import { describe, expect, it } from "vitest";

import { effectiveDuration, parseCubicBezier } from "@/ui/motion";
import {
	DURATIONS,
	EASINGS,
	REDUCED_MOTION_DURATION_CAP_MS,
} from "@/ui/tokens.gen";

describe("parseCubicBezier", () => {
	it("reads the tokens' own easings", () => {
		// Every non-linear token must parse to four finite control points with x
		// inside [0, 1] (a CSS cubic-bezier is invalid otherwise), so a token the
		// parser cannot read fails here rather than at first animation.
		for (const [name, easing] of Object.entries(EASINGS)) {
			if (easing === "linear") continue;
			const [x1, , x2] = parseCubicBezier(easing);
			expect(x1, name).toBeGreaterThanOrEqual(0);
			expect(x1, name).toBeLessThanOrEqual(1);
			expect(x2, name).toBeGreaterThanOrEqual(0);
			expect(x2, name).toBeLessThanOrEqual(1);
		}
	});

	it("maps `linear` to the identity curve", () => {
		expect(parseCubicBezier("linear")).toEqual([0, 0, 1, 1]);
	});

	it("refuses a named or spring easing instead of guessing one", () => {
		// A silently-substituted easing is a motion change nobody reviews, and the
		// system forbids springs outright (`tokens.json § motion.native.forbidden`).
		expect(() => parseCubicBezier("ease-in-out")).toThrow(/cubic-bezier/);
		expect(() => parseCubicBezier("spring(1, 100, 10, 0)")).toThrow(
			/cubic-bezier/,
		);
	});
});

describe("effectiveDuration", () => {
	it("leaves durations alone while motion is allowed", () => {
		expect(effectiveDuration(DURATIONS.slow, false)).toBe(DURATIONS.slow);
	});

	it("caps rather than zeroes under reduced motion", () => {
		// A cap, not a kill: an instantaneous colour change loses the affordance
		// that a press IS feedback.
		expect(effectiveDuration(DURATIONS.slow, true)).toBe(
			REDUCED_MOTION_DURATION_CAP_MS,
		);
		expect(effectiveDuration(DURATIONS.instant, true)).toBe(DURATIONS.instant);
	});
});
