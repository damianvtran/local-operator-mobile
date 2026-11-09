/** Load on a reader reaching the real top AFTER initial tail placement. Mount,
 * layout and remaining at the top are not new requests. Unlike drag callbacks,
 * scroll offsets also cover keyboard, web and accessibility navigation. */
export const historyTopReached = (
	previousOffset: number,
	offset: number,
	initialPositioned: boolean,
	hasError: boolean,
): boolean =>
	initialPositioned && !hasError && previousOffset > 0 && offset <= 0;

/** Where a web prepend must put `scrollTop` so the row the reader was looking at
 * stays at the same distance below the scroller's top edge (PR #207 Q5/Q6).
 *
 * WHY TWO PATHS. react-native-web 0.21's vendored VirtualizedList has no
 * `maintainVisibleContentPosition`: on a prepend its render window keeps the
 * same INDICES, which now name the newly prepended rows, so the anchor row is
 * unmounted, `scrollTop` stays 0, and the viewport sits over the spacer that
 * stands in for those rows (QA r3: a blank 2332 px block, then 1041 → 961).
 * - Mounted anchor: correct by its real on-screen drift (exact).
 * - Unmounted anchor: place it from the list's own offset table, the same
 *   table VirtualizedList positions its spacers and cells from. A mounted
 *   reference row converts table offsets to content coordinates, which absorbs
 *   the header's height without measuring it. The scroll that results makes the
 *   list recompute its window, the anchor mounts, and the mounted path then
 *   corrects any estimate error.
 * Never total content growth: concurrent tail appends grow it too. */
export type WebAnchorFacts =
	| { kind: "mounted"; scrollTop: number; rowTop: number; desiredTop: number }
	| {
			kind: "table";
			/** The anchor row's offset in the current getItemLayout table. */
			anchorOffset: number;
			/** A mounted row's content-coordinate top and its table offset. */
			reference: { contentTop: number; offset: number } | null;
			/** Anchor distance below the scroller's top edge when captured. */
			distance: number;
	  };

export const anchoredScrollTop = (facts: WebAnchorFacts): number => {
	if (facts.kind === "mounted")
		return facts.scrollTop + (facts.rowTop - facts.desiredTop);
	const contentTop = facts.reference
		? facts.reference.contentTop + (facts.anchorOffset - facts.reference.offset)
		: facts.anchorOffset;
	return Math.max(0, contentTop - facts.distance);
};
