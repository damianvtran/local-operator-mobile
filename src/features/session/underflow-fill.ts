/**
 * Filling a short first window from older history (issue #322).
 *
 * THE FAILURE. Older pages load when the reader scrolls UP into the top band
 * (`historyTopReached`). A conversation whose live tail — the relay's 80-row
 * frame — is all peer receipts and tool rows folds into ONE quiet-group row
 * (`turn-condensing.ts`, `breaksPeerRun`), so the list is shorter than its
 * viewport, cannot scroll, and never pages: the earlier user and assistant
 * turns stay invisible behind a tiny edge mark, and a completion anchored in
 * them can never be seen.
 *
 * THE RULE. After the first placement, while the window is shorter than the
 * viewport OR shows no conversation row at all, page older on the reader's
 * behalf — one page at a time, at most `UNDERFLOW_FILL_PAGES` per opened
 * session, the automatic gap fill's own walk budget. The older edge stays: it
 * is the spinner while a page is in flight and the manual way past the budget.
 *
 * Pure, so the decision is testable without a renderer; `TranscriptList` owns
 * the geometry it is fed from (`use-underflow-fill.ts`).
 */

import { FRAME_CAP, HEAL_BUDGET } from "@/features/session/history-window";
import type { TranscriptItem } from "@/features/session/turn-condensing";

/** Pages one opened session may pull without the reader asking: the
 *  automatic gap fill's five round trips (`HEAL_BUDGET`), so neither walk can
 *  hold the radio and the relay longer than the other. */
export const UNDERFLOW_FILL_PAGES = HEAL_BUDGET.pages;

/** What the history reader knows about older rows, as plain facts
 *  (`HistoryWindow`'s fields plus the live frame's shape). */
export interface OlderFillEvidence {
	/** The newest-page read: older paging before it lands would page from a
	 *  cursor the refresh is about to move. */
	read: "unknown" | "ok" | "failed";
	/** Any history read in flight, newest refresh included. */
	loading: boolean;
	/** False once an older page answered `has_more: false`. */
	hasMore: boolean;
	/** `more` once a before-page said so; a newest page is no verdict. */
	olderState: "unknown" | "more" | "end";
	/** Rows in the live frame. */
	frameRows: number;
	/** `transcript_head_pinned`, absent on an older relay. */
	frameHeadPinned: boolean | undefined;
}

/**
 * Whether an automatic older read is warranted at all.
 *
 * `hasMore` starts TRUE before any older page has answered, so it alone would
 * page every short conversation once on open. A live frame under the relay's
 * cap (opener + 79 rows) is the whole conversation; only a frame at the cap,
 * one that says it pinned its opener, or a before-page that said "more" can
 * have older rows behind it.
 */
export const olderFillReady = (evidence: OlderFillEvidence): boolean =>
	evidence.read === "ok" &&
	!evidence.loading &&
	evidence.hasMore &&
	(evidence.olderState === "more" ||
		evidence.frameHeadPinned === true ||
		evidence.frameRows >= FRAME_CAP - 1);

/** A row a reader recognises as the conversation: their own message or steer,
 *  or an answer with words in it. Peer receipts, tool rows, reasoning and
 *  textless assistant rows are what folds into the quiet group, so a window of
 *  only those has not shown the reader anything they came to read. */
export const showsConversation = (items: readonly TranscriptItem[]): boolean =>
	items.some(
		(item) =>
			item.kind === "entry" &&
			(item.entry.kind === "user" ||
				item.entry.kind === "steer" ||
				(item.entry.kind === "assistant" && item.entry.text.trim() !== "")),
	);

/** The geometry and progress facts one decision reads. */
export interface UnderflowFacts {
	/** The list's initial tail placement is spent for this session. */
	positioned: boolean;
	/** `olderFillReady`. */
	olderReady: boolean;
	/** A history read failed; the edge's "Try again" owns recovery. */
	hasError: boolean;
	/** Content height measured for the CURRENT items, or `null` when the rows
	 *  changed since the last measurement — unknown never reads as short. */
	contentPt: number | null;
	viewportPt: number;
	/** `showsConversation` over the rendered items. */
	conversationShown: boolean;
	/** Older pages this session's fill has already requested. */
	pagesFilled: number;
}

/** Whether to request one more older page now. A list no taller than its
 *  viewport cannot be scrolled into the top band, so it can never page by
 *  itself; a window with no conversation row keeps paging even when tall. */
export const shouldFillUnderflow = (facts: UnderflowFacts): boolean => {
	if (
		!facts.positioned ||
		!facts.olderReady ||
		facts.hasError ||
		facts.pagesFilled >= UNDERFLOW_FILL_PAGES
	)
		return false;
	if (!facts.conversationShown) return true;
	return (
		facts.contentPt !== null &&
		facts.viewportPt > 0 &&
		facts.contentPt <= facts.viewportPt
	);
};

/** One decision's live inputs, read from the list at the moment it asks. */
export interface UnderflowInput {
	sessionId: string;
	/** The rendered items, by identity: a new array is new rows. */
	items: readonly TranscriptItem[];
	positioned: boolean;
	olderReady: boolean;
	hasError: boolean;
	viewportPt: number;
}

/**
 * The list's fill bookkeeping, outside React so it is testable in Node.
 *
 * - A HEIGHT BELONGS TO ITS ROWS. `onContentSizeChange` reports content for
 *   the rows that laid out; a page that just arrived has not laid out yet, so
 *   its stale height would read as "still short" and pull a page the screen no
 *   longer needs. The height counts only while the items are the ones it was
 *   measured with.
 * - ONE REQUEST PER ARRIVAL. `loadOlder` flips the reader to loading
 *   synchronously, but the props that say so arrive on the next render; a
 *   second look at the same rows before then must neither send nor count a
 *   page.
 * - ONE BUDGET PER OPENED SESSION. A different session starts its own.
 */
export class UnderflowFill {
	private session: string | null = null;
	private pages = 0;
	private measuredItems: readonly TranscriptItem[] | null = null;
	private contentPt = 0;
	private askedAt: readonly TranscriptItem[] | null = null;

	measured(items: readonly TranscriptItem[], contentPt: number): void {
		this.measuredItems = items;
		this.contentPt = contentPt;
	}

	/** Whether to request one older page now; a `true` is counted. */
	next(input: UnderflowInput): boolean {
		if (this.session !== input.sessionId) {
			this.session = input.sessionId;
			this.pages = 0;
			this.askedAt = null;
		}
		if (this.askedAt === input.items) return false;
		const fill = shouldFillUnderflow({
			positioned: input.positioned,
			olderReady: input.olderReady,
			hasError: input.hasError,
			contentPt: this.measuredItems === input.items ? this.contentPt : null,
			viewportPt: input.viewportPt,
			conversationShown: showsConversation(input.items),
			pagesFilled: this.pages,
		});
		if (!fill) return false;
		this.pages += 1;
		this.askedAt = input.items;
		return true;
	}
}
