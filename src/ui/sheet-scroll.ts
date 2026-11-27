/**
 * Where the sheet's body scrolls when a field takes focus, so the field the
 * reader is typing into is never under the footer or the keyboard.
 *
 * WHY IT EXISTS (the ask panel's Other field): with the keyboard up the body is
 * the space between the sheet's header and the pinned Answer/Decline, and a
 * long question pushed the field past the bottom edge — the reader typed into
 * something they could not see. Two anchors, in this order:
 *
 *  1. If the WHOLE question block fits in the viewport, put its top 8 pt under
 *     the header. Reading the question is the point; a block that fits does not
 *     need to be pinned bottom-first.
 *  2. Otherwise pin the FIELD's bottom 16 pt above the footer, which is where
 *     the caret is and the only edge that must stay visible.
 *
 * Plain module, no `react-native` import, so the arithmetic is unit-tested in
 * Node; `Sheet` supplies the measured numbers and does the scrolling.
 */

/** Clearance under the header when the whole question fits. */
export const FOCUS_HEADER_GAP = 8;

/** Clearance above the footer line for the field's own bottom edge. */
export const FOCUS_FOOTER_GAP = 16;

/**
 * The scroll offset that satisfies one of the two anchors, for coordinates
 * measured IN THE CONTENT — what `measureLayout` against the scroll view yields
 * and what `scrollTo` takes, so there is no offset to add back.
 *
 * `fieldTop`/`blockTop` here are content positions: a field at 478 in a 336 pt
 * viewport scrolls to 478 - (336 - 16 - 44) = 202, not to zero. (The first
 * version of this file took viewport positions and clamped every focus to the
 * top of the content; the evidence run's log showed `-> 0` for a field 478 pt
 * down, which is how the mistake was found.)
 */
export const focusScrollTarget = ({
	viewportHeight,
	blockTop,
	blockHeight,
	fieldTop,
	fieldHeight,
	headerGap = FOCUS_HEADER_GAP,
	footerGap = FOCUS_FOOTER_GAP,
}: {
	viewportHeight: number;
	blockTop: number;
	blockHeight: number;
	fieldTop: number;
	fieldHeight: number;
	headerGap?: number;
	footerGap?: number;
}): number => {
	if (viewportHeight <= 0) return 0;
	const blockFits =
		blockHeight > 0 && blockHeight + headerGap + footerGap <= viewportHeight;
	if (blockFits) return Math.max(0, blockTop - headerGap);
	if (fieldHeight <= 0) return Math.max(0, blockTop - headerGap);
	return Math.max(0, fieldTop + fieldHeight - (viewportHeight - footerGap));
};

/**
 * The body offset that keeps the rows still when a `pinned` region APPEARS over
 * a scrolled body (design round 4, D1: the run-settings sheet pins its model
 * search only once the reader reaches the models, #335). The surface is
 * bottom-anchored, so the body's top moves down by however much the BODY
 * shrank, and at the same offset every row moves down with it.
 *
 * The change is measured, not assumed (design round 5, D4). The region's own
 * height over-corrects a sheet that grows instead (a body at its floor: 122 pt
 * asked, 93 pt moved at 320 pt and 200 %). And it is applied once the body has
 * its NEW height, because the shrink is exactly the scroll room the larger
 * offset needs: asked for before, it was clamped to the old end of a tall body
 * (+61 pt asked, 0 given, with 21 models). `null` when nothing moved: a body at
 * its top (a region pinned as the sheet opens), or one that kept its height.
 */
export const pinnedRevealScroll = ({
	y,
	viewportBefore,
	viewportAfter,
	content,
}: {
	y: number;
	viewportBefore: number;
	viewportAfter: number;
	content: number;
}): number | null => {
	const shrink = viewportBefore - viewportAfter;
	if (y <= 0 || viewportAfter <= 0 || Math.abs(shrink) < 1) return null;
	return Math.max(0, Math.min(y + shrink, content - viewportAfter));
};
