/** How close to the top an UPWARD scroll starts the next older page: the
 *  relay's own `scrollTop < 120` (`local_operator/mobile/web/src/components/
 *  transcript.tsx`, `onScroll`), mirrored so both clients page at the same
 *  point. Before this the phone paged only at offset 0, so a reader saw the
 *  edge and a full-width "Load earlier messages" button before anything
 *  happened (operator report, 2026-11-13: "it looks really rough/amateur");
 *  120 pt of runway lets the page arrive while they are still moving. */
export const HISTORY_NEAR_TOP_PT = 120;

/** Load when the READER moves upward into the top band, AFTER initial tail
 * placement. Mount, layout and remaining still at the top are not new requests,
 * and neither is a DOWNWARD offset change: a prepend held in place by
 * `maintainVisibleContentPosition` (native) or `anchoredScrollTop` (web) moves
 * the offset DOWN, so it can never re-trigger itself — the relay's 1 px
 * oscillation (13 pages pulled unseen) has no path here. The caller's
 * `loadingOlder` guard makes one page in flight at a time. Unlike drag
 * callbacks, scroll offsets also cover keyboard, web and accessibility
 * navigation. */
export const historyTopReached = (
	previousOffset: number,
	offset: number,
	initialPositioned: boolean,
	hasError: boolean,
): boolean =>
	initialPositioned &&
	!hasError &&
	offset <= HISTORY_NEAR_TOP_PT &&
	offset < previousOffset;

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
