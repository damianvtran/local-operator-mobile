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
	/** The computers discovery found, most recently updated first. */
	computers: DiscoveredComputer[];
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

export interface ConnectionActions {
	/** Starts a route. The ONLY entry point, so a route switch is always an
	 *  explicit act. */
	startRoute: (route: RouteProfile) => void;
	/** Records the discovered computers. */
	setComputers: (computers: DiscoveredComputer[]) => void;
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
	/** Takes the typed error's decision fields. They are all optional because a
	 *  caller may have only a `kind`-less failure in hand (an endpoint that threw a
	 *  plain `RelayError` with no surface). A caller holding a `RelayError` passes
	 *  `displayableMessage`, which is the taxonomy's sanitised copy — `detail` is the
	 *  classifier's own field and is only a fallback, because it can be empty or
	 *  markup while the sentence is not. */
	noteFailure: (error: {
		surface?: ErrorSurface | null;
		displayableMessage?: string | null;
		detail?: string | null;
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
				revision: state.revision + 1,
				route,
				/* A Radient route is not usable until a computer is picked, so it starts
				 * discovering; a custom route is a single address and goes straight to
				 * minting (which for it means "sign in with the password"). */
				phase: route.mode === "radient" ? "discovering" : "minting",
			}));
		},

		setComputers(computers) {
			if (get().route === null) return;
			set({
				computers,
				phase: get().phase === "discovering" ? "discovering" : get().phase,
			});
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
			const surface = error.surface ?? "none";
			set({
				/* Through the taxonomy's copy accessor rather than the raw `detail`: it
				 * sanitises — never a runtime diagnostic, an empty proxy body or markup — so
				 * a screen reading the snapshot cannot render `""` or an HTML error page.
				 * `surface` stays the signal for a client bug, where the answer is a retry
				 * affordance rather than a sentence. */
				detail: error.displayableMessage ?? error.detail ?? null,
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
			set((state) => ({ ...INITIAL, revision: state.revision + 1 }));
		},
	}));
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
