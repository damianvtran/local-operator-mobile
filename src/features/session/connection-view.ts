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

import type { ErrorSurface, RelayError, StreamState } from "@/relay";
import type { ConnectionPhase, ProjectionEntry } from "@/state";
import { CONTROL, SURFACE } from "@/ui/a11y";

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

/**
 * How long to wait before reconnecting a dropped stream.
 *
 * Doubling from one second to the ceiling the web client uses (`store.ts`:
 * `BACKOFF_MIN_MS` 1000 → `BACKOFF_MAX_MS` 15000). A fixed retry against a relay
 * that is down for hours is a hot loop against a phone's radio and its battery;
 * the ceiling keeps a long outage cheap, while the first retry still lands inside
 * the second a reader expects. `retryAfterMs` — the gateway's own advice for a
 * typed refusal — always wins when the error carries one, because the server
 * knows its own recovery time better than a curve does.
 *
 * `attempts` is the count of consecutive failures, reset by any delivered frame.
 */
export const RECONNECT_BACKOFF_MIN_MS = 1_000;
export const RECONNECT_BACKOFF_MAX_MS = 15_000;

export const reconnectDelay = (
	attempts: number,
	retryAfterMs: number | undefined,
): number => {
	if (retryAfterMs !== undefined) return retryAfterMs;
	/* Clamped before the shift: `2 ** 40` is fine in JavaScript but the guard keeps a
	 * counter that somehow ran away from producing `Infinity` and a `setTimeout`
	 * that never fires. */
	const steps = Math.min(Math.max(attempts, 0), 8);
	return Math.min(
		RECONNECT_BACKOFF_MAX_MS,
		RECONNECT_BACKOFF_MIN_MS * 2 ** steps,
	);
};

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
/**
 * The sentence a screen may show for a failure.
 *
 * `displayableMessage` IS the accessor for this — the error layer's own, which
 * publishes a sentence for every arm it writes and refuses the three things that
 * are not copy (a runtime's prose, an empty body, and a body that is markup).
 * Reading `detail`/`serverError` here instead was a second interpretation of the
 * same fields, and it lost the sentences that live on the MESSAGE: a rejected
 * certificate and an unresolved host both carry their own copy there, so the
 * screen fell back to "The relay could not be reached." for two failures whose
 * remedies are different — the one thing an address-level failure must say is
 * which address, or which certificate.
 */
export const relaySentence = (error: RelayError): string | undefined => {
	const sentence = error.displayableMessage.trim();
	return sentence === "" ? undefined : sentence;
};

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
						testID: CONTROL.connectionSignIn,
					},
					testIDs: [CONTROL.connectionSignIn],
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
							testID: CONTROL.connectionConsole,
						}
					: {
							kind: "retry",
							label: "Check again",
							testID: CONTROL.connectionRetry,
						},
				testIDs: isMachine
					? [SURFACE.connectionComputerOffline, SURFACE.connectionMachineRemedy]
					: isConsole
						? [CONTROL.connectionConsole]
						: [CONTROL.connectionRetry],
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

	/* ---- C2 again: an OPEN stream that has produced no frame at all. ----
	 * The flows table's second C2 trigger is "no frame after a rotation", and an
	 * open socket that has sent nothing past the reconnect deadline is that case
	 * with the socket still up: the silence watchdog will reopen it, but until the
	 * window elapses the reader gets no state at all — an open stream with an empty
	 * transcript, which looks like loading forever. `ageS === null` is the fact that
	 * says "not one frame since this connection opened". */
	if (
		input.stream === "open" &&
		input.ageS === null &&
		input.reconnectExpired
	) {
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
					testID: CONTROL.connectionRetry,
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

	/* A typed gateway refusal is `C6` whatever its surface says, because the flows'
	 * C6 row is "503 + a typed `RELAY_DETAIL` reason → the gateway's own sentence +
	 * one remedy", and `reason` is exactly what makes it typed. Routing these by
	 * surface alone put `control_plane_unreachable` under `C7` — the computer
	 * asleep — when its own sentence says the computer could not reach RADIENT,
	 * which is a different fault with a different fix. The surface still chooses
	 * the REMEDY: the console where the fix lives there, a retry where the cause
	 * clears by itself. */
	if (error.kind === "gateway-refused" && error.reason !== undefined) {
		const isConsole = error.surface === "console";
		return view("C6", message ?? "The relay refused this request.", "danger", {
			action: isConsole
				? {
						kind: "console",
						label: "Open console",
						testID: CONTROL.connectionConsole,
					}
				: {
						kind: "retry",
						label: "Check again",
						testID: CONTROL.connectionRetry,
					},
			testIDs: [
				...(isConsole
					? [CONTROL.connectionConsole]
					: [CONTROL.connectionRetry]),
				...waitingAnchors(error),
			],
		});
	}

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
						testID: CONTROL.connectionSignIn,
					},
					testIDs: [CONTROL.connectionSignIn],
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
						testID: CONTROL.connectionRetry,
					},
					testIDs: [
						SURFACE.connectionComputerOffline,
						SURFACE.connectionMachineRemedy,
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
						testID: CONTROL.connectionConsole,
					},
					testIDs: [
						SURFACE.connectionRelayNotInstalled,
						CONTROL.connectionConsole,
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
						testID: CONTROL.connectionConsole,
					},
					testIDs: [
						SURFACE.connectionTunnelUnavailable,
						CONTROL.connectionConsole,
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
						testID: CONTROL.connectionConsole,
					},
					testIDs: [CONTROL.connectionConsole, ...waitingAnchors(error)],
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
						testID: CONTROL.connectionRetry,
					},
					testIDs: [CONTROL.connectionRetry, ...waitingAnchors(error)],
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
						testID: CONTROL.connectionSignIn,
					},
					testIDs: [CONTROL.connectionSignIn],
				},
			);

		case "diagnostic":
			/* A client bug: no copy by design, and never a loop. The reader still
			 * gets a retry, because being stuck is worse than being uninformed. */
			return view("C6", "Something went wrong. Try again.", "warning", {
				action: {
					kind: "retry",
					label: "Check again",
					testID: CONTROL.connectionRetry,
				},
			});

		case "connection": {
			/* The two address-level failures. They are distinct because their REMEDIES
			 * are, and one of them must not offer a retry at all: a rejected certificate
			 * presents the same certificate again, so a "Check again" control would be a
			 * loop that looks like progress — the failure the design kit calls a control
			 * that cannot work. Its remedy is in the route's own settings, which is where
			 * the console is. An unresolved host may be a resolver timeout that clears by
			 * itself, so it keeps the retry, and says which address it could not find.
			 *
			 * The decision reads the KIND, not `retry`: the directive is a POLICY the
			 * error layer allows a caller to override, and this screen's rule is about
			 * the failure itself — a certificate that was rejected is rejected whatever
			 * a caller asks for. */
			const certificate = error.kind === "certificate-rejected";
			return view(
				"C6",
				message ?? "The relay could not be reached.",
				"danger",
				{
					action: certificate
						? {
								kind: "console",
								label: "Open console",
								testID: CONTROL.connectionConsole,
							}
						: {
								kind: "retry",
								label: "Check again",
								testID: CONTROL.connectionRetry,
							},
					testIDs: [
						certificate
							? SURFACE.connectionCertificateRejected
							: SURFACE.connectionHostUnresolved,
						certificate ? CONTROL.connectionConsole : CONTROL.connectionRetry,
					],
				},
			);
		}

		case "none":
			/* The caller handles it silently. Falling through to `null` lets a later
			 * rule (a real silence, a real drop) speak instead of this one. */
			return null;
	}
};

/** The two park-only gateway reasons, whose whole message is "this clears by
 *  itself". */
const waitingAnchors = (error: RelayError): string[] =>
	error.reason === "authorization_deferred" ||
	error.reason === "authorization_lease_pending"
		? [SURFACE.connectionWaiting, SURFACE.connectionClearsByItself]
		: [];
