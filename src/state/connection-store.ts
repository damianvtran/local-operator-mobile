/**
 * The connection store: the only place a route can start or end.
 *
 * `docs/architecture.md` §State management gives this store one rule, and the API
 * enforces it rather than documenting it: `startRoute` and `endRoute` are the only
 * actions that touch `route`, so a screen cannot switch connections as a side
 * effect of anything else. Everything else here records what the route is doing —
 * which is a state machine, not a flag:
 *
 * ```
 * signed-out ──startRoute──▶ discovering ──pickComputer──▶ minting ──▶ live
 *      ▲                                                          │
 *      ├── refresh handle expired (30 d) or OAuth lapsed ◀── re-minting
 *      │                                                          │
 *      └── user signs out ◀── refused (a 503 reason / 401 / 403) ◀─┘
 * ```
 *
 * The 60-second stream cut is deliberately NOT a state here: it is transparent, so
 * a rotation must not reach this store at all. `degraded` is a UI state derived
 * from the relay's own signals (SSE silence, `subagents_running` flipping to
 * `null`), never a transport state — and never from `projection.degraded`, which
 * is unusable over the relay (`docs/relay/contract.md` §6.5).
 */

import { createStore } from "zustand/vanilla";
import type { DiscoveredComputer } from "../connection/discovery";
import type { RouteProfile } from "../connection/profile";
import type { ErrorSurface } from "../relay";

export type ConnectionPhase =
	/** No route, no credentials: the welcome screen. */
	| "signed-out"
	/** Radient is signed in; the account's computers are being listed. */
	| "discovering"
	/** A computer is chosen and a tunnel session is being obtained. */
	| "minting"
	/** Requests can be made. */
	| "live"
	/** The handle or grant is being renewed behind the user's back. */
	| "re-minting"
	/** Live, but the relay has stopped answering: the last data is on screen and
	 *  labelled, never blanked. */
	| "degraded"
	/** A failure the user must resolve, with the surface that says which one. */
	| "refused";

export interface ConnectionSnapshot {
	phase: ConnectionPhase;
	/** The active route, or `null`. Only `startRoute`/`endRoute` change this. */
	route: RouteProfile | null;
	/** The signed-in identity, as a LABEL only: never an email in a log, never a
	 *  token anywhere. */
	accountLabel: string | null;
	/** The computers discovery found, most recently updated first, minus the ones
	 *  the reader removed (`hiddenTunnelIds`). ACCOUNT state: it survives a Radient
	 *  `startRoute` (picking a computer) and is emptied only by `endRoute`
	 *  (sign-out, sign-in), or by the provider on an `unauthorized` discovery. */
	computers: DiscoveredComputer[];
	/** The last discovery result BEFORE the removed-set filter. Only the computer
	 *  switcher reads it: a removed computer drops into its "On your Radient
	 *  account, not connected" section instead of vanishing, and that section needs
	 *  to know the account still lists it. Every other reader keeps `computers`, so a
	 *  removed computer stays removed everywhere else. Same lifetime as `computers`. */
	discoveredComputers: DiscoveredComputer[];
	/** The saved-computers registry id of the computer the live route reaches, once
	 *  the provider has recorded it (`rememberLiveRoute`). Identity is this id, never
	 *  the address (operator decision a-2a8b): two saved entries may share an address,
	 *  and only the id says which one is in use. `null` until recorded, and reset by
	 *  every route change like the rest of the route's state. */
	computerId: string | null;
	/** Why the last discovery pass failed, or `null` once one succeeds. Kept apart
	 *  from `surface` on purpose: listing an account's computers is not a ROUTE, so
	 *  its failure must not flip a live route to `refused`, hide the rows it failed
	 *  to refresh, or borrow a route refusal whose retry re-runs a route action
	 *  (PR #121 design round 1, D2). The screen owns the sentence; the store keeps
	 *  only which of the two failures it was, so a server's free text never reaches
	 *  a banner. */
	discoveryFailure: DiscoveryFailure | null;
	/** Tunnel ids the reader removed from this phone. Discovery keeps reporting a
	 *  removed computer — the account still has it — so the filter lives HERE, at
	 *  the one entry point every discovery result goes through, rather than in a
	 *  screen that the next refresh would bypass. Persisted by
	 *  `connection/saved-computers.ts` and hydrated into this store; unlike the rest
	 *  of the snapshot it survives a route change, because removing a computer is a
	 *  fact about this phone, not about one route. */
	hiddenTunnelIds: string[];
	/** The chosen computer's tunnel id, when one is chosen. */
	tunnelId: string | null;
	/** The relay's or the gateway's own sentence, written for a phone, displayed
	 *  verbatim. */
	detail: string | null;
	/** Which screen owns the failure, pre-decided by the error taxonomy so three
	 *  screens cannot each interpret a `503` differently. */
	surface: ErrorSurface | null;
	/** A server-supplied backoff, when it sent one. */
	retryAfterMs: number | null;
	/** Bumped on every route change. Consumers use it to drop work that belongs to
	 *  a route that is no longer active. */
	revision: number;
}

/** The two discovery outcomes that leave the list as it was: no answer, or an
 *  answer this build cannot use. `unauthorized` is not one — it ends the account. */
export type DiscoveryFailure = "unreachable" | "rejected";

export interface ConnectionActions {
	/** Starts a route. The ONLY entry point, so a route switch is always an
	 *  explicit act. */
	startRoute: (route: RouteProfile) => void;
	/** Records the discovered computers, dropping any the reader removed, and with
	 *  them that discovery succeeded. */
	setComputers: (computers: DiscoveredComputer[]) => void;
	/** Records a failed discovery pass. The rows already listed stay. */
	noteDiscoveryFailure: (failure: DiscoveryFailure) => void;
	/** Replaces the removed set (hydration from the saved-computers registry) and
	 *  re-filters the current list, so hydrating after discovery has already
	 *  answered still hides what it should. */
	setHiddenTunnelIds: (tunnelIds: readonly string[]) => void;
	/** The reader removed this computer: out of the list now and after every
	 *  later discovery refresh. Persisting it is the caller's job. */
	hideComputer: (tunnelId: string) => void;
	/** The way back. The computer returns at once when the last discovery listed
	 *  it, and otherwise on the next refresh. */
	unhideComputer: (tunnelId: string) => void;
	/** Records which saved computer the live route reaches. The caller fences it on
	 *  the route's admission, so a late write cannot label another route. */
	noteComputer: (computerId: string) => void;
	/** Picks a computer and moves to `minting`. */
	selectComputer: (computer: DiscoveredComputer) => void;
	/** The tunnel session exists and the relay answered: the route is usable. */
	markLive: (input?: { accountLabel?: string | null }) => void;
	/** A renewal is in flight. Transparent in the UI: no screen paints this. */
	markReminting: () => void;
	/** The stream has gone quiet long enough to matter, or the relay reported a
	 *  session it cannot vouch for. The data stays on screen. */
	markDegraded: (input: { detail: string }) => void;
	/** A failure with its surface. A `sign-in` surface returns to `signed-out`,
	 *  because that is the state the user is actually in. */
	/** Takes a failure's decision fields. A caller holding a `RelayError` passes the
	 *  error itself (it is structurally assignable), which is deliberate: the copy that
	 *  reaches a screen is `displayableMessage`, the taxonomy's sanitised accessor, so
	 *  there is no way in for a raw `detail` — an unsanitised string, an empty body or a
	 *  proxy's markup (review round 5, m2). */
	noteFailure: (error: {
		surface: ErrorSurface;
		displayableMessage: string;
		retryAfterMs?: number | null;
	}) => void;
	/** Ends the route: the only other action that touches `route`. */
	endRoute: () => void;
}

export type ConnectionStore = ConnectionSnapshot & ConnectionActions;

const INITIAL: ConnectionSnapshot = {
	phase: "signed-out",
	route: null,
	accountLabel: null,
	computers: [],
	discoveredComputers: [],
	computerId: null,
	discoveryFailure: null,
	hiddenTunnelIds: [],
	tunnelId: null,
	detail: null,
	surface: null,
	retryAfterMs: null,
	revision: 0,
};

export function createConnectionStore() {
	return createStore<ConnectionStore>()((set, get) => ({
		...INITIAL,

		startRoute(route) {
			set((state) => ({
				...INITIAL,
				hiddenTunnelIds: state.hiddenTunnelIds,
				revision: state.revision + 1,
				route,
				/* Picking a computer STARTS a Radient route, so resetting the list here
				 *  erased the very list the reader picked from: the picker fell back to
				 *  "Set up a computer" while minting and stayed there if the mint failed
				 *  (PR #121 review round 1, R1-M1; design D1). The account did not change,
				 *  so its list and its last discovery outcome carry over. A custom route is
				 *  a different identity, so STARTING one does not inherit Radient's rows.
				 *  A later Refresh may still list them: connecting a custom address keeps
				 *  the Radient grant (it is not a sign-out), and those rows are how the
				 *  reader switches back to a Radient computer from Settings (PR #121 review
				 *  round 2, R2-m2). */
				...(route.mode === "radient"
					? {
							computers: state.computers,
							discoveredComputers: state.discoveredComputers,
							discoveryFailure: state.discoveryFailure,
						}
					: {}),
				/* A Radient route is not usable until a computer is picked, so it starts
				 * discovering; a custom route is a single address and goes straight to
				 * minting (which for it means "sign in with the password"). */
				phase: route.mode === "radient" ? "discovering" : "minting",
			}));
		},

		setComputers(computers) {
			/* No route guard, unlike the actions around it. The computer list is ACCOUNT
			 *  state: Radient discovery runs after sign-in or a cold-start restore and
			 *  BEFORE any route exists, because a route is what picking one of these
			 *  computers creates. A `route === null` guard here dropped every discovery
			 *  result and left an account with tunnels on "Set up a computer"
			 *  (PR #120 QA round 1, Q1). A late result that belongs to a sign-out or a
			 *  newer sign-in is dropped by the caller, which fences discovery on the
			 *  startup-authorization revision (`refreshComputers` in
			 *  `connection-provider.tsx`); `endRoute` still empties the list, and a
			 *  Radient `startRoute` deliberately keeps it (picking is not signing out).
			 *  What must not happen without a route — minting — stays guarded in
			 *  `selectComputer`.
			 *
			 *  A list arriving IS a successful discovery, so it clears the last failure:
			 *  a banner that outlived the outage it reported would be the dismiss-by-
			 *  luck the kit's banner rule forbids (design round 1, D2). */
			set({
				computers: withoutHidden(computers, get().hiddenTunnelIds),
				discoveredComputers: computers,
				discoveryFailure: null,
				phase: get().phase === "discovering" ? "discovering" : get().phase,
			});
		},

		noteDiscoveryFailure(failure) {
			/* No route guard, for the same reason as `setComputers`; and no `phase` or
			 *  `surface` write, because a failed LISTING says nothing about a route that
			 *  may be live right now. */
			set({ discoveryFailure: failure });
		},

		setHiddenTunnelIds(tunnelIds) {
			const hiddenTunnelIds = [...new Set(tunnelIds)];
			set({
				hiddenTunnelIds,
				computers: withoutHidden(get().computers, hiddenTunnelIds),
			});
		},

		hideComputer(tunnelId) {
			if (get().hiddenTunnelIds.includes(tunnelId)) return;
			get().setHiddenTunnelIds([...get().hiddenTunnelIds, tunnelId]);
		},

		unhideComputer(tunnelId) {
			const hiddenTunnelIds = get().hiddenTunnelIds.filter(
				(id) => id !== tunnelId,
			);
			/* Re-filtered from the last discovery so a computer the switcher brings back
			 *  is listed now, not after a refresh the reader never asked for. */
			set({
				hiddenTunnelIds,
				computers: withoutHidden(get().discoveredComputers, hiddenTunnelIds),
			});
		},

		noteComputer(computerId) {
			if (get().route === null) return;
			set({ computerId });
		},

		selectComputer(computer) {
			if (get().route === null) return;
			set({
				tunnelId: computer.tunnelId,
				phase: "minting",
				detail: null,
				surface: null,
			});
		},

		markLive(input) {
			if (get().route === null) return;
			set({
				phase: "live",
				detail: null,
				surface: null,
				retryAfterMs: null,
				...(input?.accountLabel !== undefined
					? { accountLabel: input.accountLabel }
					: {}),
			});
		},

		markReminting() {
			if (get().phase === "signed-out") return;
			set({ phase: "re-minting" });
		},

		markDegraded({ detail }) {
			/* Degraded keeps whatever is on screen and labels it; it never clears the
			 * route or the data, which is the difference between "stale" and "blank". */
			if (get().phase === "signed-out" || get().phase === "refused") return;
			set({ phase: "degraded", detail });
		},

		noteFailure(error) {
			const { surface } = error;
			/* Two rules decide what a screen may show. `displayableMessage` is the
			 * taxonomy's sanitised accessor — never a runtime diagnostic, an empty proxy
			 * body or markup — so `""` and an HTML error page cannot reach a screen; and a
			 * CLIENT bug (`diagnostic`) stores NOTHING, because the answer there is a retry
			 * affordance and the surface says so. Storing its sentence is what put
			 * "cross-origin request refused" in front of a user for a bug they cannot act
			 * on (review round 5, m4). */
			const detail = surface === "diagnostic" ? null : error.displayableMessage;
			set({
				detail,
				surface,
				retryAfterMs: error.retryAfterMs ?? null,
				phase: surface === "sign-in" ? "signed-out" : "refused",
				/* A sign-in failure removes the route's identity but keeps the route: the
				 * user is re-authenticating the same computer, not choosing a new one. */
				...(surface === "sign-in" ? { accountLabel: null } : {}),
			});
		},

		endRoute() {
			/* Clearing the projections is the route switch's job (`architecture.md`
			 * "Route switch") and belongs to the caller that owns both stores; this
			 * action deliberately does not reach into another store. */
			set((state) => ({
				...INITIAL,
				hiddenTunnelIds: state.hiddenTunnelIds,
				revision: state.revision + 1,
			}));
		},
	}));
}

function withoutHidden(
	computers: DiscoveredComputer[],
	hiddenTunnelIds: readonly string[],
): DiscoveredComputer[] {
	if (hiddenTunnelIds.length === 0) return computers;
	return computers.filter(
		(computer) => !hiddenTunnelIds.includes(computer.tunnelId),
	);
}

export type ConnectionStoreApi = ReturnType<typeof createConnectionStore>;

/** True when the route can carry a request. Used by the list/projection stores'
 *  callers rather than by the stores themselves, so the dependency runs one way. */
export function isUsable(snapshot: ConnectionSnapshot): boolean {
	return (
		snapshot.route !== null &&
		(snapshot.phase === "live" ||
			snapshot.phase === "degraded" ||
			snapshot.phase === "re-minting")
	);
}
