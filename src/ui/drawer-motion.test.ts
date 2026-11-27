import { describe, expect, it } from "vitest";

import {
	DRAWER_FLING,
	DRAWER_FLING_MIN,
	DRAWER_FULL_MS,
	DRAWER_MIN_MS,
	decideRelease,
	easeInOut,
	easeInOutInverse,
	effectiveMs,
	settleAt,
	settlePlan,
} from "@/ui/drawer-motion";

const WIDTH = 390;

describe("ease-in-out", () => {
	it("pins both endpoints and the midpoint", () => {
		expect(easeInOut(0)).toBe(0);
		expect(easeInOut(1)).toBe(1);
		expect(easeInOut(0.5)).toBeCloseTo(0.5, 6);
	});

	it("is monotone across the whole curve", () => {
		let previous = -1;
		for (let i = 0; i <= 200; i += 1) {
			const value = easeInOut(i / 200);
			expect(value).toBeGreaterThanOrEqual(previous - 1e-9);
			previous = value;
		}
	});

	it("is symmetric: y(t) + y(1-t) = 1", () => {
		for (const t of [0.1, 0.25, 0.37, 0.5, 0.63, 0.8]) {
			expect(easeInOut(t) + easeInOut(1 - t)).toBeCloseTo(1, 6);
		}
	});

	it("inverts its own output", () => {
		for (const f of [0, 0.1, 0.3, 0.5, 0.7, 0.9, 1]) {
			expect(easeInOut(easeInOutInverse(f))).toBeCloseTo(f, 5);
		}
	});

	it("clamps inputs outside the curve instead of extrapolating", () => {
		expect(easeInOut(-1)).toBe(0);
		expect(easeInOut(2)).toBe(1);
		expect(easeInOutInverse(-1)).toBe(0);
		expect(easeInOutInverse(2)).toBe(1);
	});
});

describe("settlePlan", () => {
	it("takes the full 320 ms for a tap-open from closed", () => {
		const plan = settlePlan({ position: 0, width: WIDTH, target: 1 });
		expect(plan.from).toBe(0);
		expect(plan.to).toBe(WIDTH);
		expect(plan.t0).toBe(0);
		expect(plan.ms).toBe(DRAWER_FULL_MS);
		expect(plan.ms).toBe(320);
	});

	it("takes the remaining half for a release at 50 %", () => {
		for (const plan of [
			settlePlan({ position: WIDTH / 2, width: WIDTH, target: 1 }),
			settlePlan({ position: WIDTH / 2, width: WIDTH, target: 0 }),
		]) {
			expect(plan.t0).toBeCloseTo(0.5, 6);
			expect(plan.ms).toBeCloseTo(160, 6);
		}
	});

	it("floors a release at 90 % at 120 ms", () => {
		const plan = settlePlan({
			position: 0.9 * WIDTH,
			width: WIDTH,
			target: 1,
		});
		expect(plan.ms).toBe(DRAWER_MIN_MS);
		expect(plan.ms).toBe(120);
	});

	it("mirrors a spring-back from 30 % through the far edge", () => {
		const plan = settlePlan({
			position: 0.3 * WIDTH,
			width: WIDTH,
			target: 0,
		});
		expect(plan.from).toBe(WIDTH);
		expect(plan.to).toBe(0);
		// f = |position - from| / width = 0.7, so the curve resumes where it
		// reaches 0.7 — not at its start.
		expect(plan.t0).toBeCloseTo(easeInOutInverse(0.7), 9);
	});

	it("is continuous at u = 0 and exact at u = 1", () => {
		for (const target of [0, 1] as const) {
			for (const fraction of [0, 0.2, 0.5, 0.9, 1]) {
				const position = fraction * WIDTH;
				const plan = settlePlan({ position, width: WIDTH, target });
				expect(settleAt(plan, 0)).toBeCloseTo(position, 6);
				expect(settleAt(plan, 1)).toBe(target === 0 ? 0 : WIDTH);
			}
		}
	});

	it("returns finite values for a degenerate width or position", () => {
		for (const plan of [
			settlePlan({ position: 10, width: 0, target: 1 }),
			settlePlan({ position: 10, width: Number.NaN, target: 0 }),
			settlePlan({ position: Number.NaN, width: WIDTH, target: 1 }),
		]) {
			expect(Number.isFinite(plan.from)).toBe(true);
			expect(Number.isFinite(plan.to)).toBe(true);
			expect(Number.isFinite(plan.t0)).toBe(true);
			expect(Number.isFinite(plan.ms)).toBe(true);
			expect(settleAt(plan, 1)).toBe(plan.to);
		}
	});
});

describe("decideRelease", () => {
	const decide = (amount: number, velocity = 0, cancelled = false) =>
		decideRelease({ amount, width: WIDTH, velocity, cancelled });

	it("commits at exactly 50 % and not a point below", () => {
		expect(decide(0.5 * WIDTH)).toBe(true);
		expect(decide(0.5 * WIDTH - 0.1)).toBe(false);
	});

	it("commits at exactly 1000 pt/s only with 20 % travel", () => {
		expect(decide(0.2 * WIDTH, DRAWER_FLING)).toBe(true);
		expect(decide(0.2 * WIDTH, DRAWER_FLING - 1)).toBe(false);
		expect(decide(DRAWER_FLING_MIN * WIDTH - 1, DRAWER_FLING)).toBe(false);
	});

	it("commits a fast flick past the midpoint on distance alone", () => {
		expect(decide(0.6 * WIDTH, 0)).toBe(true);
	});

	it("ignores a cancelled gesture even past the threshold", () => {
		expect(decide(WIDTH, 5000, true)).toBe(false);
	});

	it("is direction-agnostic: mirrored closing values use the same rule", () => {
		// Closing passes leftward travel and speed as positives; the decision is
		// identical to the opening case.
		for (const amount of [0.19, 0.2, 0.49, 0.5, 0.9]) {
			expect(decide(amount * WIDTH, 0)).toBe(amount >= 0.5);
			expect(decide(amount * WIDTH, DRAWER_FLING)).toBe(
				amount >= 0.2 || amount >= 0.5,
			);
		}
	});

	it("treats a wrong-direction drag as zero travel", () => {
		expect(decide(-WIDTH, 5000)).toBe(false);
	});

	it("refuses a degenerate width", () => {
		expect(
			decideRelease({
				amount: 100,
				width: 0,
				velocity: 5000,
				cancelled: false,
			}),
		).toBe(false);
	});
});

describe("effectiveMs", () => {
	it("caps a settle at the reduced-motion floor", () => {
		expect(effectiveMs(DRAWER_FULL_MS, false)).toBe(DRAWER_FULL_MS);
		expect(effectiveMs(DRAWER_FULL_MS, true)).toBe(DRAWER_MIN_MS);
		expect(effectiveMs(DRAWER_MIN_MS, true)).toBe(DRAWER_MIN_MS);
	});
});
