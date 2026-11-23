/**
 * The resize arithmetic behind `Sheet`'s opt-in two sizes.
 *
 * Why these numbers: they are the design round's (docs/design/components.md § 8 —
 * Medium is the `content` detent's fraction, so the smaller size is the height
 * every other sheet already opens at; Large is the `full` detent's). Each case
 * pins a relationship rather than a literal that could drift silently.
 */
import { describe, expect, it } from "vitest";

import {
	resistResizeDrag,
	SHEET_RESIZE_FLICK,
	SHEET_RESIZE_RESIST_MAX,
	settleResize,
	sheetResizeSizes,
} from "@/ui/sheet-resize";

const sizes = (over: Partial<Parameters<typeof sheetResizeSizes>[0]> = {}) =>
	sheetResizeSizes({
		capHeight: 844,
		chrome: 120,
		contentHeight: Number.POSITIVE_INFINITY,
		floor: 120,
		ceiling: Number.POSITIVE_INFINITY,
		...over,
	});

describe("sheetResizeSizes", () => {
	it("spends each fraction on the surface, minus the chrome that never scrolls", () => {
		expect(sizes()).toEqual({
			medium: Math.round(844 * 0.6) - 120,
			large: Math.round(844 * 0.92) - 120,
		});
	});

	it("hugs the content when it is shorter than Medium", () => {
		expect(sizes({ contentHeight: 200 }).medium).toBe(200);
	});

	it("never puts Large under Medium, however tall the chrome", () => {
		const { medium, large } = sizes({ chrome: 420 });
		expect(large).toBeGreaterThanOrEqual(medium);
	});

	it("keeps the body off the floor under a very tall type setting", () => {
		expect(sizes({ chrome: 844 * 0.95 }).medium).toBe(120);
	});

	it("obeys the keyboard's ceiling when the surface must fit above it", () => {
		const { medium, large } = sizes({ ceiling: 260 });
		expect(medium).toBeLessThanOrEqual(260);
		expect(large).toBeLessThanOrEqual(260);
	});
});

describe("resistResizeDrag", () => {
	const base = { min: 200, max: 500 };

	it("follows the finger exactly between the two sizes", () => {
		expect(resistResizeDrag({ ...base, height: 300 })).toBe(300);
	});

	it("moves past an end at the resist factor, not at the finger's speed", () => {
		// 100 pt past Large at 0.35 is 35 pt of travel, under the 48 pt cap.
		expect(resistResizeDrag({ ...base, height: 600 })).toBeCloseTo(
			500 + 100 * 0.35,
			5,
		);
	});

	it("stops giving past the cap, whichever end is overshot", () => {
		expect(resistResizeDrag({ ...base, height: 5000 })).toBe(
			500 + SHEET_RESIZE_RESIST_MAX,
		);
		expect(resistResizeDrag({ ...base, height: -5000 })).toBe(
			200 - SHEET_RESIZE_RESIST_MAX,
		);
	});
});

describe("settleResize", () => {
	const base = { velocityY: 0, min: 200, max: 500 };

	it("picks Large for an upward flick, whatever the release height", () => {
		expect(
			settleResize({ ...base, height: 210, velocityY: -SHEET_RESIZE_FLICK }),
		).toBe("large");
	});

	it("picks Medium for a downward flick, whatever the release height", () => {
		expect(
			settleResize({ ...base, height: 490, velocityY: SHEET_RESIZE_FLICK }),
		).toBe("medium");
	});

	it("settles by the projected height below the flick speed", () => {
		// 20 pt past the midpoint with no velocity: large.
		expect(settleResize({ ...base, height: 370 })).toBe("large");
		// The same height, flicked down gently, projects under the midpoint, which
		// is the whole point of carrying the velocity.
		expect(settleResize({ ...base, height: 370, velocityY: 300 })).toBe(
			"medium",
		);
	});

	it("keeps a still finger's decision at the midpoint itself", () => {
		// Exactly the midpoint projects to the midpoint: "not greater" is Medium,
		// so a drag that comes back to where it started does not flip the size.
		expect(settleResize({ ...base, height: 350 })).toBe("medium");
	});
});
