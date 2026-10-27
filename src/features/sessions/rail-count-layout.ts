/**
 * Where the Notifications rail row puts its count, decided from MEASURED widths.
 *
 * The row is `[count] [label] [count]` when the label is centred symmetrically
 * (design round 6, D19), because a count on one side only pushed the label 15.6 pt
 * left of its siblings at 100 % and 19.3 pt at 200 %. The mirror that balances it
 * is a real pill's width on each side, so the row has to hold
 * `label + 2 × count` before that centring can be exact.
 *
 * At 320 × 568 / 200 % with `99+` it cannot: the row is 247 pt, the two pills take
 * 119.2 pt and the label needs 141.2 pt, so the label overran its 127.8 pt slot and
 * the pill painted over its last letter — "Notification" (design round 8, D23;
 * symmetric centring there would need 260.4 pt). Legibility outranks exact
 * centring, so a row that does not fit drops the mirror and centres the
 * label+count PAIR instead, which needs ~205 pt and fits.
 *
 * A PURE FUNCTION of the three widths, because the decision has to be made
 * BEFORE the row is painted: a switch after paint is a visible reflow, and the
 * capture's own "frames changed after first paint" check would then be measuring
 * a layout the reader never saw first. The caller measures and calls this; it
 * never guesses from the device or the text scale alone, because whether it fits
 * depends on the count's own length (`5` and `42` fit at 200 %, `99+` does not).
 */
export type RailCountPlacement = "symmetric" | "grouped";

/** A pixel of slack, so a row that fits to within rounding does not lose its
 *  symmetric centring to a half-pixel. */
const SLACK = 1;

export type RailRowWidths = {
	/** The row's own width, measured on the row itself (the pane's inner width,
	 *  not the window's: the rail is a pane inside it). */
	rowWidth: number;
	/** The destination label's NATURAL width, not the slot it is given. */
	labelWidth: number;
	/** One count pill's width — the same on both sides, by construction. */
	pillWidth: number;
};

export const railCountPlacement = ({
	rowWidth,
	labelWidth,
	pillWidth,
}: RailRowWidths): RailCountPlacement =>
	labelWidth + pillWidth * 2 <= rowWidth + SLACK ? "symmetric" : "grouped";

/** The label's own box under a placement, for the geometry tests and for anyone
 *  reading why a row looks the way it does.
 *
 *  Symmetric: the label is centred in the slot the two pills leave, so its centre
 *  IS the row's centre line — the same line every sibling label sits on.
 *  Grouped: the label and the count are centred together, so the label's centre
 *  sits half a pill left of the row's centre and nothing overlaps. */
export const railLabelBox = (
	placement: RailCountPlacement,
	{ rowWidth, labelWidth, pillWidth }: RailRowWidths,
): { left: number; right: number; centre: number } => {
	const left =
		placement === "symmetric"
			? pillWidth + (rowWidth - pillWidth * 2 - labelWidth) / 2
			: (rowWidth - (labelWidth + pillWidth)) / 2;
	return { left, right: left + labelWidth, centre: left + labelWidth / 2 };
};

/** The count pill's box under a placement. */
export const railPillBox = (
	placement: RailCountPlacement,
	{ rowWidth, labelWidth, pillWidth }: RailRowWidths,
): { left: number; right: number } => {
	const left =
		placement === "symmetric"
			? rowWidth - pillWidth
			: (rowWidth - (labelWidth + pillWidth)) / 2 + labelWidth;
	return { left, right: left + pillWidth };
};
