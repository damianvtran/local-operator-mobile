import { describe, expect, it } from "vitest";

import {
	type RailRowWidths,
	railCountPlacement,
	railLabelBox,
	railPillBox,
} from "./rail-count-layout";

/**
 * The numbers are the design review's own measurements (round 8, D23), taken from
 * the `S15` frames at `320 × 568 / 200 %`: a 247 pt row, a 141.2 pt label and a
 * 58.8 pt `99+` pill.
 *
 * The defect they encode: symmetric centring needs `141.2 + 2 × 58.8 = 258.8` pt
 * in a 247 pt row, so the label overran its 127.8 pt slot and the pill painted
 * over its last letter. That geometry is asserted below as the thing this module
 * exists to make impossible.
 */
const TIGHT: RailRowWidths = {
	rowWidth: 247,
	labelWidth: 141.2,
	pillWidth: 58.8,
};

/** Beyond this the PAIR overruns the row too, and the label has to give (m-5):
 *  at 300 % the label is 211.8 pt, the pill 58.8 pt and the row 248 pt. */
const OVERRUN: RailRowWidths = {
	rowWidth: 248,
	labelWidth: 211.8,
	pillWidth: 58.8,
};

/** The same label in a row where it fits: a one- or two-character pill, and `99+`
 *  as soon as the text scale drops. */
const FITS: RailRowWidths[] = [
	{ rowWidth: 247, labelWidth: 141.2, pillWidth: 24 },
	{ rowWidth: 247, labelWidth: 141.2, pillWidth: 42 },
	{ rowWidth: 247, labelWidth: 141.2, pillWidth: 30 },
	{ rowWidth: 247, labelWidth: 141.2, pillWidth: 40 },
];

describe("the rail's count placement", () => {
	it("drops the mirror for `99+` in a 320 pt pane at 200 % (D23)", () => {
		expect(railCountPlacement(TIGHT)).toBe("grouped");
		const label = railLabelBox("grouped", TIGHT);
		const pill = railPillBox("grouped", TIGHT);
		// No overlap: the label stops where the pill starts…
		expect(label.right).toBeLessThanOrEqual(pill.left + 0.001);
		expect(label.truncated).toBe(false);
		// …the pair is centred as ONE group…
		expect(
			label.left + (label.right - label.left + pill.right - pill.left) / 2,
		).toBeCloseTo(TIGHT.rowWidth / 2, 5);
		// …and the pill stays inside the row's own edge (247, against the 255 the
		// audit measures to, so the check has 8 pt of its own slack).
		expect(pill.right).toBeLessThanOrEqual(247.001);
		expect(pill.right).toBeLessThanOrEqual(255);
	});

	it("keeps the symmetric centring wherever the row fits", () => {
		for (const widths of FITS) {
			expect(railCountPlacement(widths)).toBe("symmetric");
			// Symmetric means the label sits on the row's centre line — the line every
			// sibling destination's label is measured against.
			expect(railLabelBox("symmetric", widths).centre).toBeCloseTo(
				widths.rowWidth / 2,
				5,
			);
			expect(railLabelBox("symmetric", widths).truncated).toBe(false);
		}
	});

	it("takes an exact fit as symmetric and one point over as grouped (m-3)", () => {
		// `label + 2 × pill == row` is the last row that can hold the mirror, and
		// `+1` is the first that cannot. Pinning both ends means a tolerance that
		// quietly allowed text under the pill would go red.
		expect(
			railCountPlacement({ rowWidth: 200, labelWidth: 100, pillWidth: 50 }),
		).toBe("symmetric");
		expect(
			railCountPlacement({ rowWidth: 200, labelWidth: 100, pillWidth: 50.5 }),
		).toBe("grouped");
	});

	it("shortens the label rather than the count above 250 % text (m-5)", () => {
		expect(railCountPlacement(OVERRUN)).toBe("grouped");
		const label = railLabelBox("grouped", OVERRUN);
		const pill = railPillBox("grouped", OVERRUN);
		// The label gives way — it is the part that can ellipsize…
		expect(label.truncated).toBe(true);
		expect(label.right - label.left).toBeCloseTo(
			OVERRUN.rowWidth - OVERRUN.pillWidth,
			5,
		);
		// …so the count never clips at the pane edge and no text sits under it.
		expect(pill.right).toBeLessThanOrEqual(OVERRUN.rowWidth + 0.001);
		expect(label.right).toBeLessThanOrEqual(pill.left + 0.001);
	});

	it("would have overlapped under the old fixed-mirror row", () => {
		/* The previous head always rendered the mirror. This is its geometry, in the
		 * same terms the check reads: the label's slot is `row - 2 × pill`, and a
		 * label wider than its slot paints over the pill that follows it. */
		const slot = TIGHT.rowWidth - TIGHT.pillWidth * 2;
		expect(TIGHT.labelWidth).toBeGreaterThan(slot);
		// The text was centred in its slot and simply painted outside it, on both
		// sides: that is how "Notification" lost its "s" to the pill.
		const oldTextLeft = TIGHT.pillWidth + (slot - TIGHT.labelWidth) / 2;
		const oldTextRight = oldTextLeft + TIGHT.labelWidth;
		const pillLeft = TIGHT.rowWidth - TIGHT.pillWidth;
		expect(oldTextRight).toBeGreaterThan(pillLeft);
		expect(oldTextLeft).toBeLessThan(TIGHT.pillWidth);
		// The placement module removes the overlap instead of trimming the text.
		expect(railLabelBox("grouped", TIGHT).right).toBeLessThan(oldTextRight);
	});
});
