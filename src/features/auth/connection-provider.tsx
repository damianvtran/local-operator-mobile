import { accountIdFromToken } from "@/connection/radient-identity";
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
	type DiscoveryResult,
	discoverComputers,
	type RadientTokens,
	type RouteProfile,
	TunnelSessionError,
	TunnelSessionManager,
	validateCustomBaseUrl,
	validateRadientHostname,
} from "@/connection";
import {
	accessTokenNeedsRefresh,
	RadientAuthError,
} from "@/connection/radient-oauth";
import { createRadientRefresher } from "@/connection/radient-refresh";
import {
	proveRecoveryAuthority,
	recoveryAuthorityScope,
} from "@/connection/recovery-authority";
import {
	describeSecureStorageRefusal,
	isSecureStorageRefusal,
	type SecureStorageRefusal,
} from "@/connection/secure-storage-refusal";
import {
	registerStartupAuthorizationCleanup,
	startupAuthorizationLifecycle,
} from "@/connection/startup-authorization";
import { agentAvatarCache } from "@/features/agent-avatar/agent-avatar";
import {
	clearStoredCredentials,
	clearStoredOauth,
	readSavedComputers,
	readSavedTunnel,
	readStoredOauth,
	readStoredTunnelSession,
	rememberLiveComputer,
	removeSavedTunnel,
	type SavedTunnel,
	writeSavedTunnel,
	writeStoredOauth,
	writeStoredTunnelSession,
} from "@/features/auth/tunnel-storage";
import { reconnectDelay } from "@/features/session/connection-view";
import { clearAuthorizationData } from "@/features/session/device-storage";
import {
	notifyDraftRecoveryReady,
	prepareDraftRecovery,
	prepareOrdinaryPrivateStorage,
} from "@/features/session/draft-recovery";
import { clearNativePickerCache } from "@/features/session/picker-cache";
import { pickerPrivacy } from "@/features/session/picker-privacy";
import { setLocaleSource, t } from "@/i18n";
import {
	type RelayEndpoints,
	RelayError,
	type RelayStream,
	type StreamStatus,
} from "@/relay";
import { type ConfigSnapshot, createConfigStore } from "@/state/config-store";
import {
	type ConnectionSnapshot,
	createConnectionStore,
	isUsable,
} from "@/state/connection-store";
import { createListStore, type ListSnapshot } from "@/state/list-store";
import { retireTeamBridgeDevice } from "@/team-bridge/retirement";
import {
	customRouteAuthentication,
	nativeCredentialRetirement,
} from "./authentication-lifecycle";
import { resumeComputerOnColdStart } from "./cold-start-computer";
import { type ConfigStreamHandle, startConfigStream } from "./config-stream";
import { createRadientAccess } from "./radient-access";
import { adoptableSession, carryOutRestore } from "./radient-restore";
import { beginRadientSignIn, type SignInState } from "./radient-sign-in";
import {
	type RefusalView,
	refusalFromError,
	tunnelSessionRelayError,
} from "./refusal";
import {
	authenticateCustomRoute,
	type RouteAdmission,
	routeAdmission,
} from "./route-admission";
import {
	appendSignInDiagnostic,
	type SignInDiagnostic,
	SignInSupersededError,
	signInErrorClass,
} from "./sign-in-diagnostics";

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

/* The i18n runtime reads the relay's RESOLVED language from this store and from
 * nowhere else (`src/i18n/locale.ts` explains why that is the only source). The
 * registration is a function rather than an import so the runtime stays free of
 * this file's `react-native` dependency and can be exercised in Node. */
setLocaleSource(() => configStore.getState().language);

export const useConnectionState = <T,>(
	selector: (state: ConnectionSnapshot) => T,
): T => useStore(connectionStore, selector);

export const useListState = <T,>(selector: (state: ListSnapshot) => T): T =>
	useStore(listStore, selector);

/**
 * Subscribe to the config stream's snapshot — today, the resolved LANGUAGE.
 *
 * WHY IT IS EXPORTED RATHER THAN READ THROUGH `getState()`. `t()` reads the
 * locale at CALL time, which is what keeps a copy module from freezing the
 * language it was first imported in — but it cannot make an already-painted
 * screen repaint. A screen that keeps its copy in a `useMemo` therefore needs
 * BOTH: a subscription that re-renders it when a frame changes the language, and
 * the language in the memo's dependency list so the memo re-runs. Home's composer
 * is the surface that needed this (review M3): its controls and chips are memoised
 * over pure copy readers, so a language change while mounted kept the old
 * sentences until some unrelated state moved. `home.tsx` calls `useLocaleFrame()`
 * and lists the value in those memos' dependency arrays; nothing else reads the
 * config store directly.
 */
export const useLocaleFrame = (): string | null =>
	useStore(configStore, (state: ConfigSnapshot) => state.language);

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
	/** The saved computer being reconnected, when the caller knows it (a tap on a
	 *  computer switcher row). Recording the live route by this id, not by address,
	 *  is what keeps two saved computers at one address apart (decision a-2a8b). */
	computerId?: string;
};

/**
 * How a `connectCustom` attempt ended, for the ONE caller that must react to it:
 * the own-tunnel screen's Save and connect, which navigated home unconditionally
 * and so dropped a refused reader on "Not connected / Not answering" with no
 * reason and no draft (diagnostic run 42855980853, PR #216).
 *
 * Read from the store at the end of the attempt rather than threaded through each
 * early return: every refusal path already records itself with `noteFailure`, so
 * the store's phase is the single truth and a new early return cannot forget to
 * report. `live` is ONLY a route that reached `markLive`; anything short of that
 * (still minting, a silent `false` from authentication) counts as refused, so the
 * screen never leaves the form for a route that is not answering.
 *
 * Every other caller (computer switcher, settings, cold start, the web override)
 * ignores the value and keeps its existing behaviour: the failure is still in the
 * store and still painted by the refusal surface exactly as before.
 */
export type ConnectCustomOutcome =
	| { status: "live" }
	/** A newer route action replaced this one; its own outcome is the one to show. */
	| { status: "superseded" }
	| {
			status: "refused";
			/** The store's sanitised sentence (`displayableMessage`), or null. */
			detail: string | null;
			/** Set when this device's secure storage was what refused. */
			storageRefusal: SecureStorageRefusal | null;
	  };

/** What `saveCustomRoute` could keep. `storageRefusal` is set when the keystore
 *  refused the write: the route still works for this run (see `writeSavedTunnel`),
 *  but the reader is told it will not survive a restart. */
export type SaveCustomRouteResult = {
	persistent: boolean;
	storageRefusal: SecureStorageRefusal | null;
};

export type Connection = {
	connectCustom: (input: ConnectCustomInput) => Promise<void>;
	/** `connectCustom`, reporting how the attempt ended. A separate member rather
	 *  than a changed return type so every existing caller (switcher, settings,
	 *  cold start) and every test double keeps its exact contract. */
	connectCustomOutcome: (
		input: ConnectCustomInput,
	) => Promise<ConnectCustomOutcome>;
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
	/** True when this app accepted a RADIENT grant (interactive or restored) and
	 *  started discovery. The historical name is retained for existing consumers.
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
	saveCustomRoute: (
		input: ConnectCustomInput,
	) => Promise<SaveCustomRouteResult | null>;
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
	/**
	 * A current Radient OAuth access token, or `null` when the reader is not signed
	 * in to Radient. For HUB calls only (Team Bridge, `src/team-bridge/client.ts`),
	 * which go to `api.radienthq.com` directly and need no computer or route.
	 *
	 * The ONE owner of token freshness stays this provider: an expired grant (or a
	 * `force` after a hub 401) is refreshed here with the rolling refresh token,
	 * single-flight, and the rotated grant is persisted. A refresh the server
	 * refuses (`invalid_grant`) answers `null`, so the caller's state is "sign in",
	 * never a loop. Without this seam a hub client would need its own copy of the
	 * refresh rule, which is how two surfaces disagree about whether the reader is
	 * signed in.
	 */
	radientAccessToken: (options?: { force?: boolean }) => Promise<string | null>;
	/** Sign-out-only bearer access: shares rotation without entering durable retirement. */
	radientRetirementAccessToken: (options?: {
		force?: boolean;
		accountId?: string;
	}) => Promise<string | null>;
	/** True while a Radient grant is held in memory (a sign-in or a restore). */
	radientSignedIn: boolean;
	/** Stable account owner; rotating the same account token does not change it. */
	radientAccountId: string | null;
	streamHealth: StreamHealth;
	signInState: SignInState;
	signInDiagnostics: readonly SignInDiagnostic[];
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

/**
 * Remembers the computer a route just reached, for the computer switcher: once the
 * route is LIVE, never on a pick, because a computer that refused or never answered
 * is not one this phone has used. Fire-and-forget: the registry is a keystore
 * write, and a route must not wait on it or fail with it. The id lands in the store
 * only while the same route is still current, so a slow write cannot label the
 * next one. Module scope for the same reason as `verifiedRetirement`.
 */
const rememberLiveRoute = (
	admission: RouteAdmission,
	computerId: string | undefined,
	radientAccount: string | null,
): void => {
	const state = connectionStore.getState();
	const route = state.route;
	if (!route || !admission.isCurrent()) return;
	/* Discovery's name when it has one; otherwise NONE, so the registry keeps the
	 *  name it already holds. A custom route clears discovery, so switching back to a
	 *  Radient computer from one passed `undefined` here and the hostname overwrote
	 *  the reader's name for it (PR #122 QA round 1, Q2; review m2). */
	const name =
		route.mode === "radient"
			? state.discoveredComputers.find(
					(computer) => computer.tunnelId === route.tunnelId,
				)?.name
			: undefined;
	void rememberLiveComputer(route, {
		name,
		computerId,
		/* The account the route was minted under, so the switcher lists this computer
		 *  for that account only (review M2). Omitted when unknown, which keeps a key
		 *  the entry already has instead of erasing it. */
		...(route.mode === "radient" && radientAccount !== null
			? { account: radientAccount }
			: {}),
		/* Re-checked INSIDE the registry's serialised write: a sign-out that cleared
		 *  the registry while this write was queued ended the route, so the write is
		 *  dropped instead of putting a hostname back into a wiped list (review m3). */
		onlyIf: admission.isCurrent,
	}).then((entry) => {
		if (entry && admission.isCurrent())
			connectionStore.getState().noteComputer(entry.id);
	});
};

/** A Radient pick with no stored grant at all: the sign-in surface's sentence. */
const RADIENT_PICK_SIGNED_OUT = "Sign in with Radient to use this computer.";

/** Turns an unverified purge into the typed refusal the surfaces already know,
 *  so a sign-out reports `false` rather than pretending the device is clean.
 *  Module scope on purpose: it reads no component state, so it never becomes a
 *  hook dependency that changes on every render. */
const verifiedRetirement = (
	retirement: Promise<SecureStorageRefusal | null>,
): Promise<void> =>
	retirement.then((refusal) => {
		if (refusal === null) return;
		/* The sanitised cause rides on `cause` (plain data, no platform message) so
		 *  `noteError` can put it in the store and the screens can say the DEVICE
		 *  refused, with its code. It used to be dropped here, leaving only a bare
		 *  diagnostic surface (PR #216 evidence). */
		throw new RelayError(
			"rejected",
			"Cannot confirm those local drafts were removed",
			{
				surface: "diagnostic",
				detail: "",
				cause: refusal,
				diagnostic: `secure-storage ${refusal.step} ${refusal.kind}${refusal.code ? ` ${refusal.code}` : ""}`,
			},
		);
	});

/** The keystore refusal a typed failure carries, if any. */
const storageRefusalOf = (error: RelayError): SecureStorageRefusal | null =>
	isSecureStorageRefusal(error.cause) ? error.cause : null;

/** A credential renewal's failure, as the ACCOUNT-level outcome the Computers banner
 * already renders. Nothing here deletes a credential: only a confirmed refusal from
 * the resource itself (the `unauthorized` arm) does, because a refresh the server
 * refused says the grant was not accepted, not that the login ended.
 *
 * A throw here is not an option: `refreshComputers` is fired as `void` from Settings,
 * the Computers header and the banner's Try now, and awaited inside the connector
 * poll — an escaping rejection stopped that poll's next tick and reported a local
 * condition as a transport failure (review round 1, Q2/R1-M5). */
function grantFailureOutcome(error: unknown): DiscoveryResult {
	if (error instanceof RadientAuthError) {
		if (error.failure === "invalid_grant") return { kind: "unauthorized" };
		// The copy is `discovery.ts`'s own, not a new sentence: the same refusal one
		// layer earlier must read the same way.
		if (error.failure === "rejected" && error.status !== undefined)
			return {
				kind: "rejected",
				message: `Radient refused the request (HTTP ${error.status}).`,
				status: error.status,
			};
	}
	// `network`, an unreadable answer, and anything unexpected: nothing was learned
	// about the grant, so the credential stays and the banner offers Try now.
	return {
		kind: "unreachable",
		message: "Radient could not be reached. Check this device's connection.",
	};
}

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
	const [signInDiagnostics, setSignInDiagnostics] = useState<
		SignInDiagnostic[]
	>([]);
	const [lastError, setLastError] = useState<RelayError | null>(null);

	const clientRef = useRef<ReturnType<typeof createRelayClient> | null>(null);
	const streamRef = useRef<RelayStream | null>(null);
	const configRef = useRef<ConfigStreamHandle | null>(null);
	/* The in-memory grant every request path reads. Written ONLY through the
	 *  accessor's `publish`, so the ref and the rendered `radientSignedIn` cannot
	 *  disagree. */
	const tokensRef = useRef<RadientTokens | null>(null);
	const refreshAccountTokens = useRef(createRadientRefresher()).current;
	const pendingOauthWrite = useRef<RadientTokens | null>(null);
	/** Serialises durable OAuth writes so an older rotation cannot land after a
	 *  newer one and persist a handle the newer rotation already spent. */
	const oauthWriteChain = useRef<Promise<void>>(Promise.resolve());
	/* Mirrors `tokensRef !== null` for RENDERING. The ref stays the source the
	 *  request paths read; this only lets a screen (the Team Bridge gate) re-render
	 *  when a sign-in or a sign-out changes the answer. */
	const [radientSignedIn, setRadientSignedIn] = useState(false);
	const [radientAccountId, setRadientAccountId] = useState<string | null>(null);
	const radientAccessRef = useRef<ReturnType<
		typeof createRadientAccess
	> | null>(null);
	if (radientAccessRef.current === null) {
		radientAccessRef.current = createRadientAccess({
			current: () => tokensRef.current,
			publish: (tokens) => {
				tokensRef.current = tokens;
				if (mountedRef.current) {
					setRadientSignedIn(tokens !== null);
					setRadientAccountId(accountIdFromToken(tokens?.access ?? null));
				}
			},
			/* Main's per-mount deduping refresher, NOT the raw `refreshRadientTokens`
			 *  call the branch threaded through its old ref plumbing: OAuth refresh may
			 *  rotate a single-use handle, and only this owner joins a rotation already in
			 *  flight (main's `usableOauth` shares it). `revokeAuthorization` clears its
			 *  completed-rotation cache at every session end. */
			refresh: refreshAccountTokens,
			write: writeStoredOauth,
			clear: clearStoredOauth,
			invalidGrant: (error) =>
				error instanceof RadientAuthError && error.failure === "invalid_grant",
			serialize: (operation) =>
				nativeCredentialRetirement.retire(null, operation),
		});
	}

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
	/** The latest `selectComputer`, for the cold start's computer restore. Read
	 *  through a ref so the cold-start effect does not list it as a dependency: a
	 *  new revision of the pick must never re-run the whole cold start. */
	const selectRef = useRef<(computer: DiscoveredComputer) => Promise<void>>(
		async () => undefined,
	);
	const mountedRef = useRef(true);
	const signInAbortRef = useRef<AbortController | null>(null);

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
			/* All three, all synchronous: the attempt's abort goes first so a browser
			 *  hand-off that lands after this unmount cannot publish (main's `ownsUI`
			 *  fence); the lifecycle gate then closes (main) and the in-memory grant's
			 *  request epochs end (Team Bridge), so neither a late scope write nor a late
			 *  hub refresh can publish into the next mount. */
			signInAbortRef.current?.abort();
			startupAuthorizationLifecycle.suspend();
			radientAccessRef.current?.replace(null);
			pendingSignOutRef.current = null;
			revocationOwnerRef.current = null;
			agentAvatarCache.clear();
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

	/**
	 * The one write of the in-memory Radient grant. Every path that gains or loses
	 * a grant (sign-in, cold-start restore, sign-out, or a discovery 401) goes
	 * through this accessor, so the rendered `radientSignedIn` and
	 * the ref the request paths read can never disagree.
	 */
	const holdRadientTokens = useCallback((tokens: RadientTokens | null) => {
		radientAccessRef.current?.replace(tokens);
	}, []);

	const radientAccessToken = useCallback(
		(options?: { force?: boolean }) =>
			radientAccessRef.current?.access(options) ?? Promise.resolve(null),
		[],
	);

	const radientRetirementAccessToken = useCallback(
		(options?: { force?: boolean; accountId?: string }) =>
			radientAccessRef.current?.retirementAccess(options) ??
			Promise.resolve(null),
		[],
	);

	/** Authentication ended without proof — a `401`, a lapsed grant, a cancelled
	 *  login. The gate closes now and the persisted generation is invalidated, but
	 *  NO draft is deleted: the reader's unfinished sentence survives a token blip
	 *  (`docs/ux/flows.md` § C5) and is simply unreachable from the next generation.
	 *  `afterCleanup` is for the credential that is genuinely dead (an expired
	 *  grant), never for private content. */
	const revokeAuthorization = useCallback(
		(afterRevoke?: () => Promise<void>): Promise<boolean> => {
			agentAvatarCache.clear();
			/* A rotation cached for the session that just ended must never be handed
			 * to the next one (review round 1, R1-n2). */
			refreshAccountTokens.clear();
			return startupAuthorizationLifecycle.revoke(afterRevoke).then(
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
			);
		},
		/* The refresher instance is stable for the provider's life (created once in a
		 *  ref), and only its cache-clear is reached here. */
		[refreshAccountTokens],
	);

	/** The synchronous half revokes dispatch; the resolved value reports whether
	 * every deletion was VERIFIED. The rejection itself stays on the lifecycle's
	 * own tail, so admission stays closed after a failure even though this
	 * caller-facing promise resolves — no unhandled rejection from a 401 handler,
	 * and no false success either. */
	/** The ONE way a refused Radient grant is withdrawn (discovery 401, a restore
	 *  the server refused). Two fences, in this order, both synchronous: the
	 *  accessor's epoch ends (`holdRadientTokens(null)` — in-flight hub refreshes
	 *  can no longer publish or persist), then `revoke` closes the lifecycle gate.
	 *  The stored-OAuth clear runs INSIDE the lifecycle's revoke step and on the
	 *  native credential queue, so it is ordered after any write already in
	 *  platform storage and before any later sign-in's write (which queues behind
	 *  this step). It deliberately calls the queue directly rather than the
	 *  accessor's `retire()`: that would re-run `replace(null)` when the step
	 *  finally executes, and could end the epoch of a grant held in between. */
	const revokeRadientGrant = useCallback((): Promise<boolean> => {
		holdRadientTokens(null);
		return revokeAuthorization(() =>
			nativeCredentialRetirement.retire(null, clearStoredOauth),
		);
	}, [holdRadientTokens, revokeAuthorization]);

	const retireAuthorization = useCallback(
		(
			preserveUnscoped = false,
			afterCleanup?: () => Promise<void>,
			policy: "retire" | "reauthenticate" = "retire",
		): Promise<SecureStorageRefusal | null> => {
			agentAvatarCache.clear();
			/* Resolves `null` when every deletion was verified, else the SANITISED reason
			 *  (step + platform code). The rejection reason used to be discarded here, so
			 *  a Keychain refusal reached the reader as an unexplained "Not connected".
			 *  `clear` is the fallback step: everything `retire()` does not tag itself is
			 *  part of the purge. */
			return startupAuthorizationLifecycle
				.retire(preserveUnscoped, afterCleanup, policy)
				.then(
					() => null,
					(reason: unknown) => {
						const storageRefusal = describeSecureStorageRefusal(
							reason,
							"clear",
						);
						if (mountedRef.current) {
							setBusy(false);
							connectionStore.getState().noteFailure({
								surface: "diagnostic",
								displayableMessage: "",
								storageRefusal,
							});
						}
						return storageRefusal;
					},
				);
		},
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
				storageRefusal: storageRefusalOf(error),
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
			// Capture before asynchronous delivery: a reset changes the inbox's
			// watermark domain, even when a reconnect reuses the client object.
			const listGeneration = listStore.getState().connectionGeneration;
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
							listStore.getState().applyFrame(
								{
									sessions: frame.data.sessions,
									degraded: frame.data.degraded,
									capabilities: frame.data.capabilities,
									/* THE INBOX COUNTS RIDE THIS SAME FRAME (contract §5.4) and
									 * were dropped at all three application sites, so the badge on
									 * the home bell and the conversations rail could never render
									 * on any relay — the count the design leans on was always
									 * null (design review D3; the mock relay was the other half). */
									notifications: frame.data.notifications,
									unread: frame.data.unread,
								},
								undefined,
								listGeneration,
							);
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
						/* The conversation stream's policy (`reconnectDelay`), so the two
						 * streams of one route back off alike: 2 s, doubling to a 15 s
						 * ceiling, and a server Retry-After only ever lengthens a step. A
						 * flat 2 s turned a Radient outage into a renewal POST every 2 s
						 * per phone once a 5xx stopped being terminal (PR #178 R1-2/Q1). */
						setTimeout(
							run,
							reconnectDelay(_attempt, error.retryAfterMs ?? undefined),
						);
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
			// Route changes include account/computer switches. Retire image bytes
			// before the next credential can address the same agent id and hash.
			agentAvatarCache.clear();
			/* A route that supersedes an in-flight browser sign-in takes its UI too.
			 * The abandoned attempt can no longer publish (`ownsUI()` is false once
			 * the ref is cleared), so its last state — "Waiting for your browser" or
			 * "Signing you in…" — was left on every screen that reads `signInState`
			 * with no way to end it. Settle it here, where ownership moves. */
			if (signInAbortRef.current) {
				signInAbortRef.current.abort();
				setSignInState({ kind: "idle" });
			}
			signInAbortRef.current = null;
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
			computerId?: string,
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
			rememberLiveRoute(
				admission,
				computerId,
				tokensRef.current?.account_id ?? null,
			);
			startStream(client, admission);
			startConfig(client);
			/* Startup authorization is admitted by the AUTHENTICATED ROUTE, not by the
			 * list read (review R1-1). Gating it on a frame meant one transient 503 on
			 * `GET /sessions` left a healthy, stream-populated route permanently unable
			 * to start a conversation — the stream's seed frame does not admit, and
			 * neither did a later refresh. The retry covers a storage write that failed
			 * once; `null` means a newer attempt superseded this one and must not retry. */
			const accessToken = tokensRef.current?.access;
			const route = connectionStore.getState().route;
			const recoveryProof =
				Platform.OS !== "web" && route?.mode === "radient" && accessToken
					? proveRecoveryAuthority(accessToken, {
							isCurrent: () =>
								admission.isCurrent() &&
								startupAuthorizationLifecycle.isCurrent(
									admission.authorizationRevision,
								) &&
								tokensRef.current?.access === accessToken,
						})
					: Promise.resolve(null);
			const admitStartup = async (): Promise<void> => {
				for (let attempt = 0; attempt < 2; attempt += 1) {
					if (!isAdmissionActive()) return;
					try {
						await startupAuthorizationLifecycle.admit(
							admission.routeKey,
							admission.authorizationRevision,
							prepareOrdinaryPrivateStorage,
							Platform.OS === "web" ? undefined : null,
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
			// Recovery is optional: ordinary generation-backed editors/outboxes do
			// not wait for the control plane. A late proof can import only an untouched
			// empty editor; restored bytes retain separate proof provenance on disk.
			void recoveryProof
				.then(async (owner) => {
					if (!owner || !route || !isAdmissionActive()) return;
					const scope = recoveryAuthorityScope(owner, route);
					if (scope === null) return;
					const admitted = await startupAuthorizationLifecycle.admit(
						admission.routeKey,
						admission.authorizationRevision,
						() =>
							prepareDraftRecovery(
								scope,
								() =>
									admission.isCurrent() &&
									startupAuthorizationLifecycle.isCurrent(
										admission.authorizationRevision,
									),
							),
						scope,
					);
					if (admitted && isAdmissionActive()) notifyDraftRecoveryReady();
				})
				.catch(() => {
					if (
						isAdmissionActive() &&
						startupAuthorizationLifecycle.get() === null
					)
						connectionStore
							.getState()
							.noteFailure({ surface: "diagnostic", displayableMessage: "" });
				});
			if (!admission.isCurrent()) return;
			/* The first paint is the REST read, not the stream's seed: the cold-start
			 * rule is that the list renders immediately, and a stream that opens in a
			 * second must not be the reason the screen is empty. It asks for the
			 * peers' rows exactly as the stream does — one list, one population. */
			const listGeneration = listStore.getState().connectionGeneration;
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
				listStore.getState().applyFrame(
					{
						sessions: frame.sessions,
						degraded: frame.degraded,
						capabilities: frame.capabilities,
						notifications: frame.notifications,
						unread: frame.unread,
					},
					undefined,
					listGeneration,
				);
			}
		},
		[startStream, startConfig],
	);

	const connectCustom = useCallback(
		async (
			{ url, password, allowInsecure, computerId }: ConnectCustomInput,
			restoring = false,
		): Promise<ConnectCustomOutcome> => {
			setBusy(true);
			let admission: StartupRouteAdmission | null = null;
			/* The outcome is read from the store, never assembled per return path; see
			 *  `ConnectCustomOutcome`. */
			const outcome = (): ConnectCustomOutcome => {
				if (admission && !admission.isCurrent())
					return { status: "superseded" };
				const state = connectionStore.getState();
				if (
					state.phase === "live" ||
					state.phase === "degraded" ||
					state.phase === "re-minting"
				)
					return { status: "live" };
				return {
					status: "refused",
					detail: state.detail,
					storageRefusal: state.storageRefusal,
				};
			};
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
					return outcome();
				}
				const route = validated.route;
				const privacy = restoring
					? Promise.resolve()
					: verifiedRetirement(retireAuthorization(true));
				admission = beginRoute(route);
				await privacy;
				await nativeCredentialRetirement.settled();
				if (!admission.isCurrent()) return outcome();
				if (!(await authenticateCustomRoute(route, password, admission)))
					return outcome();
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

				await goLive(client, admission, computerId);
				return outcome();
			} catch (error) {
				if (admission && !admission.isCurrent()) return outcome();
				if (error instanceof RelayError) {
					noteError(error, async () => {
						await connectCustom({ url, password, allowInsecure, computerId });
					});
					return outcome();
				}
				throw error;
			} finally {
				if (mountedRef.current && (!admission || admission.isCurrent()))
					setBusy(false);
			}
		},
		[beginRoute, goLive, noteError, retireAuthorization, revokeAuthorization],
	);

	// Account access and the five-minute tunnel grant have independent lives.
	// Renew in place: retiring authorization here would quarantine drafts and end
	// a perfectly valid route. Only a confirmed terminal refresh refusal may do so.
	const usableOauth = useCallback(
		async (
			force = false,
			rejectedAccess?: string,
		): Promise<RadientTokens | null> => {
			const initial = tokensRef.current;
			if (!initial) return null;
			let current = initial;
			if (
				(force && (!rejectedAccess || initial.access === rejectedAccess)) ||
				accessTokenNeedsRefresh(initial)
			) {
				const renewed = await refreshAccountTokens(initial);
				if (tokensRef.current !== initial && tokensRef.current !== renewed)
					throw new SignInSupersededError();
				if (
					initial.account_id &&
					renewed.account_id &&
					initial.account_id !== renewed.account_id
				)
					throw new SignInSupersededError();
				tokensRef.current = renewed;
				pendingOauthWrite.current = renewed;
				current = renewed;
			}
			if (pendingOauthWrite.current === current) {
				const revision = startupAuthorizationLifecycle.getRevision();
				// Persisting the rotation is BEST-EFFORT, exactly as in `radient-restore`:
				// a keystore write that fails says this DEVICE could not record the
				// grant, not that the grant is bad. Keep the rotated token in memory and
				// leave the retry armed, so the next consumer retries THIS write rather
				// than spending the old handle a second time.
				/* Serialised, and re-checked INSIDE the queue: a rotation that arrived
				 * while an earlier write was still in flight owns the durable record, and
				 * letting this older one land afterwards would persist a handle the newer
				 * rotation has already spent — a sign-out on the next launch (review
				 * round 1, R1-M3). */
				const queued = oauthWriteChain.current.then(() =>
					startupAuthorizationLifecycle.runIfCurrent(revision, async () => {
						if (pendingOauthWrite.current !== current) return;
						await writeStoredOauth(current);
						if (pendingOauthWrite.current === current)
							pendingOauthWrite.current = null;
					}),
				);
				oauthWriteChain.current = queued.then(
					() => undefined,
					() => undefined,
				);
				try {
					await oauthWriteChain.current;
				} catch {
					/* The rotated token still works for this run. */
				}
			}
			// A newer rotation, sign-in or route ended this one: stop rather than
			// publish rows for an account this route no longer owns.
			if (tokensRef.current !== current) throw new SignInSupersededError();
			return current;
		},
		[refreshAccountTokens],
	);

	const refreshComputers = useCallback(async () => {
		const ownsGrant = radientAccessRef.current?.capture();
		/* Discovery answers an ACCOUNT question before a tunnel exists. The store's
		 * phases describe a route, so the in-flight flag lives beside it instead of
		 * inventing a route to hang a phase on. */
		const pass = ++discoveryPassRef.current;
		setDiscovering(true);
		const revision = startupAuthorizationLifecycle.getRevision();
		const isCurrent = () =>
			mountedRef.current && startupAuthorizationLifecycle.isCurrent(revision);
		/* ONE latch closer for the whole pass. Every early exit below — a superseded
		 * pass, a superseded rotation, a refusal — used to bypass the inner `finally`
		 * and leave `discovering` raised, which disables Refresh, the banner's Try now
		 * and Settings' Refresh until some later pass happened to finish (review round
		 * 1, R1-M1; the shape PR #121 R2-m1 fixed, re-entered through the new exits). */
		try {
			if (!isCurrent() || !ownsGrant?.()) return;
			let result: DiscoveryResult;
			try {
				const tokens = await usableOauth();
				if (!isCurrent()) return;
				result = await discoverComputers({
					accessToken: async () => tokens?.access ?? null,
				});
				// A resource 401 is not a revocation verdict: the server's clock or a
				// server-side invalidation can outrun our own expiry. Judge it by a
				// refresh before deleting anything.
				if (result.kind === "unauthorized" && tokens?.refresh && isCurrent()) {
					const renewed = await usableOauth(true, tokens.access);
					if (!isCurrent()) return;
					result = await discoverComputers({
						accessToken: async () => renewed?.access ?? null,
					});
				}
			} catch (error) {
				if (!isCurrent() || error instanceof SignInSupersededError) return;
				result = grantFailureOutcome(error);
			}
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
				case "unauthorized": {
					/* The credential is gone SERVER-SIDE — revoked, or past its refresh window.
					 *  Deleted here rather than left for the next launch to retry, so "sign in
					 *  again" is a state the reader passes through once and not a loop. The other
					 *  failure arms deliberately KEEP the credential: an unreachable API, an
					 *  unreadable answer or a refused refresh says nothing about whether the
					 *  grant is still good. */
					/* ORDERING (merge of the Team Bridge accessor with the startup lifecycle).
					 *  Synchronously (`revokeRadientGrant`, which is main's `revokeAuthorization`
					 *  with the clear wrapped): the in-memory grant goes (a hub read now answers
					 *  "sign in" instead of presenting a refused token) and the lifecycle gate
					 *  closes (`revoke` suspends first). Then, as ONE step on the lifecycle tail,
					 *  the revoked record is written beside a stored-OAuth clear that is itself
					 *  serialized on the native credential queue — the queue the accessor's
					 *  `persist` uses, so a credential write already in platform storage finishes
					 *  before the clear, and a later sign-in's write (which waits on this
					 *  lifecycle step) can only land after it. Nothing private is deleted: a 401
					 *  is an auth blip (§ C5), not sign-out. */
					void revokeRadientGrant();
					setDiscovering(false);
					/* The rows go with the grant. A revoked account's list left in the store
					 *  stayed rendered in Settings beside "Not signed in with Radient" (PR #121
					 *  review round 1, R1-m1), now that the list outlives a route start. */
					connectionStore.getState().setComputers([]);
					/* Not awaited (main's shape): the expiry message lands in this same tick,
					 *  so no replacement sign-in can start in between and inherit it — the
					 *  ownership re-check #105 needed after its await is therefore moot. An
					 *  unverified clear later replaces it with `revokeAuthorization`'s
					 *  diagnostic, as on main. */
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
				}
				/* The failures that say nothing about the grant are ACCOUNT-level, not a
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
	}, [revokeRadientGrant, usableOauth]);

	const signInWithRadient = useCallback(async () => {
		signInAbortRef.current?.abort();
		const attempt = new AbortController();
		signInAbortRef.current = attempt;
		const ownsUI = () =>
			mountedRef.current && signInAbortRef.current === attempt;
		setSignInDiagnostics([]);
		const trace = (stage: string, errorClass?: string) => {
			if (ownsUI())
				setSignInDiagnostics((trail) =>
					appendSignInDiagnostic(trail, stage, errorClass),
				);
		};
		trace("retiring");
		// Checkpoint before ordinary purge; the sealed vault stays quarantined.
		// UI ownership, callback cancellation and the auth epoch fence this attempt.
		const privacy = retireAuthorization(true, undefined, "reauthenticate");
		// retire() revokes synchronously; capture AFTER it, not before cleanup.
		const revision = startupAuthorizationLifecycle.getRevision();
		const isCurrent = () =>
			ownsUI() &&
			!attempt.signal.aborted &&
			startupAuthorizationLifecycle.isCurrent(revision);
		const requireCurrent = () => {
			if (!isCurrent()) throw new SignInSupersededError();
		};
		cancelledRef.current = true;
		stopStream();
		stopConfig();
		clientRef.current = null;
		/* Through the accessor, not the ref: the epoch must end with the grant so an
		 *  in-flight hub refresh cannot republish it, and `radientSignedIn` re-renders. */
		holdRadientTokens(null);
		const retired = nativeCredentialRetirement.retire(managerRef.current);
		managerRef.current = null;
		connectionStore.getState().endRoute();
		setBusy(true);
		setSignInState({ kind: "starting" });
		try {
			await Promise.all([verifiedRetirement(privacy), retired]);
			requireCurrent();
			const result = await beginRadientSignIn({
				signal: attempt.signal,
				onState: (state) => {
					if (isCurrent()) {
						setSignInState(state);
						trace(
							state.kind,
							state.kind === "failed" ? state.errorClass : undefined,
						);
					}
				},
			});
			requireCurrent();
			if (!result.ok) {
				setSignInState(result.state);
				return;
			}
			trace("persisting");
			// Publish admission only after durable persistence completes. A newer
			// route/attempt cannot receive this grant, nor be overwritten by it.
			holdRadientTokens(result.tokens);
			const ownsGrant = radientAccessRef.current?.capture();
			/* Persisted BEFORE discovery, and before any route exists: the credential is
			 *  what makes the NEXT launch a computers screen instead of a second browser
			 *  hand-off, and a discovery that then fails (an unreachable API, an empty
			 *  account) must not throw a valid grant away. A runtime that cannot store it
			 *  still gets a working session this run — `writeStoredOauth` reports which. */
			/* Both fences: the lifecycle revision (a sign-out after this sign-in
			 *  began wins) and the accessor epoch on the native credential queue (a
			 *  replacement grant is never overwritten by this one). */
			/* A fresh browser proof may replace a pending sign-out's retained grant,
			 * but only a verified durable write makes it eligible for next-launch
			 * restore. A newer sign-out wins even if it arrived during that write. */
			const stored =
				await startupAuthorizationLifecycle.replaceCredentialsIfCurrent(
					revision,
					() =>
						radientAccessRef.current?.persist(result.tokens, ownsGrant) ??
						Promise.resolve(false),
				);
			requireCurrent();
			// Web's documented memory-only session is intentional. A native
			// keystore failure is not: expose Retry instead of claiming persistence.
			/* `stored` is the accessor's own durable verdict, read through main's fence:
			 *  `replaceCredentialsIfCurrent` answers false for a superseded revision (which
			 *  `requireCurrent()` above has already turned into `SignInSupersededError`) and
			 *  for a write the platform did not persist. A redundant `{persistent}` object
			 *  would only re-encode the same boolean. */
			if (Platform.OS !== "web" && !stored) throw new Error();
			tokensRef.current = result.tokens;
			setRestoredAccount(true);
			trace("discovering");
			await refreshComputers();
			// Discovery's 401 revokes this revision itself. That is a server
			// refusal, not a competing attempt, and must use the general failure.
			if (ownsUI() && connectionStore.getState().surface === "sign-in")
				throw new Error();
			requireCurrent();
			trace("signed-in");
			setSignInState({ kind: "idle" });
		} catch (error) {
			// A replacement attempt/route owns its own UI. Otherwise even a
			// revoked revision must produce a visible terminal result, not vanish.
			if (ownsUI()) {
				trace("failed", signInErrorClass(error));
				setSignInState({
					kind: "failed",
					detail: t(
						error instanceof SignInSupersededError
							? "mobile.signin.superseded"
							: "mobile.signin.failed",
					),
					errorClass: signInErrorClass(error),
				});
			}
		} finally {
			if (ownsUI()) setBusy(false);
		}
	}, [
		refreshComputers,
		retireAuthorization,
		stopStream,
		stopConfig,
		holdRadientTokens,
	]);

	/**
	 * The stored Radient grant for a pick that has none in memory — `carryOutRestore`
	 * with no discovery, because the pick already knows its computer. Accepted
	 * tokens land in `tokensRef` only while the pick's route is still current. A
	 * refusal is returned in the restore's own shape (`sign-in` for a grant that is
	 * gone, `retry` for an unreachable Radient, which must NOT discard it).
	 */
	const loadStoredRadient = useCallback(
		async (
			admission: StartupRouteAdmission,
		): Promise<{
			tokens: RadientTokens | null;
			refusal: {
				surface: "sign-in" | "retry";
				displayableMessage: string;
			} | null;
		}> => {
			const outcome = await carryOutRestore({
				readOauth: readStoredOauth,
				writeOauth: async (tokens) => {
					if (admission.isCurrent())
						await startupAuthorizationLifecycle.runIfCurrent(
							admission.authorizationRevision,
							async () => {
								await radientAccessRef.current?.persist(tokens);
							},
						);
				},
				clearOauth: async () => {
					if (admission.isCurrent()) await revokeRadientGrant();
				},
				refresh: (tokens) => refreshAccountTokens(tokens),
				discover: async (tokens) => {
					if (admission.isCurrent()) holdRadientTokens(tokens);
				},
				isCancelled: () => !admission.isCurrent(),
			});
			return {
				tokens: outcome.tokens,
				refusal: outcome.refusal
					? {
							surface: outcome.refusal.surface,
							displayableMessage: outcome.refusal.message,
						}
					: null,
			};
		},
		[revokeRadientGrant, holdRadientTokens, refreshAccountTokens],
	);

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
				/* A cold start on the reader's own address dials that address and never
				 *  loads the Radient grant (the cold start's order, below), so a pick made
				 *  from the computer switcher afterwards minted with no token and ended on
				 *  "needs attention in Radient… sign in with Radient again" (PR #122 UX
				 *  round 1, U3). The stored grant is loaded here, through the same restore
				 *  the cold start uses, so an expired one is refreshed and a refused one is
				 *  discarded by the same rules. */
				if (tokensRef.current === null) {
					const loaded = await loadStoredRadient(admission);
					if (!admission.isCurrent()) return;
					if (loaded.refusal || loaded.tokens === null) {
						connectionStore.getState().noteFailure(
							loaded.refusal ?? {
								surface: "sign-in",
								displayableMessage: RADIENT_PICK_SIGNED_OUT,
							},
						);
						return;
					}
				}
				const adopted = adoptableSession(
					await readStoredTunnelSession(),
					computer,
				);
				if (!admission.isCurrent()) return;
				const manager = new TunnelSessionManager({
					oauthAccessToken: async () => {
						if (!admission?.isCurrent())
							throw new TunnelSessionError(
								"rejected",
								"Connection route ended",
							);
						try {
							const tokens = await usableOauth();
							if (!admission.isCurrent())
								throw new TunnelSessionError(
									"rejected",
									"Connection route ended",
								);
							return tokens?.access ?? null;
						} catch (error) {
							if (
								!admission.isCurrent() ||
								error instanceof SignInSupersededError
							)
								throw new TunnelSessionError(
									"rejected",
									"Connection route ended",
								);
							// A network failure and a refused grant are different facts: the
							// first keeps the credential, the second is what sends the reader
							// to sign-in. Anything else is reported as a transport fault, not
							// silently labelled a rejected grant (review round 1, R1-n1).
							throw new TunnelSessionError(
								error instanceof RadientAuthError &&
									error.failure === "invalid_grant"
									? "oauth"
									: "network",
								"Radient credentials could not be renewed",
							);
						}
					},
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
					tunnelSession: async (signal) => {
						if (!admission?.isCurrent())
							throw new RelayError("rejected", "Connection route ended");
						try {
							// The request's own signal travels with the renewal: the request
							// deadline (armed before auth) and a route switch both cancel a
							// mint/refresh nobody is waiting for any more.
							const session = await manager.usableSession(signal);
							if (!admission.isCurrent())
								throw new RelayError("rejected", "Connection route ended");
							return session;
						} catch (error) {
							if (error instanceof TunnelSessionError)
								throw tunnelSessionRelayError(error);
							throw error;
						}
					},
					refreshTunnelSession: async (signal) => {
						if (!admission?.isCurrent())
							throw new RelayError("rejected", "Connection route ended");
						try {
							await manager.refresh(signal);
						} catch (error) {
							if (error instanceof TunnelSessionError)
								throw tunnelSessionRelayError(error);
							throw error;
						}
					},
					assertCurrent: () => {
						if (!admission?.isCurrent())
							throw new RelayError("rejected", "Connection route ended");
					},
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
								: tunnelSessionRelayError(error),
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
		[
			beginRoute,
			goLive,
			loadStoredRadient,
			noteError,
			revokeAuthorization,
			usableOauth,
		],
	);

	const refreshList = useCallback(async () => {
		const client = clientRef.current;
		if (!client) return;
		const listGeneration = listStore.getState().connectionGeneration;
		setBusy(true);
		try {
			const frame = await client.sessions({ includePeers: true });
			listStore.getState().applyFrame(
				{
					sessions: frame.sessions,
					degraded: frame.degraded,
					capabilities: frame.capabilities,
					notifications: frame.notifications,
					unread: frame.unread,
				},
				undefined,
				listGeneration,
			);
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
		/*
		 * SIGN-OUT ORDERING — the merge of two invariants that each held alone:
		 *
		 *  (A) startup lifecycle (main): the admission gate closes SYNCHRONOUSLY at
		 *      entry, and the tombstone, the private-family purge and the credential
		 *      wipe are ONE joined, retryable step on the lifecycle tail whose failure
		 *      is reported (`verifiedRetirement`) rather than passed off as success.
		 *  (B) Team Bridge (#105): push-device deregistration authenticates with the
		 *      Radient grant, so the in-memory grant and the stored OAuth must outlive
		 *      it; and every OAuth clear runs on the native credential queue, behind
		 *      any accessor `persist` already in platform storage.
		 *
		 * Neither side's order satisfies the other: (B) alone wiped credentials
		 * outside the lifecycle step (no tombstone join, no verified failure); (A)
		 * alone cleared the stored grant with no wait for deregistration. The order
		 * that satisfies both:
		 *
		 *  1. sync  — device retirement starts (it reads the in-memory grant through
		 *             `radientRetirementAccessToken`, which deliberately joins neither
		 *             queue, so nothing below can deadlock it), then `retire` closes
		 *             the lifecycle gate and enqueues its durable step. The native
		 *             route logout is also reserved synchronously below, so it sits
		 *             AHEAD of the credential slot on the native queue.
		 *  2. step  — tombstone write ∥ private-family purge ∥ native credential slot:
		 *             await device retirement (bounded at 35 s by its owner) → drop the
		 *             in-memory grant → clear the credential store.
		 *  3. join  — any failure keeps admission closed and sign-out reports false.
		 *
		 * Why a later sign-in cannot be wiped: `signInWithRadient` retires on the same
		 * lifecycle tail before it holds or persists a grant, so its tokens exist only
		 * after this step settles. The ownership guard below is defence for any other
		 * grant holder; an unmount (in-memory grant withdrawn, `tokensRef` null) must
		 * NOT cancel an already requested durable sign-out. Cost, accepted: with the
		 * push registry unreachable, the lifecycle tail (and so a sign-in right after
		 * sign-out) waits up to that 35 s bound — fail-closed rather than half-open.
		 */
		const ownsGrant = radientAccessRef.current?.capture();
		const deviceRetired = retireTeamBridgeDevice();
		const clearCredentials = async () => {
			await deviceRetired;
			if (!ownsGrant?.() && tokensRef.current !== null) return;
			holdRadientTokens(null);
			await clearStoredCredentials();
		};
		const privacy = verifiedRetirement(
			retireAuthorization(false, () =>
				nativeCredentialRetirement.retire(null, clearCredentials),
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
	}, [
		confirmRevocation,
		stopStream,
		stopConfig,
		retireAuthorization,
		holdRadientTokens,
	]);

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
		if (!validated.ok) return null;
		const tunnel: SavedTunnel = {
			baseUrl: validated.route.baseUrl,
			/* An empty field means "not remembered", which is a state the record
			 *  already has a shape for (`password: string | null`). */
			password: input.password.length > 0 ? input.password : null,
			allowInsecure: input.allowInsecure,
		};
		const written = await writeSavedTunnel(tunnel);
		setSavedTunnel(tunnel);
		return {
			persistent: written.persistent,
			storageRefusal: written.storageRefusal ?? null,
		};
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
		let ownsGrant = radientAccessRef.current?.capture();
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
				if (isCurrent() && ownsGrant?.())
					await startupAuthorizationLifecycle.runIfCurrent(
						authorizationRevision,
						async () => {
							await radientAccessRef.current?.persist(tokens, ownsGrant);
						},
					);
			},
			clearOauth: async () => {
				if (isCurrent() && ownsGrant?.()) {
					const revoked = revokeRadientGrant();
					ownsGrant = radientAccessRef.current?.capture();
					await revoked;
				}
			},
			refresh: (tokens) => refreshAccountTokens(tokens),
			discover: async (tokens) => {
				if (!isCurrent() || !ownsGrant?.()) return;
				holdRadientTokens(tokens);
				ownsGrant = radientAccessRef.current?.capture();
				if (mountedRef.current) setRestoredAccount(true);
				/* Discovery is what turns a credential into a computers screen, and
				 *  its own `unauthorized` arm deletes a grant the server has refused
				 *  since. */
				await refreshComputers();
			},
			isCancelled: () => !isCurrent() || !ownsGrant?.(),
		});
		if (!isCurrent() || !ownsGrant?.()) return;
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
	}, [
		refreshComputers,
		revokeRadientGrant,
		holdRadientTokens,
		refreshAccountTokens,
	]);

	/* The restore function is stable (its only dependency is `refreshComputers`), but
	 *  the retry it publishes must call the latest one, and the two would otherwise
	 *  have to reference each other. */
	useEffect(() => {
		restoreRef.current = restoreRadient;
	}, [restoreRadient]);

	useEffect(() => {
		selectRef.current = selectComputer;
	}, [selectComputer]);

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
				if (Platform.OS !== "web") {
					pickerPrivacy.withdraw();
					await clearNativePickerCache();
				}
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
				/* Last: open the computer the reader was on (or their only one) instead
				 *  of parking a restored account on the picker every launch. Awaited
				 *  inside the cold start so `coldStartSettled` stays false meanwhile and
				 *  Home keeps its restoring splash — no flash of the picker. Every guard
				 *  and branch is in `./cold-start-computer`. */
				if (!interrupted())
					await resumeComputerOnColdStart({
						signedIn: () => tokensRef.current !== null,
						routed: () => connectionStore.getState().route !== null,
						refused: () => connectionStore.getState().surface !== null,
						/* A saved own-tunnel without its password is the screen asking for
						 *  it; dialling a Radient computer over that would take the
						 *  reader's chosen path away from them. */
						ownTunnelPending: () => stored !== null,
						computers: () => connectionStore.getState().computers,
						readSaved: readSavedComputers,
						select: (computer) => selectRef.current(computer),
						isCancelled: interrupted,
					});
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
	const storageRefusal = useConnectionState((state) => state.storageRefusal);
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
			storageRefusal,
		});
	}, [
		computers,
		detail,
		lastError,
		retryAfterMs,
		route,
		storageRefusal,
		surface,
		tunnelId,
	]);

	const connectCustomQuiet = useCallback(
		async (input: ConnectCustomInput): Promise<void> => {
			await connectCustom(input);
		},
		[connectCustom],
	);
	const connectCustomOutcome = useCallback(
		(input: ConnectCustomInput) => connectCustom(input),
		[connectCustom],
	);

	const value = useMemo<Connection>(
		() => ({
			connectCustom: connectCustomQuiet,
			connectCustomOutcome,
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
			radientAccessToken,
			radientRetirementAccessToken,
			radientSignedIn,
			radientAccountId,
			busy,
			coldStartSettled,
			streamHealth,
			signInState,
			signInDiagnostics,
			lastError,
			refusal,
		}),
		[
			connectCustomQuiet,
			connectCustomOutcome,
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
			radientAccessToken,
			radientRetirementAccessToken,
			radientSignedIn,
			radientAccountId,
			busy,
			coldStartSettled,
			streamHealth,
			signInState,
			signInDiagnostics,
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
