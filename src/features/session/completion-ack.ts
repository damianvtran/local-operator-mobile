/**
 * The ack-on-view decision logic, in the pure: when MAY an attempt go out, how
 * long to wait after a refusal, and whether an answer settles the completion it
 * was about.
 *
 * Separated from the hook (`use-completion-ack.ts`) so the transitions the web
 * client learned the hard way are testable in this repo's Node-only suite — the
 * hook itself imports `expo-router`/`react-native` and is exercised by the web
 * harness and QA instead. The three functions are the hook's entire judgement;
 * everything left in the hook is plumbing.
 */

import type { CompletionAttention } from "@/contracts";

/** The flat poll cadence while the completion has not been acknowledged. */
export const ACK_CHECK_MS = 500;
/** Consecutive refusals before the cadence starts backing off. */
export const ACK_FAILURES_BEFORE_BACKOFF = 3;
/** Ceiling on the backed-off cadence: ~1 attempt/minute, not ~7,200/hour. */
export const ACK_MAX_BACKOFF_MS = 60_000;

/** The delay to impose after `refusals` consecutive unresolved outcomes, or `0`
 *  while the flat cadence still applies. The web's formula, kept identical:
 *  3 refusals ⇒ 1 s, then doubling, capped at one minute. */
export function retryDelayMs(refusals: number): number {
	if (refusals < ACK_FAILURES_BEFORE_BACKOFF) return 0;
	return Math.min(
		ACK_MAX_BACKOFF_MS,
		ACK_CHECK_MS * 2 ** (refusals - ACK_FAILURES_BEFORE_BACKOFF + 1),
	);
}

/** Every gate of one attempt, as facts. */
export interface AckGates {
	/** `AppState === "active"` — a backgrounded app is not a reader. */
	appActive: boolean;
	/** The session screen is the focused route. */
	focused: boolean;
	/** A sheet or panel holds the screen (the web's `blocked`). */
	blocked: boolean;
	/** The completion's end is on screen (`TranscriptList`'s measurement). */
	anchorVisible: boolean;
	/** The anchored completion's representation is complete — `final &&
	 *  text_complete`, the web selector's `data-completion-complete` half.
	 *  Settled streaming is NOT the same fact: transport caps can leave the row
	 *  a prefix while keeping its message id (`docs/relay/contract.md`), and
	 *  acknowledging one would acknowledge a result the reader has not seen the
	 *  end of. A row that is not loaded resolves to NOT complete, the same
	 *  direction as unknown geometry. */
	completionComplete: boolean;
	streaming: boolean;
	unseen: boolean;
	/** The attention names a `completion_token`. */
	hasToken: boolean;
	/** And an `anchor_id` — without one there is no row to have seen. */
	hasAnchor: boolean;
	/** `projection.session_id` and the attention's `conversation_id` both name
	 *  this screen's session: identity is part of the verdict, never assumed. */
	sameConversation: boolean;
	/** There is a relay client to send the acknowledgement through. */
	hasClient: boolean;
}

export function mayAcknowledge(gates: AckGates): boolean {
	return (
		gates.appActive &&
		gates.focused &&
		!gates.blocked &&
		gates.anchorVisible &&
		gates.completionComplete &&
		!gates.streaming &&
		gates.unseen &&
		gates.hasToken &&
		gates.hasAnchor &&
		gates.sameConversation &&
		gates.hasClient
	);
}

/** Whether the answer settles the completion this attempt was about: the three
 *  fields the contract says to read, and nothing else. A resolved call is not a
 *  read — an older daemon answered a superseded token with a 200 whose state
 *  still said `unseen`, and latching on the resolution is what left the "new"
 *  mark on for good. */
export function settlesCompletion(
	answer: Pick<
		CompletionAttention,
		"conversation_id" | "completion_token" | "unseen"
	>,
	expected: { conversationId: string; token: string },
): boolean {
	return (
		answer.unseen === false &&
		answer.conversation_id === expected.conversationId &&
		answer.completion_token === expected.token
	);
}
