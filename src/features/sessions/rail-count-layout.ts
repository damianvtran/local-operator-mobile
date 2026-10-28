/**
 * Where the Notifications rail row puts its count.
 *
 * The row is `[count] [label] [count]` when the label is centred symmetrically
 * (design round 6, D19), because a count on one side only pushed the label 15.6 pt
 * left of its siblings at 100 % and 19.3 pt at 200 %. The mirror that balances it
 * is a real pill's width on each side, so the row has to hold `label + 2 × count`
 * before that centring can be exact. Where it cannot — at 320 × 568 / 200 % with
 * `99+` the row is 247 pt, the pills 58.8 pt each and the label 141.2 pt, so the
 * label overran its 127.8 pt slot and the count painted over its last letter
 * ("Notification", design round 8, D23) — the mirror is dropped and the label and
 * count are centred together as one pair.
 *
 * THE INVARIANT, and it is about the UNMEASURED state, not about timing:
 * **the unmeasured state is the safe one, and measurement may only improve it.**
 * `grouped` is the default because it cannot overlap: it centres the pair and
 * truncates the label rather than letting text reach the pill. `symmetric` is
 * only ever adopted once a measurement proves the row holds `label + 2 × count`,
 * so the exact centring D19 asks for is a strict improvement on a layout that was
 * already correct — never a repair of a painted overlap.
 *
 * That matters because a placement decided from a measurement cannot be promised
 * before the first paint on every platform: on the web target `onLayout` arrives
 * from a ResizeObserver in the render steps before paint, but on native it is
 * delivered after the layout has been presented. Making the DEFAULT safe is the
 * only way the rule holds on both.
 *
 * A PURE FUNCTION of the three widths, because whether the row fits depends on
 * the count's own length — `5` and `42` fit at 200 %, `99+` does not — so neither
 * the device nor the text scale can answer it alone.
 */
export type RailCountPlacement = "symmetric" | "grouped";

/** No tolerance. An exact fit is symmetric, and one point over is not: any slack
 *  permits text to sit up to that slack under the pill, which is the one class of
 *  defect this module exists to forbid (code review round 10, m-3/n-4). */
const SLACK = 0;

/**
 * What the quiet Button adds around the label it is given: `px-3` a side plus the
 * control's always-present 1 pt border (`ui/variants.ts` `sm` and the base look).
 *
 * MEASURED, and it has to be in the fit test: the label width comes from a bare
 * text stand-in, while the box the row must fit is the BUTTON's. Leaving the
 * padding out chose symmetric for a `42` count at 200 % on a 320 pt pane with
 * 0.3 pt to spare, and the button's real box then overran the slot it was centring
 * in (QA round 6, Q11).
 */
export const RAIL_LABEL_CHROME = 26;

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
	labelWidth + RAIL_LABEL_CHROME + pillWidth * 2 <= rowWidth + SLACK
		? "symmetric"
		: "grouped";

/** The label's box under a placement, and whether the row had to shorten it.
 *
 *  These two functions are the MODEL the tests and the code comments reason with;
 *  the row itself is laid out by flexbox and, in grouped mode, by the label's own
 *  ellipsis. Where the model and a frame disagree, the frame is the truth — the
 *  geometry is here so a change can be argued with in numbers.
 *
 *  Symmetric: the label is centred in the slot the two pills leave, so its centre
 *  IS the row's centre line — the line every sibling label sits on.
 *  Grouped: label and count are centred together as one pair, so the label's
 *  centre sits half a pill left of the row's. Above roughly 250 % text on the
 *  smallest pane the pair itself overruns the row, and then the LABEL is the part
 *  that gives: it ellipsizes so the count never clips and text never sits under
 *  it (code review round 10, m-5). */
export const railLabelBox = (
	placement: RailCountPlacement,
	{ rowWidth, labelWidth, pillWidth }: RailRowWidths,
): { left: number; right: number; centre: number; truncated: boolean } => {
	const pairWidth = labelWidth + RAIL_LABEL_CHROME + pillWidth;
	const fitsGrouped = pairWidth <= rowWidth;
	const shown =
		placement === "symmetric" || fitsGrouped
			? labelWidth
			: Math.max(0, rowWidth - pillWidth - RAIL_LABEL_CHROME);
	const left =
		placement === "symmetric"
			? pillWidth + (rowWidth - pillWidth * 2 - shown) / 2
			: /* The BUTTON box is centred as part of the pair; its label sits inside
				 *  that box by half the chrome, which is where the text's own box starts. */
				(rowWidth - (shown + RAIL_LABEL_CHROME + pillWidth)) / 2 +
				RAIL_LABEL_CHROME / 2;
	return {
		left,
		right: left + shown,
		centre: left + shown / 2,
		truncated: shown < labelWidth,
	};
};

/** The count pill's box under a placement. In grouped mode the pair is centred, so
 *  the pill sits immediately after the label's (possibly shortened) box. */
export const railPillBox = (
	placement: RailCountPlacement,
	widths: RailRowWidths,
): { left: number; right: number } => {
	const label = railLabelBox(placement, widths);
	const boxRight = label.right + RAIL_LABEL_CHROME / 2;
	return { left: boxRight, right: boxRight + widths.pillWidth };
};
