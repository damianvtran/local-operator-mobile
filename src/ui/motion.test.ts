import { describe, expect, it } from "vitest";

import { effectiveDuration, parseCubicBezier } from "@/ui/motion";
import {
	DURATIONS,
	EASINGS,
	REDUCED_MOTION_DURATION_CAP_MS,
} from "@/ui/tokens.gen";

describe("parseCubicBezier", () => {
	it("reads the tokens' own easings", () => {
		expect(parseCubicBezier(EASINGS["out-expo"])).toEqual([0.16, 1, 0.3, 1]);
		expect(parseCubicBezier(EASINGS["in-out"])).toEqual([0.65, 0, 0.35, 1]);
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
