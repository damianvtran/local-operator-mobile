/**
 * The session-link existence check's one decision, kept pure.
 *
 * A `localoperator://s/<id>` link is navigated by the router on the way in, and
 * the resolver's job at `live` is to repair it — which includes the case a
 * stale link creates: a conversation that was deleted (or never existed on the
 * connected computer) must land somewhere sensible, not on a screen whose empty
 * state invites sending "the first message" to a conversation that is gone.
 *
 * The check is the relay's own existence route (`GET /api/sessions/{id}/history`,
 * `contract.md` §3.5): a LIVE generation **or** a durable user session answers,
 * and anything else is the relay's own clean `404 {"error": "unknown session"}`
 * — the one failure that is PROOF of absence rather than an inference from a
 * list that may not have painted yet. Everything else (a transport drop, a
 * refusal, a timeout) is NOT proof — including the edge's `404 unknown tunnel
 * host`, which shares the status code and means the computer is unreachable,
 * not that the conversation is gone — so none of them may borrow the "no longer
 * there" sentence.
 *
 * `sessionLinkOutcome` is the whole of that mapping, here so the two sentences
 * the resolver chooses between are decided by a function a test can drive
 * without a router, a connection, or a relay.
 */

import { isRelayMissing } from "@/relay";

export type SessionLinkOutcome = "exists" | "missing" | "failed";

/** The verdict for a history read that THREW. A caller passes the error as
 *  caught; a non-relay shape (a TypeError, an abort) is `failed`, never
 *  `missing` — silence must not be read as absence. Absence is the relay's own
 *  `404` and only that (`isRelayMissing`): the kind check is what keeps the
 *  edge's `unknown-tunnel` refusal, a fact about the TUNNEL, from reading as a
 *  fact about the conversation. */
export function sessionLinkOutcome(error: unknown): "missing" | "failed" {
	return isRelayMissing(error) ? "missing" : "failed";
}
