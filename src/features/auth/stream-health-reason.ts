import type { RelayError } from "@/relay";

/**
 * The raw reason code behind the stream's health — the INPUT that turned a
 * route's word into "Not answering" (Settings › Status, the drawer pill) or
 * "Asleep" (the computer switcher and its entry points).
 *
 * Why this exists: a teammate's phone showed "Asleep"/"Not answering" while his
 * Mac reported healthy, and the in-app Diagnostics could not say WHICH degraded
 * input the app had received. The provider set `streamHealth = "degraded"` from
 * two very different inputs — a keep-alive silence (`stalled`) and a retryable
 * relay error — and kept neither: the retryable branch never reached
 * `noteError`, so "Last error" stayed empty for exactly the case being debugged.
 * This carries the code through to the Diagnostics row.
 *
 * Constraints:
 *  - The code is a machine identifier and is shown UNTRANSLATED (it is what a
 *    support thread greps for); only the row's label is keyed.
 *  - It is never a token, URL or body: every value below is either one of the
 *    two stream states named here, a `RelayErrorKind`, a gateway `reason`, or a
 *    relay `code`/`error` identifier — none of which carry secrets.
 */
export type StreamHealthReason = string;

/** The stream was open but silent past the keep-alive grace window (`sse.ts`
 *  `stalled`): the relay stopped forwarding while the socket stayed up. */
export const STREAM_STALLED_REASON = "stream_stalled";
/** The stream closed with no typed error to explain it (`sse.ts` `closed`). */
export const STREAM_CLOSED_REASON = "stream_closed";

/**
 * The most specific raw code a relay error carries, most specific first:
 *  1. `reasonRaw` — the body's `reason` verbatim, including one this build does
 *     not know (so a newer gateway's reason is visible rather than lost);
 *  2. `reason` — a known gateway reason (`control_plane_unreachable`, …);
 *  3. `code` — a relay/gateway typed `code` (`operator_authority_required`, …);
 *  4. `serverError` — the body's `error`, e.g. a relay's `relay_unreachable`;
 *  5. `kind` — the client's own taxonomy (`transport`, `computer-offline`,
 *     `relay-down`, …), which every `RelayError` has, so this never answers
 *     empty.
 *
 * Every value that came off the WIRE (1, 3, 4) must be identifier-shaped to be
 * shown: a free-text sentence ("authentication required") is copy, not a code,
 * and an unbounded body string is how a proxy's page or anything else a
 * responder put there would reach a screen whose footer promises "never a token,
 * a password, or a session's content". A value that fails the shape falls
 * through to the next, ending at `kind`.
 */
export function reasonCodeOf(
	error: Pick<
		RelayError,
		"reasonRaw" | "reason" | "code" | "serverError" | "kind"
	>,
): StreamHealthReason {
	if (isIdentifier(error.reasonRaw)) return error.reasonRaw;
	if (error.reason) return error.reason;
	if (isIdentifier(error.code)) return error.code;
	if (isIdentifier(error.serverError)) return error.serverError;
	return error.kind;
}

/** A bare identifier: what a machine-readable code looks like, as opposed to a
 *  sentence such as `authentication required`. 64 characters at most. */
const IDENTIFIER = /^[a-z][a-z0-9_.-]{0,63}$/;
const isIdentifier = (value: string | undefined): value is string =>
	value !== undefined && IDENTIFIER.test(value);

/**
 * What the Diagnostics "Reason" row shows: the stream's own reason while the
 * stream is unhealthy, else the last typed error's code (the refusal path that
 * makes the switcher say "Asleep" goes through `noteError`, so it lives there),
 * else nothing.
 *
 * The health check matters: a reason left over from a stall that has since
 * recovered would be a stale fact presented as a current one.
 */
export function diagnosticReason(input: {
	health: "idle" | "connecting" | "live" | "degraded" | "offline";
	healthReason: StreamHealthReason | null;
	lastError: Pick<
		RelayError,
		"reasonRaw" | "reason" | "code" | "serverError" | "kind"
	> | null;
}): StreamHealthReason | null {
	const unhealthy =
		input.health === "degraded" ||
		input.health === "offline" ||
		input.health === "connecting";
	if (unhealthy && input.healthReason) return input.healthReason;
	if (input.lastError) return reasonCodeOf(input.lastError);
	return null;
}

/**
 * The next reason for a stream status transition. Pure so the rule is testable
 * without mounting the provider:
 *  - `stalled` names itself;
 *  - `closed` keeps an error's more specific code if one already arrived (the
 *    error and the close are reported for the same failure, in either order);
 *  - `connecting` keeps the previous reason, so a reconnect loop still shows WHY
 *    it is reconnecting instead of blanking between attempts;
 *  - a healthy (`open`/`rotating`) or `idle` stream has no reason.
 */
export function reasonForStatus(
	state: "idle" | "connecting" | "open" | "rotating" | "stalled" | "closed",
	previous: StreamHealthReason | null,
): StreamHealthReason | null {
	switch (state) {
		case "stalled":
			return STREAM_STALLED_REASON;
		case "closed":
			return previous ?? STREAM_CLOSED_REASON;
		case "connecting":
			return previous;
		case "open":
		case "rotating":
		case "idle":
			return null;
	}
}
