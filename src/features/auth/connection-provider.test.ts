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
	configureStartupAuthorizationStorage,
	getStartupAuthorization,
	startupAuthorizationLifecycle,
} from "@/connection/startup-authorization";
import { memorySecureStore, SecureStorage } from "@/connection/storage";
import {
	ConnectionProvider,
	configStore,
	connectionStore,
	PICK_UNREACHABLE_DETAIL,
	useConnection,
} from "@/features/auth/connection-provider";
import { headerHealth } from "@/features/session/health";
import { sessions as sessionProjections } from "@/features/session/runtime";
import {
	sessionFactsFrom,
	sessionStateFlags,
} from "@/features/session/state-marker";
import { useSessionRuntime } from "@/features/session/use-session";
import { activeLocale, preferredLocale } from "@/i18n";
import { registerTeamBridgeRetirement } from "@/team-bridge/retirement";
import { nativeCredentialRetirement } from "./authentication-lifecycle";
import {
	performSwitcherTap,
	switcherSections,
	switcherTap,
} from "./computer-switcher-view";

// The strict privacy adapter is supplied by the adjacent storage slice. These
// tests exercise the real provider boundary, not native filesystem/Keychain I/O.
const privacy = vi.hoisted(() => ({ calls: 0, fail: false }));
const handoff = vi.hoisted(() => ({
	block: null as Promise<void> | null,
	started: false,
}));
vi.mock("./radient-sign-in", () => ({
	beginRadientSignIn: async () => {
		handoff.started = true;
		await handoff.block;
		return { ok: true, tokens: oauth };
	},
}));
vi.mock("@/features/session/device-storage", async (importOriginal) => ({
	...(await importOriginal<object>()),
	clearAuthorizationData: async () => {
		privacy.calls += 1;
		if (privacy.fail) throw new Error("Synthetic privacy storage failure");
	},
}));

vi.mock("react-native", () => ({
	Platform: { OS: "web" },
	AppState: { addEventListener: () => ({ remove() {} }) },
}));
const durable = vi.hoisted(() => ({
	oauth: null as RadientTokens | null,
	saved: null as {
		baseUrl: string;
		password: string;
		allowInsecure: boolean;
	} | null,
	session: null as TunnelSession | null,
	events: [] as string[],
	writeBlock: null as Promise<void> | null,
	writesStarted: 0,
	clearBlock: null as Promise<void> | null,
	clearsStarted: 0,
}));
type TunnelStorageModule = typeof import("@/features/auth/tunnel-storage");
/* The saved-computers registry is the REAL module's (the web runtime, so its
 *  memory keystore): the switcher tests assert what the provider records there,
 *  and a stand-in would only prove the stand-in. Credentials stay synthetic. */
const realRegistry = () =>
	vi.importActual<TunnelStorageModule>("@/features/auth/tunnel-storage");
vi.mock("@/features/auth/tunnel-storage", () => ({
	rememberLiveComputer: async (
		...args: Parameters<TunnelStorageModule["rememberLiveComputer"]>
	) => (await realRegistry()).rememberLiveComputer(...args),
	readSavedTunnel: async () => durable.saved,
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
	writeStoredOauth: async (tokens: RadientTokens) => {
		durable.events.push("oauth-write");
		durable.oauth = tokens;
		return { persistent: false };
	},
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
	/* `null` means "no session screen"; `""` means "a screen with no conversation
	 *  yet", which is the case Q10 measured and which must still mount the hook. */
	return observedSession === null
		? null
		: createElement(SessionCapture, { id: observedSession });
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
		rejectOauthRefresh?: boolean;
		refreshOauth?: boolean;
		holdToken?: boolean;
		failStream?: boolean;
		failLogout?: boolean;
		refuseCatalogue?: boolean;
		/** Seed one session frame, tear the stream, then refuse every reopen 401 —
		 *  the round-4 shape (review N1). */
		refuseSessionStream?: boolean;
		holdFrame?: boolean;
		holdHistory?: boolean;
		holdReloadHistory?: boolean;
		historyFailure?: boolean;
		emptyHistory?: boolean;
		privateHistory?: string;
		emptyFrame?: boolean;
		frameTitle?: string;
		/** The initial list read fails while the stream stays healthy (R1-1). */
		sessionsFailure?: boolean;
		/** What Radient's `GET /v1/tunnels` lists; empty unless a test needs rows. */
		tunnels?: unknown[];
		/** Holds `GET /v1/tunnels` until `releaseTunnels`, so a test can end the
		 *  account (sign out) while discovery is still in flight. */
		holdTunnels?: boolean;
		/** Holds `POST /v1/tunnels/session/code` until `releaseCode`, so a test can
		 *  look at the store while a pick is minting. */
		holdCode?: boolean;
		/** Answers the session code request with a 500: a failed mint. */
		failCode?: boolean;
		/** Drops the session code request's connection: a pick made offline. */
		dropCode?: boolean;
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
	const tunnelsReceived = deferred();
	const releaseTunnels = deferred();
	const codeReceived = deferred();
	const releaseCode = deferred();
	/* What `GET /v1/tunnels` answers next: the listed tunnels, or a status a test
	 *  switches to mid-run to fail a Refresh and then recover it. */
	let tunnelsAnswer: "list" | 500 | 401 = "list";
	/* Holds the NEXT `GET /v1/tunnels` only, so a test can sign in normally and
	 *  then keep a Refresh in flight (R2-m1). */
	let holdNext = false;
	const nextTunnelsReceived = deferred();
	const releaseNextTunnels = deferred();
	let historyReads = 0;
	let catalogueStreams = 0;
	let loginCount = 0;
	let tokenCount = 0;
	let codeCount = 0;
	/* Whether the session code request fails NOW: starts at `options.failCode`, and a
	 *  test can lift it to retry the same pick against a recovered control plane. */
	let failCode = options.failCode ?? false;
	let sessionStreams = 0;
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
		if (path === "/v1/auth/oauth/token" && options.refreshOauth) {
			json({
				access_token: "fresh-retirement",
				refresh_token: "rotated",
				expires_in: 3600,
				token_type: "Bearer",
				scope: "openid",
			});
			return;
		}
		if (path === "/v1/auth/oauth/token" && options.rejectOauthRefresh) {
			json({ error: "invalid_grant" }, 400);
			return;
		}
		if (path === "/v1/tunnels") {
			tunnelsReceived.resolve();
			if (options.holdTunnels) await releaseTunnels.promise;
			if (holdNext) {
				holdNext = false;
				nextTunnelsReceived.resolve();
				await releaseNextTunnels.promise;
			}
			if (tunnelsAnswer === 500) {
				response.writeHead(500, { "content-type": "text/plain" });
				response.end("Synthetic control-plane failure");
				return;
			}
			if (tunnelsAnswer === 401) {
				json({ msg: "unauthorized" }, 401);
				return;
			}
			json({ msg: "ok", result: options.tunnels ?? [] });
			return;
		}
		if (path === "/v1/tunnels/session/code") {
			codeReceived.resolve();
			if (options.holdCode) await releaseCode.promise;
			if (options.dropCode) {
				request.socket.destroy();
				return;
			}
			if (failCode) {
				json({ msg: "synthetic mint failure" }, 500);
				return;
			}
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
			/* The round-4 shape (review N1 / QA Q10 / UX U17): a frame lands, the
			 *  session stream is torn, and the REOPEN is refused 401. The route
			 *  client records that refusal on the shared route, which is the fact
			 *  the header must read — the stream's own terminal report does not
			 *  survive the effect teardown in this shape. */
			if (options.refuseSessionStream) {
				sessionStreams += 1;
				if (sessionStreams > 1) {
					response.writeHead(401, {
						"content-type": "application/json",
						"x-radient-login": "required",
					});
					response.end(JSON.stringify({ detail: "Authentication required" }));
					return;
				}
			}
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
			if (options.refuseSessionStream) {
				/* Torn mid-stream, exactly as `sse-drop-mid-stream` does on the
				 *  mock relay: the hook sees a transport error and reopens. */
				setTimeout(() => response.destroy(), 50);
			}
			return;
		}
		if (path.startsWith("/api/sessions") && !path.endsWith("/history")) {
			if (options.sessionsFailure) {
				json({ detail: "Sessions unavailable", reason: "connector" }, 503);
				return;
			}
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
		releaseTunnels.resolve();
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
		tunnelsReceived,
		releaseTunnels,
		codeReceived,
		releaseCode,
		answerTunnels: (answer: "list" | 500 | 401) => {
			tunnelsAnswer = answer;
		},
		holdNextTunnels: () => {
			holdNext = true;
		},
		nextTunnelsReceived,
		releaseNextTunnels,
		allowLogout: () => {
			failLogout = false;
		},
		allowCode: () => {
			failCode = false;
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

beforeEach(async () => {
	privacy.fail = false;
	handoff.block = null;
	handoff.started = false;
	durable.saved = null;
	const storage = new SecureStorage(memorySecureStore());
	configureStartupAuthorizationStorage({
		read: () => storage.readStartupAuthorization(),
		write: (record) => storage.writeStartupAuthorization(record),
	});
	await startupAuthorizationLifecycle.retire();
	privacy.calls = 0;
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

describe("startup authorization is admitted by the route (R1-1)", () => {
	it("survives a failed cold-start list read with a healthy stream", async () => {
		const mock = await relay({ sessionsFailure: true });
		transport();
		await mount();
		await act(async () => {
			await latest.connectCustom({
				url: mock.origin,
				password: "test-only",
				allowInsecure: true,
			});
		});
		// The read failed: the list says so ...
		expect(mock.events).toContain("GET /api/sessions");
		// ... and the route is still authorized to start work, which is what the
		// startup coordinator opens on.
		expect(getStartupAuthorization()).not.toBeNull();
	});
});

describe("mounted provider authentication retirement", () => {
	it("reports failed privacy cleanup and keeps replacement admission closed", async () => {
		const mock = await relay();
		transport();
		await mount();
		await act(async () => {
			await latest.connectCustom({
				url: mock.origin,
				password: "test-only",
				allowInsecure: true,
			});
		});
		expect(getStartupAuthorization()).not.toBeNull();
		privacy.fail = true;
		await act(async () => {
			expect(await latest.signOut()).toBe(false);
		});
		expect(getStartupAuthorization()).toBeNull();
		expect(connectionStore.getState().surface).toBe("diagnostic");
		privacy.fail = false;
	});

	it("ignores an OAuth browser result that arrives after explicit signout", async () => {
		await mount();
		const held = deferred();
		handoff.block = held.promise;
		cleanup.push(async () => {
			held.resolve();
		});
		let signingIn!: Promise<void>;
		await act(async () => {
			signingIn = latest.signInWithRadient();
		});
		await until(() => handoff.started);
		await act(async () => {
			expect(await latest.signOut()).toBe(true);
		});
		held.resolve();
		await act(async () => {
			await signingIn;
		});
		expect(durable.events).not.toContain("oauth-write");
		expect(durable.oauth).toBeNull();
		expect(getStartupAuthorization()).toBeNull();
		expect(connectionStore.getState().route).toBeNull();
	});

	it("retains a generation on verified saved-route remount, rotates it on same-URL explicit login", async () => {
		const mock = await relay();
		transport();
		await mount();
		const input = {
			url: mock.origin,
			password: "test-only",
			allowInsecure: true,
		};
		await act(async () => {
			await latest.connectCustom(input);
		});
		const original = getStartupAuthorization()?.scope;
		expect(original).toBeTruthy();
		durable.saved = {
			baseUrl: input.url,
			password: input.password,
			allowInsecure: true,
		};
		await unmount();
		await mount();
		await until(() => getStartupAuthorization() !== null);
		expect(getStartupAuthorization()?.scope).toBe(original);
		await act(async () => {
			await latest.connectCustom(input);
		});
		expect(getStartupAuthorization()?.scope).not.toBe(original);
	});

	it("explicit sign-out invokes verified private-data cleanup even without a selected route", async () => {
		await mount();
		await act(async () => {
			expect(await latest.signOut()).toBe(true);
		});
		expect(privacy.calls).toBeGreaterThan(0);
		expect(getStartupAuthorization()).toBeNull();
	});

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
			cleanup.push(async () => {
				clear.resolve();
			});
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
			let connecting: Promise<void> | undefined;
			if (current)
				await act(async () => {
					connecting = latest.connectCustom({
						url: current.origin,
						password: "test-only",
						allowInsecure: true,
					});
				});
			// Replacement admission now waits for verified privacy/credential
			// retirement; it may not race a durable clear from the former identity.
			expect(getStartupAuthorization()).toBeNull();
			if (current) expect(current.events).not.toContain("POST /login");
			clear.resolve();
			await act(async () => {
				await Promise.all([exiting, connecting]);
			});
			const currentClient = latest.relay();
			const currentCookie = current ? jars.get(current.origin) : null;
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

	it("reserves route logout before a held push retirement; a new sign-in waits for the full wipe", async () => {
		/* Two properties, one test. (1) OAuth is NOT cleared early: push-device
		 * removal authenticates with the grant, so the clear must not start while
		 * that retirement is held. (2) A new sign-in is NOT accepted before the old
		 * credentials are confirmed wiped (#97/#118): `connectCustom` waits for the
		 * sign-out's `privacy` step, which includes the held push retirement, so the
		 * replacement login's cookie request only goes out AFTER the clear. The cost
		 * (a sign-in right after sign-out waits up to the 35 s push ceiling) is the
		 * accepted fail-closed trade documented at `signOut`. */
		const mock = await relay();
		transport();
		await mount();
		await act(async () => {
			await latest.connectCustom({
				url: mock.origin,
				password: "old",
				allowInsecure: true,
			});
		});
		const push = deferred();
		const unregister = registerTeamBridgeRetirement(() => push.promise);
		try {
			let exiting!: Promise<boolean>;
			let second!: Promise<void>;
			await act(async () => {
				exiting = latest.signOut();
				// Withdrawing route admission cannot wait for the push registry.
				expect(latest.relay()).toBeNull();
				expect(connectionStore.getState().route).toBeNull();
				second = latest.connectCustom({
					url: mock.origin,
					password: "new",
					allowInsecure: true,
				});
				// Let the replacement sign-in run as far as it is allowed to.
				for (let turn = 0; turn < 20; turn += 1)
					await new Promise<void>((resolve) => setImmediate(resolve));
			});
			// Held push retirement: nothing is cleared and the new login is parked.
			expect(durable.clearsStarted).toBe(0);
			expect(mock.events).not.toContain("login:2:cookie");
			push.resolve();
			await until(() => mock.events.includes("login:2:cookie"));
			// The wipe finished before the replacement login reached the relay.
			expect(durable.events).toContain("clear");
			await act(async () => {
				await Promise.all([exiting, second]);
			});
			/* `exiting` resolves false here by design: the replacement login's route
			 * admission supersedes the sign-out's revocation owner. */
			expect(durable.clearsStarted).toBe(1);
			expect(jars.get(mock.origin)).toBe("lop_mobile=synthetic-2");
			expect(mock.events.lastIndexOf("GET /logout")).toBeLessThan(
				mock.events.indexOf("login:2:cookie"),
			);
			expect(latest.relay()).not.toBeNull();
		} finally {
			push.resolve();
			unregister();
		}
	});

	it("an invalid_grant during push retirement does not cancel the requested route and durable sign-out", async () => {
		const mock = await relay({ rejectOauthRefresh: true });
		transport(mock.origin);
		durable.oauth = { ...oauth, refresh: "rolling" };
		await mount();
		await act(async () => {
			await latest.connectCustom({
				url: mock.origin,
				password: "old",
				allowInsecure: true,
			});
		});
		const push = deferred();
		const unregister = registerTeamBridgeRetirement(() => push.promise);
		try {
			let exiting!: Promise<boolean>;
			let refreshing!: Promise<string | null>;
			await act(async () => {
				exiting = latest.signOut();
				refreshing = latest.radientAccessToken({ force: true });
			});
			await until(() => !latest.radientSignedIn);
			expect(durable.clearsStarted).toBe(0);
			push.resolve();
			await act(async () => {
				await Promise.all([exiting, refreshing]);
			});
			expect(await exiting).toBe(true);
			expect(await refreshing).toBeNull();
			expect(mock.events).toContain("POST /v1/auth/oauth/token");
			expect(mock.events).toContain("GET /logout");
			expect(durable.clearsStarted).toBe(1);
			expect(durable.oauth).toBeNull();
			expect(latest.relay()).toBeNull();
		} finally {
			push.resolve();
			unregister();
		}
	});

	it("refreshes an expired retirement bearer while the actual native clear barrier awaits device removal", async () => {
		const mock = await relay({ refreshOauth: true });
		transport(mock.origin);
		const held = { ...oauth, refresh: "rolling" };
		durable.oauth = held;
		await mount();
		await act(async () => {
			await latest.connectCustom({
				url: mock.origin,
				password: "old",
				allowInsecure: true,
			});
		});
		// Expiry occurs after restoration accepted the same provider-owned grant.
		held.expires_at = 0;
		let bearer: string | null | undefined;
		const unregister = registerTeamBridgeRetirement(async () => {
			bearer = await latest.radientRetirementAccessToken();
			expect(durable.clearsStarted).toBe(0);
		});
		try {
			let exiting!: Promise<boolean>;
			await act(async () => {
				exiting = latest.signOut();
			});
			// The normal accessor would deadlock behind the clear barrier until the
			// five-second emergency timeout. Require progress before that fallback.
			await until(() => bearer === "fresh-retirement");
			await act(async () => {
				expect(await exiting).toBe(true);
			});
			expect(
				mock.events.filter((event) => event === "POST /v1/auth/oauth/token"),
			).toHaveLength(1);
			expect(durable.clearsStarted).toBe(1);
			expect(durable.oauth).toBeNull();
		} finally {
			unregister();
		}
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

describe("a 401 on the session stream alone reaches the header", () => {
	/* REVIEW ROUND 4, N1 / QA Q10 / UX U17. The filed defect: after a frame, a
	 * 401 on this session's own event stream ends every retry (no request for a
	 * minute) while the dot still says "Reconnecting — keeps trying".
	 *
	 * WHY THIS TEST EXISTS IN THIS SHAPE. The round-3 fix added `streamClosed`
	 * and its table rows, but those rows assign the flag directly — nothing drove
	 * the stream's 401 through the hook, so the suite was green while the shipped
	 * bundle still read `state: "connecting"`. On this path the route client's
	 * `onResponse` 401 hook records the refusal and flips the source to
	 * `refused` while `http.open` unwinds, and the session effect's guards drop
	 * the stream's own terminal report. So this mounts the real hook against a
	 * relay that seeds a frame, tears the stream and refuses the reopen 401, and
	 * asserts the reading the header consumes. */
	it("reads the refused route as a stop, with no request left to make", async () => {
		const mock = await relay({ refuseSessionStream: true });
		observedSession = "synthetic-session";
		transport();
		await mount();
		await act(async () => {
			await latest.connectCustom({
				url: mock.origin,
				password: "test-only",
				allowInsecure: true,
			});
		});
		await until(() => sessionReading.projection !== null);
		/* The reopen is refused: the route is refused and the hook's link is a
		 * stop, which is what `headerHealth` turns into "no dot". */
		await until(() => sessionReading.link === "stopped");
		expect(sessionReading.source.reason).toBe("refused");
		expect(
			headerHealth(sessionReading.projection, sessionReading.link),
		).toBeNull();
		/* And nothing is retrying behind that reading — the false promise the
		 * dot used to make. */
		const before = wire.length;
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 300));
		});
		expect(
			wire.slice(before).filter((entry) => entry.path.endsWith("/events")),
		).toEqual([]);
	});
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

describe("Radient discovery before a route exists (PR #120 QA round 1, Q1)", () => {
	/* Two synthetic tunnels in the control plane's own shape, parsed by the real
	 *  `discoverComputers`. Discovery answers before any route is started — a route
	 *  is what picking one of these creates — so the list must survive `route ===
	 *  null`; on `origin/main` the store dropped it and the picker read 0 rows. */
	const tunnels = ["tun-synthetic-1", "tun-synthetic-2"].map((id, index) => ({
		id,
		name: `Synthetic computer ${index + 1}`,
		hostname: `${String(index + 1).padStart(32, "0")}-lop.example.com`,
		status: "active",
		harnesses: [{ id: "local-operator", enabled: true }],
	}));

	it("lists the account's computers after sign-in, with no route started", async () => {
		const mock = await relay({ tunnels });
		transport(mock.origin);
		await mount();
		await act(async () => {
			await latest.signInWithRadient();
		});
		expect(mock.events).toContain("GET /v1/tunnels");
		expect(connectionStore.getState().route).toBeNull();
		expect(
			connectionStore
				.getState()
				.computers.map((c) => c.tunnelId)
				.sort(),
		).toEqual(["tun-synthetic-1", "tun-synthetic-2"]);
	});

	it("lists the account's computers on a cold-start restore of a stored grant", async () => {
		const mock = await relay({ tunnels });
		transport(mock.origin);
		durable.oauth = oauth;
		await mount();
		await until(() => connectionStore.getState().computers.length === 2);
		expect(connectionStore.getState().route).toBeNull();
		expect(latest.restoredAccount).toBe(true);
	});

	it("drops a discovery result that lands after sign-out (negative control)", async () => {
		const mock = await relay({ tunnels, holdTunnels: true });
		transport(mock.origin);
		await mount();
		let signingIn!: Promise<void>;
		await act(async () => {
			signingIn = latest.signInWithRadient();
		});
		await mock.tunnelsReceived.promise;
		await act(async () => {
			expect(await latest.signOut()).toBe(true);
		});
		mock.releaseTunnels.resolve();
		await act(async () => {
			await signingIn;
		});
		/* The tunnels WERE served; the provider's authorization fence, not the store,
		 *  is what keeps them off a signed-out screen. */
		expect(mock.events).toContain("GET /v1/tunnels");
		expect(connectionStore.getState().computers).toEqual([]);
		expect(connectionStore.getState().phase).toBe("signed-out");
	});
});

describe("the account's computers outlive a pick and a failed refresh (PR #121 round 1)", () => {
	/* Hostnames the synthetic transport routes to the loopback relay, so a pick
	 *  can mint against the control plane and then go live against the relay. */
	const tunnels = ["a", "b"].map((letter, index) => ({
		id: `tun-synthetic-${index + 1}`,
		name: `Synthetic computer ${index + 1}`,
		hostname: `${letter.repeat(32)}-lop.radienthq.com`,
		status: "active",
		harnesses: [{ id: "local-operator", enabled: true }],
	}));
	const ids = () =>
		connectionStore
			.getState()
			.computers.map((c) => c.tunnelId)
			.sort();
	const listed = ["tun-synthetic-1", "tun-synthetic-2"];

	async function signedIn(options: Parameters<typeof relay>[0]) {
		const mock = await relay({ tunnels, ...options });
		transport(mock.origin);
		await mount();
		await act(async () => {
			await latest.signInWithRadient();
		});
		expect(ids()).toEqual(listed);
		return mock;
	}

	it("keeps the list while the picked computer mints and after it is live (R1-M1, D1)", async () => {
		const mock = await signedIn({ holdCode: true });
		const second = connectionStore.getState().computers[1];
		if (!second) throw new Error("no second computer");
		let picking!: Promise<void>;
		await act(async () => {
			picking = latest.selectComputer(second);
		});
		await mock.codeReceived.promise;
		try {
			/* Mid-mint: the route exists, the row is the chosen one, the list is whole. */
			expect(connectionStore.getState().phase).toBe("minting");
			expect(connectionStore.getState().tunnelId).toBe(second.tunnelId);
			expect(ids()).toEqual(listed);
		} finally {
			/* Released even when an assertion fails, so a regression reports here
			 *  rather than as a held mint timing out every later test's teardown. */
			mock.releaseCode.resolve();
		}
		await act(async () => {
			await picking;
		});
		await until(() => connectionStore.getState().phase === "live");
		expect(ids()).toEqual(listed);
	});

	it("keeps the list when the mint fails, and names the PICKED computer (R1-m2)", async () => {
		await signedIn({ failCode: true });
		const second = connectionStore.getState().computers[1];
		if (!second) throw new Error("no second computer");
		await act(async () => {
			await latest.selectComputer(second);
		});
		expect(connectionStore.getState().phase).toBe("refused");
		expect(ids()).toEqual(listed);
		/* `computers[0]` was the subject before; the failure belongs to the second. */
		expect(latest.refusal?.subject).toBe("Synthetic computer 2");
	});

	it("retries the PICKED computer from the refusal's Try again, and goes live on it (PR #122 Q6/U11)", async () => {
		/* Every entry point's refusal surface (Settings, Computers, Home) calls the
		 *  provider's `retry`; a failed switch is only recoverable from Settings if
		 *  that re-runs the computer the reader picked, not a list read. */
		const mock = await signedIn({ failCode: true });
		const second = connectionStore.getState().computers[1];
		if (!second) throw new Error("no second computer");
		await act(async () => {
			await latest.selectComputer(second);
		});
		expect(connectionStore.getState().phase).toBe("refused");
		expect(latest.refusal?.subject).toBe("Synthetic computer 2");
		const mints = () =>
			mock.events.filter((event) => event === "POST /v1/tunnels/session/code")
				.length;
		const before = mints();
		mock.allowCode();
		await act(async () => {
			await latest.retry();
		});
		await until(() => connectionStore.getState().phase === "live");
		expect(connectionStore.getState().tunnelId).toBe(second.tunnelId);
		expect(latest.refusal).toBeNull();
		/* Exactly one more mint, for that computer. */
		expect(mints()).toBe(before + 1);
	});

	it("records a failed Refresh as account state over the cached rows, and a later success clears it (D2)", async () => {
		const mock = await signedIn({});
		mock.answerTunnels(500);
		await act(async () => {
			await latest.refreshComputers();
		});
		expect(ids()).toEqual(listed);
		expect(connectionStore.getState().discoveryFailure).toBe("rejected");
		/* Not a route refusal: nothing on screen blames a computer, and no refusal
		 *  hides the rows. */
		expect(connectionStore.getState().surface).toBeNull();
		expect(latest.refusal).toBeNull();
		mock.answerTunnels("list");
		const before = mock.events.filter((e) => e === "GET /v1/tunnels").length;
		/* What the banner's "Try now" calls. */
		await act(async () => {
			await latest.refreshComputers();
		});
		expect(mock.events.filter((e) => e === "GET /v1/tunnels").length).toBe(
			before + 1,
		);
		expect(connectionStore.getState().discoveryFailure).toBeNull();
		expect(ids()).toEqual(listed);
	});

	it("clears the rows when Radient refuses the grant (R1-m1)", async () => {
		const mock = await signedIn({});
		mock.answerTunnels(401);
		await act(async () => {
			await latest.refreshComputers();
		});
		expect(connectionStore.getState().computers).toEqual([]);
		expect(connectionStore.getState().surface).toBe("sign-in");
		/* The screen reads this kind to show a sign-in state, not an empty
		 *  account (QA round 2, Q-r2-1). */
		expect(latest.refusal?.kind).toBe("sign-in");
	});
});

/* The account-problem copy a network failure must never borrow (U5, D11). */
const CONSOLE_COPY = /console|lop login/i;

describe("a pick and a Refresh do not leave each other's state behind (PR #121 round 2)", () => {
	const tunnels = ["a", "b"].map((letter, index) => ({
		id: `tun-synthetic-${index + 1}`,
		name: `Synthetic computer ${index + 1}`,
		hostname: `${letter.repeat(32)}-lop.radienthq.com`,
		status: "active",
		harnesses: [{ id: "local-operator", enabled: true }],
	}));

	async function signedIn(options: Parameters<typeof relay>[0]) {
		const mock = await relay({ tunnels, ...options });
		transport(mock.origin);
		await mount();
		await act(async () => {
			await latest.signInWithRadient();
		});
		expect(connectionStore.getState().computers).toHaveLength(2);
		return mock;
	}

	it("lowers `discovering` when a pick retires an in-flight Refresh (R2-m1)", async () => {
		const mock = await signedIn({});
		mock.holdNextTunnels();
		let refreshing!: Promise<void>;
		await act(async () => {
			refreshing = latest.refreshComputers();
		});
		await mock.nextTunnelsReceived.promise;
		const second = connectionStore.getState().computers[1];
		if (!second) throw new Error("no second computer");
		try {
			expect(latest.discovering).toBe(true);
			/* The pick suspends the authorization revision, so the held pass is no
			 *  longer current when it lands. */
			await act(async () => {
				await latest.selectComputer(second);
			});
			await until(() => connectionStore.getState().phase === "live");
		} finally {
			mock.releaseNextTunnels.resolve();
		}
		await act(async () => {
			await refreshing;
		});
		/* Stuck `true` here was an inert Try now and an endless skeleton. */
		expect(latest.discovering).toBe(false);
	});

	it("offers Try again, not the Radient console, for a pick made offline (U5, D11)", async () => {
		await signedIn({ dropCode: true });
		const second = connectionStore.getState().computers[1];
		if (!second) throw new Error("no second computer");
		await act(async () => {
			await latest.selectComputer(second);
		});
		expect(connectionStore.getState().phase).toBe("refused");
		expect(latest.refusal).toMatchObject({
			kind: "retry",
			subject: "Synthetic computer 2",
			detail: PICK_UNREACHABLE_DETAIL,
			remedy: null,
		});
		expect(JSON.stringify(latest.refusal)).not.toMatch(CONSOLE_COPY);
	});
});

describe("the computer switcher's registry (M2a)", () => {
	/* The registry the provider writes to is the real one over the web runtime's
	 *  memory keystore, a process singleton: each test starts from an empty list. */
	beforeEach(async () => {
		const registry = await vi.importActual<TunnelStorageModule>(
			"@/features/auth/tunnel-storage",
		);
		await registry.clearStoredCredentials();
	});
	const saved = async () =>
		(
			await vi.importActual<TunnelStorageModule>(
				"@/features/auth/tunnel-storage",
			)
		).readSavedComputers();
	const tunnels = [
		{
			id: "tun-synthetic-1",
			name: "Synthetic computer 1",
			hostname: `${"a".repeat(32)}-lop.radienthq.com`,
			status: "active",
			harnesses: [{ id: "local-operator", enabled: true }],
		},
	];

	it("remembers a live Radient route by tunnel id and marks it used", async () => {
		const mock = await relay({ tunnels });
		transport(mock.origin);
		await mount();
		await act(async () => {
			await latest.signInWithRadient();
		});
		/* Discovery alone records nothing: the phone has not USED the computer. */
		expect(await saved()).toEqual([]);
		const first = connectionStore.getState().computers[0];
		if (!first) throw new Error("no computer");
		const before = Date.now();
		await act(async () => {
			await latest.selectComputer(first);
		});
		await until(() => connectionStore.getState().computerId !== null);
		const entries = await saved();
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({
			transport: "radient",
			tunnelId: "tun-synthetic-1",
			name: "Synthetic computer 1",
			hidden: false,
		});
		expect(entries[0]?.lastUsedAt).toBeGreaterThanOrEqual(before);
		/* The store names the live computer by its REGISTRY id, not its address. */
		expect(connectionStore.getState().computerId).toBe(entries[0]?.id);
	});

	it("remembers a live custom route by address and marks it used", async () => {
		const mock = await relay();
		transport();
		await mount();
		const before = Date.now();
		await act(async () => {
			await latest.connectCustom({
				url: mock.origin,
				password: "test-only",
				allowInsecure: true,
			});
		});
		await until(() => connectionStore.getState().computerId !== null);
		const entries = await saved();
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({
			transport: "custom",
			baseUrl: mock.origin,
			allowInsecure: true,
		});
		expect(entries[0]?.lastUsedAt).toBeGreaterThanOrEqual(before);
		expect(connectionStore.getState().computerId).toBe(entries[0]?.id);
		/* Metadata only: the password never reaches the registry. */
		expect(JSON.stringify(entries)).not.toContain("test-only");
	});

	it("does not remember a computer whose route never went live (negative control)", async () => {
		/* The mint fails, so the pick ends `refused`: a computer this phone never
		 *  reached is not one it has used, and must not join "On this phone". */
		const mock = await relay({ tunnels, failCode: true });
		transport(mock.origin);
		await mount();
		await act(async () => {
			await latest.signInWithRadient();
		});
		const first = connectionStore.getState().computers[0];
		if (!first) throw new Error("no computer");
		await act(async () => {
			await latest.selectComputer(first);
		});
		expect(connectionStore.getState().phase).toBe("refused");
		expect(await saved()).toEqual([]);
		expect(connectionStore.getState().computerId).toBeNull();
	});

	it("a tap on a saved custom row starts a custom route to it, keyed by its registry id", async () => {
		const mock = await relay();
		transport();
		await mount();
		/* A custom computer the phone used before, then a Radient-less phone state. */
		await act(async () => {
			await latest.connectCustom({
				url: mock.origin,
				password: "test-only",
				allowInsecure: true,
			});
		});
		await until(() => connectionStore.getState().computerId !== null);
		const entry = (await saved())[0];
		if (!entry) throw new Error("not remembered");
		await act(async () => {
			connectionStore.getState().endRoute();
		});
		expect(connectionStore.getState().route).toBeNull();

		const row = switcherSections({
			saved: await saved(),
			discovered: [],
			probes: {},
			route: { phase: "signed-out", tunnelId: null },
			activeComputerId: null,
			pendingKey: null,
			radientSignedOut: false,
		}).onPhone[0];
		if (!row) throw new Error("no switcher row");
		const tap = switcherTap(row, {
			baseUrl: mock.origin,
			password: "test-only",
			allowInsecure: true,
		});
		expect(tap.kind).toBe("connect-custom");
		await act(async () => {
			await performSwitcherTap(tap, {
				selectComputer: latest.selectComputer,
				connectCustom: latest.connectCustom,
				signInWithRadient: latest.signInWithRadient,
				unhide: () => {},
				enterPassword: () => {},
				openSettings: () => {},
				openConsole: () => {},
				close: () => {},
			});
		});
		await until(() => connectionStore.getState().phase === "live");
		expect(connectionStore.getState().route).toMatchObject({
			mode: "custom",
			baseUrl: mock.origin,
		});
		await until(() => connectionStore.getState().computerId === entry.id);
		/* The same computer, not a second entry at the same address. */
		expect(await saved()).toHaveLength(1);
	});
});

describe("PR #122 round-1 remediation: the provider's side of the switcher", () => {
	beforeEach(async () => {
		const registry = await vi.importActual<TunnelStorageModule>(
			"@/features/auth/tunnel-storage",
		);
		await registry.clearStoredCredentials();
	});
	const saved = async () =>
		(
			await vi.importActual<TunnelStorageModule>(
				"@/features/auth/tunnel-storage",
			)
		).readSavedComputers();
	const tunnel = {
		id: "tun-[redacted]-1",
		name: "Synthetic computer 1",
		hostname: `${"a".repeat(32)}-lop.radienthq.com`,
		status: "active",
		harnesses: [{ id: "local-operator", enabled: true }],
	};

	it("loads the stored Radient grant for a pick made after a cold start on an own address (U3)", async () => {
		/* The cold start dials the own address and never reads the Radient grant. */
		const mock = await relay({ tunnels: [tunnel] });
		transport(mock.origin);
		durable.oauth = { ...oauth, account_id: "acct-[redacted]" };
		durable.saved = {
			baseUrl: mock.origin,
			password: "test-only",
			allowInsecure: true,
		};
		await mount();
		await until(() => connectionStore.getState().phase === "live");
		expect(connectionStore.getState().route?.mode).toBe("custom");
		/* A switcher tap on a saved Radient computer discovery has not listed. */
		const computerFromRow: DiscoveredComputer = {
			...computer("x"),
			tunnelId: tunnel.id,
			hostname: tunnel.hostname,
			name: "Synthetic computer 1",
		};
		await act(async () => {
			await latest.selectComputer(computerFromRow);
		});
		await until(() => connectionStore.getState().phase === "live");
		expect(connectionStore.getState().route).toMatchObject({
			mode: "radient",
			tunnelId: tunnel.id,
		});
		expect(mock.events).toContain("POST /v1/tunnels/session/code");
		/* And the route it reached is recorded under that account (M2). */
		await until(() => connectionStore.getState().computerId !== null);
		const entry = (await saved()).find(
			(candidate) => candidate.transport === "radient",
		);
		expect(entry).toMatchObject({ account: "acct-[redacted]" });
	});

	it("refuses a pick with no stored grant as Sign in, not a console dead end (U3 negative control)", async () => {
		const mock = await relay({ tunnels: [tunnel] });
		transport(mock.origin);
		await mount();
		await act(async () => {
			await latest.selectComputer({
				...computer("x"),
				tunnelId: tunnel.id,
				hostname: tunnel.hostname,
			});
		});
		expect(connectionStore.getState().surface).toBe("sign-in");
		expect(mock.events).not.toContain("POST /v1/tunnels/session/code");
	});

	it("keeps the saved name when switching back from an own address, where discovery is empty (Q2)", async () => {
		const mock = await relay({ tunnels: [tunnel] });
		transport(mock.origin);
		await mount();
		await act(async () => {
			await latest.signInWithRadient();
		});
		const first = connectionStore.getState().computers[0];
		if (!first) throw new Error("no computer");
		await act(async () => {
			await latest.selectComputer(first);
		});
		await until(() => connectionStore.getState().computerId !== null);
		expect((await saved())[0]?.name).toBe("Synthetic computer 1");
		/* Own address: a custom startRoute empties discovery. */
		await act(async () => {
			await latest.connectCustom({
				url: mock.origin,
				password: "test-only",
				allowInsecure: true,
			});
		});
		await until(() => connectionStore.getState().route?.mode === "custom");
		expect(connectionStore.getState().discoveredComputers).toEqual([]);
		/* Back to the Radient computer through its switcher row (a stand-in pick). */
		const row = switcherSections({
			saved: await saved(),
			discovered: [],
			probes: {},
			route: { phase: "live", tunnelId: null },
			activeComputerId: connectionStore.getState().computerId,
			pendingKey: null,
			radientSignedOut: false,
		}).onPhone.find((candidate) => candidate.transport.kind === "radient");
		if (!row) throw new Error("no Radient row");
		await act(async () => {
			await performSwitcherTap(switcherTap(row, null), {
				selectComputer: latest.selectComputer,
				connectCustom: latest.connectCustom,
				signInWithRadient: latest.signInWithRadient,
				unhide: () => {},
				enterPassword: () => {},
				openSettings: () => {},
				openConsole: () => {},
				close: () => {},
			});
		});
		await until(
			() =>
				connectionStore.getState().route?.mode === "radient" &&
				connectionStore.getState().phase === "live",
		);
		/* Let the fire-and-forget remember land, then read the name back. */
		await until(() => connectionStore.getState().computerId === row.savedId);
		const radientEntry = (await saved()).find(
			(candidate) => candidate.transport === "radient",
		);
		expect(radientEntry?.name).toBe("Synthetic computer 1");
		expect(radientEntry?.name).not.toBe(tunnel.hostname);
	});
});

describe("an unnamed session asks the relay nothing (QA round 5, Q10)", () => {
	it('mounts the runtime for `""` and issues no request for it', async () => {
		/* The inbox and its detail read the runtime for a conversation they may not
		 * have yet, so they pass `""`. That is not an id: it built
		 * `/api/sessions//events` and `//history`, two 404s and two console errors on
		 * every mount. The hook must be MOUNTED here (this is a live screen with no
		 * conversation, not an absent one) and must ask for nothing. */
		const mock = await relay({});
		observedSession = "";
		transport();
		await mount();
		await act(async () => {
			await latest.connectCustom({
				url: mock.origin,
				password: "test-only",
				allowInsecure: true,
			});
		});
		// Give the effects the same settle the other cases get.
		await act(async () => {
			await new Promise<void>((resolve) => setImmediate(resolve));
		});
		// The two requests the empty id used to build, and nothing else for a session.
		const asked = wire.filter((entry) =>
			/\/api\/sessions\/\//.test(entry.path),
		);
		expect(asked).toEqual([]);
		/* The shared session LIST stream (`/api/sessions/events`) is the provider's
		 *  own subscription and opens on every screen; what must not appear is a
		 *  request for a NAMED session, which is what `""` used to build. */
		expect(
			wire
				.filter(
					(entry) =>
						entry.path.startsWith("/api/sessions/") &&
						entry.path !== "/api/sessions/events",
				)
				.map((entry) => entry.path),
		).toEqual([]);
	});

	it("still asks for a named session, so the guard is not a blanket mute", async () => {
		const mock = await relay({});
		observedSession = "synthetic-session";
		transport();
		await mount();
		await act(async () => {
			await latest.connectCustom({
				url: mock.origin,
				password: "test-only",
				allowInsecure: true,
			});
		});
		await until(() => sessionReading.projection !== null);
		expect(wire).toContainEqual({
			method: "GET",
			path: "/api/sessions/synthetic-session/history",
			status: 200,
		});
		// The empty-id case CANNOT be the first assertion's mirror by accident: the
		// exact request the empty id used to make is named here.
		expect(
			wire.filter((entry) => entry.path === "/api/sessions//history"),
		).toEqual([]);
	});
});

/**
 * The one line that connects the backend's language to `t()`.
 *
 * `setLocaleSource(() => configStore.getState().language)` at the top of
 * `connection-provider.tsx` is the sole link between the relay's resolved
 * language and the i18n runtime. `runtime.test.ts` exercises the runtime with
 * stubs and `config-store` has its own tests, so without THIS test deleting the
 * registration left every file green while the app silently stayed on the
 * "no frame yet" default. It drives the real provider module's registration, not
 * a re-statement of it: the only thing applied is a config frame to the store the
 * provider exports.
 */
describe("the i18n runtime reads the provider's config store", () => {
	afterEach(() => {
		configStore.getState().reset();
	});

	it("follows the relay's resolved language frame", () => {
		expect(preferredLocale()).toBeNull();
		configStore
			.getState()
			.applyFrame({ changed_keys: ["language"], language: "pt_BR" });
		/* Normalized once by the runtime (`pt_BR` → `pt-BR`); the value arriving at
		 * all is what proves the registration. */
		expect(preferredLocale()).toBe("pt-BR");
		/* Only `en` ships today, so an unshipped preference still renders English
		 * source rather than the key. */
		expect(activeLocale()).toBe("en");
	});

	it("returns to no preference when the store is reset", () => {
		configStore
			.getState()
			.applyFrame({ changed_keys: ["language"], language: "en-GB" });
		expect(preferredLocale()).toBe("en-GB");
		configStore.getState().reset();
		expect(preferredLocale()).toBeNull();
	});
});
