/**
 * How the session view lays itself out, as arithmetic rather than as a media query.
 *
 * The operator's requirement is that the app be usable from a 280 pt foldable cover
 * screen to a 1366 pt iPad Pro in landscape, and that a tablet use its space
 * deliberately rather than showing a phone column stretched across 1366 px. So the
 * decision is three values, derived purely, and pinned by a test:
 *
 *   - **`bucket`** — `compact` (a phone in portrait), `medium` (a phone in
 *     landscape, or a small tablet), `wide` (a tablet with room to spare).
 *   - **`twoPane`** — whether the panels get their own rail beside the transcript.
 *     Only when there is genuinely a second column's worth of room: a landscape
 *     phone is `medium` and stays one column, because 390 pt of height with a
 *     keyboard up is not a two-column surface.
 *   - **`measurePt`** — the cap on the transcript's line length. This is the one
 *     that matters most on a tablet: a paragraph 1366 px wide is unreadable, and the
 *     fix is a constrained column, not a stretched one.
 *
 * Orientation is read from the viewport rather than from a device API: a split-view
 * tablet is neither, and only the space actually available can answer the question.
 */

export type LayoutBucket = "compact" | "medium" | "wide";

export interface SessionLayout {
	bucket: LayoutBucket;
	/** The panels render in a rail beside the transcript instead of above it. */
	twoPane: boolean;
	/** The maximum width of the readable column, in points. */
	measurePt: number;
	/** The rail's width when `twoPane`, in points. */
	railPt: number;
}

/**
 * And below this HEIGHT it is a single column too.
 *
 * This is the half that is easy to miss and that a width test cannot express: a
 * phone in landscape is 844x390, which is wider than a 768 pt tablet in portrait —
 * but 390 pt of height with a soft keyboard up leaves no room for two panes, and a
 * rail there would take the transcript's width to give the reader a panel. So the
 * rule needs BOTH dimensions, which is why it is not a media query.
 */
const TWO_PANE_MIN_HEIGHT = 600;

/** The readable measure. ~66 characters of body text, which is the top of the
 *  comfortable range and the point at which a wider column starts costing accuracy
 *  rather than adding comfort. */
const MEASURE_PT = 720;
const RAIL_PT = 300;

/**
 * The rail appears only where a FULL readable measure still fits beside it.
 *
 * Derived rather than chosen, and measured against the space this view is GIVEN
 * rather than the window: inside a split view's detail pane a 1024 pt tablet
 * leaves ~660 pt, and a rail there would take the transcript's measure to show a
 * panel (the first tablet frames showed exactly that — a 520 pt transcript beside
 * ~830 pt of empty rail). Below this, the panels stack inside the measure-capped
 * column, which is the other deliberate use of a tablet's width.
 */
const TWO_PANE_MIN_WIDTH = MEASURE_PT + RAIL_PT;

/** The smallest viewport the app claims to support: a folded phone's cover screen.
 *  Named because a frame at this size is a matrix cell, not an accident. */
export const NARROWEST_PT = 280;

export const sessionLayout = (width: number, height: number): SessionLayout => {
	const twoPane = width >= TWO_PANE_MIN_WIDTH && height >= TWO_PANE_MIN_HEIGHT;
	/* The bucket describes the LAYOUT, not the pixel width: `wide` means the layout
	 * has a rail, so a 844 pt landscape phone is `medium` — it is wider than a tablet
	 * in portrait and still one column, which is exactly the distinction a width-only
	 * classification loses. */
	const bucket: LayoutBucket = twoPane
		? "wide"
		: width > height || width >= 600
			? "medium"
			: "compact";
	return {
		bucket,
		twoPane,
		// The measure is capped, never scaled: on a 1366 pt tablet the transcript stays
		// 720 pt wide and the remaining space is the rail's and the margins'.
		measurePt: Math.min(MEASURE_PT, width),
		railPt: RAIL_PT,
	};
};

/**
 * Whether the panels must share the vertical space with the transcript.
 *
 * One expanded panel at a time on a phone (the v1 rule), but a rail has room for
 * both: collapsing one to open the other is a phone constraint, and applying it on
 * a tablet hides information the reader came for.
 */
export const panelsAreExclusive = (layout: SessionLayout): boolean =>
	!layout.twoPane;
