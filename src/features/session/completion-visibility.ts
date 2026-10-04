/**
 * "Is the completion's END actually on screen?" — the one question the ack gate
 * asks, as arithmetic over the list's own measurements.
 *
 * The web client learned the shape the hard way (`use-completion-view.ts`): a
 * rendered row is not a seen row (it can sit off the viewport), and the END of
 * a long result is the part that must be visible, not its first line. Its rule
 * is `rect.bottom - 2` inside the viewport; this is that rule in the numbers a
 * `FlatList` actually has — no DOM, no `elementFromPoint`:
 *
 * ```
 * y = tailDistance + viewportPt - afterHeight - 2
 * visible  ⟺  0 ≤ y < viewportPt
 * ```
 *
 * where `tailDistance = contentHeight - scrollOffset - viewportPt` is how far
 * the viewport's bottom edge sits from the content's end (0 at the very
 * bottom), and `afterHeight` is the summed height of every row AFTER the
 * anchored one. The anchored row's bottom, in viewport coordinates, is
 * `tailDistance + viewportPt - afterHeight`; subtract the web's 2 pt slack.
 *
 * **Unknown measurements resolve to NOT visible, never to visible.** A row
 * after the anchor that has never been laid out leaves `afterHeight` unknown,
 * and the honest reading of "cannot compute" here is "cannot prove the end is
 * on screen" — the direction that cannot ack by accident. The reader loses
 * nothing: the tail is where a completion is read, and rows between the anchor
 * and the tail are measured the moment they are rendered.
 */

export interface AnchorGeometry {
	/** `contentHeight - scrollOffset - viewportPt`; 0 at the very bottom of the
	 *  list (small negatives are iOS overscroll at the end). */
	tailDistance: number;
	/** The transcript viewport's height, in points. */
	viewportPt: number;
	/** Summed height of every row after the anchored one, or `null` when any of
	 *  them has not been laid out yet. */
	afterHeight: number | null;
	/** The anchored row itself has been laid out (it is rendered, not merely
	 *  present in the data). */
	anchorRendered: boolean;
}

export function anchorBottomVisible(geometry: AnchorGeometry): boolean {
	if (!geometry.anchorRendered || geometry.afterHeight === null) return false;
	const y =
		geometry.tailDistance + geometry.viewportPt - geometry.afterHeight - 2;
	return y >= 0 && y < geometry.viewportPt;
}

/**
 * The `unseen` completion is complete: its answer has actually finished
 * rendering. Mirrors the web's `data-completion-complete="true"` half of the
 * anchor selector — acknowledging a row that is still growing would be
 * acknowledging a result the reader has not seen the end of.
 */
export function entryComplete(entry: {
	final: boolean;
	text_complete: boolean;
}): boolean {
	return entry.final && entry.text_complete === true;
}
