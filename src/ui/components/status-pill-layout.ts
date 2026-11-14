import { LARGE_TEXT_SCALE } from "@/ui/text-scale";

/**
 * Where a `ConnectionPill` sits in a ROW, and how it fits there.
 *
 * WHY THIS EXISTS. Sherman's iPhone (relayed by Aida) showed "Not answering"
 * running past the right edge in two places: Settings › Connection › Status
 * (a label/value row) and the Agents drawer header (`conversations-pane`). The
 * pill's own `maxWidth: "100%"` is relative to its PARENT, and in the Status row
 * the parent is the whole row — so "100 %" let the pill claim the full row width
 * while the label beside it claimed its own, and the sum left the screen. The
 * text had no line cap either, so nothing truncated.
 *
 * React Native's default `flexShrink` is 0 (CSS's is 1), so the pill's box never
 * gave way to the label beside it.
 *
 * THE RULE, in both places:
 *  - the row has `min-w-0`, so its children may shrink below their content;
 *  - the pill sits in a slot that shrinks (`flexShrink: 1`, `minWidth: 0`) and
 *    is capped relative to the row (`maxWidth: "100%"`, never a pt width — the
 *    row is the viewport's, 320 pt SE up to split view);
 *  - the label does NOT shrink: it is one short word, and a shrinking one-word
 *    label breaks mid-word ("Состояни/е") to save the pill a few points. Inline
 *    rows only exist up to `LARGE_TEXT_SCALE`, where the longest catalogue label
 *    is under half the 320 pt row; the test pins that;
 *  - the pill's text is ONE line, tail-ellipsised, with the whole message as its
 *    accessible name (`ConnectionPill singleLine`);
 *  - above `LARGE_TEXT_SCALE` the Status row STACKS (label over pill) instead of
 *    truncating — the same threshold and the same reason as the account card
 *    above it: at 200 % on a 320 pt phone a Russian label and pill side by side
 *    leave the pill a couple of glyphs, which is a dot with "Не…" next to it.
 *
 * Node has no layout engine, so the outcome is modelled here as a pure function
 * of widths (`statusPillFit`, `drawerPillFit`) and pinned by
 * `status-pill-layout.test.ts`; the components are checked to use these same
 * constants. Kept free of `react-native` so the test can import it.
 */

/** `gap-3` between the label and the pill in an inline Status row, in pt. */
export const STATUS_ROW_GAP_PT = 12;
/** `gap-1` between the label and the pill once the row stacks, in pt. */
export const STATUS_ROW_STACK_GAP_PT = 4;

/** The pill's own horizontal chrome in pt: `px-2` both sides (16), the 6 pt
 *  dot, `gap-2` (8) and a 1 pt border each side (2). */
export const STATUS_PILL_CHROME_PT = 32;

/** Whether the Status row stacks: above `LARGE_TEXT_SCALE`, as the account card
 *  does, measured against the RENDERED scale. */
export const statusRowStacked = (effectiveScale: number): boolean =>
	effectiveScale > LARGE_TEXT_SCALE;

/** The Status row's class. `min-w-0` in both: without it Yoga sizes the row to
 *  its content and the pill leaves the screen. */
export const statusRowClass = (stacked: boolean): string =>
	stacked
		? "min-w-0 items-start gap-1"
		: "min-w-0 flex-row items-center justify-between gap-3";

/** The row label's style: it keeps its natural width (see the rule above). */
export const STATUS_LABEL_STYLE = { flexShrink: 0 } as const;

/** The pill's slot in the Status row: it gives way to the label and is never
 *  wider than the row, inline or stacked. */
export const STATUS_PILL_SLOT_STYLE = {
	flexShrink: 1,
	minWidth: 0,
	maxWidth: "100%",
} as const;

/** The Agents drawer header's pill wrapper: alone on its line, so the cap is the
 *  line itself; `min-w-0` lets it shrink inside the pane. */
export const DRAWER_PILL_ROW_CLASS = "min-w-0 px-4 pb-1 pt-2";
/** `px-4` both sides of that wrapper, in pt. */
export const DRAWER_PILL_ROW_PADDING_PT = 32;

export type PillFit = {
	/** The pill's painted width. */
	pillPt: number;
	/** The label's painted width (equal to its natural width unless it had to
	 *  yield). */
	labelPt: number;
	/** The pill's text is tail-ellipsised: its natural width exceeds its box. */
	truncated: boolean;
	/** The label kept its natural width (no mid-word break). */
	labelIntact: boolean;
	/** Horizontal extent the row's content occupies, in pt. */
	usedPt: number;
};

/**
 * The Status row's flex outcome.
 *
 * Inline: the label keeps its natural width (`flexShrink: 0`); the pill starts
 * at its natural width capped at the row (`maxWidth: 100%`) and, as the only
 * shrinking child, takes the whole deficit down to its `minWidth: 0`.
 *
 * Stacked: each has the row to itself; the pill is capped at the row, the label
 * wraps on its own line if it ever has to.
 */
export function statusPillFit(input: {
	rowPt: number;
	labelPt: number;
	textPt: number;
	stacked: boolean;
}): PillFit {
	const natural = input.textPt + STATUS_PILL_CHROME_PT;
	if (input.stacked) {
		const pillPt = Math.min(natural, input.rowPt);
		const labelPt = Math.min(input.labelPt, input.rowPt);
		return {
			pillPt,
			labelPt,
			truncated: natural > pillPt,
			labelIntact: labelPt >= input.labelPt,
			usedPt: Math.max(pillPt, labelPt),
		};
	}
	const labelPt = input.labelPt;
	const pillPt = Math.max(
		0,
		Math.min(natural, input.rowPt, input.rowPt - STATUS_ROW_GAP_PT - labelPt),
	);
	return {
		pillPt,
		labelPt,
		truncated: natural > pillPt,
		labelIntact: true,
		usedPt: labelPt + STATUS_ROW_GAP_PT + pillPt,
	};
}

/** The drawer header pill: alone on a line `rowPt` wide, capped at it. */
export function drawerPillFit(input: { rowPt: number; textPt: number }): {
	pillPt: number;
	truncated: boolean;
} {
	const natural = input.textPt + STATUS_PILL_CHROME_PT;
	const pillPt = Math.min(natural, input.rowPt);
	return { pillPt, truncated: natural > pillPt };
}
