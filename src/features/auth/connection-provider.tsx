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
	revokeTunnelSession,
	signInToCustomRoute,
	signOutOfCustomRoute,
	TunnelSessionError,
	TunnelSessionManager,
	validateCustomBaseUrl,
	validateRadientHostname,
} from "@/connection";
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
import {
	type RelayEndpoints,
	RelayError,
	type RelayStream,
	type StreamStatus,
} from "@/relay";
import {
	type ConnectionSnapshot,
	createConnectionStore,
} from "@/state/connection-store";
import { createListStore, type ListSnapshot } from "@/state/list-store";
import { adoptableSession, carryOutRestore } from "./radient-restore";

import { beginRadientSignIn, type SignInState } from "./radient-sign-in";
import { type RefusalView, refusalFromError } from "./refusal";

/**
 * The two stores, as process-wide singletons.
 *
 * Built here rather than inside the provider so a hook can read them without a
 * second context, and so a test can build its own instance from the exported
 * factories. The provider mounts once, in the root layout, so "process-wide" and
 * "screen-wide" are the same lifetime in this app.
 */
export const connectionStore = createConnectionStore();
export const listStore = createListStore();

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
	signOut: () => Promise<void>;
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

export const ConnectionProvider = ({
	children,
}: {
	children: React.ReactNode;
}) => {
	const [busy, setBusy] = useState(false);
	const [discovering, setDiscovering] = useState(false);
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
	const tokensRef = useRef<RadientTokens | null>(null);
	const managerRef = useRef<TunnelSessionManager | null>(null);
	const retryRef = useRef<(() => Promise<void>) | null>(null);
	/** The latest revision of the cold-start restore, so the retry a network failure
	 *  offers can re-run the very function that offered it — see `restoreRadient`. */
	const restoreRef = useRef<() => Promise<void>>(async () => undefined);
	const mountedRef = useRef(true);

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
			streamRef.current?.stop();
		};
	}, []);

	/** Records a typed failure: the store owns the surface, and the retry closure
	 *  is what the refusal surface's button re-runs. */
	const noteError = useCallback(
		(error: RelayError, retry?: () => Promise<void>) => {
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
		[],
	);

	const stopStream = useCallback(() => {
		streamRef.current?.stop();
		streamRef.current = null;
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
		(client: ReturnType<typeof createRelayClient>, route: RouteProfile) => {
			stopStream();
			let stopped = false;
			let _attempt = 0;

			const run = () => {
				if (stopped) return;
				const stream = client.sessionsStream({
					onFrame: (frame) => {
						if (frame.kind === "sessions") {
							_attempt = 0;
							listStore.getState().applyFrame({
								sessions: frame.data.sessions,
								degraded: frame.data.degraded,
								capabilities: frame.data.capabilities,
							});
						}
					},
					onState: (status) => {
						if (mountedRef.current) setStreamHealth(healthFrom(status));
					},
					onError: (error) => {
						if (stopped) return;
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
			};

			run();
			// The route is read for its label in diagnostics; kept in the closure so
			// a later stream cannot be started against a route that has ended.
			void route;
			return () => {
				stopped = true;
			};
		},
		[noteError, stopStream],
	);

	/** Everything a route needs once its credentials are valid. */
	const goLive = useCallback(
		async (
			client: ReturnType<typeof createRelayClient>,
			route: RouteProfile,
		): Promise<void> => {
			clientRef.current = client;
			connectionStore.getState().markLive({ accountLabel: null });
			startStream(client, route);
			/* The first paint is the REST read, not the stream's seed: the cold-start
			 * rule is that the list renders immediately, and a stream that opens in a
			 * second must not be the reason the screen is empty. */
			const frame = await client.sessions().catch(() => null);
			if (frame) {
				listStore.getState().applyFrame({
					sessions: frame.sessions,
					degraded: frame.degraded,
					capabilities: frame.capabilities,
				});
			}
		},
		[startStream],
	);

	const connectCustom = useCallback(
		async ({ url, password, allowInsecure }: ConnectCustomInput) => {
			setBusy(true);
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
				connectionStore.getState().startRoute(route);
				const signIn = await signInToCustomRoute(route, password);
				const client = createRelayClient({
					route,
					onResponse: (facts) => {
						if (facts.status === 401) {
							connectionStore.getState().noteFailure({
								surface: "password",
								displayableMessage: "",
							});
						}
					},
				});

				if (!signIn.signedIn) {
					if (signIn.failure !== null) {
						/* The relay never got as far as judging the password: a dead tunnel, a
						 *  502/503 from the gateway or the edge, a blocked request. Reporting
						 *  "That password was not accepted." here sends the reader to fix the one
						 *  thing that is not wrong, and hides the fault that needs action — so
						 *  the taxonomy's own sentence and surface are used instead (D21).
						 *
						 *  The admission read below is deliberately NOT run: a tunnel refusing
						 *  `/login` is refusing the list route too, so its verdict would only
						 *  re-derive "not admitted" from a fault already classified. */
						noteError(signIn.failure, () =>
							connectCustom({ url, password, allowInsecure }),
						);
						return;
					}
					/* The status of a MANUAL redirect is not a reliable reading. The daemon
					 * answers `303` on a successful form login, and `fetch` with
					 * `redirect: 'manual'` may hand back an **opaque-redirect** response whose
					 * status is `0` — the platform's choice, not the relay's answer. So the
					 * outcome is VERIFIED rather than inferred: a wrong password leaves no
					 * cookie and the list route then answers 401, while a right one reads.
					 * One extra request on the failure path buys a login that works wherever
					 * the response is filtered, and it cannot mask a real wrong password. */
					const admitted = await client.sessions().then(
						() => true,
						() => false,
					);
					if (!admitted) {
						connectionStore.getState().noteFailure({
							surface: "password",
							/* Deliberately NOT `signIn.detail`: when the response was filtered, that
							 * sentence is a status reading (“HTTP 0”), and a status code is the one
							 * thing the refusal surfaces are forbidden to show — the taxonomy's own
							 * copy names the cause and the remedy instead, and a wrong password then
							 * reads the same on every platform rather than differently on web. */
							displayableMessage: "",
						});
						retryRef.current = () =>
							connectCustom({ url, password, allowInsecure });
						return;
					}
				}
				await goLive(client, route);
			} catch (error) {
				if (error instanceof RelayError) {
					noteError(error, () =>
						connectCustom({ url, password, allowInsecure }),
					);
					return;
				}
				throw error;
			} finally {
				if (mountedRef.current) setBusy(false);
			}
		},
		[goLive, noteError],
	);

	const refreshComputers = useCallback(async () => {
		/* Discovery answers an ACCOUNT question before a tunnel exists. The store's
		 * phases describe a route, so the in-flight flag lives beside it instead of
		 * inventing a route to hang a phase on. */
		setDiscovering(true);
		const result = await discoverComputers({
			accessToken: async () => tokensRef.current?.access ?? null,
		});
		try {
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
					await clearStoredOauth();
					connectionStore.getState().noteFailure({
						surface: "sign-in",
						displayableMessage: "Your Radient session expired.",
					});
					return;
				case "unreachable":
					connectionStore.getState().noteFailure({
						surface: "retry",
						displayableMessage: result.message,
					});
					return;
				case "rejected":
					connectionStore.getState().noteFailure({
						surface: "diagnostic",
						displayableMessage: result.message,
					});
					return;
			}
		} finally {
			if (mountedRef.current) setDiscovering(false);
		}
	}, []);

	const signInWithRadient = useCallback(async () => {
		setBusy(true);
		try {
			const result = await beginRadientSignIn({
				onState: (state) => {
					if (mountedRef.current) setSignInState(state);
				},
			});
			if (!result.ok) return;
			tokensRef.current = result.tokens;
			/* Persisted BEFORE discovery, and before any route exists: the credential is
			 *  what makes the NEXT launch a computers screen instead of a second browser
			 *  hand-off, and a discovery that then fails (an unreachable API, an empty
			 *  account) must not throw a valid grant away. A runtime that cannot store it
			 *  still gets a working session this run — `writeStoredOauth` reports which. */
			await writeStoredOauth(result.tokens);
			if (mountedRef.current) setSignInState({ kind: "idle" });
			/* Straight into discovery, which is what makes the button's promise —
			 * "finds your computers" — true rather than a second tap away. */
			await refreshComputers();
		} finally {
			if (mountedRef.current) setBusy(false);
		}
	}, [refreshComputers]);

	const selectComputer = useCallback(
		async (computer: DiscoveredComputer) => {
			setBusy(true);
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
				connectionStore.getState().startRoute(route);
				connectionStore.getState().selectComputer(computer);
				const adopted = adoptableSession(
					await readStoredTunnelSession(),
					computer,
				);
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
				const client = createRelayClient({
					route,
					tunnelSession: () => manager.current,
					onResponse: (facts) => {
						/* The edge's own 401 (with `X-Radient-Login`) is the re-auth
						 * signal; the connection layer types it as `sign-in`, and this
						 * only records it so the surface is decided once. */
						if (facts.status === 401) {
							connectionStore.getState().noteFailure({
								surface: "sign-in",
								displayableMessage: "",
							});
						}
					},
				});
				await goLive(client, route);
			} catch (error) {
				if (
					error instanceof RelayError ||
					error instanceof TunnelSessionError
				) {
					noteError(
						error instanceof RelayError
							? error
							: /* A control-plane refusal has no HTTP client error to carry it: it is
								 * typed here so the surface stays the taxonomy's decision and never the
								 * caller's. `console` because every `TunnelSessionError` this can be
								 * is fixed on the computer or in the console. */
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
				if (mountedRef.current) setBusy(false);
			}
		},
		[goLive, noteError],
	);

	const refreshList = useCallback(async () => {
		const client = clientRef.current;
		if (!client) return;
		setBusy(true);
		try {
			const frame = await client.sessions();
			listStore.getState().applyFrame({
				sessions: frame.sessions,
				degraded: frame.degraded,
				capabilities: frame.capabilities,
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

	const signOut = useCallback(async () => {
		const activeRoute = connectionStore.getState().route;
		setBusy(true);
		try {
			/* Revoke BEFORE the route ends: after `endRoute` there is nothing left to
			 * authenticate the revocation with, and a session left live at the control
			 * plane keeps a tunnel reachable from a phone that has forgotten it. */
			const manager = managerRef.current;
			if (activeRoute?.mode === "radient" && manager?.current) {
				await revokeTunnelSession(manager.current).catch(() => undefined);
			}
			if (activeRoute?.mode === "custom") {
				await signOutOfCustomRoute(activeRoute).catch(() => undefined);
			}
			stopStream();
			clientRef.current = null;
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
			connectionStore.getState().endRoute();
			/* Every stored credential goes with the sign-out. `removeSavedTunnel` stays the
			 *  NARROWER delete for a good reason: forgetting a tunnel must not take the
			 *  Radient grant with it, and a lapsed grant must not take the 30-day handle. */
			await clearStoredCredentials();
			if (mountedRef.current) {
				setStreamHealth("idle");
				setLastError(null);
				setSignInState({ kind: "idle" });
			}
		} finally {
			if (mountedRef.current) setBusy(false);
		}
	}, [stopStream]);

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
		 * Signing out first is the same order `signOut` uses: the relay's session is
		 * closed politely before the route it belongs to disappears. */
		if (active?.mode === "custom") {
			await signOutOfCustomRoute(active).catch(() => undefined);
			stopStream();
			clientRef.current = null;
			tokensRef.current = null;
			retryRef.current = null;
			listStore.getState().reset();
			connectionStore.getState().endRoute();
			if (mountedRef.current) setLastError(null);
		}
		await removeSavedTunnel();
		setSavedTunnel(null);
	}, [stopStream]);

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
		/* The decision is `planRestore` and the carrying-out is `carryOutRestore`,
		 *  both data/injectable and therefore testable; this wires them to the
		 *  live storage, the live refresh and the list's own discovery. See that
		 *  module for why the two failure arms must not be collapsed — the bare
		 *  `catch` that used to live here deleted a valid credential on an offline
		 *  cold start (review round 4, M1). */
		const outcome = await carryOutRestore({
			readOauth: readStoredOauth,
			writeOauth: async (tokens) => {
				await writeStoredOauth(tokens);
			},
			clearOauth: clearStoredOauth,
			refresh: (tokens) => refreshRadientTokens(tokens),
			discover: async (tokens) => {
				tokensRef.current = tokens;
				if (mountedRef.current) setRestoredAccount(true);
				/* Discovery is what turns a credential into a computers screen, and
				 *  its own `unauthorized` arm deletes a grant the server has refused
				 *  since. */
				await refreshComputers();
			},
			isCancelled: () => cancelledRef.current,
		});
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
	}, [refreshComputers]);

	/* The restore function is stable (its only dependency is `refreshComputers`), but
	 *  the retry it publishes must call the latest one, and the two would otherwise
	 *  have to reference each other. */
	useEffect(() => {
		restoreRef.current = restoreRadient;
	}, [restoreRadient]);

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
		cancelledRef.current = false;
		void (async () => {
			try {
				const stored = await readSavedTunnel();
				if (cancelled) return;
				if (stored) {
					setSavedTunnel(stored);
					if (stored.password != null) {
						await connectCustom({
							url: stored.baseUrl,
							password: stored.password,
							allowInsecure: stored.allowInsecure,
						});
						return;
					}
				}
				/* Nothing of the reader's own to dial: the RECOMMENDED path's turn. */
				if (!cancelled) await restoreRadient();
			} finally {
				/* Settled either way: "nothing saved" is a decision, not a pending read. */
				if (!cancelled) setColdStartSettled(true);
			}
		})();
		return () => {
			cancelled = true;
			cancelledRef.current = true;
		};
	}, [connectCustom, restoreRadient]);

	const surface = useConnectionState((state) => state.surface);
	const detail = useConnectionState((state) => state.detail);
	const retryAfterMs = useConnectionState((state) => state.retryAfterMs);
	const computers = useConnectionState((state) => state.computers);
	const route = useConnectionState((state) => state.route);

	const refusal = useMemo<RefusalView | null>(() => {
		if (!surface || surface === "none") return null;
		/* What the refusal's sentence calls the thing that failed. A known computer
		 *  is named by the reader's own name for it; a Radient route with none
		 *  discovered yet is "Your computer"; and a custom route is named by the
		 *  ADDRESS the reader typed, because "The relay" as a subject collided with the
		 *  `relay-stopped` headline that already says "The relay" — the frame read
		 *  "The relay is not running on The relay." A bare address is the one name
		 *  this app is certain the reader recognises." */
		const subject =
			computers.length > 0
				? (computers[0]?.name ?? "Your computer")
				: route?.mode === "radient"
					? "Your computer"
					: (route?.baseUrl ?? "That address");
		return refusalFromError({
			error: lastError,
			surface,
			detail,
			retryAfterMs,
			subject,
		});
	}, [computers, detail, lastError, retryAfterMs, route, surface]);

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
			relay: () => clientRef.current,
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
