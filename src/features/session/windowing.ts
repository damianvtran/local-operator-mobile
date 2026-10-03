/**
 * The transcript's windowing policy, as arithmetic rather than as vibes.
 *
 * A live transcript is the one list in this app that can be hundreds of rows long
 * (the relay's own `long-transcript` scenario is 520), and every row can change
 * height as it streams. So the list has to be virtualised — and a virtualised list
 * has exactly one number that decides both its memory footprint and its smoothness:
 * how many rows are mounted at once.
 *
 * That number is derived here, as a pure function of the viewport, so it is a
 * pinned property rather than a hope. The reason it needs pinning at all is that
 * the failure is invisible in both directions: too few mounted rows and the reader
 * scrolls into blank space on a fast flick, too many and a 520-row transcript
 * mounts 520 row trees, each of which is re-rendered by the next streamed frame.
 *
 * `TARGET_MOUNTED_ROWS` is the ceiling, and the window is expressed in FLATLIST'S
 * OWN units (`windowSize` counts viewport heights, not rows) so the derived value
 * can be handed straight to the component. Mounting a whole screen plus a screen
 * either side is what keeps a flick ahead of the renderer without keeping the
 * conversation in memory.
 */

/** The estimate for one row. Rows vary — an expanded tool row is many times this —
 *  and the number that matters is the COUNT of mounted rows, which this only has
 *  to get the right order of magnitude for. Taken from the tool row's line box,
 *  which is the most common row in a long transcript. */
export const ESTIMATED_ROW_PT = 44;

/** Never mount more than this, whatever the viewport. */
export const TARGET_MOUNTED_ROWS = 60;

/** At least this many rows, so a short transcript is fully rendered and a tall
 *  viewport does not open on a half-empty screen. */
export const MIN_INITIAL_ROWS = 12;

/** FlatList's own bounds for `windowSize`, in viewport heights. Below 3 a flick
 *  outruns the renderer; above 11 the ceiling above is unreachable anyway. */
const MIN_WINDOW_SIZE = 3;
const MAX_WINDOW_SIZE = 11;

export interface WindowPolicy {
	initialNumToRender: number;
	maxToRenderPerBatch: number;
	windowSize: number;
	/** How many rows the policy expects to have mounted, for the test that pins
	 *  it and for a diagnostic line. */
	estimatedMountedRows: number;
}

/** How many rows fit on screen, from the viewport. At least one. */
export const estimateVisibleRows = (viewportPt: number): number =>
	Math.max(1, Math.ceil(viewportPt / ESTIMATED_ROW_PT));

/**
 * The window for a viewport and a transcript length.
 *
 * `viewportPt` should be the transcript list's own height, not the screen's: the
 * header, panels and composer all take their share first, and using the screen
 * height would over-estimate by roughly half on a phone with a pending card open.
 *
 * `windowSize` is `floor`, not `ceil`, so the ceiling holds from below: the mounted
 * count is roughly `visible × windowSize`, and rounding up on a 320 pt viewport
 * overshoots the budget by a whole screen. `MIN_WINDOW_SIZE` is still allowed to
 * exceed the budget on a large viewport (a 1112 pt tablet mounts ~78 by this rule),
 * and that is deliberate: a window smaller than three screens on a tall display is
 * the worse failure — the reader flicks into blank space — and mounting ~80 short
 * rows is not what makes a tablet slow.
 */
export const windowPolicy = (
	viewportPt: number,
	rowCount: number,
): WindowPolicy => {
	const visible = estimateVisibleRows(viewportPt);
	const windowSize = Math.min(
		MAX_WINDOW_SIZE,
		Math.max(MIN_WINDOW_SIZE, Math.floor(TARGET_MOUNTED_ROWS / visible)),
	);
	const initialNumToRender = Math.min(
		rowCount,
		Math.max(MIN_INITIAL_ROWS, visible),
	);
	const maxToRenderPerBatch = Math.max(4, Math.ceil(visible / 2));
	const estimatedMountedRows = Math.min(
		rowCount,
		Math.max(initialNumToRender, visible * windowSize),
	);
	return {
		initialNumToRender,
		maxToRenderPerBatch,
		windowSize,
		estimatedMountedRows,
	};
};
