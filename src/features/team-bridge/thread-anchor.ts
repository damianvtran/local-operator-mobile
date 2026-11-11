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
 * back can be it). The thread itself ends the walk; `ANCHOR_WALK_MAX_PAGES`
 * and `ANCHOR_WALK_BUDGET_MS` (in `use-thread-anchor.ts`) only stop a very
 * deep one from holding a hidden thread. A missing message falls back to
 * open-at-newest, and says why (`MissingReason`), so the reader is told
 * "no longer available" only when history proved it.
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
	/** Not landing on it: open at newest (`MissingReason` says why). */
	| { kind: "missing"; reason: MissingReason };

/**
 * WHY an anchor fell back. `gone` is PROVEN absence — history ran out, or a
 * seq walk passed the message's place — so the reader can be told it is no
 * longer available. `unloaded` is NOT proof: a failed page, a failed first
 * read or the walk's own bound. Claiming "no longer available" then would be
 * false, so it falls back silently (round-1 U1-1 / U1-2).
 */
export type MissingReason = "gone" | "unloaded";

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
		return { kind: "missing", reason: "unloaded" };
	if (!thread.messages.length)
		return thread.state === "ready"
			? { kind: "missing", reason: "gone" }
			: { kind: "wait" };
	// A seq beyond the newest held message is not proof of deletion: it may be
	// newer than the page just read (a push outrunning the read) or a bad link.
	// Open at newest, silently — the pre-remediation `seq=999` landing.
	if (
		anchor.seq !== null &&
		anchor.seq > Math.max(...thread.messages.map((m) => m.seq))
	)
		return { kind: "missing", reason: "unloaded" };
	if (thread.loadingOlder) return { kind: "wait" };
	// A failed older page is not proof of absence, but retrying it in a loop
	// would spin; the reader gets the newest edge and the existing retry row.
	if (thread.olderError) return { kind: "missing", reason: "unloaded" };
	if (!thread.hasMore) return { kind: "missing", reason: "gone" };
	if (anchor.seq !== null) {
		const oldest = Math.min(...thread.messages.map((m) => m.seq));
		if (oldest <= anchor.seq) return { kind: "missing", reason: "gone" };
	}
	return { kind: "older" };
}

/** How long the landed message keeps its highlight: long enough to find it. */
export const ANCHOR_HIGHLIGHT_MS = 2_400;

/**
 * Where the landed row sits (round-1 D3 / U1-4 / Q1-3). "Jump to newest"
 * floats over the list's foot after a landing: a 48 px pill plus the dock's
 * `pb-2` (8 px) above the composer, so the bottom `JUMP_PILL_CLEARANCE` px of
 * the list are covered. At 320 px wide and 200 % text the upper-third default
 * put the anchored message's last line under that pill.
 *
 * React Native's `scrollToIndex` puts a row's top at
 * `viewPosition * (viewport - row) + viewOffset` from the list's top edge
 * (VirtualizedList `scrollToIndex`), which is just under the header. So:
 * - unknown height, or a row that fits at the upper third and still clears
 *   the pill by `ANCHOR_GAP`: the default, so ordinary sizes (390 px, 100 %)
 *   land exactly where they did;
 * - a row that fits the band but not at the upper third: raised until its
 *   bottom clears the pill by `ANCHOR_GAP`;
 * - a row taller than the band: top-aligned `ANCHOR_GAP` under the header,
 *   so the reader starts at its first line (the rest is a scroll away).
 * Pure, so the geometry is a Node test rather than a pixel hunt.
 */
export const ANCHOR_VIEW_POSITION = 0.3;
export const JUMP_PILL_CLEARANCE = 48 + 8;
export const ANCHOR_GAP = 8;

export function anchorPlacement(
	rowHeight: number | null,
	viewportHeight: number,
): { viewPosition: number; viewOffset: number } {
	const fallback = { viewPosition: ANCHOR_VIEW_POSITION, viewOffset: 0 };
	if (rowHeight === null || rowHeight <= 0 || viewportHeight <= 0)
		return fallback;
	const bottomLimit = viewportHeight - JUMP_PILL_CLEARANCE - ANCHOR_GAP;
	if (rowHeight > bottomLimit - ANCHOR_GAP)
		return { viewPosition: 0, viewOffset: ANCHOR_GAP };
	const free = viewportHeight - rowHeight;
	if (ANCHOR_VIEW_POSITION * free + rowHeight <= bottomLimit) return fallback;
	return { viewPosition: (bottomLimit - rowHeight) / free, viewOffset: 0 };
}
