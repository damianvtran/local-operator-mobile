import { describe, expect, it } from "vitest";
import { composerPresentation, keyboardOverlap } from "./composer-presentation";

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
});
