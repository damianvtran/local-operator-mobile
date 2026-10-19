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
import { sessions as sessionProjections } from "@/features/session/runtime";
import {
	sessionFactsFrom,
	sessionStateFlags,
} from "@/features/session/state-marker";
import { useSessionRuntime } from "@/features/session/use-session";
import { nativeCredentialRetirement } from "./authentication-lifecycle";

vi.mock("react-native", () => ({
	Platform: { OS: "web" },
	AppState: { addEventListener: () => ({ remove() {} }) },
}));
const durable = vi.hoisted(() => ({
	oauth: null as RadientTokens | null,
	session: null as TunnelSession | null,
	events: [] as string[],
	writeBlock: null as Promise<void> | null,
	writesStarted: 0,
	clearBlock: null as Promise<void> | null,
	clearsStarted: 0,
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
		durable.clearsStarted += 1;
		await durable.clearBlock;
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
let observedSession: string | null = null;
let sessionReading: ReturnType<typeof useSessionRuntime>;
const wire: Array<{ method: string; path: string; status: number }> = [];
function SessionCapture({ id }: { id: string }) {
	sessionReading = useSessionRuntime(id);
	return null;
}
function Capture() {
	latest = useConnection();
	return observedSession
		? createElement(SessionCapture, { id: observedSession })
		: null;
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
		refuseCatalogue?: boolean;
		holdFrame?: boolean;
		holdHistory?: boolean;
		holdReloadHistory?: boolean;
		historyFailure?: boolean;
		emptyHistory?: boolean;
		privateHistory?: string;
		emptyFrame?: boolean;
		frameTitle?: string;
	} = {},
) {
	const events: string[] = [];
	let failLogout = options.failLogout;
	const loginReceived = deferred();
	const tokenReceived = deferred();
	const releaseLogin = deferred();
	const releaseToken = deferred();
	const refuseCatalogue = deferred();
	const releaseHistory = deferred();
	let historyReads = 0;
	let catalogueStreams = 0;
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
			if (failLogout) {
				events.push("logout:503");
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
			catalogueStreams += 1;
			if (options.refuseCatalogue && catalogueStreams > 1) {
				json({ detail: "Authentication required" }, 401);
				return;
			}
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
			if (options.refuseCatalogue) {
				await refuseCatalogue.promise;
				response.end();
			}
			return;
		}
		if (path.startsWith("/api/sessions/") && path.endsWith("/events")) {
			// Keep the wire open but deliver no frame: cache presence alone must
			// not authorize a retained transcript for this new screen/identity.
			if (options.holdFrame) return;
			const seed = JSON.parse(
				readFileSync(
					new URL(
						"../../../fixtures/relay/sse/sse-projection-checkpoints-empty.json",
						import.meta.url,
					),
					"utf8",
				),
			).data;
			if (options.emptyFrame) seed.entries = [];
			if (options.frameTitle) seed.conversation_name = options.frameTitle;
			response.writeHead(200, { "content-type": "text/event-stream" });
			response.write(
				`event: projection\ndata: ${JSON.stringify({ ...seed, session_id: observedSession })}\n\n`,
			);
			return;
		}
		if (path.startsWith("/api/sessions") && !path.endsWith("/history")) {
			json(body("sessions-empty"));
			return;
		}
		if (path.endsWith("/history")) {
			historyReads += 1;
			if (
				options.holdHistory ||
				(options.holdReloadHistory && historyReads > 1)
			)
				await releaseHistory.promise;
			if (response.destroyed) return;
			if (options.historyFailure) {
				json({ detail: "History unavailable" }, 503);
				return;
			}
			const page = body("history-ok");
			if (options.emptyHistory || options.holdHistory) page.entries = [];
			if (options.privateHistory)
				page.entries = [
					{
						...page.entries[0],
						id: "private-history-row",
						text: options.privateHistory,
					},
				];
			json(page);
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
		refuseCatalogue.resolve();
		releaseHistory.resolve();
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
		refuseCatalogue,
		releaseHistory,
		allowLogout: () => {
			failLogout = false;
		},
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
			wire.push({
				method: init?.method ?? "GET",
				path: url.pathname,
				status: response.status,
			});
			const cookie = response.headers.get("set-cookie");
			if (init?.credentials !== "omit" && cookie !== null)
				jars.set(url.origin, cookie.split(";")[0] ?? "");
			return response;
		},
	);
}

beforeEach(() => {
	observedSession = null;
	wire.length = 0;
	sessionProjections.getState().reset();
	durable.oauth = null;
	durable.session = null;
	durable.events = [];
	durable.writeBlock = null;
	durable.writesStarted = 0;
	durable.clearBlock = null;
	durable.clearsStarted = 0;
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
		let exiting!: Promise<boolean>;
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
		let exiting!: Promise<boolean>;
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
		let exiting!: Promise<boolean>;
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

	it.each(["pending", "ready"])(
		"an explicit logout failure remains refused across remount from %s login",
		async (state) => {
			const mock = await relay({
				holdLogin: state === "pending",
				failLogout: true,
			});
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
			if (state === "ready")
				await act(async () => {
					await connecting;
				});
			let exiting!: Promise<boolean>;
			await act(async () => {
				exiting = latest.signOut();
			});
			mock.releaseLogin.resolve();
			await act(async () => {
				await Promise.all([connecting, exiting]);
			});
			expect(await exiting).toBe(false);
			expect(
				mock.events.filter((event) => event === "logout:503"),
			).toHaveLength(state === "pending" ? 2 : 1);
			const signoutFailure = latest.lastError;
			expect(jars.get(mock.origin)).toBe("lop_mobile=synthetic-1");
			await unmount();
			const before = mock.events.length;
			vi.stubGlobal("location", {
				origin: mock.origin,
				protocol: "http:",
				search: "",
			});
			await mount();
			expect(latest.relay()).toBeNull();
			expect(connectionStore.getState().phase).toBe("refused");
			expect(latest.coldStartSettled).toBe(true);
			expect(mock.events.slice(before)).toEqual([]);
			expect(signoutFailure?.kind).toBe("transport");
			// A genuinely new explicit login may replace failed ownership. No old
			// cleanup is allowed to run after it and erase the newly admitted cookie.
			await act(async () => {
				await latest.connectCustom({
					url: mock.origin,
					password: "new",
					allowInsecure: true,
				});
			});
			expect(latest.relay()).not.toBeNull();
			expect(jars.get(mock.origin)).toBe("lop_mobile=synthetic-2");
			mock.allowLogout();
			await act(async () => {
				expect(await latest.signOut()).toBe(true);
			});
			expect(latest.lastError).toBeNull();
			expect(jars.get(mock.origin)).toBe("lop_mobile=");
			await unmount();
			const after = mock.events.length;
			await mount();
			expect(latest.relay()).toBeNull();
			expect(mock.events.slice(after)).toEqual(["GET /api/sessions"]);
		},
	);

	it("a successful explicit logout retry clears a failed cleanup barrier", async () => {
		const mock = await relay({ failLogout: true });
		transport();
		await mount();
		await act(async () => {
			await latest.connectCustom({
				url: mock.origin,
				password: "synthetic",
				allowInsecure: true,
			});
		});
		await act(async () => {
			await latest.signOut();
		});
		expect(latest.lastError?.kind).toBe("transport");
		const attempts = mock.events.filter(
			(event) => event === "logout:503",
		).length;
		await act(async () => {
			await latest.retry();
		});
		expect(latest.lastError?.kind).toBe("transport");
		expect(mock.events.filter((event) => event === "logout:503")).toHaveLength(
			attempts + 1,
		);
		mock.allowLogout();
		await act(async () => {
			await latest.retry();
		});
		expect(latest.lastError).toBeNull();
		expect(connectionStore.getState().phase).toBe("signed-out");
		expect(jars.get(mock.origin)).toBe("lop_mobile=");
		await unmount();
		const before = mock.events.length;
		vi.stubGlobal("location", {
			origin: mock.origin,
			protocol: "http:",
			search: "",
		});
		await mount();
		expect(latest.relay()).toBeNull();
		expect(mock.events.slice(before)).toEqual(["GET /api/sessions"]);
	});

	it("consumes the typed logout failure when forgetting the active custom route", async () => {
		const mock = await relay({ failLogout: true });
		transport();
		await mount();
		await act(async () => {
			await latest.connectCustom({
				url: mock.origin,
				password: "synthetic",
				allowInsecure: true,
			});
		});
		await act(async () => {
			await latest.removeCustomRoute();
		});
		expect(latest.lastError?.kind).toBe("transport");
		await unmount();
		const before = mock.events.length;
		vi.stubGlobal("location", {
			origin: mock.origin,
			protocol: "http:",
			search: "",
		});
		await mount();
		expect(latest.relay()).toBeNull();
		expect(connectionStore.getState().phase).toBe("refused");
		expect(mock.events.slice(before)).toEqual([]);
	});

	it.each(["ready", "pending"])(
		"ordinary repeated Sign out retains the failed revocation from %s login",
		async (state) => {
			const mock = await relay({
				holdLogin: state === "pending",
				failLogout: true,
			});
			transport();
			await mount();
			let connecting!: Promise<void>;
			await act(async () => {
				connecting = latest.connectCustom({
					url: mock.origin,
					password: "test-only",
					allowInsecure: true,
				});
			});
			await mock.loginReceived.promise;
			if (state === "ready")
				await act(async () => {
					await connecting;
				});
			let first!: Promise<boolean>;
			await act(async () => {
				first = latest.signOut();
			});
			mock.releaseLogin.resolve();
			await act(async () => {
				await Promise.all([connecting, first]);
			});
			expect(await first).toBe(false);
			const attempts = mock.events.filter(
				(event) => event === "GET /logout",
			).length;
			await act(async () => {
				expect(await latest.signOut()).toBe(false);
			});
			expect(
				mock.events.filter((event) => event === "GET /logout"),
			).toHaveLength(attempts + 1);
			expect(latest.lastError?.kind).toBe("transport");
			expect(connectionStore.getState().phase).toBe("refused");
			expect(jars.get(mock.origin)).not.toBe("lop_mobile=");
			mock.allowLogout();
			await act(async () => {
				expect(await latest.signOut()).toBe(true);
			});
			expect(mock.events.slice(-2)).toEqual([
				"GET /logout",
				"logout:cookie-cleared",
			]);
			expect(
				mock.events.filter((event) => event === "GET /logout"),
			).toHaveLength(attempts + 2);
			expect(latest.lastError).toBeNull();
			expect(jars.get(mock.origin)).toBe("lop_mobile=");
			await unmount();
			const before = mock.events.length;
			vi.stubGlobal("location", {
				origin: mock.origin,
				protocol: "http:",
				search: "",
			});
			await mount();
			expect(latest.relay()).toBeNull();
			expect(mock.events.slice(before)).toEqual(["GET /api/sessions"]);
		},
	);

	it("a new origin replaces unresolved revocation ownership before ordinary Sign out", async () => {
		const old = await relay({ failLogout: true });
		const current = await relay();
		transport();
		await mount();
		await act(async () => {
			await latest.connectCustom({
				url: old.origin,
				password: "test-only",
				allowInsecure: true,
			});
		});
		await act(async () => {
			expect(await latest.signOut()).toBe(false);
		});
		const retiredRequests = old.events.length;
		await act(async () => {
			await latest.connectCustom({
				url: current.origin,
				password: "test-only",
				allowInsecure: true,
			});
		});
		await act(async () => {
			expect(await latest.signOut()).toBe(true);
		});
		expect(old.events).toHaveLength(retiredRequests);
		expect(current.events.slice(-2)).toEqual([
			"GET /logout",
			"logout:cookie-cleared",
		]);
		expect(jars.get(current.origin)).toBe("lop_mobile=");
	});

	it("ordinary Sign out retries the retained revocation after forgetting a route", async () => {
		const mock = await relay({ failLogout: true });
		transport();
		await mount();
		await act(async () => {
			await latest.connectCustom({
				url: mock.origin,
				password: "test-only",
				allowInsecure: true,
			});
		});
		durable.oauth = oauth;
		await act(async () => {
			await latest.removeCustomRoute();
		});
		expect(durable.oauth).toBe(oauth);
		await act(async () => {
			expect(await latest.signOut()).toBe(false);
		});
		expect(mock.events.filter((event) => event === "GET /logout")).toHaveLength(
			2,
		);
		expect(latest.lastError?.kind).toBe("transport");
		expect(durable.oauth).toBeNull();
		mock.allowLogout();
		await act(async () => {
			expect(await latest.signOut()).toBe(true);
		});
		expect(jars.get(mock.origin)).toBe("lop_mobile=");
	});

	it("concurrent ordinary Sign out confirmations share their pending remote attempt", async () => {
		const mock = await relay({ holdLogin: true, failLogout: true });
		transport();
		await mount();
		let connecting!: Promise<void>;
		await act(async () => {
			connecting = latest.connectCustom({
				url: mock.origin,
				password: "test-only",
				allowInsecure: true,
			});
		});
		await mock.loginReceived.promise;
		let first!: Promise<boolean>;
		let second!: Promise<boolean>;
		await act(async () => {
			first = latest.signOut();
			second = latest.signOut();
		});
		mock.releaseLogin.resolve();
		await act(async () => {
			await Promise.all([connecting, first, second]);
		});
		expect(await first).toBe(false);
		expect(await second).toBe(false);
		// One compensating logout plus one shared explicit logout, not an extra
		// request per confirmation while that same operation remains in flight.
		expect(mock.events.filter((event) => event === "GET /logout")).toHaveLength(
			2,
		);
		expect(latest.lastError?.kind).toBe("transport");
	});

	it.each(["replace", "retain", "failure"])(
		"checks ownership after the final held durable clear: %s",
		async (mode) => {
			const old = await relay({ failLogout: true });
			transport();
			await mount();
			await act(async () => {
				await latest.connectCustom({
					url: old.origin,
					password: "test-only",
					allowInsecure: true,
				});
			});
			await act(async () => {
				expect(await latest.signOut()).toBe(false);
			});
			const clear = deferred();
			durable.clearBlock = clear.promise;
			if (mode !== "failure") old.allowLogout();
			let exiting!: Promise<boolean>;
			let completed = false;
			await act(async () => {
				exiting = latest.signOut();
				void exiting.then(() => {
					completed = true;
				});
			});
			await until(() => durable.clearsStarted === 2);
			// The successful remote attempt has fully settled, not just been sent,
			// while the outer API still waits on its separate durable-clear await.
			await until(() =>
				mode === "failure"
					? old.events.filter((event) => event === "logout:503").length === 2
					: latest.lastError === null,
			);
			expect(completed).toBe(false);
			const current = mode === "retain" ? null : await relay();
			if (current)
				await act(async () => {
					await latest.connectCustom({
						url: current.origin,
						password: "test-only",
						allowInsecure: true,
					});
				});
			const currentClient = latest.relay();
			const currentCookie = current ? jars.get(current.origin) : null;
			clear.resolve();
			await act(async () => {
				await exiting;
			});
			expect(await exiting).toBe(mode === "retain");
			if (current) {
				expect(latest.relay()).toBe(currentClient);
				expect(currentClient).not.toBeNull();
				expect(connectionStore.getState().route).toMatchObject({
					baseUrl: current.origin,
				});
				expect(connectionStore.getState().phase).toBe("live");
				expect(latest.lastError).toBeNull();
				expect(jars.get(current.origin)).toBe(currentCookie);
			} else {
				expect(jars.get(old.origin)).toBe("lop_mobile=");
				expect(latest.lastError).toBeNull();
			}
		},
	);

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
		let exiting!: Promise<boolean>;
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

describe("session runtime shared-route refusal", () => {
	it.each([false, true])(
		"publishes honest session state when catalogue refusal is %s",
		async (refused) => {
			const mock = await relay({ refuseCatalogue: refused });
			observedSession = "synthetic-session";
			transport();
			await mount();
			expect(sessionReading.error).toBeNull();
			await act(async () => {
				await latest.connectCustom({
					url: mock.origin,
					password: "test-only",
					allowInsecure: true,
				});
			});
			await until(() => sessionReading.projection !== null);
			expect(sessionReading.content).toBe("transcript");
			if (refused) {
				// A real first session frame has landed. Refuse only the catalogue's
				// reconnect, leaving the session channel healthy until route readiness
				// withdraws it: the session consumer still owns the shared typed failure.
				mock.refuseCatalogue.resolve();
				await until(() => latest.lastError !== null);
				expect(latest.lastError?.kind).toBe("relay-unauthorized");
				expect(sessionReading.error).toMatchObject({
					kind: "relay-unauthorized",
				});
				expect(sessionReading.source.endpoints).toBeNull();
				expect(wire).toContainEqual({
					method: "GET",
					path: "/api/sessions/events",
					status: 401,
				});
			} else {
				expect(sessionReading.error).toBeNull();
				expect(sessionReading.source.endpoints).not.toBeNull();
			}
			const flags = sessionStateFlags(
				sessionFactsFrom({
					projection: sessionReading.projection,
					streaming: sessionReading.streaming,
					error: sessionReading.error !== null,
					entries: sessionReading.entries,
					subagents: 0,
					micVisible: false,
				}),
			);
			expect(flags.error).toBe(refused);
			expect(sessionReading.content).toBe("transcript");
			if (refused) {
				const count = wire.length;
				await expect(
					sessionReading.supplementCommand(
						"cancel",
						"synthetic-anchor",
						"synthetic-job",
					),
				).rejects.toThrow("no relay route");
				expect(wire).toHaveLength(count);
				// Same-address re-selection is a NEW revision, not permission to
				// reuse the old frame. Explicit sign-out never revives it either.
				const selected = connectionStore.getState().route;
				if (selected === null)
					throw new Error("Expected retained selected route");
				await act(async () => connectionStore.getState().startRoute(selected));
				expect(sessionReading.content).toBe("loading");
				expect(sessionReading.projection).toBeNull();
				expect(sessionReading.entries).toEqual([]);
				await act(async () => connectionStore.getState().endRoute());
				expect(sessionReading.content).toBe("disconnected");
				expect(sessionReading.projection).toBeNull();
				expect(sessionReading.entries).toEqual([]);
				expect(sessionReading.streaming).toBe(false);
			}
			// The ordinary cold-start gate remains intact for both success/refusal.
			expect(wire[0]).toEqual({ method: "POST", path: "/login", status: 303 });
		},
	);
});

describe("session recovery without an owned frame", () => {
	it("keeps refused first-load recovery honest even when process cache already contains rows", async () => {
		const mock = await relay({ refuseCatalogue: true, holdFrame: true });
		observedSession = "synthetic-session";
		const cached = JSON.parse(
			readFileSync(
				new URL(
					"../../../fixtures/relay/sse/sse-projection-checkpoints-empty.json",
					import.meta.url,
				),
				"utf8",
			),
		).data;
		sessionProjections.getState().applyFrame(observedSession, {
			...cached,
			session_id: observedSession,
			conversation_name: "PRIVATE_OLD_TITLE",
			streaming: true,
		});
		transport();
		await mount();
		await act(async () => {
			await latest.connectCustom({
				url: mock.origin,
				password: "synthetic-password",
				allowInsecure: true,
			});
		});
		expect(sessionReading.projection).toBeNull();
		expect(sessionReading.entries).toEqual([]);
		expect(sessionReading.streaming).toBe(false);
		expect(sessionReading.streamingRowId).toBeNull();
		expect(sessionReading.supplements).toEqual({});
		expect(sessionReading.projectionPid).toBe(0);
		expect(sessionReading.commands).toEqual([]);
		expect(sessionReading.models).toEqual([]);
		expect(sessionReading.content).toBe("loading");
		mock.refuseCatalogue.resolve();
		await until(() => latest.lastError !== null);
		expect(sessionReading.content).toBe("recovery");
		expect(sessionReading.projection).toBeNull();
		expect(sessionReading.entries).toEqual([]);
		expect(sessionReading.streaming).toBe(false);
		expect(sessionReading.source.reason).toBe("refused");
		expect(sessionReading.source.endpoints).toBeNull();
		expect(sessionReading.error?.kind).toBe("relay-unauthorized");
		expect(sessionReading.connection.action).not.toBeNull();
		await unmount();
		await mount();
		expect(sessionReading.content).not.toBe("transcript");
		expect(sessionReading.projection).toBeNull();
		expect(sessionReading.entries).toEqual([]);
		expect(sessionReading.streaming).toBe(false);
	});
});

describe("session ownership across routes", () => {
	it.each(["held", "503", "empty", "late-A"])(
		"never merges A history into an owned B frame while B history is %s",
		async (mode) => {
			const marker = "PRIVATE_A_HISTORY";
			const a = await relay({
				privateHistory: marker,
				frameTitle: "PRIVATE_A_TITLE",
				holdReloadHistory: mode === "late-A",
			});
			const b = await relay({
				emptyFrame: true,
				frameTitle: "CURRENT_B_TITLE",
				emptyHistory: true,
				holdHistory: mode === "held",
				historyFailure: mode === "503",
			});
			observedSession = "shared-session-id";
			transport();
			await mount();
			await act(async () => {
				await latest.connectCustom({
					url: a.origin,
					password: "local-test-password",
					allowInsecure: true,
				});
			});
			await until(() =>
				sessionReading.entries.some((row) => row.text.includes(marker)),
			);
			expect(sessionReading.content).toBe("transcript");
			if (mode === "late-A") {
				await act(async () => sessionReading.reload());
				await until(
					() =>
						a.events.filter((event) => event.endsWith("/history")).length === 2,
				);
			}
			await act(async () => {
				await latest.connectCustom({
					url: b.origin,
					password: "local-test-password",
					allowInsecure: true,
				});
			});
			await until(
				() =>
					sessionReading.projection?.conversation_name === "CURRENT_B_TITLE",
			);
			expect(sessionReading.source.baseUrl).toBe(b.origin);
			expect(sessionReading.content).toBe("transcript");
			expect(sessionReading.entries).toEqual([]);
			expect(JSON.stringify(sessionReading.projection)).not.toContain(
				"PRIVATE_A",
			);
			if (mode === "held") b.releaseHistory.resolve();
			if (mode === "late-A") {
				a.releaseHistory.resolve();
				// Observe the late A response itself, not just a quiet B render.
				// A's initial page + B's page + the retired A reload must all arrive.
				await until(
					() =>
						wire.filter(
							(request) =>
								request.path.endsWith("/history") && request.status === 200,
						).length === 3,
				);
			}
			await until(() => !sessionReading.loading);
			await act(async () => {
				await new Promise<void>((resolve) => setTimeout(resolve, 30));
			});
			expect(sessionReading.entries).toEqual([]);
			expect(sessionReading.projection?.conversation_name).toBe(
				"CURRENT_B_TITLE",
			);
			if (mode === "503")
				expect(wire).toContainEqual({
					method: "GET",
					path: `/api/sessions/${observedSession}/history`,
					status: 503,
				});
		},
	);
});
