import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	COMPOSER_CONTROLS_GAP,
	COMPOSER_FIELD_BOX,
	composerPaintedHeight,
	composerPresentation,
	composerShellPadding,
	keyboardOverlap,
	seedFor,
} from "./composer-presentation";

const read = (path: string) =>
	readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

const empty = {
	focused: false,
	draft: "",
	attachments: 0,
	dictation: false,
	stop: false,
	error: false,
	keyboard: false,
	inset: 34,
	scale: 1,
};
describe("build389 uniform dock", () => {
	it("keeps home-indicator clearance outside the idle capsule", () => {
		expect(composerPresentation(empty)).toEqual({
			expanded: false,
			height: 56,
			radius: 28,
			gap: 42,
			side: 12,
		});
	});
	it("expands for each retained editing state, including whitespace", () => {
		for (const delta of [
			{ focused: true },
			{ draft: " " },
			{ attachments: 1 },
			{ dictation: true },
			{ stop: true },
			{ error: true },
		]) {
			expect(composerPresentation({ ...empty, ...delta })).toMatchObject({
				expanded: true,
				height: 112,
				radius: 24,
			});
		}
	});
	it("pays no second safe inset above the keyboard", () => {
		expect(composerPresentation({ ...empty, keyboard: true })).toMatchObject({
			gap: 8,
		});
		expect(keyboardOverlap(500, 500)).toBe(0);
		expect(keyboardOverlap(844, 500)).toBe(344);
	});
	it("grows idle capsule with text rather than clipping scaled targets", () => {
		const p = composerPresentation({ ...empty, scale: 2 });
		expect(p.height).toBeGreaterThan(56);
		expect(p.radius).toBe(p.height / 2);
	});

	/* PAINTED heights, not class names: the dock's own padding plus the field's
	 * painted box plus the expanded controls row and its gap must add up to the
	 * record's 56 / 112. A web `<textarea>` is content-box, which is how the
	 * first build measured 60 / 116 — the +4 came from the field's padding, so
	 * the arithmetic below is what the regression watches. */
	it("sums to the record's 56 and 112 from the parts the shell actually paints", () => {
		expect(COMPOSER_FIELD_BOX).toBe(44);
		const rest = composerShellPadding(false);
		const expanded = composerShellPadding(true);
		expect(rest).toEqual({ top: 6, bottom: 6 });
		expect(expanded).toEqual({ top: 12, bottom: 8 });
		expect(composerPaintedHeight(false)).toBe(56);
		expect(composerPaintedHeight(true)).toBe(112);
		/* The record's totals are its iOS values. The web/Android floor is 48, and
		 *  the SAME rule paints 60/120 there — which is exactly what the web frames
		 *  measure, so the frame table and this arithmetic agree instead of one
		 *  being declared wrong. */
		expect(composerPaintedHeight(false, 48)).toBe(60);
		expect(composerPaintedHeight(true, 48)).toBe(120);
		expect(
			expanded.top +
				COMPOSER_FIELD_BOX +
				COMPOSER_CONTROLS_GAP +
				COMPOSER_FIELD_BOX +
				expanded.bottom,
		).toBe(112);
		// The shape follows the PAINTED pill on the floor it is given: 44 gives the
		// record's 56/28, and the 48 floor the composer actually paints on gives
		// 60/30 — reporting 28 over a 30 pt paint was a second source of truth
		// (round 7, R7-4). Both floors are asserted, so neither can drift alone.
		expect(composerPresentation({ ...empty, floor: 44 }).height).toBe(56);
		expect(composerPresentation({ ...empty, floor: 44 }).radius).toBe(28);
		expect(
			composerPresentation({ ...empty, focused: true, floor: 44 }).height,
		).toBe(112);
		expect(
			composerPresentation({ ...empty, focused: true, floor: 44 }).radius,
		).toBe(24);
		expect(composerPresentation({ ...empty, floor: 48 }).height).toBe(60);
		expect(composerPresentation({ ...empty, floor: 48 }).radius).toBe(30);
	});
});

describe("round 7 — the seed is a decision, not an expression", () => {
	it("seeds the collapsed end whenever the card is not expanded", () => {
		expect(seedFor(false, 60)).toEqual({ kind: "collapsed", total: 60 });
		expect(seedFor(true, 120)).toEqual({ kind: "expanded", total: 120 });
	});

	it("has no second condition that could skip a layout", () => {
		// The regression this replaces: a `!compactSingle` guard left short
		// landscape unmeasured while the seeded floor stayed in place.
		const source = read("src/features/session/components/composer.tsx");
		const call = source.slice(
			source.indexOf("const seed = seedFor("),
			source.indexOf("const seed = seedFor(") + 200,
		);
		expect(call).toContain("presentation.expanded");
		expect(call).not.toContain("compactSingle");
	});
});
