/**
 * The connection layer, as the screens see it: one route at a time, one list
 * stream, one place that can start or end either.
 *
 * **Why a provider rather than a screen-local hook.** `docs/architecture.md`
 * § State management gives `connection-store` the rule that it is *the only place
 * that can start or end a route*. A store cannot hold a socket, so something has
 * to own the live objects — the `RelayEndpoints` client and the list stream —
 * and that something must outlive every screen, because the stream keeps the list
 * live while the reader is on Settings, Past sessions or a session view. This
 * module is that owner, and it is the only file in the app that builds a client.
 *
 * **What it does with credentials.** It persists them, through
 * `src/features/auth/tunnel-storage.ts` — the app's use of the keystore, with one
 * adapter per run and a stated web fallback — and it is the ONLY caller that may hold an
 * access token (`docs/architecture.md` principle 4). A Radient sign-in is stored when
 * the hand-off succeeds and restored at cold start, VERIFIED rather than trusted; those
 * decisions live in `./radient-restore.ts` as data, so every failure mode (a revoked
 * grant, a lapsed one, a tunnel that is gone) is a case a test can name and this file
 * only carries out. No token enters a store or a component, and the one thing that
 * still lives only for the life of the process is the route itself. Sign-out still
 * revokes with the control plane, because that is a consequence of the route ENDING
 * rather than of persistence (`docs/adr/0002`).
 *
 * Earlier revisions of this comment said flatly that nothing was persisted. That was
 * true when it was written and is the reason the app re-ran the whole browser hand-off
 * on every launch for a signed-in Radient reader (review round 3, R3-3) — a self-hosted
 * reader with a saved tunnel was dialled straight in while the RECOMMENDED path was the
 * worse one. The restore it now does is the fix, and its failure modes are the ones the
 * round names.
 *
 * **The `lo-*` query parameters are web-only and deliberate.** The web target is
 * the surface the audit harness drives (`docs/adr/0003`), and the deployment
 * shape for it is a relay serving the bundle itself. Reading the address, the
 * password and the cleartext opt-in from the query string is how that surface is
 * pointed at one specific relay for a capture — gated on `Platform.OS === "web"`
 * so a URL can never redirect the native app.
 */

import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Platform } from "react-native";
import { useStore } from "zustand";
import {
	createRelayClient,
	type DiscoveredComputer,
	discoverComputers,
	type RadientTokens,
	type RouteProfile,
	refreshRadientTokens,
	TunnelSessionError,
	TunnelSessionManager,
	validateCustomBaseUrl,
	validateRadientHostname,
} from "@/connection";
import {
	registerStartupAuthorizationCleanup,
	startupAuthorizationLifecycle,
} from "@/connection/startup-authorization";
import {
	clearStoredCredentials,
	clearStoredOauth,
	readSavedTunnel,
	readStoredOauth,
	readStoredTunnelSession,
	removeSavedTunnel,
	type SavedTunnel,
	writeSavedTunnel,
	writeStoredOauth,
	writeStoredTunnelSession,
} from "@/features/auth/tunnel-storage";
import { clearAuthorizationData } from "@/features/session/device-storage";
import {
	type RelayEndpoints,
	RelayError,
	type RelayStream,
	type StreamStatus,
} from "@/relay";
import { createConfigStore } from "@/state/config-store";
import {
	type ConnectionSnapshot,
	createConnectionStore,
	isUsable,
} from "@/state/connection-store";
import { createListStore, type ListSnapshot } from "@/state/list-store";
import {
	customRouteAuthentication,
	nativeCredentialRetirement,
} from "./authentication-lifecycle";
import { type ConfigStreamHandle, startConfigStream } from "./config-stream";
import { adoptableSession, carryOutRestore } from "./radient-restore";
import { beginRadientSignIn, type SignInState } from "./radient-sign-in";
import { type RefusalView, refusalFromError } from "./refusal";
import {
	authenticateCustomRoute,
	type RouteAdmission,
	routeAdmission,
} from "./route-admission";

/**
 * The three stores, as process-wide singletons.
 *
 * Built here rather than inside the provider so a hook can read them without a
 * second context, and so a test can build its own instance from the exported
 * factories. The provider mounts once, in the root layout, so "process-wide" and
 * "screen-wide" are the same lifetime in this app.
 */
export const connectionStore = createConnectionStore();
export const listStore = createListStore();
export const configStore = createConfigStore();

// Registration outlives route/provider mounts, just like the credential store.
// Startup storage registers independently, avoiding an auth/coordinator cycle.
registerStartupAuthorizationCleanup(clearAuthorizationData);
type StartupRouteAdmission = RouteAdmission & {
	authorizationRevision: number;
	routeKey: string;
};

export const useConnectionState = <T,>(
	selector: (state: ConnectionSnapshot) => T,
): T => useStore(connectionStore, selector);

export const useListState = <T,>(selector: (state: ListSnapshot) => T): T =>
	useStore(listStore, selector);

/** How long the list stream waits before reopening after a transport failure.
 *  Long enough that a phone coming out of a tunnel does not hammer the relay,
 *  short enough that the list is live again before the reader notices. A clean
 *  end-of-body is NOT this path — the connection layer rotates on its own. */
const RESTART_MS = 2_000;

/** The body of a pick that never reached Radient (U5/D11): about THIS phone's
 *  connection, because that is the one thing the failure tells us. */
export const PICK_UNREACHABLE_DETAIL =
	"This phone could not reach Radient. Check its connection, then try again.";

/** What the connection pill shows, derived from the stream's own status. */
export type StreamHealth =
	| "idle"
	| "connecting"
	| "live"
	| "degraded"
	| "offline";

export type ConnectCustomInput = {
	url: string;
	password: string;
	allowInsecure: boolean;
};

export type Connection = {
	connectCustom: (input: ConnectCustomInput) => Promise<void>;
	signInWithRadient: () => Promise<void>;
	refreshComputers: () => Promise<void>;
	/** What the console says about the account's billing, when discovery returned
	 *  it: `null` before any computer is known. The amount of a paid quote is NOT
	 *  here — the merged client surfaces eligibility and the console's own sentence
	 *  through discovery, so the create command carries a placeholder rather than a
	 *  number this app cannot verify. */
	billing: { eligible: boolean | null; message: string | null } | null;
	/** A discovery pass is in flight. Kept beside the store rather than in it: the
	 *  store's phases describe a ROUTE, and listing an account's computers happens
	 *  before any route exists. */
	discovering: boolean;
	/** The reader's own tunnel from secure storage, or `null`. */
	savedTunnel: SavedTunnel | null;
	/** True when this cold start read a stored RADIENT credential, accepted it, and
	 *  started discovery.
	 *
	 *  It exists because a restored sign-in is invisible to the store: no route exists
	 *  yet (the reader has not picked a computer), so `phase` is still `signed-out` and
	 *  a screen cannot tell "signed in, choosing a computer" from "first run". The
	 *  flows' first branch is `Launch →|credential cached| Computers`, and this is the
	 *  bit that lets the landing decide which of the two it is (R3-3). */
	restoredAccount: boolean;
	selectComputer: (computer: DiscoveredComputer) => Promise<void>;
	refreshList: () => Promise<void>;
	/** False means remote sign-out was not confirmed: callers must not show a success toast. */
	signOut: () => Promise<boolean>;
	/** Persists the reader's own tunnel, so a self-hosted setup survives a
	 *  restart. Storage is written HERE rather than by a screen: two screens can
	 *  save a tunnel (setup, and Settings' edit), and the record has one owner. */
	saveCustomRoute: (input: ConnectCustomInput) => Promise<void>;
	/** Forgets the saved own-tunnel. Deliberately not a sign-out: a reader
	 *  dropping a tunnel keeps their Radient login, and vice versa. */
	removeCustomRoute: () => Promise<void>;
	/** Whether the saved tunnel survives a restart on this runtime. Settings says
	 *  which it is instead of implying the keystore everywhere. */
	tunnelStoragePersistent: () => Promise<boolean>;
	/** Retries whatever failed last, through the same call that failed. */
	retry: () => Promise<void>;
	/** Whether a connection attempt is in flight. */
	busy: boolean;
	/** True once the cold start has finished deciding whether there is anything to
	 *  resume — the saved own-tunnel read, or a `?lo-relay` override.
	 *
	 *  A screen cannot tell "no credentials YET" from "no credentials" without it, and
	 *  that difference is a whole screen's honesty: the store's initial phase IS
	 *  `signed-out`, so the first render of a CONNECTED cold start looks identical to a
	 *  first run. A screen that routed to the welcome surface on `!route` alone bounced
	 *  a connected reader to `/welcome` on every launch (it did exactly that on the
	 *  capture harness's cells, which never reached the relay at all). */
	coldStartSettled: boolean;
	/** The live client, or `null` when there is no route. A screen uses it for the
	 *  read and command routes it owns, and never builds a path or a URL itself —
	 *  `src/relay/endpoints.ts` is the only module that knows the relay's shape. */
	relay: () => RelayEndpoints | null;
	streamHealth: StreamHealth;
	signInState: SignInState;
	/** The last typed failure, for the diagnostics row. Never a status code on a
	 *  screen; this is the one place a diagnostic is allowed. */
	lastError: RelayError | null;
	/** The refusal to render, or null. Decided from the store's surface. */
	refusal: RefusalView | null;
};

const ConnectionContext = createContext<Connection | null>(null);

/** Web-only: the relay a capture run pointed this build at. */
function webRelayOverride(): ConnectCustomInput | null {
	if (Platform.OS !== "web" || typeof location === "undefined") return null;
	const params = new URLSearchParams(location.search);
	const url = params.get("lo-relay");
	if (!url) return null;
	return {
		url,
		password: params.get("lo-relay-password") ?? "",
		allowInsecure: params.get("lo-relay-insecure") === "1",
	};
}

function healthFrom(status: StreamStatus): StreamHealth {
	switch (status.state) {
		case "open":
		// `rotating` is live on purpose: the gateway ends every stream at 60 s,
		// so a client that painted reconnecting on the boundary would flash once a
		// minute forever (`docs/ux/flows.md` § 9, `C1`).
		case "rotating":
			return "live";
		case "connecting":
			return "connecting";
		case "stalled":
			return "degraded";
		case "closed":
			return "offline";
		case "idle":
			return "idle";
	}
}

/** Builds the profile for a discovered computer, through the validator so the
 *  hostname form is checked in one place rather than trusted here. */
function routeForComputer(computer: DiscoveredComputer): RouteProfile | null {
	const result = validateRadientHostname(computer.hostname, computer.tunnelId);
	return result.ok ? result.route : null;
}

/** Turns an unverified purge into the typed refusal the surfaces already know,
 *  so a sign-out reports `false` rather than pretending the device is clean.
 *  Module scope on purpose: it reads no component state, so it never becomes a
 *  hook dependency that changes on every render. */
const verifiedRetirement = (retirement: Promise<boolean>): Promise<void> =>
	retirement.then((verified) => {
		if (verified) return;
		throw new RelayError(
			"rejected",
			"Cannot confirm those local drafts were removed",
			{ surface: "diagnostic", detail: "" },
		);
	});

export const ConnectionProvider = ({
	children,
}: {
	children: React.ReactNode;
}) => {
	const [busy, setBusy] = useState(false);
	const [discovering, setDiscovering] = useState(false);
	/* The latest discovery pass, so only it lowers `discovering` (R2-m1). */
	const discoveryPassRef = useRef(0);
	/* See `Connection.coldStartSettled`. */
	const [coldStartSettled, setColdStartSettled] = useState(false);
	const cancelledRef = useRef(false);
	const [savedTunnel, setSavedTunnel] = useState<SavedTunnel | null>(null);
	/* See `Connection.restoredAccount`. */
	const [restoredAccount, setRestoredAccount] = useState(false);
	const [streamHealth, setStreamHealth] = useState<StreamHealth>("idle");
	const [signInState, setSignInState] = useState<SignInState>({ kind: "idle" });
	const [lastError, setLastError] = useState<RelayError | null>(null);

	const clientRef = useRef<ReturnType<typeof createRelayClient> | null>(null);
	const streamRef = useRef<RelayStream | null>(null);
	const configRef = useRef<ConfigStreamHandle | null>(null);
	const tokensRef = useRef<RadientTokens | null>(null);
	const managerRef = useRef<TunnelSessionManager | null>(null);
	const retryRef = useRef<(() => Promise<void>) | null>(null);
	// Readiness is withdrawn before remote revocation. Keep the unresolved
	// operation independently so ordinary Sign out and diagnostic retry share
	// the same origin even though the selected route has already become null.
	const pendingSignOutRef = useRef<(() => Promise<boolean>) | null>(null);
	// Keep completion identity even after remote success clears the pending
	// callback: an outer durable-clear await must still detect a newer route.
	const revocationOwnerRef = useRef<symbol | null>(null);
	/** The latest revision of the cold-start restore, so the retry a network failure
	 *  offers can re-run the very function that offered it — see `restoreRadient`. */
	const restoreRef = useRef<() => Promise<void>>(async () => undefined);
	const mountedRef = useRef(true);

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
			startupAuthorizationLifecycle.suspend();
			pendingSignOutRef.current = null;
			revocationOwnerRef.current = null;
			streamRef.current?.stop();
			configRef.current?.stop();
			clientRef.current = null;
			void nativeCredentialRetirement.retire(
				managerRef.current,
				undefined,
				false,
			);
			managerRef.current = null;
			connectionStore.getState().endRoute();
		};
	}, []);

	/** Authentication ended without proof — a `401`, a lapsed grant, a cancelled
	 *  login. The gate closes now and the persisted generation is invalidated, but
	 *  NO draft is deleted: the reader's unfinished sentence survives a token blip
	 *  (`docs/ux/flows.md` § C5) and is simply unreachable from the next generation.
	 *  `afterCleanup` is for the credential that is genuinely dead (an expired
	 *  grant), never for private content. */
	const revokeAuthorization = useCallback(
		(afterRevoke?: () => Promise<void>): Promise<boolean> =>
			startupAuthorizationLifecycle.revoke(afterRevoke).then(
				() => true,
				() => {
					if (mountedRef.current) {
						setBusy(false);
						connectionStore
							.getState()
							.noteFailure({ surface: "diagnostic", displayableMessage: "" });
					}
					return false;
				},
			),
		[],
	);

	/** The synchronous half revokes dispatch; the resolved value reports whether
	 * every deletion was VERIFIED. The rejection itself stays on the lifecycle's
	 * own tail, so admission stays closed after a failure even though this
	 * caller-facing promise resolves — no unhandled rejection from a 401 handler,
	 * and no false success either. */
	const retireAuthorization = useCallback(
		(
			preserveUnscoped = false,
			afterCleanup?: () => Promise<void>,
		): Promise<boolean> =>
			startupAuthorizationLifecycle.retire(preserveUnscoped, afterCleanup).then(
				() => true,
				() => {
					if (mountedRef.current) {
						setBusy(false);
						connectionStore
							.getState()
							.noteFailure({ surface: "diagnostic", displayableMessage: "" });
					}
					return false;
				},
			),
		[],
	);

	/** Records a typed failure: the store owns the surface, and the retry closure
	 *  is what the refusal surface's button re-runs. */
	const noteError = useCallback(
		(error: RelayError, retry?: () => Promise<void>) => {
			if (error.surface === "password" || error.surface === "sign-in")
				void revokeAuthorization();
			setLastError(error);
			retryRef.current = retry ?? null;
			connectionStore.getState().noteFailure({
				surface: error.surface,
				/* `displayableMessage`, NOT `error.detail`.
				 *
				 *  The store's field is named for the taxonomy's sanitised accessor and this
				 *  call site used to bypass it, feeding the RAW `.detail` in its place. That
				 *  put a tunnel edge's or a proxy's body — `<html><body>502 Bad Gateway
				 *  </body></html>` is the one a driven repro produced — into the field the
				 *  store documents as the only way in, from where `refusal.ts` re-read it and
				 *  `RefusalSurface` rendered it verbatim. The accessor is the one thing that
				 *  refuses a `transport` failure's runtime words, an empty body and markup,
				 *  so reading it here is what makes the store's guarantee true rather than
				 *  merely stated. */
				displayableMessage: error.displayableMessage,
				retryAfterMs: error.retryAfterMs ?? null,
			});
		},
		[revokeAuthorization],
	);

	const stopStream = useCallback(() => {
		streamRef.current?.stop();
		streamRef.current = null;
	}, []);

	/** Stops the config stream. Same lifecycle as the list's — it belongs to the
	 *  route — and silent by design: this stream paints nothing, and its failure
	 *  policy lives in `config-stream.ts`. */
	const stopConfig = useCallback(() => {
		configRef.current?.stop();
		configRef.current = null;
	}, []);

	/**
	 * Opens the list stream, and reopens it when the loop stops on an error.
	 *
	 * The restart lives here rather than in the connection layer for the reason
	 * that layer documents: it never retries a failure it does not understand, and
	 * only the app knows whether a given failure is a "wait and it clears" or a
	 * "the reader must act". Transient failures mark the list stale and keep it on
	 * screen — the cold-start rule, and the difference between stale and blank.
	 */
	const startStream = useCallback(
		(
			client: ReturnType<typeof createRelayClient>,
			admission: RouteAdmission,
		) => {
			stopStream();
			let stopped = false;
			let _attempt = 0;

			const run = () => {
				if (stopped || !admission.isCurrent()) return;
				const stream = client.sessionsStream({
					/* The flag goes to the STREAM as well as the REST read below, together:
					 * the relay reads it once at connection open, so a repaint from a
					 * stream that did not ask would drop the remote rows the cold-start
					 * GET painted — the flap the relay's contract warns about. */
					includePeers: true,
					onFrame: (frame) => {
						if (!admission.isCurrent()) return;
						if (frame.kind === "malformed") {
							/* NOT SILENT (round 1, R1-1). This handler used to fall through for a
							 *  frame the schema refused, so a relay answer this build cannot read
							 *  left the list frozen on its last snapshot with nothing said — the
							 *  shape measured when an `ask` gate failed the whole `sessions`
							 *  frame. The frame is still dropped (the last good list stays), but
							 *  the drop is REPORTED: a line for the diagnosis, and the stale mark
							 *  (`Last updated …`) so the reader can see the list is no longer
							 *  being kept current. The next readable frame clears it. */
							console.warn(
								`[sessions] an unreadable ${frame.event} frame was dropped; the list keeps its last good frame`,
								frame.error,
							);
							if (frame.event === "sessions") listStore.getState().markStale();
							return;
						}
						if (frame.kind === "sessions") {
							_attempt = 0;
							listStore.getState().applyFrame({
								sessions: frame.data.sessions,
								degraded: frame.data.degraded,
								capabilities: frame.data.capabilities,
								unread: frame.data.unread,
							});
						}
					},
					onState: (status) => {
						if (!admission.isCurrent()) return;
						if (mountedRef.current) setStreamHealth(healthFrom(status));
					},
					onError: (error) => {
						if (stopped || !admission.isCurrent()) return;
						/* A surface the reader must act on ends the loop: retrying a
						 * 401 or a revoked tunnel in a tight cycle is how a phone
						 * burns a battery to annoy a gateway. */
						if (
							error.surface &&
							error.surface !== "none" &&
							error.surface !== "retry" &&
							error.surface !== "computer-offline"
						) {
							/* The stream is over and it is NOT coming back on its own, so the health
							 *  must stop reporting a live stream. This branch used to return with
							 *  `streamHealth` untouched, which left the status pill — and, after the
							 *  D12 fix, the Settings row that reads it — saying "Connected" for a
							 *  route the reader has to re-establish. Measured on a driven kill: the
							 *  pill still read a healthy state 30 s after the relay went away (design
							 *  round 2, D12 rider). The refusal surface below the row carried the
							 *  cause; the health was simply never told. */
							if (mountedRef.current) setStreamHealth("offline");
							noteError(error);
							return;
						}
						listStore.getState().markStale();
						if (mountedRef.current) setStreamHealth("degraded");
						_attempt += 1;
						setTimeout(run, RESTART_MS);
					},
				});
				streamRef.current = stream;
				/*
				 * START IT. `SseConnection` is inert until `start()` — the
				 * constructor only stores its options — and this stream was built
				 * and parked for as long as the provider has existed: the list
				 * repainted only on the cold-start REST read and a pull-to-refresh,
				 * never on a wire frame. MEASURED (2026-10-09, the mesh half's
				 * capture): four app loads against the mock relay recorded four
				 * `GET /api/sessions` and ZERO `/api/sessions/events`, and the mock
				 * serves the stream route correctly — the request was simply never
				 * made. The socket is a route property (see this file's header), so
				 * it is started HERE, where the route is decided, and re-started on
				 * every `run()` — the retry path builds a new stream, and a stream
				 * that is not started is the same defect with a fresh object.
				 *
				 * The slice that found this is the one that needs it most: remote
				 * rows arrive on BOTH transports, and a stream that never opens is a
				 * list that never learns a peer's row changed.
				 */
				stream.connection.start();
			};

			run();
			// A queued restart is inert once admission's revision has been revoked.
			return () => {
				stopped = true;
			};
		},
		[noteError, stopStream],
	);

	/**
	 * Opens the config stream beside the list stream: the relay's resolved
	 * language (wave-5 slice D). Its rules live in `config-stream.ts`, and one
	 * differs from the list's on purpose — a relay-own `404` means an older
	 * daemon's route is absent and is never retried.
	 */
	const startConfig = useCallback(
		(client: ReturnType<typeof createRelayClient>) => {
			stopConfig();
			configRef.current = startConfigStream(client, configStore, {
				restartMs: RESTART_MS,
			});
		},
		[stopConfig],
	);

	/** Retire the old client before publishing a provisional route. Its address
	 * is useful for loading/refusal UI, but must not carry protected requests. */
	const beginRoute = useCallback(
		(route: RouteProfile): StartupRouteAdmission => {
			const authorizationRevision = startupAuthorizationLifecycle.suspend();
			pendingSignOutRef.current = null;
			revocationOwnerRef.current = null;
			stopStream();
			stopConfig();
			clientRef.current = null;
			void nativeCredentialRetirement.retire(
				managerRef.current,
				undefined,
				false,
			);
			managerRef.current = null;
			listStore.getState().reset();
			configStore.getState().reset();
			setLastError(null);
			retryRef.current = null;
			connectionStore.getState().startRoute(route);
			// Keep route ownership independent from the dispatch generation: a 401
			// closes dispatch immediately, but its typed onError must still reach
			// this route's refusal surface rather than disappear as a stale event.
			const admission = routeAdmission(
				connectionStore,
				() => mountedRef.current,
			);
			return {
				...admission,
				authorizationRevision,
				routeKey: JSON.stringify(route),
			};
		},
		[stopStream, stopConfig],
	);

	/** Everything a route needs once its credentials are valid. */
	const goLive = useCallback(
		async (
			client: ReturnType<typeof createRelayClient>,
			admission: StartupRouteAdmission,
		): Promise<void> => {
			if (
				!admission.isCurrent() ||
				!startupAuthorizationLifecycle.isCurrent(
					admission.authorizationRevision,
				)
			)
				return;
			if (
				!admission.publish(() => {
					clientRef.current = client;
				})
			)
				return;
			startStream(client, admission);
			startConfig(client);
			/* Startup authorization is admitted by the AUTHENTICATED ROUTE, not by the
			 * list read (review R1-1). Gating it on a frame meant one transient 503 on
			 * `GET /sessions` left a healthy, stream-populated route permanently unable
			 * to start a conversation — the stream's seed frame does not admit, and
			 * neither did a later refresh. The retry covers a storage write that failed
			 * once; `null` means a newer attempt superseded this one and must not retry. */
			const admitStartup = async (): Promise<void> => {
				for (let attempt = 0; attempt < 2; attempt += 1) {
					if (!isAdmissionActive()) return;
					try {
						await startupAuthorizationLifecycle.admit(
							admission.routeKey,
							admission.authorizationRevision,
						);
						return;
					} catch {
						if (!isAdmissionActive()) return;
					}
				}
				if (isAdmissionActive())
					connectionStore
						.getState()
						.noteFailure({ surface: "diagnostic", displayableMessage: "" });
			};
			const isAdmissionActive = () => admission.isCurrent();
			await admitStartup();
			if (!admission.isCurrent()) return;
			/* The first paint is the REST read, not the stream's seed: the cold-start
			 * rule is that the list renders immediately, and a stream that opens in a
			 * second must not be the reason the screen is empty. It asks for the
			 * peers' rows exactly as the stream does — one list, one population. */
			const frame = await client.sessions({ includePeers: true }).catch(
				/* NOT SILENT (round 1, R1-1): this used to be `.catch(() => null)`, so
				 *  a cold-start answer the schema refused (or a transport that never
				 *  answered) left an empty list with nothing on screen or in the log
				 *  saying why. The stream's seed frame is the other carrier of the
				 *  same list, so the read is not fatal — but the failure is said out
				 *  loud and the list carries the same stale mark a dropped stream
				 *  paints. */
				(error: unknown) => {
					if (!admission.isCurrent()) return null;
					console.warn(
						"[sessions] the cold-start list read could not be applied; the stream's seed frame is the fallback",
						error,
					);
					listStore.getState().markStale();
					return null;
				},
			);
			if (frame && admission.isCurrent()) {
				listStore.getState().applyFrame({
					sessions: frame.sessions,
					degraded: frame.degraded,
					capabilities: frame.capabilities,
					unread: frame.unread,
				});
			}
		},
		[startStream, startConfig],
	);

	const connectCustom = useCallback(
		async (
			{ url, password, allowInsecure }: ConnectCustomInput,
			restoring = false,
		) => {
			setBusy(true);
			let admission: StartupRouteAdmission | null = null;
			try {
				const validated = validateCustomBaseUrl(url, { allowInsecure });
				if (!validated.ok) {
					/* A shape the validator refuses is not a transport failure: it never
					 * reaches the network, and the screen states the reason beside the
					 * field rather than in a refusal surface. */
					setLastError(null);
					connectionStore.getState().noteFailure({
						surface: "none",
						displayableMessage: validated.reason,
					});
					retryRef.current = null;
					return;
				}
				const route = validated.route;
				const privacy = restoring
					? Promise.resolve()
					: verifiedRetirement(retireAuthorization(true));
				admission = beginRoute(route);
				await privacy;
				await nativeCredentialRetirement.settled();
				if (!admission.isCurrent()) return;
				if (!(await authenticateCustomRoute(route, password, admission)))
					return;
				const client = createRelayClient({
					route,
					onResponse: (facts) => {
						if (admission?.isCurrent() && facts.status === 401) {
							void revokeAuthorization();
							setBusy(false);
							connectionStore.getState().noteFailure({
								surface: "password",
								displayableMessage: "",
							});
						}
					},
				});

				await goLive(client, admission);
			} catch (error) {
				if (admission && !admission.isCurrent()) return;
				if (error instanceof RelayError) {
					noteError(error, () =>
						connectCustom({ url, password, allowInsecure }),
					);
					return;
				}
				throw error;
			} finally {
				if (mountedRef.current && (!admission || admission.isCurrent()))
					setBusy(false);
			}
		},
		[beginRoute, goLive, noteError, retireAuthorization, revokeAuthorization],
	);

	const refreshComputers = useCallback(async () => {
		/* Discovery answers an ACCOUNT question before a tunnel exists. The store's
		 * phases describe a route, so the in-flight flag lives beside it instead of
		 * inventing a route to hang a phase on. */
		const pass = ++discoveryPassRef.current;
		setDiscovering(true);
		const revision = startupAuthorizationLifecycle.getRevision();
		const tokens = tokensRef.current;
		const isCurrent = () =>
			mountedRef.current && startupAuthorizationLifecycle.isCurrent(revision);
		const result = await discoverComputers({
			accessToken: async () => tokens?.access ?? null,
		});
		try {
			if (!isCurrent()) return;
			switch (result.kind) {
				case "computers":
					connectionStore.getState().setComputers(result.computers);
					return;
				case "none":
					/* An account with no tunnels is a SCREEN, not a failure: it is the set-up
					 * path (F-2). An empty array is how the picker knows to show it. */
					connectionStore.getState().setComputers([]);
					return;
				case "unauthorized":
					/* The credential is gone SERVER-SIDE — revoked, or past its refresh window.
					 *  Deleted here rather than left for the next launch to retry, so "sign in
					 *  again" is a state the reader passes through once and not a loop. The other
					 *  two failure arms deliberately KEEP the credential: an unreachable API or an
					 *  unreadable answer says nothing about whether the grant is still good. */
					void revokeAuthorization(clearStoredOauth);
					setDiscovering(false);
					/* The rows go with the grant. A revoked account's list left in the store
					 *  stayed rendered in Settings beside "Not signed in with Radient" (PR #121
					 *  review round 1, R1-m1), now that the list outlives a route start. */
					connectionStore.getState().setComputers([]);
					/* The landing latch goes with the credential (review round 5, r5-n1). This
					 *  is the SECOND place a session ends — `signOut` is the other — and a latch
					 *  left set here would route a signed-out reader to `/tunnels` the moment
					 *  this refusal cleared, which is exactly the M2 defect from the other
					 *  direction. */
					if (mountedRef.current) setRestoredAccount(false);
					connectionStore.getState().noteFailure({
						surface: "sign-in",
						displayableMessage: "Your Radient session expired.",
					});
					return;
				/* The two failures that say nothing about the grant are ACCOUNT-level, not a
				 *  route refusal. Routed through `noteFailure` they flipped a live route to
				 *  `refused`, hid the rows they failed to refresh, named the first computer
				 *  as the thing "not ready yet", and offered a Try now that re-ran a route
				 *  action instead of this one (PR #121 design round 1, D2/D3). The Computers
				 *  screen renders this as a banner whose action calls `refreshComputers`. */
				case "unreachable":
				case "rejected":
					connectionStore.getState().noteDiscoveryFailure(result.kind);
					return;
			}
		} finally {
			/* Keyed on the PASS, not on `isCurrent()`. A pick or a route start during an
			 *  in-flight Refresh suspends the authorization revision, so this pass stops
			 *  being current and its result is rightly dropped — but the flag it raised
			 *  must still come down, or the banner's Try now and the header Refresh stay
			 *  spinning (and inert) and an empty list paints the skeleton forever (PR
			 *  #121 review round 2, R2-m1). Only the latest pass may lower it, so an
			 *  older pass finishing late cannot hide a newer one still running. */
			if (mountedRef.current && pass === discoveryPassRef.current)
				setDiscovering(false);
		}
	}, [revokeAuthorization]);

	const signInWithRadient = useCallback(async () => {
		const privacy = retireAuthorization(true);
		const revision = startupAuthorizationLifecycle.getRevision();
		const isCurrent = () =>
			mountedRef.current && startupAuthorizationLifecycle.isCurrent(revision);
		cancelledRef.current = true;
		stopStream();
		stopConfig();
		clientRef.current = null;
		tokensRef.current = null;
		const retired = nativeCredentialRetirement.retire(managerRef.current);
		managerRef.current = null;
		connectionStore.getState().endRoute();
		setBusy(true);
		try {
			await Promise.all([verifiedRetirement(privacy), retired]);
			if (!isCurrent()) return;
			const result = await beginRadientSignIn({
				onState: (state) => {
					if (isCurrent()) setSignInState(state);
				},
			});
			if (!result.ok || !isCurrent()) return;
			tokensRef.current = result.tokens;
			/* Persisted BEFORE discovery, and before any route exists: the credential is
			 *  what makes the NEXT launch a computers screen instead of a second browser
			 *  hand-off, and a discovery that then fails (an unreachable API, an empty
			 *  account) must not throw a valid grant away. A runtime that cannot store it
			 *  still gets a working session this run — `writeStoredOauth` reports which. */
			await startupAuthorizationLifecycle.runIfCurrent(revision, () =>
				writeStoredOauth(result.tokens),
			);
			if (!isCurrent()) return;
			setSignInState({ kind: "idle" });
			/* Straight into discovery, which is what makes the button's promise —
			 * "finds your computers" — true rather than a second tap away. */
			await refreshComputers();
		} finally {
			if (isCurrent()) setBusy(false);
		}
	}, [refreshComputers, retireAuthorization, stopStream, stopConfig]);

	const selectComputer = useCallback(
		async (computer: DiscoveredComputer) => {
			setBusy(true);
			let admission: StartupRouteAdmission | null = null;
			try {
				const route = routeForComputer(computer);
				if (!route) {
					connectionStore.getState().noteFailure({
						surface: "diagnostic",
						displayableMessage:
							"That computer's address is not one this build can reach.",
					});
					return;
				}
				admission = beginRoute(route);
				connectionStore.getState().selectComputer(computer);
				await nativeCredentialRetirement.settled();
				if (!admission.isCurrent()) return;
				const adopted = adoptableSession(
					await readStoredTunnelSession(),
					computer,
				);
				if (!admission.isCurrent()) return;
				const manager = new TunnelSessionManager({
					oauthAccessToken: async () => tokensRef.current?.access ?? null,
					initial: adopted,
					/* Every mutation of the session is written through, so a crash mid-flow
					 *  cannot leave the store behind the manager. */
					persist: (session) => writeStoredTunnelSession(session),
				});
				managerRef.current = manager;
				if (adopted) {
					/* Not a mint: a fresh GRANT for a session that already exists. The manager
					 *  re-mints or refreshes as the handle's age requires. */
					await manager.usableSession();
				} else {
					await manager.mint({
						tunnelId: computer.tunnelId,
						hostname: computer.hostname,
					});
				}
				if (!admission.isCurrent()) return;
				const client = createRelayClient({
					route,
					tunnelSession: () => manager.current,
					onResponse: (facts) => {
						/* The edge's own 401 (with `X-Radient-Login`) is the re-auth
						 * signal; the connection layer types it as `sign-in`, and this
						 * only records it so the surface is decided once. */
						if (admission?.isCurrent() && facts.status === 401) {
							void revokeAuthorization();
							setBusy(false);
							connectionStore.getState().noteFailure({
								surface: "sign-in",
								displayableMessage: "",
							});
						}
					},
				});
				await goLive(client, admission);
			} catch (error) {
				if (admission && !admission.isCurrent()) return;
				if (
					error instanceof RelayError ||
					error instanceof TunnelSessionError
				) {
					noteError(
						error instanceof RelayError
							? error
							: error.failure === "network"
								? /* The phone could not reach Radient at all: nothing on the
									 * computer or in the console is wrong, and the `console` surface
									 * sent an offline reader to the Radient console and a terminal
									 * command (PR #121 UX round 1, U5; design D11). `retry` is the
									 * surface whose button re-runs this pick. The sentence is ours,
									 * not the session client's developer string, and it is passed as
									 * `detail` because `transport`'s fixed copy names the relay, which
									 * this request never reached. */
									new RelayError("rejected", error.message, {
										surface: "retry",
										detail: PICK_UNREACHABLE_DETAIL,
									})
								: /* A control-plane refusal has no HTTP client error to carry it: it
									 * is typed here so the surface stays the taxonomy's decision and
									 * never the caller's. `console` because every other
									 * `TunnelSessionError` this can be is fixed on the computer or in
									 * the console. */
									new RelayError("rejected", error.message, {
										surface: "console",
										detail: error.message,
									}),
						() => selectComputer(computer),
					);
					return;
				}
				throw error;
			} finally {
				if (mountedRef.current && (!admission || admission.isCurrent()))
					setBusy(false);
			}
		},
		[beginRoute, goLive, noteError, revokeAuthorization],
	);

	const refreshList = useCallback(async () => {
		const client = clientRef.current;
		if (!client) return;
		setBusy(true);
		try {
			const frame = await client.sessions({ includePeers: true });
			listStore.getState().applyFrame({
				sessions: frame.sessions,
				degraded: frame.degraded,
				capabilities: frame.capabilities,
				unread: frame.unread,
			});
		} catch (error) {
			if (error instanceof RelayError) {
				noteError(error, refreshList);
				return;
			}
			throw error;
		} finally {
			if (mountedRef.current) setBusy(false);
		}
	}, [noteError]);

	/** One owner for both explicit logout callers. A null selected route says
	 * nothing about whether a prior remote cleanup succeeded. Retain this
	 * operation until confirmation or replacement by a genuinely new route. */
	const confirmRevocation = useCallback(
		(
			activeRoute: RouteProfile | null,
			revision: number,
			retired: Promise<void>,
		): Promise<boolean> => {
			const owner = Symbol("revocation");
			revocationOwnerRef.current = owner;
			let inFlight: Promise<boolean> | null = null;
			const isCurrent = () =>
				mountedRef.current &&
				revocationOwnerRef.current === owner &&
				connectionStore.getState().revision === revision;
			const attempt = (): Promise<boolean> => {
				if (!isCurrent()) return Promise.resolve(false);
				if (inFlight) return inFlight;
				setBusy(true);
				const loggedOut =
					activeRoute?.mode === "custom"
						? customRouteAuthentication.signOut(activeRoute)
						: Promise.resolve();
				const work = (async (): Promise<boolean> => {
					try {
						await Promise.all([retired, loggedOut]);
						if (!isCurrent()) return false;
						setStreamHealth("idle");
						setLastError(null);
						setSignInState({ kind: "idle" });
						retryRef.current = null;
						if (pendingSignOutRef.current === attempt)
							pendingSignOutRef.current = null;
						setBusy(false);
						if (connectionStore.getState().surface !== null)
							connectionStore.getState().endRoute();
						return true;
					} catch (error) {
						if (!isCurrent()) return false;
						if (!(error instanceof RelayError)) throw error;
						noteError(error, async () => {
							await attempt();
						});
						return false;
					} finally {
						if (isCurrent()) setBusy(false);
					}
				})();
				inFlight = work;
				// Coalesce concurrent confirmations, but a later explicit action may
				// make one new attempt after a failure. No timer/automatic retry exists.
				void work.then(
					() => {
						inFlight = null;
					},
					() => {
						inFlight = null;
					},
				);
				return work;
			};
			pendingSignOutRef.current = attempt;
			return attempt();
		},
		[noteError],
	);

	const signOut = useCallback(async () => {
		const privacy = verifiedRetirement(
			retireAuthorization(false, () =>
				nativeCredentialRetirement.retire(null, clearStoredCredentials),
			),
		);
		if (pendingSignOutRef.current) {
			const owner = revocationOwnerRef.current;
			// The retained operation may originate from forgetting one custom route,
			// which deliberately preserves OAuth. Ordinary Sign out still wipes all
			// owned credentials, serialized before any newer native admission.
			const clear = nativeCredentialRetirement.settled();
			const [, confirmed] = await Promise.all([
				Promise.all([clear, privacy]),
				pendingSignOutRef.current(),
			]);
			// Remote success may precede the additional clear. Validate ownership
			// after BOTH complete; the store revision alone is not a stable token
			// because successful refusal cleanup legitimately bumps it itself.
			return (
				confirmed &&
				mountedRef.current &&
				owner !== null &&
				revocationOwnerRef.current === owner
			);
		}
		const activeRoute = connectionStore.getState().route;
		const manager = managerRef.current;
		cancelledRef.current = true;
		setColdStartSettled(true);
		setBusy(true);
		stopStream();
		stopConfig();
		clientRef.current = null;
		connectionStore.getState().endRoute();
		tokensRef.current = null;
		managerRef.current = null;
		retryRef.current = null;
		/* The landing latch goes with the session. It is a one-way latch otherwise:
		 *  written where a stored credential is accepted and never cleared, so the
		 *  NEXT arrival at `/` in this process (a back gesture, a `router.push`)
		 *  would still route a signed-out reader to `/tunnels` ("Set up a
		 *  computer") instead of the first-run surface (review round 4, M2). */
		if (mountedRef.current) setRestoredAccount(false);
		listStore.getState().reset();
		configStore.getState().reset();
		const revision = connectionStore.getState().revision;
		// Enqueue both side effects before yielding. A new native selection waits
		// for the clear; a new same-origin login queues behind the final logout.
		const retired = nativeCredentialRetirement.retire(manager);
		return await confirmRevocation(
			activeRoute,
			revision,
			Promise.all([retired, privacy]).then(() => undefined),
		);
	}, [confirmRevocation, stopStream, stopConfig, retireAuthorization]);

	const retry = useCallback(async () => {
		const pending = retryRef.current;
		if (pending) {
			await pending();
			return;
		}
		await refreshList();
	}, [refreshList]);

	const saveCustomRoute = useCallback(async (input: ConnectCustomInput) => {
		const validated = validateCustomBaseUrl(input.url, {
			allowInsecure: input.allowInsecure,
		});
		if (!validated.ok) return;
		const tunnel: SavedTunnel = {
			baseUrl: validated.route.baseUrl,
			/* An empty field means "not remembered", which is a state the record
			 *  already has a shape for (`password: string | null`). */
			password: input.password.length > 0 ? input.password : null,
			allowInsecure: input.allowInsecure,
		};
		await writeSavedTunnel(tunnel);
		setSavedTunnel(tunnel);
	}, []);

	const removeCustomRoute = useCallback(async () => {
		const active = connectionStore.getState().route;
		/* Removing the tunnel also ENDS it, when it is the live one.
		 *
		 * Clearing storage alone left Settings saying "Connected directly to
		 * <the address you just removed>" until the reader navigated away — the screen
		 * reads the live route, and the live route was still in the store (QA round 1).
		 * Admission is withdrawn first, just as in `signOut`; revocation uses the
		 * captured route so a slow response cannot leave requests enabled. */
		if (active?.mode === "custom") {
			const privacy = verifiedRetirement(retireAuthorization());
			clientRef.current = null;
			connectionStore.getState().endRoute();
			stopStream();
			stopConfig();
			clientRef.current = null;
			tokensRef.current = null;
			retryRef.current = null;
			listStore.getState().reset();
			configStore.getState().reset();
			await confirmRevocation(
				active,
				connectionStore.getState().revision,
				Promise.all([nativeCredentialRetirement.settled(), privacy]).then(
					() => undefined,
				),
			);
		}
		await removeSavedTunnel();
		setSavedTunnel(null);
	}, [confirmRevocation, stopStream, stopConfig, retireAuthorization]);

	const tunnelStoragePersistent = useCallback(
		async () => Platform.OS !== "web",
		[],
	);

	/**
	 * Resumes a stored Radient sign-in on a cold start — `docs/ux/flows.md` § 0's
	 * "Launch →|credential cached| Computers".
	 *
	 * The credential is VERIFIED, never trusted: a grant past its `expires_at` is
	 * refreshed with the rolling refresh token first, and one the server refuses is
	 * deleted rather than retried, so the next launch is a first run instead of a loop.
	 * Every dead end lands on the sign-in surface with the store's `sign-in` surface
	 * set, so a reader whose session lapsed is TOLD that — never quietly shown a
	 * first-run screen as though they had never signed in.
	 */
	const restoreRadient = useCallback(async () => {
		const revision = connectionStore.getState().revision;
		const authorizationRevision = startupAuthorizationLifecycle.getRevision();
		const isCurrent = () =>
			mountedRef.current &&
			!cancelledRef.current &&
			connectionStore.getState().revision === revision &&
			startupAuthorizationLifecycle.isCurrent(authorizationRevision);
		/* The decision is `planRestore` and the carrying-out is `carryOutRestore`,
		 *  both data/injectable and therefore testable; this wires them to the
		 *  live storage, the live refresh and the list's own discovery. See that
		 *  module for why the two failure arms must not be collapsed — the bare
		 *  `catch` that used to live here deleted a valid credential on an offline
		 *  cold start (review round 4, M1). */
		const outcome = await carryOutRestore({
			readOauth: readStoredOauth,
			writeOauth: async (tokens) => {
				if (isCurrent())
					await startupAuthorizationLifecycle.runIfCurrent(
						authorizationRevision,
						() => writeStoredOauth(tokens),
					);
			},
			clearOauth: async () => {
				if (isCurrent()) await revokeAuthorization(clearStoredOauth);
			},
			refresh: (tokens) => refreshRadientTokens(tokens),
			discover: async (tokens) => {
				if (!isCurrent()) return;
				tokensRef.current = tokens;
				if (mountedRef.current) setRestoredAccount(true);
				/* Discovery is what turns a credential into a computers screen, and
				 *  its own `unauthorized` arm deletes a grant the server has refused
				 *  since. */
				await refreshComputers();
			},
			isCancelled: () => !isCurrent(),
		});
		if (!isCurrent()) return;
		/* One-way latch no more: any restore that does not end accepted clears it, so a
		 *  later arrival at `/` cannot inherit a stale "signed in" landing. */
		if (!outcome.restored && mountedRef.current) setRestoredAccount(false);
		if (outcome.refusal === null) return;
		connectionStore.getState().noteFailure({
			surface: outcome.refusal.surface,
			displayableMessage: outcome.refusal.message,
		});
		/* The retry a network failure offers re-runs the restore it interrupted —
		 *  `restoreRef` holds the latest revision of this function, because the
		 *  function is what offers the retry. */
		if (outcome.refusal.surface === "retry") {
			retryRef.current = () => restoreRef.current();
		}
	}, [refreshComputers, revokeAuthorization]);

	/* The restore function is stable (its only dependency is `refreshComputers`), but
	 *  the retry it publishes must call the latest one, and the two would otherwise
	 *  have to reference each other. */
	useEffect(() => {
		restoreRef.current = restoreRadient;
	}, [restoreRadient]);

	/** The relay-served web bundle may already hold a cookie. Verify it once as
	 * admission, not in each screen; this path never runs again after sign-out. */
	const restorePageRoute = useCallback(async () => {
		const origin =
			Platform.OS === "web" &&
			typeof globalThis.location?.origin === "string" &&
			(globalThis.location.protocol === "http:" ||
				globalThis.location.protocol === "https:")
				? globalThis.location.origin
				: null;
		if (
			!origin ||
			connectionStore.getState().route ||
			connectionStore.getState().surface
		)
			return;
		const validated = validateCustomBaseUrl(origin, { allowInsecure: true });
		if (!validated.ok) return;
		const route = validated.route;
		const admission = beginRoute(route);
		const client = createRelayClient({
			route,
			onResponse: (facts) => {
				if (admission.isCurrent() && facts.status === 401) {
					void revokeAuthorization();
					setBusy(false);
					connectionStore
						.getState()
						.noteFailure({ surface: "password", displayableMessage: "" });
				}
			},
		});
		try {
			await customRouteAuthentication.settled(route);
			if (!admission.isCurrent()) return;
			await client.sessions();
			await goLive(client, admission);
		} catch (error) {
			if (admission.isCurrent() && error instanceof RelayError)
				noteError(error);
		}
	}, [beginRoute, goLive, noteError, revokeAuthorization]);

	/* The cold start. On web an explicit `lo-relay` override wins; otherwise the saved
	 * CUSTOM tunnel is resumed, and failing that a stored RADIENT credential is
	 * restored.
	 *
	 * That order is deliberate. A custom route needs no control-plane round trip, so it
	 * is the cheaper resume, and a reader who saved one explicitly chose the technical
	 * path — re-typing an address and password every launch is the worse outcome. A
	 * tunnel saved WITHOUT a remembered password is loaded but not dialled: the screen
	 * asks for the password, which is the only honest thing it can do — and the Radient
	 * credential is still tried behind it, because a reader may hold both. */
	useEffect(() => {
		const override = webRelayOverride();
		if (override) {
			void connectCustom(override).finally(() => {
				if (!cancelledRef.current) setColdStartSettled(true);
			});
			return;
		}
		let cancelled = false;
		const revision = connectionStore.getState().revision;
		const interrupted = () =>
			cancelled || connectionStore.getState().revision !== revision;
		cancelledRef.current = false;
		void (async () => {
			try {
				const stored = await readSavedTunnel();
				if (interrupted()) return;
				if (stored) {
					setSavedTunnel(stored);
					if (stored.password != null) {
						await connectCustom(
							{
								url: stored.baseUrl,
								password: stored.password,
								allowInsecure: stored.allowInsecure,
							},
							true,
						);
						return;
					}
				}
				/* Nothing of the reader's own to dial: the RECOMMENDED path's turn. */
				if (!interrupted()) await restoreRadient();
				if (!interrupted()) await restorePageRoute();
			} catch {
				/* The cold start is the APP's own setup, so a throw here is a bug in the app
				 *  and not a fact about the reader's tunnel — which is exactly what the
				 *  `diagnostic` surface is for, and it is recorded rather than swallowed: an
				 *  empty "no computer" screen would be a silent lie about a start that failed.
				 *
				 *  What the reader sees is the SURFACE's own copy, not the sentence below:
				 *  `connection-store.ts` deliberately nulls `displayableMessage` for this
				 *  surface (a client bug has no runtime detail to show and the answer is a
				 *  retry affordance), so the refusal renders "This request was built
				 *  incorrectly." over "Nothing on this screen can fix it; this is a bug in the
				 *  app." The string below is carried because the action requires one and it
				 *  documents intent; it is not what is painted.
				 *
				 *  This used to be the landing place for a rejected credential WRITE, which
				 *  arrived here as an unhandled rejection — the shape review round 6, M-C
				 *  named. That rejection is now caught where it happens, in `carryOutRestore`,
				 *  because it is survivable; this catches what is left, so no path out of the
				 *  cold start can escape unhandled whatever a future caller adds. */
				connectionStore.getState().noteFailure({
					surface: "diagnostic",
					displayableMessage: "The start-up check could not be completed.",
				});
			} finally {
				/* Settled either way: "nothing saved" is a decision, not a pending read. */
				if (!cancelled) setColdStartSettled(true);
			}
		})();
		return () => {
			cancelled = true;
			cancelledRef.current = true;
		};
	}, [connectCustom, restoreRadient, restorePageRoute]);

	const surface = useConnectionState((state) => state.surface);
	const detail = useConnectionState((state) => state.detail);
	const retryAfterMs = useConnectionState((state) => state.retryAfterMs);
	const computers = useConnectionState((state) => state.computers);
	const route = useConnectionState((state) => state.route);
	const tunnelId = useConnectionState((state) => state.tunnelId);

	const refusal = useMemo<RefusalView | null>(() => {
		if (!surface || surface === "none") return null;
		/* What the refusal's sentence calls the thing that failed. A known computer
		 *  is named by the reader's own name for it; a Radient route with none
		 *  discovered yet is "Your computer"; and a custom route is named by the
		 *  ADDRESS the reader typed, because "The relay" as a subject collided with the
		 *  `relay-stopped` headline that already says "The relay" — the frame read
		 *  "The relay is not running on The relay." A bare address is the one name
		 *  this app is certain the reader recognises." */
		/* The computer is the CHOSEN one, matched by tunnel id — never `computers[0]`.
		 *  The list now outlives a route start, so the first row is just whichever
		 *  computer Radient listed first: a refusal for the second computer named the
		 *  first (PR #121 review round 1, R1-m2). */
		const chosen = computers.find((computer) => computer.tunnelId === tunnelId);
		/* No route at all means the refusal came from the ACCOUNT side — a cold-start
		 *  restore that could not reach Radient, or a grant Radient refused — since a
		 *  custom route always exists before it can fail. "That address" named an
		 *  address the reader never typed (design round 1, D3). */
		const subject = chosen
			? chosen.name
			: route === null
				? "Radient"
				: route.mode === "radient"
					? "Your computer"
					: route.baseUrl;
		return refusalFromError({
			error: lastError,
			surface,
			detail,
			retryAfterMs,
			subject,
		});
	}, [computers, detail, lastError, retryAfterMs, route, surface, tunnelId]);

	const value = useMemo<Connection>(
		() => ({
			connectCustom,
			signInWithRadient,
			refreshComputers,
			billing: computers[0]?.billing ?? null,
			discovering,
			savedTunnel,
			restoredAccount,
			selectComputer,
			refreshList,
			signOut,
			saveCustomRoute,
			removeCustomRoute,
			tunnelStoragePersistent,
			retry,
			relay: () =>
				isUsable(connectionStore.getState()) ? clientRef.current : null,
			busy,
			coldStartSettled,
			streamHealth,
			signInState,
			lastError,
			refusal,
		}),
		[
			connectCustom,
			signInWithRadient,
			refreshComputers,
			computers,
			discovering,
			savedTunnel,
			restoredAccount,
			selectComputer,
			refreshList,
			signOut,
			saveCustomRoute,
			removeCustomRoute,
			tunnelStoragePersistent,
			retry,
			busy,
			coldStartSettled,
			streamHealth,
			signInState,
			lastError,
			refusal,
		],
	);

	return (
		<ConnectionContext.Provider value={value}>
			{children}
		</ConnectionContext.Provider>
	);
};

export function useConnection(): Connection {
	const value = useContext(ConnectionContext);
	if (!value) {
		throw new Error(
			"useConnection needs the ConnectionProvider: it owns the live route, and a screen that built its own would be a second connection",
		);
	}
	return value;
}
