import { describe, expect, it } from "vitest";
import {
	rideOffset,
	SETTLE_SNAP_LIMIT,
	settleOffset,
} from "@/features/session/keyboard-motion";

describe("rideOffset", () => {
	it("is the native height verbatim, fractions included", () => {
		expect(rideOffset(336)).toBe(336);
		expect(rideOffset(0.5)).toBe(0.5);
	});

	it("never goes negative or non-finite", () => {
		/* A spring overshoot below rest, or a frame that is not a height. */
		expect(rideOffset(-1.5)).toBe(0);
		expect(rideOffset(Number.NaN)).toBe(0);
		expect(rideOffset(Number.POSITIVE_INFINITY)).toBe(0);
	});
});

describe("settleOffset", () => {
	it("snaps a sub-2 pt mismatch to the settled overlap", () => {
		expect(settleOffset(335.4, 336)).toBe(336);
		expect(settleOffset(336.6, 336)).toBe(336);
		expect(settleOffset(1.99 + 100, 100)).toBe(100);
	});

	it("does not snap at the 2 pt boundary or beyond", () => {
		expect(SETTLE_SNAP_LIMIT).toBe(2);
		expect(settleOffset(334, 336)).toBe(334);
		expect(settleOffset(338, 336)).toBe(338);
		expect(settleOffset(100, 336)).toBe(100);
	});

	it("keeps an exact match exactly", () => {
		expect(settleOffset(336, 336)).toBe(336);
	});

	it("leaves a stale target alone (Android: didShow lands after onEnd)", () => {
		/* Show: the motion ended at 336 while the store still holds 0. */
		expect(settleOffset(336, 0)).toBe(336);
		/* Hide: the motion ended at 0 while the store still holds the old 336. */
		expect(settleOffset(0, 336)).toBe(0);
	});
});
