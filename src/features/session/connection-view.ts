/**
 * The connection states as the session screen presents them
 * (`docs/ux/flows.md` § 9, the `C1`–`C7` table).
 *
 * The ids are the point: the audit rubric scores *these* names, so a harness
 * failure can say which state it saw without a paragraph of prose. This module is
 * the single place that decides which one is showing, because the alternative —
 * three screens each interpreting a `503` — is how the same failure acquires three
 * sentences.
 *
 * Three rules carry the section, and each is a measured failure rather than a
 * preference:
 *
 * 1. **`C1` is invisible.** The gateway ends every relayed stream at
 *    `MAX_STREAM_SECONDS = 60`, so on the Radient route an orderly close arrives
 *    once a minute, forever. A reconnect flash on that boundary teaches the reader
 *    to ignore the indicator that matters. So a clean EOF produces NO state at
 *    all — not a brief one, not a muted one. `sse.ts` distinguishes a lease
 *    rotation (`rotating`) from an early gateway stop (`stalled`) and both are
 *    reported there for diagnostics; here they are deliberately the same value,
 *    because `tunnel-edge.md` § 3 is explicit that an early EOF carries no
 *    information about *why* it ended, and flow 08 asserts no banner across it.
 * 2. **Only a genuine loss is a state**, and there are exactly three ways to enter
 *    `C2`: a transport error, or a reconnect whose replacement produces no
 *    snapshot inside `RECONNECT_DEADLINE_MS`.
 * 3. **The gateway's sentences are rendered verbatim.** They are the product's own
 *    vocabulary, already reviewed (`RELAY_DETAIL` in `gateway.py`), so this module
 *    chooses a tone, a remedy and an id — never new words for the failure.
 *
 * No React, no React Native.
 */

import type { ErrorSurface, StreamState } from "@/relay";
import { isRelayError, type RelayError } from "@/relay";
import type { ConnectionPhase, ProjectionEntry } from "@/state";

/**
 * The grace window for `C3`, derived rather than guessed (flows.md § 9).
 *
 * It has one job: be longer than the slowest silence a HEALTHY connection can
 * produce. On the phone leg that is the relay daemon's 25 s SSE keep-alive
 * (`SSE_KEEPALIVE_S`); the link's 30 s heartbeat is a different transport
 * (daemon ↔ runtime) and the gateway emits no keepalive of its own. So 75 s
 * clears 15 s, 25 s and 30 s alike — 3× the daemon's cadence, 2.5× the link's, and
 * deliberately NOT a multiple of the 60 s rotation, so a harness reading can tell
 * a rotation from silence without arithmetic.
 */
export const KEEPALIVE_GRACE_S = 75;

/**
 * How long a reconnect may take before it counts as a failure.
 *
 * A rotation reopens immediately and the relay answers with a seed frame, so this
 * deadline is many times the honest round trip; it exists so that a replacement
 * that produces NOTHING becomes `C2` instead of an indefinite silence. Stated in
 * code rather than felt (flows.md § 9: "pick ~5 s; state it in code").
 */
export const RECONNECT_DEADLINE_MS = 5_000;

/** A snapshot older than this is old, and `C3` says so (same derivation as the
 *  silence window: both answer "is this still live"). */
export const STALE_SNAPSHOT_AGE_S = KEEPALIVE_GRACE_S;

export type ConnectionStateId = "C1" | "C2" | "C3" | "C4" | "C5" | "C6" | "C7";

/** The control the state offers, if any. `null` is a state that only informs. */
export type ConnectionAction =
	| { kind: "sign-in"; label: string; testID: string }
	| { kind: "retry"; label: string; testID: string }
	| { kind: "console"; label: string; testID: string };

export interface ConnectionView {
	/** `null` when nothing should be shown at all. `C1` always resolves here. */
	id: ConnectionStateId | null;
	text: string;
	tone: "info" | "warning" | "danger";
	action: ConnectionAction | null;
	/** Extra anchors the flows address, on the banner and beside it. */
	testIDs: string[];
}

/**
 * The one state a reader is allowed to see nothing about. Exported so the
 * derivation reads as a choice rather than as a missing branch, and so a test can
 * assert the ABSENCE by name.
 */
export const NOTHING_VISIBLE: ConnectionView = {
	id: null,
	text: "",
	tone: "info",
	action: null,
	testIDs: [],
};

const BANNER = "connection-banner";

const view = (
	id: ConnectionStateId,
	text: string,
	tone: ConnectionView["tone"],
	options: { action?: ConnectionAction; testIDs?: string[] } = {},
): ConnectionView => ({
	id,
	text,
	tone,
	action: options.action ?? null,
	testIDs: [BANNER, ...(options.testIDs ?? [])],
});

export interface ConnectionViewInput {
	/** The connection store's phase. Pre-decided so three screens cannot each
	 *  interpret one failure differently. */
	phase: ConnectionPhase;
	/** The session stream's own state. */
	stream: StreamState;
	/** Why the last open ended, as `sse.ts` recorded it. A clean `eof` is never a
	 *  fault, whatever its length. */
	lastEnd: "eof" | "error" | "stopped" | undefined;
	/** A reconnect has outlived `RECONNECT_DEADLINE_MS` without a snapshot. */
	reconnectExpired: boolean;
	/** The last failure the connection layer resolved, if any. It already carries
	 *  the decision (`envelope`, `retry`, `surface`) so nothing is re-derived here. */
	error: RelayError | null;
	/** This session's projection entry. */
	entry: ProjectionEntry;
	/** `isSessionViewStale`'s verdict: the listing row cannot vouch for the
	 *  session even though a projection is on screen. */
	stale: boolean;
	/** Seconds since the last accepted frame, or `null` when nothing has ever
	 *  arrived. */
	ageS: number | null;
	/** `false` only when the platform told us there is no route. `null` is "not
	 *  known", which must not be painted as offline. */
	online: boolean | null;
	/** The computer's name, for the sentences that must name it. */
	computerLabel: string;
	/** The computer's last-seen age, for `C7`. */
	computerLastSeenS: number | null;
	/** The connection store's own sentence and surface, for a failure that landed
	 *  before this screen had an error of its own. Rendered verbatim when present:
	 *  the gateway writes these for a phone, and re-wording one here would give the
	 *  same refusal two voices (`errors.ts`'s `surface` is the pre-decision this
	 *  module must not second-guess). */
	phaseDetail?: string | null;
	phaseSurface?: ErrorSurface | null;
	/** The session ended: terminal, and NOT the same thing as not-answering. */
	ended: boolean;
}

/**
 * The sentence a relay failure is allowed to put in front of the reader, or
 * `undefined` when the failure supplied none.
 *
 * Three sources are trusted, in this order, and each is the PRODUCT's own
 * vocabulary:
 *
 *   1. `detail` — the gateway's sentence, written for a phone and reviewed.
 *   2. `serverError` — the relay's or the edge's own `error` string or body text.
 *   3. nothing, so the caller chooses its own words.
 *
 * `message` and `displayableMessage()` are deliberately excluded: a transport
 * error's message is the RUNTIME's prose ("Load failed", a platform string), and
 * surfacing it was a shipped first impression of a failure (U3). This is the one
 * place that decides, so a screen cannot accidentally be the exception.
 */
export const relaySentence = (error: RelayError): string | undefined =>
	error.detail ?? error.serverError;

/** `Ns`, `Nm Ss`, `Nh` — the register the transcript already uses. */
const agoLabel = (seconds: number): string => {
	const whole = Math.max(0, Math.round(seconds));
	if (whole < 60) return `${whole}s`;
	const minutes = Math.floor(whole / 60);
	if (minutes < 60) return `${minutes}m`;
	return `${Math.floor(minutes / 60)}h`;
};

const computerName = (label: string): string =>
	label.length > 0 ? label : "your computer";

/**
 * The state, in priority order.
 *
 * Order is load-bearing: a refusal the user must resolve outranks a silence, and
 * a route that is simply not up yet outranks everything — a `C3` about a session
 * on a computer the app has not reached would be technically true and useless.
 */
export const connectionView = (input: ConnectionViewInput): ConnectionView => {
	/* A terminal session is not a connection state. Painting it as "not
	 * answering" would be a different lie, and it has its own affordance (resume). */
	if (input.ended) return NOTHING_VISIBLE;

	/* ---- the refusals the user must act on: C5, C6, C7 ---- */
	if (input.error !== null) {
		const refusal = refusalView(input.error, input);
		if (refusal !== null) return refusal;
	}

	/* The connection store's own verdict, for a route that failed before any
	 * per-session request could: the same surface, decided once. */
	if (input.phase === "refused") {
		if (input.phaseSurface === "sign-in" || input.phaseSurface === "password") {
			return view(
				"C5",
				input.phaseDetail ??
					`Your Radient session expired. Sign in to reconnect to ${computerName(input.computerLabel)}.`,
				"warning",
				{
					action: {
						kind: "sign-in",
						label: "Sign in again",
						testID: "connection-error-sign-in",
					},
					testIDs: ["connection-error-sign-in"],
				},
			);
		}
		const isConsole =
			input.phaseSurface === "console" || input.phaseSurface === "tunnel-gone";
		const isMachine = input.phaseSurface === "computer-offline";
		return view(
			isMachine ? "C7" : "C6",
			input.phaseDetail ??
				"The relay refused. Check the computer, then try again.",
			"danger",
			{
				action: isConsole
					? {
							kind: "console",
							label: "Open console",
							testID: "connection-error-console-link",
						}
					: {
							kind: "retry",
							label: "Check again",
							testID: "connection-error-retry-prominent",
						},
				testIDs: isMachine
					? [
							"connection-error-computer-offline",
							"connection-error-machine-remedy",
						]
					: isConsole
						? ["connection-error-console-link"]
						: ["connection-error-retry-prominent"],
			},
		);
	}

	/* ---- C4: no route at all. Only ever from a platform signal, because
	 * `null` (unknown) must not be painted as offline. ---- */
	if (input.online === false) {
		return view(
			"C4",
			"Offline. Messages will send when you’re back.",
			"danger",
		);
	}

	/* ---- C2: a transport error, or a reconnect that produced nothing ---- */
	if (input.lastEnd === "error") {
		return view("C2", "The connection dropped. Reconnecting…", "warning");
	}
	if (input.stream === "connecting" && input.reconnectExpired) {
		return view("C2", "Reconnecting…", "warning");
	}

	/* ---- C1: a clean EOF. NEVER visible, however long the open was. ---- */
	if (input.stream === "rotating" || input.stream === "stalled") {
		return NOTHING_VISIBLE;
	}

	/* ---- C3: an open stream that has gone quiet, or a snapshot that is old ---- */
	const quietFor =
		input.ageS !== null && input.ageS >= KEEPALIVE_GRACE_S ? input.ageS : null;
	if (quietFor !== null || input.stale) {
		const seconds = quietFor ?? input.ageS;
		return view(
			"C3",
			seconds === null
				? "Not answering."
				: `Not answering — last update ${agoLabel(seconds)} ago.`,
			"warning",
			{
				action: {
					kind: "retry",
					label: "Check again",
					testID: "connection-error-retry-prominent",
				},
			},
		);
	}

	/* A stream that is `connecting` and has not yet expired is a ROTATION being
	 * re-established: still nothing, because that is the case flow 08 asserts on. */
	return NOTHING_VISIBLE;
};

/**
 * A failure the reader must resolve.
 *
 * `surface` is the connection layer's pre-decision, so this function's whole job
 * is presentation: a tone, one remedy, and the anchors. `displayableMessage` is
 * the gateway's own sentence where there is one; a `diagnostic` surface has no
 * copy by design (a client bug), so it falls back to the retry the reader can act
 * on rather than a stack trace.
 */
const refusalView = (
	error: RelayError,
	input: ConnectionViewInput,
): ConnectionView | null => {
	const message = relaySentence(error);
	const name = computerName(input.computerLabel);

	switch (error.surface) {
		case "sign-in":
			/* The edge's 401 with `X-Radient-Login`: the CONNECTOR was reached, so
			 * this must never say "computer offline" (flow 09, family 3). One button,
			 * and the transcript stays. */
			return view(
				"C5",
				`Your Radient session expired. Sign in to reconnect to ${name}.`,
				"warning",
				{
					action: {
						kind: "sign-in",
						label: "Sign in again",
						testID: "connection-error-sign-in",
					},
					testIDs: ["connection-error-sign-in"],
				},
			);

		case "computer-offline":
			/* C7: the host stopped answering while the control plane still lists the
			 * tunnel. The remedy is machine-side; re-authenticating would be wrong. */
			return view(
				"C7",
				input.computerLastSeenS === null
					? `${name} isn’t answering.`
					: `${name} isn’t answering — last seen ${agoLabel(input.computerLastSeenS)} ago.`,
				"danger",
				{
					action: {
						kind: "retry",
						label: "Check again",
						testID: "connection-error-retry-prominent",
					},
					testIDs: [
						"connection-error-computer-offline",
						"connection-error-machine-remedy",
					],
				},
			);

		case "relay-stopped":
			return view(
				"C6",
				message ?? "The relay isn’t running on that computer.",
				"danger",
				{
					action: {
						kind: "console",
						label: "Open console",
						testID: "connection-error-console-link",
					},
					testIDs: [
						"connection-error-relay-not-installed",
						"connection-error-console-link",
					],
				},
			);

		case "tunnel-gone":
			return view(
				"C6",
				message ?? "That tunnel no longer exists. Set the computer up again.",
				"danger",
				{
					action: {
						kind: "console",
						label: "Open console",
						testID: "connection-error-console-link",
					},
					testIDs: [
						"connection-error-tunnel-unavailable",
						"connection-error-console-link",
					],
				},
			);

		case "console":
			/* The gateway's own sentence, verbatim, plus the remedy where it lives.
			 * `authorization_deferred` and `authorization_lease_pending` are the
			 * park-only states that clear themselves, and saying so is the whole
			 * difference between "wait" and "go and fix something". */
			return view(
				"C6",
				message ?? "The relay refused this request.",
				"danger",
				{
					action: {
						kind: "console",
						label: "Open console",
						testID: "connection-error-console-link",
					},
					testIDs: ["connection-error-console-link", ...waitingAnchors(error)],
				},
			);

		case "retry":
			return view(
				"C6",
				message ?? "The relay can’t be reached right now.",
				"warning",
				{
					action: {
						kind: "retry",
						label: "Check again",
						testID: "connection-error-retry-prominent",
					},
					testIDs: [
						"connection-error-retry-prominent",
						...waitingAnchors(error),
					],
				},
			);

		case "password":
			/* The custom route needs its relay password again; the route screen owns
			 * that form, so this only says so and lets the route screen take over. */
			return view(
				"C6",
				message ?? "This relay needs its password again.",
				"warning",
				{
					action: {
						kind: "sign-in",
						label: "Enter password",
						testID: "connection-error-sign-in",
					},
					testIDs: ["connection-error-sign-in"],
				},
			);

		case "diagnostic":
			/* A client bug: no copy by design, and never a loop. The reader still
			 * gets a retry, because being stuck is worse than being uninformed. */
			return view("C6", "Something went wrong. Try again.", "warning", {
				action: {
					kind: "retry",
					label: "Check again",
					testID: "connection-error-retry-prominent",
				},
			});

		case "none":
			/* The caller handles it silently. Falling through to `null` lets a later
			 * rule (a real silence, a real drop) speak instead of this one. */
			return null;

		default:
			return view(
				"C6",
				isRelayError(error) && message
					? message
					: "The relay can’t be reached right now.",
				"warning",
				{
					action: {
						kind: "retry",
						label: "Check again",
						testID: "connection-error-retry-prominent",
					},
				},
			);
	}
};

/** The two park-only gateway reasons, whose whole message is "this clears by
 *  itself". */
const waitingAnchors = (error: RelayError): string[] =>
	error.reason === "authorization_deferred" ||
	error.reason === "authorization_lease_pending"
		? ["connection-error-waiting", "connection-error-clears-by-itself"]
		: [];
