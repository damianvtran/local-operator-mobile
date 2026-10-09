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

/* ------------------------------------------------------------ layout facts --
 *
 * The three numbers the list needs to OPEN AT THE TAIL before its first paint:
 * where to start rendering, what offset each row is at, and where the end of
 * the content is. They are arithmetic over the height cache rather than props
 * to a component, because the failure they prevent — a first frame drawn from
 * the top of a 520-row conversation and then scrolled — is silent in a test and
 * obvious in a still.
 *
 * THE CACHE IS THE HONEST HALF. `FlatList` needs `getItemLayout` to place the
 * list anywhere other than the top, and that function must answer for rows that
 * have never laid out. The answer here is the row's own last measured height
 * when it has one, and `ESTIMATED_ROW_PT` when it does not. The estimate is
 * deliberately the SMALL side of the real distribution (a text row is taller
 * than a tool row's line box): an under-estimate leaves the reader short of the
 * content's end while the rows above them mount, which resolves as they scroll
 * and measure; the other direction is content the reader can scroll into and
 * find blank, which is the failure `windowing`'s own note rejects. Rows the
 * reader has actually seen are all measured, and a rendered row writes its
 * height into the cache on every layout, so the estimate only ever covers the
 * middle of a conversation nobody has looked at yet.
 */

/** One row's metrics, in the shape `getItemLayout` returns. */
export interface RowLayout {
	length: number;
	offset: number;
	index: number;
}

/** What one row occupies: its measured height, or the estimate. */
export const rowHeightPt = (
	id: string | undefined,
	heights: ReadonlyMap<string, number>,
): number =>
	(id === undefined ? undefined : heights.get(id)) ?? ESTIMATED_ROW_PT;

/**
 * The layout of one rendered row, from the top of the content.
 *
 * `itemIdAt` is the rendered item's id at an index (a `transcript-row-…` entry
 * id or a bar's `turn-bar-…`): the heights are cached by id, so the layout does
 * not shift when the plan re-emits the same rows differently.
 */
export const rowLayout = (
	index: number,
	itemIdAt: (at: number) => string | undefined,
	heights: ReadonlyMap<string, number>,
): RowLayout => {
	let offset = 0;
	for (let at = 0; at < index; at += 1) {
		offset += rowHeightPt(itemIdAt(at), heights);
	}
	return { length: rowHeightPt(itemIdAt(index), heights), offset, index };
};

/**
 * The index the list must OPEN at so its first render mounts the tail rows.
 *
 * `FlatList` renders `initialNumToRender` rows from `initialScrollIndex` up, so
 * the index is the first of the last screenful rather than the very last row:
 * starting at the last row alone mounts one row and then expands, and the first
 * frame the reader sees is a nearly empty one. Clamped at 0 so a conversation
 * shorter than a screen still renders whole.
 */
export const tailStartIndex = (
	rowCount: number,
	initialNumToRender: number,
): number => Math.max(0, rowCount - Math.max(1, initialNumToRender));

/**
 * An offset past any real content, for pinning the list to its end.
 *
 * `scrollToEnd` on the list is computed from the SAME row metrics that are
 * estimated for rows nobody has measured, so on a long conversation it can stop
 * short of the true end (under-estimated rows) — the defect reads as the newest
 * row being just off screen. Every platform clamps a scroll past the content's
 * end, so asking for an impossible offset is exact on native and on the web and
 * needs no height to be right.
 *
 * A billion points, not `Number.MAX_SAFE_INTEGER`: Android's `ReactScrollView`
 * takes the destination as an `int`, and a double that does not fit it is a
 * platform conversion this code cannot see (measured signature:
 * `ReactScrollView.java` `public void scrollTo(int x, int y)`). A billion points
 * is ~1.2 million phone screens, which no content reaches, and it is exactly
 * representable in every type on the path.
 */
export const TAIL_CLAMP_OFFSET_PT = 1_000_000_000;

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
