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

/** The same label in a row where it fits: `5` and `42` are narrower pills, and
 *  `99+` fits as soon as the text scale drops. */
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
		}
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

	it("treats a half-pixel shortfall as fitting", () => {
		expect(
			railCountPlacement({
				rowWidth: 200,
				labelWidth: 100,
				pillWidth: 50.4,
			}),
		).toBe("symmetric");
	});
});
