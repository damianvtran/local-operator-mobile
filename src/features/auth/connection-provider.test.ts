import { readFileSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	DiscoveredComputer,
	RadientTokens,
	TunnelSession,
} from "@/connection";
import * as recoveryProof from "@/connection/recovery-authority";
import type { SavedComputer } from "@/connection/saved-computers";
import {
	configureStartupAuthorizationStorage,
	getStartupAuthorization,
	startupAuthorizationLifecycle,
} from "@/connection/startup-authorization";
import { memorySecureStore, SecureStorage } from "@/connection/storage";
import { agentAvatarCache } from "@/features/agent-avatar/agent-avatar";
import {
	ConnectionProvider,
	configStore,
	connectionStore,
	PICK_UNREACHABLE_DETAIL,
	useConnection,
} from "@/features/auth/connection-provider";
import { headerHealth } from "@/features/session/health";
import { sessions as sessionProjections } from "@/features/session/runtime";
import { scopedStore } from "@/features/session/scoped-storage";
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
import { signInPresentation } from "./sign-in-presentation";

// The strict privacy adapter is supplied by the adjacent storage slice. These
// tests exercise the real provider boundary, not native filesystem/Keychain I/O.
const nativePlatform = vi.hoisted(() => ({ OS: "web" }));
const privacy = vi.hoisted(() => ({
	calls: 0,
	fail: false,
	/* The rejection to throw instead of the default one: a platform-shaped error
	 *  (an Expo `code` and a message quoting the OSStatus) for the keystore
	 *  refusal tests. */
	error: null as Error | null,
}));
const handoff = vi.hoisted(() => ({
	block: null as Promise<void> | null,
	started: false,
	signals: [] as AbortSignal[],
}));
vi.mock("./radient-sign-in", () => ({
	beginRadientSignIn: async (options?: { signal?: AbortSignal }) => {
		if (options?.signal) handoff.signals.push(options.signal);
		handoff.started = true;
		await handoff.block;
		return { ok: true, tokens: oauth };
	},
}));
vi.mock("@/features/session/device-storage", async (importOriginal) => ({
	...(await importOriginal<object>()),
	clearAuthorizationData: async () => {
		privacy.calls += 1;
		if (privacy.fail)
			throw privacy.error ?? new Error("Synthetic privacy storage failure");
	},
}));

vi.mock("@/features/session/native-private-store", () => ({
	nativePrivateStore: () => ({
		get: async () => null,
		set: async () => {},
		remove: async () => {},
		keys: async () => [],
		clear: async () => {},
	}),
	eraseNativePrivateInstallation: async () => {},
}));
// Native retirement in this test has empty virtual directories, never host FS.
vi.mock("expo-file-system", () => ({
	Paths: { cache: "memory://cache", document: "memory://documents" },
	Directory: class {
		exists = false;
		create() {}
		info() {
			return { exists: false };
		}
		list() {
			return [];
		}
		delete() {}
	},
	File: class {},
}));
vi.mock("@/features/session/picker-cache", () => ({
	clearNativePickerCache: async () => {},
}));
/* `AppState` drives the background-launch restore retry (review R1-M2): the
 *  launch state is read once at the cold start and `change` listeners are
 *  captured so a case can deliver the user's first foreground. "active" by
 *  default, which is what every other case was implicitly. */
const appState = vi.hoisted(() => ({
	currentState: "active" as string,
	listeners: new Set<(state: string) => void>(),
	emit(state: string) {
		appState.currentState = state;
		for (const listener of [...appState.listeners]) listener(state);
	},
}));
vi.mock("react-native", () => ({
	Platform: nativePlatform,
	AppState: {
		get currentState() {
			return appState.currentState;
		},
		addEventListener: (_type: string, listener: (state: string) => void) => {
			appState.listeners.add(listener);
			return {
				remove() {
					appState.listeners.delete(listener);
				},
			};
		},
	},
}));
const durable = vi.hoisted(() => ({
	oauth: null as RadientTokens | null,
	/** A locked device: the keychain refuses the read, which the real
	 *  `readStoredOauth` reports as `null` (its catch). */
	locked: false,
	oauthReads: 0,
	saved: null as {
		baseUrl: string;
		password: string;
		allowInsecure: boolean;
	} | null,
	session: null as TunnelSession | null,
	computers: [] as SavedComputer[],
	events: [] as string[],
	writeBlock: null as Promise<void> | null,
	writesStarted: 0,
	clearBlock: null as Promise<void> | null,
	clearsStarted: 0,
}));
/** The OAuth rotation's durable-write hold. Module scope like `durable` because the
 *  storage mock above is hoisted and cannot see `relay()`'s locals. */
const oauthWriteHold = vi.hoisted(() => {
	let markHeld: (() => void) | null = null;
	let releaseWrite: (() => void) | null = null;
	const hold = {
		armed: false,
		/** Resolves once the armed write has actually STARTED. */
		started: null as Promise<void> | null,
		/** Resolves when the test lets that write land. */
		release: null as Promise<void> | null,
		arm() {
			hold.armed = true;
			hold.started = new Promise<void>((resolve) => {
				markHeld = resolve;
			});
			hold.release = new Promise<void>((resolve) => {
				releaseWrite = resolve;
			});
		},
		markHeld() {
			markHeld?.();
		},
		releaseNow() {
			releaseWrite?.();
		},
	};
	return hold;
});
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
	/* A fixture rather than the real registry: the cold start's computer restore
	 *  reads this on every mount, and a registry shared across cases would let an
	 *  earlier case's live computer reopen itself in the next one. */
	readSavedComputers: async () => durable.computers,
	readSavedTunnel: async () => durable.saved,
	readStoredOauth: async () => {
		durable.oauthReads += 1;
		return durable.locked ? null : durable.oauth;
	},
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
		if (oauthWriteHold.armed) {
			oauthWriteHold.armed = false;
			oauthWriteHold.markHeld();
			await oauthWriteHold.release;
		}
		durable.events.push(`oauth-write:${tokens.access}`);
		durable.oauth = tokens;
		return { persistent: false };
	},
}));

/** The existing modal hook tests use ReactDOM's client renderer with a small
 * Node DOM host. This provider renders no host elements, so only the container,
 * document event target and focus constructors are needed. Hooks, effects, store
 * subscriptions, authentication, endpoints and stream timers are production code.
 * This is mounted lifecycle proof, not browser pixels or native-device proof. */
/** A request built from the empty session id (`/api/sessions//…`). */
const EMPTY_SESSION_ID_PATH = /\/api\/sessions\/\//;
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
		/** The relay refuses the password: `POST /login` answers the relay's own
		 *  401 `{"error":"authentication required"}` (PR #220 design D2). */
		rejectLogin?: boolean;
		/** The branch's own token-endpoint controls: a rotation that succeeds, and one
		 *  the server refuses, so the accessor's `invalidGrant` arm is reachable. */
		rejectOauthRefresh?: boolean;
		refreshOauth?: boolean;
		/**389: stale account access is recoverable through its durable refresh. */
		expiringOauth?: boolean;
		/** Lifetime the token endpoint reports for a rotation. `0` makes the rotated
		 *  access already stale, so the next pass rotates again (R1-M3's ordering
		 *  case) without inventing a 401 burst. */
		oauthExpiresIn?: number;
		holdToken?: boolean;
		failStream?: boolean;
		failLogout?: boolean;
		refuseCatalogue?: boolean;
		/** Edge re-auth signal, distinct from the custom relay's plain 401. */
		edgeCatalogue?: boolean;
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
		/** The first frame's working label; the seed keeps `streaming: false`. */
		frameActivity?: string;
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
	let oauthRefreshed = false;
	let oauthIssued = 0;
	let holdNextOauth = false;
	const oauthHeld = deferred();
	const releaseOauth = deferred();
	let rejectOldGrant = false;
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
	const refreshFailures: { status: number; retryAfter?: number }[] = [];
	const openCatalogue = new Set<ServerResponse>();
	const openSession = new Set<ServerResponse>();
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
		if (path === "/v1/auth/oauth/token" && options.expiringOauth) {
			if (holdNextOauth) {
				holdNextOauth = false;
				oauthHeld.resolve();
				await releaseOauth.promise;
			}
			oauthRefreshed = true;
			json({
				access_token: `synthetic-access-${++oauthIssued}`,
				refresh_token: `synthetic-refresh-${oauthIssued}`,
				expires_in: options.oauthExpiresIn ?? 3600,
				token_type: "Bearer",
			});
			return;
		}
		if (path === "/v1/tunnels") {
			if (
				options.expiringOauth &&
				oauth.expires_at < Date.now() &&
				!oauthRefreshed
			) {
				json({ error: "access expired" }, 401);
				return;
			}
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
				json({ error: "unauthorized" }, 401);
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
				json({ error: "synthetic mint failure" }, 500);
				return;
			}
			json({
				msg: "Authorization code created",
				result: { code: `synthetic-code-${++codeCount}` },
			});
			return;
		}
		if (path === "/v1/tunnels/session/refresh") {
			const failure = refreshFailures.shift();
			if (failure) {
				if (failure.retryAfter !== undefined)
					response.setHeader("retry-after", String(failure.retryAfter));
				json({ error: "synthetic control-plane outage" }, failure.status);
				return;
			}
			json({
				access_token: `synthetic-grant-${++tokenCount}`,
				refresh_token: "synthetic-handle-1",
				expires_in: 300,
				refresh_expires_in: 2592000,
			});
			return;
		}
		if (
			path.startsWith("/api/") &&
			rejectOldGrant &&
			(request.headers.cookie ?? "").includes("synthetic-grant-1")
		) {
			response.writeHead(401, {
				"content-type": "application/json",
				"x-radient-login": "/login",
			});
			response.end(JSON.stringify({ detail: "grant expired" }));
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
			if (options.rejectLogin) {
				events.push(`login:${login}:401`);
				json({ error: "authentication required" }, 401);
				return;
			}
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
				if (options.edgeCatalogue)
					response.setHeader("x-radient-login", "required");
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
			openCatalogue.add(response);
			response.on("close", () => openCatalogue.delete(response));
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
			if (options.frameActivity) seed.activity = options.frameActivity;
			response.writeHead(200, { "content-type": "text/event-stream" });
			response.write(
				`event: projection\ndata: ${JSON.stringify({ ...seed, session_id: observedSession })}\n\n`,
			);
			openSession.add(response);
			response.on("close", () => openSession.delete(response));
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
		releaseOauth.resolve();
		oauthWriteHold.releaseNow();
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
		expireGrant: () => {
			rejectOldGrant = true;
		},
		/** The control plane answers the next grant renewals with these statuses. */
		failRefresh: (...statuses: number[]) => {
			refreshFailures.push(...statuses.map((status) => ({ status })));
		},
		/** One renewal answered `status` with `Retry-After: <seconds>`. */
		failRefreshAfter: (status: number, retryAfter: number) => {
			refreshFailures.push({ status, retryAfter });
		},
		/** Ends every open list stream cleanly — the gateway's 60 s stream cap. */
		endCatalogueStreams: () => {
			for (const open of openCatalogue) open.end();
		},
		/** Ends every open conversation stream cleanly, as the 60 s cap does. */
		endSessionStreams: () => {
			for (const open of openSession) open.end();
		},
		answerTunnels: (answer: "list" | 500 | 401) => {
			tunnelsAnswer = answer;
		},
		holdNextTunnels: () => {
			holdNext = true;
		},
		/** Holds the NEXT account renewal, so a pass can be superseded inside its
		 *  `await usableOauth()` — the exit review round 1 R1-M1 found unguarded. */
		holdNextOauth: () => {
			holdNextOauth = true;
		},
		/** Holds the NEXT durable OAuth write, so a newer rotation can arrive while
		 *  an older one's record is still open (review round 1, R1-M3). */
		holdNextOauthWrite: () => oauthWriteHold.arm(),
		oauthWriteStarted: () => oauthWriteHold.started ?? Promise.resolve(),
		releaseOauthWrite: () => oauthWriteHold.releaseNow(),
		oauthHeld,
		releaseOauth,
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
	// Finish the real registry module's one-time authorization-storage setup
	// BEFORE installing this test's synthetic adapter. Its lazy import from
	// rememberLiveComputer must not replace the adapter during route admission.
	await realRegistry();
	nativePlatform.OS = "web";
	privacy.fail = false;
	privacy.error = null;
	handoff.block = null;
	handoff.started = false;
	handoff.signals.length = 0;
	durable.saved = null;
	durable.computers = [];
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
	durable.locked = false;
	durable.oauthReads = 0;
	durable.session = null;
	durable.events = [];
	appState.currentState = "active";
	appState.listeners.clear();
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
	it("opens ordinary native writers while optional /me is still pending", async () => {
		const gate = deferred();
		vi.spyOn(recoveryProof, "proveRecoveryAuthority").mockReturnValue(
			gate.promise.then(() => null),
		);
		const mock = await relay();
		transport(mock.origin);
		durable.oauth = oauth;
		nativePlatform.OS = "ios";
		// The shared setup leaves an explicit-retire tombstone. This cold-start
		// case starts with no prior owner, not a request to exercise native erase.
		const storage = new SecureStorage(memorySecureStore());
		configureStartupAuthorizationStorage({
			read: () => storage.readStartupAuthorization(),
			write: (record) => storage.writeStartupAuthorization(record),
		});
		await mount();
		let connecting!: Promise<void>;
		try {
			await act(async () => {
				connecting = latest.selectComputer(computer("a"));
				await vi.waitFor(() =>
					expect(getStartupAuthorization()).not.toBeNull(),
				);
				const disk = new Map<string, string>();
				const raw = {
					get: async (key: string) => disk.get(key) ?? null,
					set: async (key: string, value: string) => {
						disk.set(key, value);
					},
					remove: async (key: string) => {
						disk.delete(key);
					},
					keys: async () => [...disk.keys()],
				};
				const ordinary = scopedStore(
					raw,
					getStartupAuthorization()?.scope ?? null,
				);
				await ordinary.set("draft", "typed before identity response");
				expect(await ordinary.get("draft")).toBe(
					"typed before identity response",
				);
				const auth = getStartupAuthorization();
				gate.resolve();
				await connecting;
				expect(getStartupAuthorization()).toBe(auth);
			});
		} finally {
			await act(async () => {
				gate.resolve();
				if (connecting) await connecting;
			});
			nativePlatform.OS = "web";
		}
	});
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

/**
 * Save and connect's outcome, and the keystore refusal's reason (PR #216 evidence,
 * diagnostic run 42855980853). Real provider, real lifecycle, real store: the only
 * synthetic piece is the private-data purge rejecting with a platform-shaped error.
 */
describe("connectCustomOutcome and the keystore refusal reason", () => {
	const keychainRefusal = () =>
		Object.assign(
			new Error(
				"Calling the 'deleteValueWithKeyAsync' function has failed\n→ Caused by: secret-value-must-not-leak (OSStatus -34018)",
			),
			{ code: "ERR_KEY_CHAIN" },
		);

	it("reports live for a route that went live, and the quiet member still resolves undefined", async () => {
		const mock = await relay();
		transport();
		await mount();
		let outcome: unknown;
		await act(async () => {
			outcome = await latest.connectCustomOutcome({
				url: mock.origin,
				password: "test-only",
				allowInsecure: true,
			});
		});
		expect(outcome).toEqual({ status: "live" });
		let quiet: unknown = "unset";
		await act(async () => {
			quiet = await latest.connectCustom({
				url: mock.origin,
				password: "test-only",
				allowInsecure: true,
			});
		});
		// Other callers' contract is unchanged: `connectCustom` reports nothing.
		expect(quiet).toBeUndefined();
		expect(connectionStore.getState().phase).toBe("live");
	});

	it("reports a validator refusal with its sentence", async () => {
		await mount();
		let outcome: unknown;
		await act(async () => {
			outcome = await latest.connectCustomOutcome({
				url: "http://example.invalid",
				password: "test-only",
				allowInsecure: false,
			});
		});
		expect(outcome).toMatchObject({ status: "refused", storageRefusal: null });
		expect((outcome as { detail: string | null }).detail).toBeTruthy();
	});

	it("names a relay 401 by its surface, so the screen can say the password was rejected", async () => {
		const mock = await relay({ rejectLogin: true });
		transport();
		await mount();
		let outcome: unknown;
		await act(async () => {
			outcome = await latest.connectCustomOutcome({
				url: mock.origin,
				password: "wrong-test-only",
				allowInsecure: true,
			});
		});
		expect(mock.events).toContain("login:1:401");
		expect(outcome).toMatchObject({
			status: "refused",
			storageRefusal: null,
			surface: "password",
		});
	});

	it("carries a keystore rejection's step and code into the outcome, the store and the refusal, redacted", async () => {
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
		// A record now exists, so the next explicit connect runs the real purge.
		privacy.fail = true;
		privacy.error = keychainRefusal();
		let outcome: unknown;
		await act(async () => {
			outcome = await latest.connectCustomOutcome({
				url: mock.origin,
				password: "test-only",
				allowInsecure: true,
			});
		});
		const refusal = {
			step: "clear",
			kind: "Error",
			code: "ERR_KEY_CHAIN -34018",
		};
		expect(outcome).toEqual({
			status: "refused",
			detail: null,
			storageRefusal: refusal,
			surface: "diagnostic",
		});
		const state = connectionStore.getState();
		expect(state.surface).toBe("diagnostic");
		expect(state.storageRefusal).toEqual(refusal);
		// The diagnostics row names the step; the reader's sentence carries the code.
		expect(latest.lastError?.diagnostic).toBe(
			"secure-storage clear Error ERR_KEY_CHAIN -34018",
		);
		expect(latest.refusal?.detail).toBe(
			"This device's secure storage refused the request (code ERR_KEY_CHAIN -34018). Try again, or reinstall the app if it keeps happening.",
		);
		// Redaction: the platform message never reaches any of them.
		const everywhere = JSON.stringify([
			outcome,
			state.storageRefusal,
			state.detail,
			latest.refusal,
			latest.lastError?.diagnostic,
		]);
		expect(everywhere).not.toContain("secret-value-must-not-leak");
		expect(everywhere).not.toContain("deleteValueWithKeyAsync");
		// A later success clears the cause with the rest of the failure.
		privacy.fail = false;
		await act(async () => {
			outcome = await latest.connectCustomOutcome({
				url: mock.origin,
				password: "test-only",
				allowInsecure: true,
			});
		});
		expect(outcome).toEqual({ status: "live" });
		expect(connectionStore.getState().storageRefusal).toBeNull();
	});

	it("keeps the reason on sign-out's refusal too (another verifiedRetirement caller)", async () => {
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
		privacy.fail = true;
		privacy.error = keychainRefusal();
		await act(async () => {
			// Unchanged contract: sign-out still reports false.
			expect(await latest.signOut()).toBe(false);
		});
		expect(connectionStore.getState().surface).toBe("diagnostic");
		expect(connectionStore.getState().storageRefusal?.code).toBe(
			"ERR_KEY_CHAIN -34018",
		);
	});
});

describe("mounted provider picture privacy", () => {
	it.each(["sign-out", "replacement-route", "unmount"])(
		"clears retained picture bytes on %s",
		async (boundary) => {
			const first = await relay();
			transport();
			await mount();
			await act(async () => {
				await latest.connectCustom({
					url: first.origin,
					password: "test-only",
					allowInsecure: true,
				});
			});
			const picture = { agentId: "synthetic-agent", sha256: "a".repeat(64) };
			await agentAvatarCache.get(
				picture,
				async () => "data:image/png;base64,cHJpdmF0ZQ==",
			);
			expect(agentAvatarCache.peek(picture)).not.toBeNull();
			expect(agentAvatarCache.bytes()).toBeGreaterThan(0);
			if (boundary === "unmount") await unmount();
			else if (boundary === "sign-out")
				await act(async () => {
					expect(await latest.signOut()).toBe(true);
				});
			else {
				const replacement = await relay();
				await act(async () => {
					await latest.connectCustom({
						url: replacement.origin,
						password: "test-only",
						allowInsecure: true,
					});
				});
			}
			expect(agentAvatarCache.size()).toBe(0);
			expect(agentAvatarCache.bytes()).toBe(0);
			expect(agentAvatarCache.peek(picture)).toBeUndefined();
		},
	);
});

describe("mounted provider authentication retirement", () => {
	it("proves recovery only after native persistence, and refuses late proof after a route-change abort", async () => {
		const mock = await relay();
		transport(mock.origin);
		nativePlatform.OS = "ios";
		const storage = new SecureStorage(memorySecureStore());
		configureStartupAuthorizationStorage({
			read: () => storage.readStartupAuthorization(),
			write: (record) => storage.writeStartupAuthorization(record),
		});
		const persisted = deferred(),
			heldProof = deferred();
		let writing = false;
		const tunnelStorage = await import("@/features/auth/tunnel-storage");
		const write = vi
			.spyOn(tunnelStorage, "writeStoredOauth")
			.mockImplementation(async (tokens) => {
				writing = true;
				await persisted.promise;
				durable.oauth = tokens;
				durable.events.push("oauth-write");
				return { persistent: true };
			});
		const proof = vi
			.spyOn(recoveryProof, "proveRecoveryAuthority")
			.mockImplementation(async () => {
				expect(durable.events).toContain("oauth-write");
				await heldProof.promise;
				return { accountId: "owner-a", tenantId: "tenant-a" };
			});
		const recovery = await import("@/features/session/draft-recovery");
		const prepare = vi.spyOn(recovery, "prepareDraftRecovery"),
			publish = vi.spyOn(recovery, "notifyDraftRecoveryReady");
		let signingIn: Promise<void> | undefined;
		await mount();
		try {
			await act(async () => {
				signingIn = latest.signInWithRadient();
			});
			await until(() => writing);
			expect(proof).not.toHaveBeenCalled();
			expect(prepare).not.toHaveBeenCalled();
			expect(publish).not.toHaveBeenCalled();
			expect(latest.restoredAccount).toBe(false);
			await act(async () => {
				persisted.resolve();
				await signingIn;
			});
			expect(latest.restoredAccount).toBe(true);
			await act(async () => {
				await latest.selectComputer(computer("a"));
			});
			expect(handoff.signals[0]?.aborted).toBe(true);
			expect(proof).toHaveBeenCalledOnce();
			const fence = proof.mock.calls[0]?.[1].isCurrent;
			expect(fence?.()).toBe(true);
			await act(async () => {
				await latest.connectCustom({
					url: mock.origin,
					password: "test-only",
					allowInsecure: true,
				});
			});
			expect(fence?.()).toBe(false);
			await act(async () => {
				heldProof.resolve();
			});
			expect(prepare).not.toHaveBeenCalled();
			expect(publish).not.toHaveBeenCalled();
		} finally {
			persisted.resolve();
			heldProof.resolve();
			await signingIn;
			await unmount();
			nativePlatform.OS = "web";
			write.mockRestore();
			proof.mockRestore();
			prepare.mockRestore();
			publish.mockRestore();
		}
	});
	it("does not prove or publish recovery when native persistent admission fails", async () => {
		const mock = await relay();
		transport(mock.origin);
		nativePlatform.OS = "ios";
		const proof = vi.spyOn(recoveryProof, "proveRecoveryAuthority");
		const recovery = await import("@/features/session/draft-recovery");
		const prepare = vi.spyOn(recovery, "prepareDraftRecovery"),
			publish = vi.spyOn(recovery, "notifyDraftRecoveryReady");
		await mount();
		try {
			await act(async () => {
				await latest.signInWithRadient();
			});
			expect(latest.signInState.kind).toBe("failed");
			expect(latest.restoredAccount).toBe(false);
			expect(proof).not.toHaveBeenCalled();
			expect(prepare).not.toHaveBeenCalled();
			expect(publish).not.toHaveBeenCalled();
			expect(getStartupAuthorization()).toBeNull();
		} finally {
			await unmount();
			nativePlatform.OS = "web";
			proof.mockRestore();
			prepare.mockRestore();
			publish.mockRestore();
		}
	});
	it("combines reauth checkpoint epochs with callback abort: late identity proof and superseded browser success cannot adopt recovery", async () => {
		const mock = await relay();
		transport(mock.origin);
		durable.oauth = oauth;
		nativePlatform.OS = "ios";
		const storage = new SecureStorage(memorySecureStore());
		configureStartupAuthorizationStorage({
			read: () => storage.readStartupAuthorization(),
			write: (record) => storage.writeStartupAuthorization(record),
		});
		const heldProof = deferred();
		const first = deferred();
		const second = deferred();
		const proof = vi
			.spyOn(recoveryProof, "proveRecoveryAuthority")
			.mockImplementation(async () => {
				await heldProof.promise;
				return { accountId: "owner-a", tenantId: "tenant-a" };
			});
		const recovery = await import("@/features/session/draft-recovery");
		const prepare = vi.spyOn(recovery, "prepareDraftRecovery");
		const publish = vi.spyOn(recovery, "notifyDraftRecoveryReady");
		let firstAttempt: Promise<void> | undefined;
		let secondAttempt: Promise<void> | undefined;
		await mount();
		try {
			await act(async () => {
				await latest.selectComputer(computer("a"));
			});
			expect(proof).toHaveBeenCalledOnce();
			expect(getStartupAuthorization()).not.toBeNull();
			handoff.block = first.promise;
			await act(async () => {
				firstAttempt = latest.signInWithRadient();
			});
			await until(() => handoff.signals.length === 1);
			handoff.block = second.promise;
			await act(async () => {
				secondAttempt = latest.signInWithRadient();
			});
			await until(() => handoff.signals.length === 2);
			expect(handoff.signals[0]?.aborted).toBe(true);
			expect(handoff.signals[1]?.aborted).toBe(false);
			expect(proof.mock.calls[0]?.[1].isCurrent()).toBe(false);
			await act(async () => {
				heldProof.resolve();
				first.resolve();
				await firstAttempt;
			});
			expect(prepare).not.toHaveBeenCalled();
			expect(publish).not.toHaveBeenCalled();
			expect(getStartupAuthorization()).toBeNull();
			expect(durable.events).not.toContain("oauth-write");
			await unmount();
			expect(handoff.signals[1]?.aborted).toBe(true);
		} finally {
			await unmount();
			await act(async () => {
				heldProof.resolve();
				first.resolve();
				second.resolve();
				await Promise.all([firstAttempt, secondAttempt]);
			});
			nativePlatform.OS = "web";
			prepare.mockRestore();
			publish.mockRestore();
			proof.mockRestore();
		}
	});
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
		// Controlled lazy-import completion: the registry module must not steal
		// the test's configured authorization adapter before a remount.
		await realRegistry();
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

describe("session runtime `streaming` is `turnRunning`", () => {
	it("reads a working label under a lowered `streaming` as a running turn", async () => {
		/* The hook-level half of the predicate (#190 R1-3): header, composer op and
		 *  pinned line all read `runtime.streaming`, so the hook must publish
		 *  `turnRunning`, not the raw wire flag, or a reconcile frame mints a
		 *  `prompt` into a busy runtime. */
		const mock = await relay({ frameActivity: "Reading" });
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
		expect(sessionReading.projection?.streaming).toBe(false);
		expect(sessionReading.projection?.activity).toBe("Reading");
		expect(sessionReading.streaming).toBe(true);
		// `streamingRowId` stays on the raw flag: no streamed text lands here.
		expect(sessionReading.streamingRowId).toBeNull();
	});
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
		// A browser grant must publish the same landing admission as a restored
		// credential, not merely populate rows behind the welcome screen.
		expect(latest.restoredAccount).toBe(true);
		expect(connectionStore.getState().route).toBeNull();
		expect(
			connectionStore
				.getState()
				.computers.map((c) => c.tunnelId)
				.sort(),
		).toEqual(["tun-synthetic-1", "tun-synthetic-2"]);
	});

	it("keeps Welcome available after a restored account gets an edge 401, then admits its own retry", async () => {
		const routedTunnels = tunnels.map((tunnel, index) => ({
			...tunnel,
			hostname: `${(index === 0 ? "a" : "b").repeat(32)}-lop.radienthq.com`,
		}));
		const mock = await relay({
			tunnels: routedTunnels,
			refuseCatalogue: true,
			edgeCatalogue: true,
		});
		transport(mock.origin);
		durable.oauth = oauth;
		await mount();
		await until(
			() =>
				latest.restoredAccount &&
				connectionStore.getState().computers.length === 2,
		);
		const computer = connectionStore.getState().computers[0];
		if (!computer) throw new Error("Expected discovered computer");
		await act(async () => {
			await latest.selectComputer(computer);
		});
		await until(() => connectionStore.getState().phase === "live");
		mock.refuseCatalogue.resolve();
		await until(() => connectionStore.getState().surface === "sign-in");
		expect(latest.refusal?.kind).toBe("sign-in");
		// Opening C5's "Sign in again" mounts Welcome with this exact state.
		// The shared presentation function is the screen's actual redirect guard.
		const welcome = signInPresentation({
			initiated: false,
			restoredAccount: latest.restoredAccount,
			busy: latest.busy,
			state: latest.signInState,
		});
		expect(latest.restoredAccount).toBe(true);
		expect(welcome.navigate).toBe(false);
		expect(welcome.state.kind).toBe("idle");
		await act(async () => {
			await latest.signInWithRadient();
		});
		const retried = signInPresentation({
			initiated: true,
			restoredAccount: latest.restoredAccount,
			busy: latest.busy,
			state: latest.signInState,
		});
		expect(retried.navigate).toBe(true);
		expect(retried.state.kind).toBe("exchanging");
	});

	it("reports a discovery 401 after a fresh grant as general failure, not a competing sign-in", async () => {
		const mock = await relay({ tunnels });
		transport(mock.origin);
		mock.answerTunnels(401);
		await mount();
		await act(async () => {
			await latest.signInWithRadient();
		});
		expect(latest.signInState).toMatchObject({
			kind: "failed",
			errorClass: "Error",
			detail: "We could not finish signing in.",
		});
		expect(mock.events).toContain("GET /v1/tunnels");
	});

	it("makes native memory-only credential storage a visible retryable failure", async () => {
		await mount();
		const { Platform } = await import("react-native");
		const previous = Platform.OS;
		Object.defineProperty(Platform, "OS", {
			value: "ios",
			writable: true,
			configurable: true,
		});
		try {
			await act(async () => {
				await latest.signInWithRadient();
			});
			expect(latest.signInState).toMatchObject({
				kind: "failed",
				errorClass: "Error",
			});
			expect(
				latest.signInDiagnostics.map((entry) => entry.stage),
			).not.toContain("discovering");
			expect(latest.restoredAccount).toBe(false);
			expect(latest.busy).toBe(false);
			expect(latest.signInDiagnostics.map((entry) => entry.stage)).toContain(
				"persisting",
			);
		} finally {
			Object.defineProperty(Platform, "OS", {
				value: previous,
				writable: true,
				configurable: true,
			});
		}
	});

	it("shows a superseded attempt instead of silently abandoning a returned browser grant", async () => {
		await mount();
		const gate = deferred();
		handoff.block = gate.promise;
		let signingIn!: Promise<void>;
		await act(async () => {
			signingIn = latest.signInWithRadient();
		});
		await until(() => handoff.started);
		startupAuthorizationLifecycle.suspend();
		gate.resolve();
		await act(async () => {
			await signingIn;
		});
		expect(latest.signInState).toMatchObject({
			kind: "failed",
			errorClass: "SignInSupersededError",
		});
		expect(latest.signInDiagnostics.at(-1)).toEqual({
			stage: "failed",
			errorClass: "SignInSupersededError",
		});
		expect(latest.busy).toBe(false);
		expect(durable.oauth).toBeNull();
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

	/* A pick that supersedes a browser sign-in still in flight aborts it, and the
	 * aborted attempt may no longer publish. Its pending state used to survive on
	 * every screen reading `signInState` ("Waiting for your browser" for ever, and
	 * Computers rendered as signed out) — the ownership move must settle it. */
	it("settles an in-flight sign-in's pending state when a pick takes over", async () => {
		await signedIn({});
		const first = connectionStore.getState().computers[0];
		if (!first) throw new Error("no computer");
		const gate = deferred();
		handoff.block = gate.promise;
		handoff.started = false;
		let signingIn!: Promise<void>;
		await act(async () => {
			signingIn = latest.signInWithRadient();
		});
		await until(() => handoff.started);
		expect(latest.signInState.kind).not.toBe("idle");
		await act(async () => {
			await latest.selectComputer(first);
		});
		gate.resolve();
		await act(async () => {
			await signingIn;
		});
		expect(latest.signInState).toEqual({ kind: "idle" });
	});

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

	it("389 renews a five-minute live grant before the next real relay request", async () => {
		const mock = await signedIn({});
		const computer = connectionStore.getState().computers[0];
		if (!computer) throw new Error("missing fixture computer");
		await act(async () => {
			await latest.selectComputer(computer);
		});
		await until(() => connectionStore.getState().phase === "live");
		mock.expireGrant();
		const now = Date.now();
		const clock = vi.spyOn(Date, "now").mockReturnValue(now + 301_000);
		try {
			await act(async () => {
				await latest.refreshList();
			});
			expect(
				mock.events.filter((e) => e === "POST /v1/tunnels/session/refresh"),
			).toHaveLength(1);
			expect(connectionStore.getState().phase).toBe("live");
			expect(connectionStore.getState().surface).not.toBe("sign-in");
		} finally {
			clock.mockRestore();
		}
	});

	/* TestFlight 453: "The mobile app seems to disconnect after some time with no
	 * reason." A live route renews its five-minute tunnel grant as the list stream
	 * reopens past the gateway's 60 s cap. One control-plane 5xx on that renewal
	 * was typed `rejected` → `diagnostic`, which the list stream treats as
	 * terminal: the route ended and nothing reconnected. It must ride the stream's
	 * ordinary retry and come back live once Radient answers again. */
	it("keeps a live route through a control-plane outage on the grant renewal", async () => {
		const mock = await signedIn({});
		const computer = connectionStore.getState().computers[0];
		if (!computer) throw new Error("missing fixture computer");
		await act(async () => {
			await latest.selectComputer(computer);
		});
		await until(() => connectionStore.getState().phase === "live");
		const streams = () =>
			mock.events.filter((e) => e === "GET /api/sessions/events").length;
		const renewals = () =>
			mock.events.filter((e) => e === "POST /v1/tunnels/session/refresh")
				.length;
		await until(() => streams() === 1);
		mock.failRefresh(503);
		/* Past the grant's life, and still moving: the stream's rotation timing and
		 * `until`'s own deadline both read the clock. The provider restarts a
		 * failed list stream after 2 s, so the wait outlasts one restart. */
		const skew = 301_000;
		const realNow = Date.now.bind(Date);
		const clock = vi
			.spyOn(Date, "now")
			.mockImplementation(() => realNow() + skew);
		const within = async (test: () => boolean) => {
			const deadline = realNow() + 8_000;
			while (!test()) {
				if (realNow() > deadline)
					throw new Error(
						`Route did not recover: ${JSON.stringify({
							renewals: renewals(),
							streams: streams(),
							phase: connectionStore.getState().phase,
							surface: connectionStore.getState().surface,
						})}`,
					);
				await act(async () => {
					await new Promise<void>((resolve) => setTimeout(resolve, 20));
				});
			}
		};
		try {
			await act(async () => {
				mock.endCatalogueStreams();
			});
			await within(() => renewals() >= 2 && streams() >= 2);
			expect(connectionStore.getState().phase).toBe("live");
			expect(connectionStore.getState().surface).toBeNull();
		} finally {
			clock.mockRestore();
		}
	}, 20_000);

	/* PR #178 UX round 1, U1: the same renewal 5xx reached an OPEN CONVERSATION as
	 * `rejected`/`retry`, which the conversation stream treated as terminal — the
	 * transcript stopped behind "Check again". The operator's complaint is this
	 * screen, so it is proven on the conversation stream alone: only the session
	 * stream is cut, so only its reopen renews the grant. */
	it("keeps an open conversation live through a control-plane outage on the grant renewal", async () => {
		observedSession = "synthetic-session";
		const mock = await signedIn({});
		const computer = connectionStore.getState().computers[0];
		if (!computer) throw new Error("missing fixture computer");
		await act(async () => {
			await latest.selectComputer(computer);
		});
		await until(() => connectionStore.getState().phase === "live");
		await until(() => sessionReading.projection !== null);
		const sessionStreams = () =>
			mock.events.filter(
				(e) => e === "GET /api/sessions/synthetic-session/events",
			).length;
		const renewals = () =>
			mock.events.filter((e) => e === "POST /v1/tunnels/session/refresh")
				.length;
		const opened = sessionStreams();
		mock.failRefresh(503);
		const realNow = Date.now.bind(Date);
		const clock = vi
			.spyOn(Date, "now")
			.mockImplementation(() => realNow() + 301_000);
		try {
			await act(async () => {
				mock.endSessionStreams();
			});
			const deadline = realNow() + 8_000;
			while (!(renewals() >= 2 && sessionStreams() >= opened + 1)) {
				if (realNow() > deadline)
					throw new Error(
						`Conversation did not recover: ${JSON.stringify({
							renewals: renewals(),
							sessionStreams: sessionStreams(),
							link: sessionReading.link,
							error: sessionReading.error?.message ?? null,
						})}`,
					);
				await act(async () => {
					await new Promise<void>((resolve) => setTimeout(resolve, 20));
				});
			}
			await until(() => sessionReading.link === "up");
			expect(sessionReading.error).toBeNull();
		} finally {
			clock.mockRestore();
		}
	}, 20_000);

	/* PR #178 review round 2, R2-1: `Retry-After: 0` reached the conversation
	 * stream's reconnect unfloored — reconnect and renewal with no delay, for as
	 * long as the outage lasted. Timed from the wire: with the floor, the second
	 * and third renewals wait at least the curve's 1 s and 2 s steps. */
	it("never lets Retry-After: 0 hot-loop the open conversation's reconnect", async () => {
		observedSession = "synthetic-session";
		const mock = await signedIn({});
		const computer = connectionStore.getState().computers[0];
		if (!computer) throw new Error("missing fixture computer");
		await act(async () => {
			await latest.selectComputer(computer);
		});
		await until(() => connectionStore.getState().phase === "live");
		await until(() => sessionReading.projection !== null);
		const renewals = () =>
			mock.events.filter((e) => e === "POST /v1/tunnels/session/refresh")
				.length;
		const base = renewals();
		mock.failRefreshAfter(503, 0);
		mock.failRefreshAfter(503, 0);
		const realNow = Date.now.bind(Date);
		const clock = vi
			.spyOn(Date, "now")
			.mockImplementation(() => realNow() + 301_000);
		const seen: number[] = [];
		try {
			await act(async () => {
				mock.endSessionStreams();
			});
			const deadline = realNow() + 10_000;
			while (seen.length < 3 || sessionReading.link !== "up") {
				if (realNow() > deadline)
					throw new Error(
						`No recovery: ${JSON.stringify({ seen, link: sessionReading.link })}`,
					);
				while (renewals() - base > seen.length) seen.push(realNow());
				await act(async () => {
					await new Promise<void>((resolve) => setTimeout(resolve, 10));
				});
			}
			const [first = 0, second = 0, third = 0] = seen;
			expect(second - first).toBeGreaterThanOrEqual(900);
			expect(third - second).toBeGreaterThanOrEqual(1_900);
			expect(sessionReading.error).toBeNull();
		} finally {
			clock.mockRestore();
		}
	}, 20_000);

	/* PR #178 R1-2/Q1: once a renewal 5xx is transient, the list stream's restart
	 * is what paces renewals during an outage. It must back off (2 s, then 4 s —
	 * `reconnectDelay`'s curve, unit-tested to its 15 s cap) and honour the
	 * control plane's Retry-After, not POST every 2 s. Read from the scheduled
	 * delays of the provider's own `run` restarts, so no test waits them out. */
	it("backs the list stream's renewal retries off and honours Retry-After", async () => {
		const mock = await signedIn({});
		const computer = connectionStore.getState().computers[0];
		if (!computer) throw new Error("missing fixture computer");
		await act(async () => {
			await latest.selectComputer(computer);
		});
		await until(() => connectionStore.getState().phase === "live");
		/* A pass-through spy (no replacement): Node's own timers must keep their
		 * receiver and arguments. Only the provider's `run` restarts are read. */
		const timers = vi.spyOn(globalThis, "setTimeout");
		const restarts = () =>
			timers.mock.calls
				.filter(
					([handler]) =>
						typeof handler === "function" && handler.name === "run",
				)
				.map(([, ms]) => ms ?? 0);
		const realSetTimeout = setTimeout;
		/* `Retry-After: 0` first (R2-1: it was a zero-delay loop), then 7 s where
		 * the curve's step (4 s) is shorter, so the server's longer ask wins. */
		mock.failRefreshAfter(503, 0);
		mock.failRefreshAfter(503, 7);
		const realNow = Date.now.bind(Date);
		const clock = vi
			.spyOn(Date, "now")
			.mockImplementation(() => realNow() + 301_000);
		try {
			await act(async () => {
				mock.endCatalogueStreams();
			});
			const deadline = realNow() + 10_000;
			while (restarts().length < 2 && realNow() < deadline)
				await act(async () => {
					await new Promise<void>((resolve) => realSetTimeout(resolve, 20));
				});
			// The curve is the floor (never 0), and a longer Retry-After wins.
			expect(restarts().slice(0, 2)).toEqual([2_000, 7_000]);
		} finally {
			clock.mockRestore();
			timers.mockRestore();
		}
	}, 20_000);

	it("389 treats a granted refresh that is still refused as genuine revocation", async () => {
		// The other half of the rule: a refresh only buys one retry. If the grant is
		// really revoked, the retried discovery is refused again and the reader goes
		// to sign-in with the credential cleared — no infinite refresh loop, and no
		// silently accepted refused credential.
		const previous = { ...oauth };
		try {
			oauth.refresh = "synthetic-durable-refresh";
			const mock = await signedIn({ expiringOauth: true });
			oauth.expires_at = Date.now() - 1;
			mock.answerTunnels(401);
			await act(async () => {
				await latest.refreshComputers();
			});
			/* Two renewals, and that is the fence: one to replace the expired access
			 * before discovery, and the forced one a 401 on that fresh token earns.
			 * The retried discovery is refused again, so the pass stops here — a third
			 * attempt would be a refresh loop over a grant the server has revoked. */
			expect(
				mock.events.filter((e) => e === "POST /v1/auth/oauth/token"),
			).toHaveLength(2);
			expect(connectionStore.getState().computers).toEqual([]);
			expect(connectionStore.getState().surface).toBe("sign-in");
			expect(latest.refusal?.kind).toBe("sign-in");
			expect(durable.oauth).toBeNull();
			/* And it stays signed out once the revocation has settled: a later Refresh
			 * neither restores rows for the refused grant nor reports a live session. */
			await until(() => connectionStore.getState().phase === "signed-out");
			await act(async () => {
				await latest.refreshComputers();
			});
			expect(connectionStore.getState().computers).toEqual([]);
			expect(connectionStore.getState().surface).toBe("sign-in");
			expect(durable.oauth).toBeNull();
		} finally {
			Object.assign(oauth, previous);
		}
	});

	it("389 never lets an older rotation's durable write land after a newer one", async () => {
		// Review round 1, R1-M3: rotation A's keystore write is slow and the next pass
		// rotates again (B). The durable record must be B — A's handle is already spent —
		// and the writes must land in rotation order, not completion order. Without the
		// queue the record can end up holding A, and the next launch signs the reader
		// out with `invalid_grant`.
		const previous = { ...oauth };
		try {
			oauth.refresh = "synthetic-durable-refresh";
			const mock = await signedIn({ expiringOauth: true, oauthExpiresIn: 0 });
			oauth.expires_at = Date.now() - 1;
			const writesBefore = durable.events.length;
			mock.holdNextOauthWrite();
			let first!: Promise<void>;
			await act(async () => {
				first = latest.refreshComputers();
			});
			await mock.oauthWriteStarted();
			// A's write is in flight and held. B starts while it is still open.
			let second!: Promise<void>;
			await act(async () => {
				second = latest.refreshComputers();
			});
			mock.releaseOauthWrite();
			await act(async () => {
				await first;
				await second;
			});
			// The newest rotation owns the record; the older one never overwrites it.
			expect(durable.oauth?.access).toBe("synthetic-access-2");
			// The writes themselves, in landing order: the queue is what makes B win.
			expect(
				durable.events
					.slice(writesBefore)
					.filter((e) => e.startsWith("oauth-write:")),
			).toEqual([
				"oauth-write:synthetic-access-1",
				"oauth-write:synthetic-access-2",
			]);
		} finally {
			Object.assign(oauth, previous);
		}
	});

	it("389 closes the discovering latch when its route is retired mid-renewal", async () => {
		// The body has already awaited `await usableOauth()` when the route ends, so it
		// returns before every result arm — the exit that bypassed the inner `finally`.
		// The latch the Refresh controls read must still come down, or Refresh/Try now
		// stay spinning and inert and an empty account paints the skeleton forever
		// (review round 1, R1-M1: PR #121 R2-m1 re-entered through the new exits).
		const previous = { ...oauth };
		try {
			oauth.refresh = "synthetic-durable-refresh";
			const mock = await signedIn({ expiringOauth: true });
			oauth.expires_at = Date.now() - 1;
			mock.holdNextOauth();
			let pass!: Promise<void>;
			await act(async () => {
				pass = latest.refreshComputers();
			});
			await mock.oauthHeld.promise;
			expect(latest.discovering).toBe(true);
			try {
				// Sign-out suspends the authorization revision the pass captured; it does
				// not need the held rotation, so it cannot join it.
				await act(async () => {
					await latest.signOut();
				});
			} finally {
				mock.releaseOauth.resolve();
			}
			await act(async () => {
				await pass;
			});
			// Stuck `true` here was an inert Refresh and an endless skeleton.
			expect(latest.discovering).toBe(false);
		} finally {
			Object.assign(oauth, previous);
		}
	});

	it("389 renews expired account access before discovery instead of deleting its still-valid refresh", async () => {
		const previous = { ...oauth };
		try {
			oauth.refresh = "synthetic-durable-refresh";
			const mock = await signedIn({ expiringOauth: true });
			oauth.expires_at = Date.now() - 1;
			await act(async () => {
				await latest.refreshComputers();
			});
			expect(
				mock.events.filter((e) => e === "POST /v1/auth/oauth/token"),
			).toHaveLength(1);
			expect(ids()).toEqual(listed);
			expect(connectionStore.getState().surface).not.toBe("sign-in");
			expect(durable.oauth?.refresh).toBe("synthetic-refresh-1");
		} finally {
			Object.assign(oauth, previous);
		}
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
			EMPTY_SESSION_ID_PATH.test(entry.path),
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

describe("the cold start reopens the reader's computer (startup restore, PR H)", () => {
	/* Routed to the loopback relay like the PR #121 cases, so a restored pick can
	 *  mint and go live. Every id is synthetic. */
	const tunnels = ["a", "b"].map((letter, index) => ({
		id: `tun-synthetic-${index + 1}`,
		name: `Synthetic computer ${index + 1}`,
		hostname: `${letter.repeat(32)}-lop.radienthq.com`,
		status: "active",
		harnesses: [{ id: "local-operator", enabled: true }],
	}));
	const used = (tunnelId: string, lastUsedAt: number): SavedComputer => ({
		id: `saved-${tunnelId}`,
		transport: "radient",
		tunnelId,
		hostname: `${tunnelId}.example.invalid`,
		name: tunnelId,
		account: null,
		addedAt: 1,
		lastUsedAt,
		hidden: false,
		identity: null,
	});
	const tunnelOf = () => {
		const route = connectionStore.getState().route;
		return route?.mode === "radient" ? route.tunnelId : null;
	};

	it("reopens the last computer used, with the route started before the cold start settles", async () => {
		const mock = await relay({ tunnels });
		transport(mock.origin);
		durable.oauth = oauth;
		durable.computers = [
			used("tun-synthetic-1", 5),
			used("tun-synthetic-2", 10),
		];
		await mount();
		/* `mount` returns at `coldStartSettled`: a route already exists then, so
		 *  Home's landing effect (which needs `!routed`) never sends it to the picker. */
		expect(tunnelOf()).toBe("tun-synthetic-2");
		await until(() => connectionStore.getState().phase === "live");
	});

	it("opens the only computer when nothing was used before", async () => {
		const mock = await relay({ tunnels: tunnels.slice(0, 1) });
		transport(mock.origin);
		durable.oauth = oauth;
		await mount();
		expect(tunnelOf()).toBe("tun-synthetic-1");
	});

	it("stays on the picker with two computers and a stale last id", async () => {
		const mock = await relay({ tunnels });
		transport(mock.origin);
		durable.oauth = oauth;
		durable.computers = [used("tun-synthetic-gone", 10)];
		await mount();
		expect(latest.restoredAccount).toBe(true);
		expect(connectionStore.getState().computers).toHaveLength(2);
		expect(connectionStore.getState().route).toBeNull();
	});

	it("leaves a saved own-tunnel waiting for its password alone", async () => {
		const mock = await relay({ tunnels: tunnels.slice(0, 1) });
		transport(mock.origin);
		durable.oauth = oauth;
		durable.saved = {
			baseUrl: mock.origin,
			password: null as unknown as string,
			allowInsecure: true,
		};
		await mount();
		expect(latest.savedTunnel).not.toBeNull();
		expect(connectionStore.getState().route).toBeNull();
	});
});

/*
 * Review R1-M2. `UIBackgroundModes: remote-notification` lets iOS launch the
 * app in the background for the silent attention push, usually while locked;
 * the keychain then refuses the grant read and the cold start ends signed out.
 * iOS resumes THAT process when the user opens the app, so the restore must be
 * re-run once on the first foreground, or the reader stays signed out until a
 * kill. `durable.locked` stands in for the refused keychain read (the real
 * `readStoredOauth` maps it to `null`).
 */
describe("a background launch on a locked device (R1-M2)", () => {
	it("restores the account on the first foreground after a locked background cold start", async () => {
		const mock = await relay();
		transport(mock.origin);
		durable.oauth = oauth;
		durable.locked = true;
		appState.currentState = "background";
		await mount();
		expect(latest.radientSignedIn).toBe(false);
		expect(durable.oauthReads).toBe(1);
		// Still locked and still in the background: an `inactive`/`background`
		// transition is not the user opening the app.
		await act(async () => appState.emit("inactive"));
		expect(durable.oauthReads).toBe(1);
		// The user unlocks and opens the app: iOS resumes the same process.
		durable.locked = false;
		await act(async () => appState.emit("active"));
		await until(() => latest.radientSignedIn);
		expect(latest.restoredAccount).toBe(true);
		expect(durable.oauthReads).toBe(2);
		// Once only: later foregrounds do not replay the restore.
		await act(async () => appState.emit("background"));
		await act(async () => appState.emit("active"));
		expect(durable.oauthReads).toBe(2);
	});

	it("does not retry a foreground cold start that found nothing", async () => {
		const mock = await relay();
		transport(mock.origin);
		durable.oauth = oauth;
		durable.locked = true;
		appState.currentState = "active";
		await mount();
		expect(latest.radientSignedIn).toBe(false);
		durable.locked = false;
		await act(async () => appState.emit("background"));
		await act(async () => appState.emit("active"));
		expect(durable.oauthReads).toBe(1);
		expect(latest.radientSignedIn).toBe(false);
	});

	it("does not retry a background cold start that DID restore", async () => {
		const mock = await relay();
		transport(mock.origin);
		durable.oauth = oauth;
		appState.currentState = "background";
		await mount();
		await until(() => latest.radientSignedIn);
		await act(async () => appState.emit("active"));
		expect(durable.oauthReads).toBe(1);
	});

	it("does not retry after the provider unmounts", async () => {
		const mock = await relay();
		transport(mock.origin);
		durable.oauth = oauth;
		durable.locked = true;
		appState.currentState = "background";
		await mount();
		await unmount();
		durable.locked = false;
		await act(async () => appState.emit("active"));
		expect(durable.oauthReads).toBe(1);
	});
});
