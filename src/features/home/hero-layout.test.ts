import { describe, expect, it } from "vitest";
import {
	HERO_EDGE,
	HERO_OPTICAL_NUDGE,
	heroHeldInset,
	heroMeasured,
	heroTopInset,
} from "./hero-layout";

/* Design spec §2: the hero is optically centred in the band between the header
 * and the composer STACK, clamped 24 pt from both ends, on the 4 pt scale. */
const BLOCK = 154; // display greeting 34 + 24 + 44 + 8 + 44 (the spec's block)

describe("heroTopInset (spec §2)", () => {
	it("centres the block in the band, nudged up by 8 pt, on the 4 pt scale", () => {
		const band = 652;
		const top = heroTopInset(band, BLOCK);
		expect(top % 4).toBe(0);
		const centred = (band - BLOCK) / 2 - HERO_OPTICAL_NUDGE;
		expect(top).toBeLessThanOrEqual(centred);
		expect(centred - top).toBeLessThan(4);
		// Acceptance: the block's centre sits within 8 pt of the band's centre.
		const blockCentre = top + BLOCK / 2;
		expect(Math.abs(blockCentre - band / 2)).toBeLessThanOrEqual(
			HERO_OPTICAL_NUDGE + 3,
		);
	});

	it("re-centres UPWARD when a notice shortens the band, never past the clamps", () => {
		const without = heroTopInset(652, BLOCK);
		const withNotice = heroTopInset(652 - 67, BLOCK);
		expect(withNotice).toBeLessThan(without);
		expect(withNotice).toBeGreaterThanOrEqual(HERO_EDGE);
	});

	it("keeps 24 pt at both ends, and falls back to the top anchor when it cannot", () => {
		for (let band = BLOCK; band < 900; band += 1) {
			const top = heroTopInset(band, BLOCK);
			expect(top).toBeGreaterThanOrEqual(HERO_EDGE);
			if (band >= BLOCK + 2 * HERO_EDGE)
				expect(band - (top + BLOCK)).toBeGreaterThanOrEqual(HERO_EDGE);
		}
		// Under block + 48 the region scrolls from the 24 pt anchor.
		expect(heroTopInset(BLOCK + 47, BLOCK)).toBe(HERO_EDGE);
	});

	it("paints the top anchor until both boxes are measured", () => {
		expect(heroTopInset(0, BLOCK)).toBe(HERO_EDGE);
		expect(heroTopInset(652, 0)).toBe(HERO_EDGE);
	});
});

describe("hero first frame and focus hold (R4/D4, U1)", () => {
	it("is unpainted until both band and block are measured", () => {
		expect(heroMeasured(0, 0)).toBe(false);
		expect(heroMeasured(652, 0)).toBe(false);
		expect(heroMeasured(0, BLOCK)).toBe(false);
		expect(heroMeasured(652, BLOCK)).toBe(true);
	});
	it("holds the resting inset when the rows step away on focus", () => {
		const band = 652;
		const rest = heroTopInset(band, BLOCK);
		/* Rows gone: the block is just the greeting, which would centre lower. */
		const shorter = heroTopInset(band, 34);
		expect(shorter).toBeGreaterThan(rest);
		expect(heroHeldInset(shorter, rest)).toBe(rest);
	});
	it("still rises when the band itself shrinks (keyboard, notice)", () => {
		const rest = heroTopInset(652, BLOCK);
		const keyboardUp = heroTopInset(300, 34);
		expect(keyboardUp).toBeLessThan(rest);
		expect(heroHeldInset(keyboardUp, rest)).toBe(keyboardUp);
	});
});
