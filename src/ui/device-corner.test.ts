import { describe, expect, it } from "vitest";

import {
	COMPOSER_EDGE_INSET,
	COMPOSER_TOP_RADIUS,
	composerGeometry,
	cornerOverhang,
	displayCornerRadius,
} from "@/ui/device-corner";

/**
 * The acceptance devices of the decision record (§7) plus the table's edges.
 * The insets are the simulators' own portrait values.
 */
const D1_SE = { platform: "ios", width: 375, height: 667, insetBottom: 0 };
const D2_16 = { platform: "ios", width: 393, height: 852, insetBottom: 34 };
const D3_17PRO = { platform: "ios", width: 402, height: 874, insetBottom: 34 };
const D4_MAX = { platform: "ios", width: 440, height: 956, insetBottom: 34 };
const PIXEL_GESTURE = {
	platform: "android",
	width: 412,
	height: 915,
	insetBottom: 24,
};
const PIXEL_3BUTTON = {
	platform: "android",
	width: 412,
	height: 915,
	insetBottom: 48,
};

describe("displayCornerRadius", () => {
	it("is square on a home-button phone and the web", () => {
		expect(displayCornerRadius(D1_SE)).toBe(0);
		expect(displayCornerRadius({ ...D2_16, platform: "web" })).toBe(0);
	});

	it("looks the iPhone families up by their short side, in either orientation", () => {
		expect(displayCornerRadius(D2_16)).toBe(55);
		expect(displayCornerRadius(D3_17PRO)).toBe(62);
		expect(displayCornerRadius(D4_MAX)).toBe(62);
		expect(displayCornerRadius({ ...D3_17PRO, width: 874, height: 402 })).toBe(
			62,
		);
	});

	it("falls back to 55 for an unknown rounded iOS device", () => {
		expect(displayCornerRadius({ ...D2_16, width: 500, height: 900 })).toBe(55);
	});

	it("gives Android the floor model until a native reading exists", () => {
		expect(displayCornerRadius(PIXEL_GESTURE)).toBe(24);
		expect(displayCornerRadius({ ...PIXEL_GESTURE, insetBottom: 0 })).toBe(0);
	});
});

describe("composerGeometry (record §2.1/§2.2 pass criteria)", () => {
	it("keeps margin = gap = 8 and r_t = 20 on every device", () => {
		for (const device of [D1_SE, D2_16, D3_17PRO, D4_MAX, PIXEL_GESTURE]) {
			const g = composerGeometry(device);
			expect(g.marginX).toBe(8);
			expect(g.marginBottom).toBe(8);
			expect(g.radiusTop).toBe(COMPOSER_TOP_RADIUS);
		}
	});

	it("makes r_b = R − 8 on Face ID phones and 16 on the SE", () => {
		expect(composerGeometry(D1_SE).radiusBottom).toBe(16);
		expect(composerGeometry(D2_16).radiusBottom).toBe(47);
		expect(composerGeometry(D3_17PRO).radiusBottom).toBe(54);
		expect(composerGeometry(PIXEL_GESTURE).radiusBottom).toBe(16);
	});

	it("pays the bottom inset inside the shell: max(inset − 8, 2)", () => {
		expect(composerGeometry(D2_16).paddingBottom).toBe(26);
		expect(composerGeometry(D1_SE).paddingBottom).toBe(2);
		expect(composerGeometry(PIXEL_3BUTTON).paddingBottom).toBe(40);
		// …so every control's box ends at least `insets.bottom` above the edge.
		for (const device of [D1_SE, D2_16, D3_17PRO, PIXEL_3BUTTON]) {
			const g = composerGeometry(device);
			expect(g.marginBottom + g.paddingBottom).toBeGreaterThanOrEqual(
				device.insetBottom,
			);
		}
	});

	it("squares the bottom to the top radius and drops the inset with the keyboard up", () => {
		const g = composerGeometry({ ...D3_17PRO, keyboardVisible: true });
		expect(g.radiusBottom).toBe(20);
		expect(g.paddingBottom).toBe(2);
		expect(g.marginBottom).toBe(8);
	});
});

describe("cornerOverhang — why the rule is the rule", () => {
	it("reproduces the shipped clip: 12/8/12 pokes 3.8 pt out of R 55 and 6.6 out of R 62", () => {
		expect(cornerOverhang(55, 12, 8, 12)).toBeCloseTo(3.75, 1);
		expect(cornerOverhang(62, 12, 8, 12)).toBeCloseTo(6.64, 1);
	});

	it("sits exactly the inset inside the display with the concentric rule", () => {
		for (const device of [D2_16, D3_17PRO, D4_MAX]) {
			const r = displayCornerRadius(device);
			const g = composerGeometry(device);
			expect(
				cornerOverhang(r, g.marginX, g.marginBottom, g.radiusBottom),
			).toBeCloseTo(-COMPOSER_EDGE_INSET, 5);
		}
	});

	it("never clips when the table under-estimates R by 7 pt", () => {
		const assumed = composerGeometry(D2_16); // R 55 assumed
		// The real display is rounder than assumed: still inside.
		expect(
			cornerOverhang(62, assumed.marginX, assumed.marginBottom, 47),
		).toBeLessThan(0);
	});
});
