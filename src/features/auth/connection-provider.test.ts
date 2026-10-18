import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	DiscoveredComputer,
	RadientTokens,
	TunnelSession,
} from "@/connection";
import {
	ConnectionProvider,
	connectionStore,
	useConnection,
} from "@/features/auth/connection-provider";

import { nativeCredentialRetirement } from "./authentication-lifecycle";

vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
const durable = vi.hoisted(() => ({
	oauth: null as RadientTokens | null,
	session: null as TunnelSession | null,
	events: [] as string[],
	writeBlock: null as Promise<void> | null,
	writesStarted: 0,
}));
vi.mock("@/features/auth/tunnel-storage", () => ({
	readSavedTunnel: async () => null,
	readStoredOauth: async () => durable.oauth,
	readStoredTunnelSession: async () => durable.session,
	writeStoredTunnelSession: async (session: TunnelSession) => {
		durable.writesStarted += 1;
		await durable.writeBlock;
		durable.events.push(`persist:${session.tunnelId}`);
		durable.session = session;
	},
	clearStoredCredentials: async () => {
		durable.events.push("clear");
		durable.oauth = null;
		durable.session = null;
	},
	clearStoredOauth: async () => {
		durable.oauth = null;
	},
	removeSavedTunnel: async () => {},
	writeSavedTunnel: async () => {},
	writeStoredOauth: async () => ({ persistent: false }),
}));

/** The existing modal hook tests use ReactDOM's client renderer with a small
 * Node DOM host. This provider renders no host elements, so only the container,
 * document event target and focus constructors are needed. Hooks, effects, store
 * subscriptions, authentication, endpoints and stream timers are production code.
 * This is mounted lifecycle proof, not browser pixels or native-device proof. */
let root: ReturnType<typeof createRoot> | null = null;
let latest: ReturnType<typeof useConnection>;
const cleanup: Array<() => Promise<void>> = [];
function Capture() {
	latest = useConnection();
	return null;
}
async function mount() {
	const doc = {
		nodeType: 9,
		activeElement: null,
		addEventListener() {},
		removeEventListener() {},
	};
	vi.stubGlobal("window", {
		document: doc,
		HTMLIFrameElement: class {},
		HTMLElement: class {},
		addEventListener() {},
		removeEventListener() {},
	});
	vi.stubGlobal("document", doc);
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	const container = {
		nodeType: 1,
		nodeName: "DIV",
		tagName: "DIV",
		namespaceURI: "http://www.w3.org/1999/xhtml",
		ownerDocument: doc,
		addEventListener() {},
		removeEventListener() {},
	};
	root = createRoot(container as unknown as Element);
	await act(async () => {
		root?.render(
			createElement(ConnectionProvider, null, createElement(Capture)),
		);
	});
	await until(() => latest.coldStartSettled);
}
async function unmount() {
	await act(async () => {
		root?.unmount();
		root = null;
	});
}
async function until(test: () => boolean) {
	const deadline = Date.now() + 1500;
	while (!test()) {
		if (Date.now() > deadline)
			throw new Error("Provider did not reach the expected state");
		await act(async () => {
			await new Promise<void>((resolve) => setImmediate(resolve));
		});
	}
}
const deferred = () => {
	let resolve = () => {};
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
};
const body = (name: string) =>
	JSON.parse(
		readFileSync(
			new URL(`../../../fixtures/relay/http/${name}.json`, import.meta.url),
			"utf8",
		),
	).body;

const computer = (id: string): DiscoveredComputer => ({
	tunnelId: id,
	hostname: `${id.padEnd(32, "a")}-lop.radienthq.com`,
	name: "Synthetic computer",
	deviceId: "synthetic-device",
	status: "ready",
	rawStatus: "active",
	supportsLocalOperator: true,
	billing: { eligible: true, message: null },
	updatedAt: 0,
});
const oauth: RadientTokens = {
	access: "synthetic-oauth",
	refresh: null,
	expires_at: Number.MAX_SAFE_INTEGER,
	scope: "",
	token_type: "Bearer",
	account_label: null,
};

async function relay(
	options: {
		holdLogin?: boolean;
		holdToken?: boolean;
		failStream?: boolean;
		failLogout?: boolean;
	} = {},
) {
	const events: string[] = [];
	const loginReceived = deferred();
	const tokenReceived = deferred();
	const releaseLogin = deferred();
	const releaseToken = deferred();
	let loginCount = 0;
	let tokenCount = 0;
	let codeCount = 0;
	let failedStream = false;
	const server = createServer(async (request, response) => {
		const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
		events.push(`${request.method} ${path}`);
		for await (const _chunk of request) {
			/* Drain the real request body before answering. */
		}
		const json = (value: unknown, status = 200) => {
			response.writeHead(status, { "content-type": "application/json" });
			response.end(JSON.stringify(value));
		};
		if (path === "/v1/tunnels") {
			json({ msg: "ok", result: [] });
			return;
		}
		if (path === "/v1/tunnels/session/code") {
			json({ code: `synthetic-code-${++codeCount}` });
			return;
		}
		if (path === "/v1/tunnels/session/token") {
			const token = ++tokenCount;
			tokenReceived.resolve();
			if (token === 1 && options.holdToken) await releaseToken.promise;
			events.push(`token:${token}:issued`);
			json({
				access_token: `synthetic-grant-${token}`,
				refresh_token: `synthetic-handle-${token}`,
				expires_in: 300,
				refresh_expires_in: 2592000,
			});
			return;
		}
		if (path === "/_radient/logout") {
			json({ detail: "Use control-plane fallback" }, 503);
			return;
		}
		if (path === "/v1/tunnels/session/logout") {
			durable.events.push("revoke");
			json({ msg: "ok" });
			return;
		}
		if (path === "/login") {
			const login = ++loginCount;
			loginReceived.resolve();
			if (login === 1 && options.holdLogin) await releaseLogin.promise;
			events.push(`login:${login}:cookie`);
			response.writeHead(303, {
				location: "/",
				"set-cookie": `lop_mobile=synthetic-${login}; Path=/`,
			});
			response.end();
			return;
		}
		if (path === "/logout") {
			if (options.failLogout) {
				response.writeHead(503);
				response.end("Synthetic logout unavailable");
				return;
			}
			events.push("logout:cookie-cleared");
			response.writeHead(303, {
				location: "/login",
				"set-cookie": "lop_mobile=; Max-Age=0; Path=/",
			});
			response.end();
			return;
		}
		if (!request.headers.cookie?.includes("=synthetic")) {
			json({ detail: "Authentication required" }, 401);
			return;
		}
		if (path === "/api/config/events") {
			json({ detail: "Not Found" }, 404);
			return;
		}
		if (path === "/api/sessions/events") {
			if (options.failStream && !failedStream) {
				failedStream = true;
				response.writeHead(503, { "content-type": "text/plain" });
				response.end("Tunnel temporarily unavailable");
				return;
			}
			response.writeHead(200, { "content-type": "text/event-stream" });
			response.write(
				`event: sessions\ndata: ${JSON.stringify(body("sessions-empty"))}\n\n`,
			);
			return;
		}
		if (path.startsWith("/api/sessions") && !path.endsWith("/history")) {
			json(body("sessions-empty"));
			return;
		}
		if (path.endsWith("/history")) {
			json(body("history-ok"));
			return;
		}
		if (path === "/api/models") {
			json(body("models"));
			return;
		}
		json({ detail: "Unknown synthetic route" }, 404);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	cleanup.push(async () => {
		releaseLogin.resolve();
		releaseToken.resolve();
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});
	const address = server.address();
	if (!address || typeof address === "string")
		throw new Error("No loopback listener");
	return {
		origin: `http://127.0.0.1:${address.port}`,
		events,
		loginReceived,
		tokenReceived,
		releaseLogin,
		releaseToken,
	};
}

const SYNTHETIC_HOST = /^[ab]{32}-lop\.radienthq\.com$/;
const actualFetch = globalThis.fetch;
let jars: Map<string, string>;
function transport(controlPlane?: string) {
	vi.stubGlobal(
		"fetch",
		async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
			const url = new URL(String(input));
			const syntheticRemote =
				url.hostname === "api.radienthq.com" ||
				SYNTHETIC_HOST.test(url.hostname);
			if (url.hostname !== "127.0.0.1" && !syntheticRemote)
				throw new Error("Test forbids non-synthetic traffic");
			const target = syntheticRemote
				? `${controlPlane}${url.pathname}${url.search}`
				: url.href;
			if (syntheticRemote && !controlPlane)
				throw new Error("No synthetic control plane");
			const headers = new Headers(init?.headers);
			if (init?.credentials !== "omit" && jars.has(url.origin))
				headers.set("cookie", jars.get(url.origin) ?? "");
			const response = await actualFetch(target, { ...init, headers });
			const cookie = response.headers.get("set-cookie");
			if (init?.credentials !== "omit" && cookie !== null)
				jars.set(url.origin, cookie.split(";")[0] ?? "");
			return response;
		},
	);
}

beforeEach(() => {
	durable.oauth = null;
	durable.session = null;
	durable.events = [];
	durable.writeBlock = null;
	durable.writesStarted = 0;
	jars = new Map();
	connectionStore.getState().endRoute();
});
afterEach(async () => {
	await unmount();
	await nativeCredentialRetirement.settled();
	await Promise.all(cleanup.splice(0).map((stop) => stop()));
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("mounted provider authentication retirement", () => {
	it("drains a late native mint, revokes its session, then clears durable credentials", async () => {
		const mock = await relay({ holdToken: true });
		transport(mock.origin);
		durable.oauth = oauth;
		await mount();
		let connecting!: Promise<void>;
		await act(async () => {
			connecting = latest.selectComputer(computer("a"));
		});
		await mock.tokenReceived.promise;
		let exiting!: Promise<void>;
		await act(async () => {
			exiting = latest.signOut();
		});
		expect(latest.relay()).toBeNull();
		mock.releaseToken.resolve();
		await act(async () => {
			await Promise.all([connecting, exiting]);
		});
		expect(durable.session).toBeNull();
		expect(durable.events).toEqual(["revoke", "clear"]);
		expect(mock.events.indexOf("token:1:issued")).toBeLessThan(
			mock.events.indexOf("POST /v1/tunnels/session/logout"),
		);
		expect(connectionStore.getState().phase).toBe("signed-out");
	});

	it("retires a late native mint before the next route can persist", async () => {
		const mock = await relay({ holdToken: true });
		transport(mock.origin);
		durable.oauth = oauth;
		await mount();
		let first!: Promise<void>;
		await act(async () => {
			first = latest.selectComputer(computer("a"));
		});
		await mock.tokenReceived.promise;
		let second!: Promise<void>;
		await act(async () => {
			second = latest.selectComputer(computer("b"));
		});
		mock.releaseToken.resolve();
		await act(async () => {
			await Promise.all([first, second]);
		});
		expect(durable.events).toEqual(["revoke", "persist:b"]);
		expect(durable.session?.tunnelId).toBe("b");
		expect(connectionStore.getState().route?.mode).toBe("radient");
		expect(latest.relay()).not.toBeNull();
	});

	it("waits for an already-started durable write before final sign-out clear", async () => {
		const mock = await relay();
		transport(mock.origin);
		durable.oauth = oauth;
		const write = deferred();
		durable.writeBlock = write.promise;
		await mount();
		let connecting!: Promise<void>;
		await act(async () => {
			connecting = latest.selectComputer(computer("a"));
		});
		await until(() => durable.writesStarted === 1);
		let exiting!: Promise<void>;
		await act(async () => {
			exiting = latest.signOut();
		});
		expect(durable.events).not.toContain("clear");
		write.resolve();
		await act(async () => {
			await Promise.all([connecting, exiting]);
		});
		expect(durable.events).toEqual(["persist:a", "revoke", "clear"]);
		expect(durable.session).toBeNull();
	});

	it("revokes a native mint that finishes after the provider unmounts", async () => {
		const mock = await relay({ holdToken: true });
		transport(mock.origin);
		durable.oauth = oauth;
		await mount();
		let connecting!: Promise<void>;
		await act(async () => {
			connecting = latest.selectComputer(computer("a"));
		});
		await mock.tokenReceived.promise;
		await unmount();
		mock.releaseToken.resolve();
		await connecting;
		expect(durable.events).toEqual(["revoke"]);
		expect(durable.session).toBeNull();
	});

	it("finishes logout after a cancelled login and cannot restore its cookie on remount", async () => {
		const mock = await relay({ holdLogin: true });
		transport();
		await mount();
		let connecting!: Promise<void>;
		await act(async () => {
			connecting = latest.connectCustom({
				url: mock.origin,
				password: "synthetic",
				allowInsecure: true,
			});
		});
		await mock.loginReceived.promise;
		let exiting!: Promise<void>;
		await act(async () => {
			exiting = latest.signOut();
		});
		expect(latest.relay()).toBeNull();
		// Give an incorrectly independent logout a complete socket round trip
		// while login stays held. Correct retirement intentionally remains pending.
		await Promise.race([
			exiting,
			new Promise<void>((resolve) => setTimeout(resolve, 100)),
		]);
		mock.releaseLogin.resolve();
		await act(async () => {
			await Promise.all([connecting, exiting]);
		});
		expect(mock.events.indexOf("login:1:cookie")).toBeLessThan(
			mock.events.indexOf("GET /logout"),
		);
		expect(jars.get(mock.origin)).toBe("lop_mobile=");
		await unmount();
		vi.stubGlobal("location", {
			origin: mock.origin,
			protocol: "http:",
			search: "",
		});
		await mount();
		expect(latest.relay()).toBeNull();
		expect(connectionStore.getState().phase).not.toBe("live");
	});

	it.each(["switch", "unmount"])(
		"retires a custom cookie after pending-login %s without clearing another origin",
		async (action) => {
			const first = await relay({ holdLogin: true });
			transport();
			await mount();
			let connecting!: Promise<void>;
			await act(async () => {
				connecting = latest.connectCustom({
					url: first.origin,
					password: "old",
					allowInsecure: true,
				});
			});
			await first.loginReceived.promise;
			const second = action === "switch" ? await relay() : null;
			if (second)
				await act(async () => {
					await latest.connectCustom({
						url: second.origin,
						password: "new",
						allowInsecure: true,
					});
				});
			else await unmount();
			first.releaseLogin.resolve();
			await act(async () => {
				await connecting;
			});
			expect(jars.get(first.origin)).toBe("lop_mobile=");
			if (second) {
				expect(jars.get(second.origin)).toBe("lop_mobile=synthetic-1");
				expect(latest.relay()).not.toBeNull();
			} else {
				vi.stubGlobal("location", {
					origin: first.origin,
					protocol: "http:",
					search: "",
				});
				await mount();
				expect(latest.relay()).toBeNull();
			}
		},
	);

	it("does not silently restore a cookie when compensating logout fails", async () => {
		const mock = await relay({ holdLogin: true, failLogout: true });
		transport();
		await mount();
		let connecting!: Promise<void>;
		await act(async () => {
			connecting = latest.connectCustom({
				url: mock.origin,
				password: "synthetic",
				allowInsecure: true,
			});
		});
		await mock.loginReceived.promise;
		await unmount();
		mock.releaseLogin.resolve();
		await connecting;
		const before = mock.events.length;
		vi.stubGlobal("location", {
			origin: mock.origin,
			protocol: "http:",
			search: "",
		});
		await mount();
		expect(latest.coldStartSettled).toBe(true);
		expect(latest.relay()).toBeNull();
		expect(connectionStore.getState().phase).toBe("refused");
		expect(mock.events.slice(before)).toEqual([]);
	});

	it("does not let an old compensating logout clear a newer same-origin login", async () => {
		const mock = await relay({ holdLogin: true });
		transport();
		await mount();
		let first!: Promise<void>;
		await act(async () => {
			first = latest.connectCustom({
				url: mock.origin,
				password: "old",
				allowInsecure: true,
			});
		});
		await mock.loginReceived.promise;
		let exiting!: Promise<void>;
		let second!: Promise<void>;
		await act(async () => {
			exiting = latest.signOut();
			second = latest.connectCustom({
				url: mock.origin,
				password: "new",
				allowInsecure: true,
			});
		});
		mock.releaseLogin.resolve();
		await act(async () => {
			await Promise.all([first, exiting, second]);
		});
		expect(jars.get(mock.origin)).toBe("lop_mobile=synthetic-2");
		expect(mock.events.lastIndexOf("GET /logout")).toBeLessThan(
			mock.events.indexOf("login:2:cookie"),
		);
		expect(latest.relay()).not.toBeNull();
	});

	it.each(["sign-out", "unmount", "switch"])(
		"a queued real list-stream restart stays retired after %s",
		async (action) => {
			const mock = await relay({ failStream: true });
			transport();
			await mount();

			const timer = vi.spyOn(globalThis, "setTimeout");
			await act(async () => {
				await latest.connectCustom({
					url: mock.origin,
					password: "synthetic",
					allowInsecure: true,
				});
			});
			await until(() => timer.mock.calls.some((call) => call[1] === 2000));
			const before = mock.events.filter(
				(event) => event === "GET /api/sessions/events",
			).length;
			expect(before).toBe(1);
			if (action === "unmount") await unmount();
			else if (action === "sign-out")
				await act(async () => {
					await latest.signOut();
				});
			else {
				const other = await relay();
				await act(async () => {
					await latest.connectCustom({
						url: other.origin,
						password: "synthetic",
						allowInsecure: true,
					});
				});
			}
			await act(async () => {
				await new Promise<void>((resolve) => setTimeout(resolve, 2100));
			});
			expect(
				mock.events.filter((event) => event === "GET /api/sessions/events"),
			).toHaveLength(before);
		},
	);
});
