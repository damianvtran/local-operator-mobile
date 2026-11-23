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
 * The scroll offset that satisfies one of the two anchors.
 *
 * `offset` is the current scroll position, and the measured tops are the
 * positions a node reports INSIDE the viewport (a `measureLayout` against the
 * scroll view), which is why the current offset has to be added back: the result
 * is an absolute content offset, clamped at zero.
 *
 * A field whose height is unknown (0 while it lays out) falls back to the block
 * anchor rather than scrolling to a bottom edge that is not yet there.
 */
export const focusScrollOffset = ({
	offset,
	viewportHeight,
	blockTop,
	blockHeight,
	fieldTop,
	fieldHeight,
	headerGap = FOCUS_HEADER_GAP,
	footerGap = FOCUS_FOOTER_GAP,
}: {
	offset: number;
	viewportHeight: number;
	blockTop: number;
	blockHeight: number;
	fieldTop: number;
	fieldHeight: number;
	headerGap?: number;
	footerGap?: number;
}): number => {
	if (viewportHeight <= 0) return Math.max(0, offset);
	const blockFits =
		blockHeight > 0 && blockHeight + headerGap + footerGap <= viewportHeight;
	/* NOTHING TO DO IS THE COMMON CASE, and it must move nothing: a question
	 *  already below the header, or a field already above the footer, does not
	 *  jump at the reader when they tap into it. */
	if (blockFits) {
		if (blockTop >= headerGap) return Math.max(0, offset);
		return Math.max(0, offset + (headerGap - blockTop));
	}
	if (fieldHeight <= 0) {
		/* The field has not laid out yet: anchor the block and let the next focus
		 *  (or the keyboard's own frame) do the rest. */
		return Math.max(0, offset + (headerGap - blockTop));
	}
	if (fieldTop + fieldHeight <= viewportHeight - footerGap) {
		return Math.max(0, offset);
	}
	return Math.max(
		0,
		offset + (viewportHeight - footerGap - fieldHeight - fieldTop),
	);
};
