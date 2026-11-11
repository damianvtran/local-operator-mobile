/**
 * Message-anchored thread opens: a push tap or a deep link that names ONE
 * message (`/team-bridge/<tenant>/<conversation>?messageId=<id>&seq=<n>`)
 * lands on that message instead of the newest edge.
 *
 * WHERE THE ANCHOR COMES FROM. The hub's push data already carries
 * `message_id` and `seq` (`push-payload.ts`, "THE WIRE"); `teamBridgeThreadPath`
 * forwards both as route params, and a deep link may carry either. Both are
 * validated with the push payload's own id/seq rules, so a malformed link
 * degrades to an ordinary open-at-newest, never a half-built anchor.
 *
 * HOW IT RESOLVES. The first page is the NEWEST page (#208), so an older
 * message needs history: `anchorStep` asks for older pages until the message
 * is held, history runs out, or — with a seq — the oldest held message is
 * already older than the anchor (the message was deleted; nothing further
 * back can be it). That walk is bounded by the thread itself, not by a guessed
 * page cap. A missing message falls back to open-at-newest.
 *
 * PURE, so every branch is a Node test.
 */

import type { Message } from "@/team-bridge/contract";

export interface ThreadAnchor {
	messageId: string | null;
	seq: number | null;
}

const ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const DOTS = /^\.+$/;
const SEQ = /^\d{1,15}$/;

const one = (value: string | string[] | undefined): string | undefined =>
	typeof value === "string" ? value : undefined;

export function parseThreadAnchor(params: {
	messageId?: string | string[];
	seq?: string | string[];
}): ThreadAnchor | null {
	const rawId = one(params.messageId);
	const messageId = rawId && ID.test(rawId) && !DOTS.test(rawId) ? rawId : null;
	const rawSeq = one(params.seq);
	const seqNumber = rawSeq && SEQ.test(rawSeq) ? Number(rawSeq) : NaN;
	const seq = Number.isSafeInteger(seqNumber) ? seqNumber : null;
	return messageId || seq !== null ? { messageId, seq } : null;
}

export const anchorMatches = (
	anchor: ThreadAnchor,
	message: Message,
): boolean =>
	anchor.messageId
		? message.id === anchor.messageId
		: message.seq === anchor.seq;

export type AnchorStep =
	/** Messages are still arriving (first page or an older page in flight). */
	| { kind: "wait" }
	/** The message is held: scroll to the row with this item key. */
	| { kind: "found"; messageId: string }
	/** Not held yet, more history exists and could contain it. */
	| { kind: "older" }
	/** Not in this thread (deleted, or a stale link): open at newest. */
	| { kind: "missing" };

export function anchorStep(
	anchor: ThreadAnchor,
	thread:
		| {
				messages: readonly Message[];
				state: "idle" | "loading" | "ready" | "error";
				hasMore: boolean;
				loadingOlder: boolean;
				olderError: unknown;
		  }
		| undefined,
): AnchorStep {
	if (!thread) return { kind: "wait" };
	const held = thread.messages.find((m) => anchorMatches(anchor, m));
	if (held) return { kind: "found", messageId: held.id };
	if (thread.state === "error" && !thread.messages.length)
		return { kind: "missing" };
	if (!thread.messages.length)
		return thread.state === "ready" ? { kind: "missing" } : { kind: "wait" };
	if (thread.loadingOlder) return { kind: "wait" };
	// A failed older page is not proof of absence, but retrying it in a loop
	// would spin; the reader gets the newest edge and the existing retry row.
	if (thread.olderError) return { kind: "missing" };
	if (!thread.hasMore) return { kind: "missing" };
	if (anchor.seq !== null) {
		const oldest = Math.min(...thread.messages.map((m) => m.seq));
		if (oldest <= anchor.seq) return { kind: "missing" };
	}
	return { kind: "older" };
}

/** How long the landed message keeps its highlight: long enough to find it. */
export const ANCHOR_HIGHLIGHT_MS = 2_400;
