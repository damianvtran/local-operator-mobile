import { describe, expect, it } from "vitest";
import {
	COMPOSER_CONTROLS_GAP,
	COMPOSER_FIELD_BOX,
	composerPaintedHeight,
	composerPresentation,
	composerShellPadding,
	keyboardOverlap,
} from "./composer-presentation";

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
		expect(
			expanded.top +
				COMPOSER_FIELD_BOX +
				COMPOSER_CONTROLS_GAP +
				COMPOSER_FIELD_BOX +
				expanded.bottom,
		).toBe(112);
		// The shape follows the painted height: half the idle height, and the
		// record's 24 once expanded.
		expect(composerPresentation(empty).height).toBe(56);
		expect(composerPresentation(empty).radius).toBe(28);
		expect(composerPresentation({ ...empty, focused: true }).height).toBe(112);
		expect(composerPresentation({ ...empty, focused: true }).radius).toBe(24);
	});
});
