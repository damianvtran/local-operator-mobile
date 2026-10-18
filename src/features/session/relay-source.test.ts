import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
	type CustomRoute,
	createRelayClient,
	signInToCustomRoute,
	signOutOfCustomRoute,
} from "@/connection";
import { CustomRouteAuthentication } from "@/features/auth/authentication-lifecycle";
import {
	authenticateCustomRoute,
	routeAdmission,
} from "@/features/auth/route-admission";
import { type RelayEndpoints, RelayError } from "@/relay";
import { createConnectionStore, isUsable } from "@/state/connection-store";
import { relaySource } from "./relay-source";

const fixture = (name: string) =>
	JSON.parse(
		readFileSync(
			new URL(`../../../fixtures/relay/${name}`, import.meta.url),
			"utf8",
		),
	);
const close: Array<() => Promise<void>> = [];
afterEach(async () => {
	await Promise.all(close.splice(0).map((stop) => stop()));
});

const deferred = () => {
	let resolve = () => {};
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
};

async function relay() {
	const events: string[] = [];
	const receivedLogin = deferred();
	const releaseLogin = deferred();
	const fetchImpl = globalThis.fetch;
	let cookie = "";
	let expired = false;
	const server = createServer(async (request, response) => {
		events.push(`${request.method} ${request.url}`);
		if (request.url === "/logout") {
			response.writeHead(303, {
				"set-cookie": "lop_mobile=; Path=/",
				location: "/login",
			});
			response.end();
			return;
		}
		if (request.url === "/login") {
			let body = "";
			for await (const chunk of request) body += chunk;
			receivedLogin.resolve();
			await releaseLogin.promise;
			const accepted =
				new URLSearchParams(body).get("password") === "synthetic-password";
			const status = accepted ? 303 : 401;
			events.push(`POST /login -> ${status}`);
			response.writeHead(
				status,
				accepted
					? { "set-cookie": "lop_mobile=synthetic; Path=/", location: "/" }
					: {},
			);
			response.end();
			return;
		}
		if (expired || !request.headers.cookie?.includes("lop_mobile=synthetic")) {
			events.push("protected -> 401");
			response.writeHead(401, { "content-type": "application/json" });
			response.end(JSON.stringify({ detail: "Authentication required" }));
			return;
		}
		if (request.url?.endsWith("/events")) {
			response.writeHead(200, { "content-type": "text/event-stream" });
			response.end(
				`event: projection\ndata: ${JSON.stringify(fixture("sse/sse-projection-checkpoints-empty.json").data)}\n\n`,
			);
			return;
		}
		const name = request.url?.endsWith("/history")
			? "history-ok"
			: request.url?.endsWith("/checkpoints")
				? "checkpoints-empty"
				: request.url === "/api/commands"
					? "commands"
					: "models";
		response.writeHead(200, { "content-type": "application/json" });
		response.end(JSON.stringify(fixture(`http/${name}.json`).body));
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	close.push(
		() =>
			new Promise<void>((resolve) => {
				server.closeAllConnections();
				server.close(() => resolve());
			}),
	);
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("No listener");
	const route: CustomRoute = {
		mode: "custom",
		baseUrl: `http://127.0.0.1:${address.port}`,
		allowInsecure: true,
	};
	// Node has no platform cookie jar. This test-only adapter models that transport
	// behavior while all login and protected requests still cross a real socket.
	const fetchWithJar: typeof fetch = async (input, init) => {
		const headers = new Headers(init?.headers);
		if (cookie) headers.set("cookie", cookie);
		const response = await fetchImpl(input, { ...init, headers });
		const setCookie = response.headers.get("set-cookie");
		if (setCookie) cookie = setCookie.split(";")[0] ?? "";
		return response;
	};
	const authentication = new CustomRouteAuthentication({
		signIn: (route, password) =>
			signInToCustomRoute(route, password, { fetchImpl: fetchWithJar }),
		signOut: (route) =>
			signOutOfCustomRoute(route, { fetchImpl: fetchWithJar }),
	});
	return {
		authentication,
		route,
		events,
		receivedLogin,
		releaseLogin,
		fetchWithJar,
		expire: () => {
			expired = true;
		},
	};
}

describe("session admission", () => {
	it("waits for login before history, commands, models, checkpoints or the session stream", async () => {
		const mock = await relay();
		const store = createConnectionStore();
		let client: RelayEndpoints | null = null;
		const source = () =>
			relaySource(
				store.getState().route,
				isUsable(store.getState()) ? client : null,
				store.getState().phase === "minting",
			);
		expect(source().endpoints).toBeNull();
		store.getState().startRoute(mock.route);
		const admission = routeAdmission(store, () => true);
		const authenticating = authenticateCustomRoute(
			mock.route,
			"synthetic-password",
			admission,
			mock.authentication,
		);
		await mock.receivedLogin.promise;
		expect(source().reason).toBe("pending");
		expect(source().endpoints).toBeNull();
		expect(mock.events).toEqual(["POST /login"]);
		mock.releaseLogin.resolve();
		expect(await authenticating).toBe(true);
		expect(
			admission.publish(() => {
				client = createRelayClient({
					route: mock.route,
					fetchImpl: mock.fetchWithJar,
				});
			}),
		).toBe(true);
		const endpoints = source().endpoints;
		if (!endpoints) throw new Error("Client was not admitted");
		const history = await endpoints.history("synthetic-session");
		expect(history.entries[0]?.text).toBe("Hello from the mock provider!");
		await Promise.all([
			endpoints.commands(),
			endpoints.models(),
			endpoints.checkpoints("synthetic-session"),
		]);
		const framed = deferred();
		const stream = endpoints.sessionStream("synthetic-session", {
			onFrame: () => framed.resolve(),
		});
		stream.connection.start();
		try {
			await framed.promise;
		} finally {
			stream.stop();
		}
		expect(mock.events.slice(0, 2)).toEqual([
			"POST /login",
			"POST /login -> 303",
		]);
		expect(mock.events.slice(2).sort()).toEqual(
			[
				"GET /api/sessions/synthetic-session/history",
				"GET /api/commands",
				"GET /api/models",
				"GET /api/sessions/synthetic-session/checkpoints",
				"GET /api/sessions/synthetic-session/events",
			].sort(),
		);
		expect(mock.events).not.toContain("protected -> 401");
	});

	it("reports a wrong password without protected requests or an automatic retry", async () => {
		const mock = await relay();
		const store = createConnectionStore();
		store.getState().startRoute(mock.route);
		const admission = routeAdmission(store, () => true);
		const authenticating = authenticateCustomRoute(
			mock.route,
			"incorrect",
			admission,
			mock.authentication,
		).catch((error: unknown) => error);
		await mock.receivedLogin.promise;
		mock.releaseLogin.resolve();
		const error = await authenticating;
		expect(error).toBeInstanceOf(RelayError);
		if (!(error instanceof RelayError)) throw new Error("Missing refusal");
		expect(error.surface).toBe("password");
		store.getState().noteFailure({
			surface: error.surface,
			displayableMessage: error.displayableMessage,
		});
		expect(isUsable(store.getState())).toBe(false);
		expect(mock.events).toEqual(["POST /login", "POST /login -> 401"]);
	});

	it("surfaces expired admission instead of retrying or treating it as pending", async () => {
		const mock = await relay();
		const store = createConnectionStore();
		store.getState().startRoute(mock.route);
		const admission = routeAdmission(store, () => true);
		const authenticating = authenticateCustomRoute(
			mock.route,
			"synthetic-password",
			admission,
			mock.authentication,
		);
		await mock.receivedLogin.promise;
		mock.releaseLogin.resolve();
		expect(await authenticating).toBe(true);
		const client = createRelayClient({
			route: mock.route,
			fetchImpl: mock.fetchWithJar,
			onResponse: (facts) => {
				if (admission.isCurrent() && facts.status === 401)
					store
						.getState()
						.noteFailure({ surface: "password", displayableMessage: "" });
			},
		});
		admission.publish(() => undefined);
		mock.expire();
		await expect(client.history("synthetic-session")).rejects.toMatchObject({
			kind: "relay-unauthorized",
		});
		expect(isUsable(store.getState())).toBe(false);
		expect(
			relaySource(mock.route, isUsable(store.getState()) ? client : null, false)
				.reason,
		).toBe("no-route");
		expect(store.getState().surface).toBe("password");
		expect(mock.events).toEqual([
			"POST /login",
			"POST /login -> 303",
			"GET /api/sessions/synthetic-session/history",
			"protected -> 401",
		]);
	});

	it.each(["switch", "sign-out", "unmount"])(
		"revokes a pending admission on %s",
		async (action) => {
			const mock = await relay();
			const store = createConnectionStore();
			let mounted = true;
			store.getState().startRoute(mock.route);
			const admission = routeAdmission(store, () => mounted);
			const authenticating = authenticateCustomRoute(
				mock.route,
				"synthetic-password",
				admission,
				mock.authentication,
			);
			await mock.receivedLogin.promise;
			if (action === "switch")
				store
					.getState()
					.startRoute({ ...mock.route, baseUrl: "http://127.0.0.1:1" });
			else if (action === "sign-out") store.getState().endRoute();
			else mounted = false;
			mock.releaseLogin.resolve();
			expect(await authenticating).toBe(false);
			let published = false;
			expect(
				admission.publish(() => {
					published = true;
				}),
			).toBe(false);
			expect(published).toBe(false);
			expect(isUsable(store.getState())).toBe(false);
			expect(mock.events).toEqual([
				"POST /login",
				"POST /login -> 303",
				"GET /logout",
			]);
		},
	);

	it("does not expose a previously ready client after switching or signing out", () => {
		const store = createConnectionStore();
		const route: CustomRoute = {
			mode: "custom",
			baseUrl: "http://127.0.0.1:1",
			allowInsecure: true,
		};
		store.getState().startRoute(route);
		const admission = routeAdmission(store, () => true);
		const client = createRelayClient({ route });
		admission.publish(() => undefined);
		const source = () =>
			relaySource(
				store.getState().route,
				isUsable(store.getState()) ? client : null,
				store.getState().phase === "minting",
			);
		expect(source().endpoints).toBe(client);
		store.getState().startRoute(route);
		expect(source().endpoints).toBeNull();
		store.getState().endRoute();
		expect(source().endpoints).toBeNull();
		expect(source().reason).toBe("no-route");
	});
});
