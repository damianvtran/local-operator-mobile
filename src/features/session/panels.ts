/**
 * How tall a panel's roster body may be, as arithmetic rather than as a constant.
 *
 * The panel sits between a scrolling transcript and the composer, and on a short
 * phone the stack can outgrow the viewport: measured with the agents panel open at
 * 320×568, the document grew to 642 pt and the send button ended 16 pt BELOW the
 * fold — the one control the reader came for, off screen, because a roster body
 * asked for a fixed 256 pt (design round 2, D11).
 *
 * Two rules, both measured rather than chosen:
 *
 * - **A share of the viewport, not a constant.** A fixed cap cannot know whether
 *   the screen is a 568 pt phone or a 1024 pt tablet; a share keeps the transcript
 *   from being squeezed to nothing on the small one while leaving the tablet's
 *   roster roomy.
 * - **Whole rows only.** The body is a scroller, and a cap that lands mid-row shows
 *   a fragment — the cancelled row rendered as a lone `–` glyph above the working
 *   line, with no label and no cue that more was below (D12). Rounding DOWN to a
 *   row multiple means every visible row is a whole row; the caller says how many
 *   are hidden.
 */

/**
 * The row's height UNTIL the panel measures a real one.
 *
 * A roster row is content-driven: `min-h-11` (44) plus `py-1.5`, so a row with a
 * metadata line measures 49 pt and one without measures 44. A constant therefore
 * cannot promise "whole rows" — the promise D12 needs — so the panel feeds the
 * height its first row actually rendered at, and this is only the first-frame
 * estimate. It is the design round's own measured value (six 49 pt rows).
 */
export const ROSTER_ROW_PT = 49;

/** The old fixed cap, kept as an upper bound so a tall tablet does not grow a
 *  roster body the reader has to scan like a page. */
const ROSTER_CAP_PT = 256;

/** The share of the viewport the body may take. A third leaves the transcript its
 *  own room above and the composer its place below; at 568 pt that is 199 pt. */
const VIEWPORT_SHARE = 0.35;

/** Never fewer than this many rows: a body shorter than two rows is a reward for
 *  having a small screen rather than a working panel. */
const MIN_VISIBLE_ROWS = 2;

export interface RosterBody {
	/** The body's max height in pt — a whole number of rows, never a fragment. */
	maxHeight: number;
	visibleRows: number;
	/** How many rows the cap hides, for the caller's own "+N more" cue. */
	hiddenRows: number;
}

export const rosterBody = (input: {
	/** The viewport the panel is inside, in pt. */
	viewportHeight: number;
	rowCount: number;
	/** The row height as RENDERED, once the panel has measured one. The estimate is
	 *  used only before the first row lays out. */
	rowPt?: number;
}): RosterBody => {
	const rowPt = input.rowPt && input.rowPt > 0 ? input.rowPt : ROSTER_ROW_PT;
	const cap = Math.min(
		ROSTER_CAP_PT,
		Math.round(input.viewportHeight * VIEWPORT_SHARE),
	);
	const fits = Math.floor(cap / rowPt);
	// The floor is applied BEFORE the row count caps it, so a one-row roster gets a
	// one-row body: the minimum is a floor for a roster that needs it, not a demand
	// that a short roster reserve space it has nothing to put in. (The first cut had
	// these two the other way round, and a one-child roster reserved two rows.)
	const visibleRows = Math.min(
		input.rowCount,
		Math.max(MIN_VISIBLE_ROWS, fits),
	);
	return {
		maxHeight: visibleRows * rowPt,
		visibleRows,
		hiddenRows: Math.max(0, input.rowCount - visibleRows),
	};
};
