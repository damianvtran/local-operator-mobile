import { describe, expect, it } from "vitest";

import {
	parseTextScalePreference,
	resolveTextScale,
	scaledTextVariables,
} from "@/ui/text-scale";
import { TYPE_STEPS } from "@/ui/tokens.gen";

/**
 * The text scale's arithmetic only.
 *
 * What is NOT here, deliberately: the scale hook and the provider are proved end
 * to end by the audit harness, whose `medianTextHeight` comparison between the
 * 100 % and 200 % frames is the measurement `U-04` is scored on — a unit test
 * that renders the provider and asserts a variable would re-test the mechanism
 * rather than the outcome, and would pass on a build whose 200 % frames are
 * pixel-identical (which is exactly the defect this change fixes).
 */

describe("resolveTextScale", () => {
	it("follows the platform when nothing was chosen", () => {
		expect(resolveTextScale("system", 1.3)).toBeCloseTo(1.3);
	});

	it("REPLACES the platform signal when a step was chosen", () => {
		// The decision that matters: a reader whose phone is already at 200 % must
		// not get 400 % by asking for 200 %.
		expect(resolveTextScale("200", 2)).toBe(2);
		expect(resolveTextScale("100", 2)).toBe(1);
	});

	it("clamps a misreported platform signal into a usable range", () => {
		// A signal outside the bounds is a misreported value, not a request: below
		// 0.8 type stops being readable, above 3 every layout truncates.
		expect(resolveTextScale("system", 0)).toBe(0.8);
		expect(resolveTextScale("system", 99)).toBe(3);
		expect(resolveTextScale("system", Number.NaN)).toBe(1);
	});
});

/** A px size in the unit the web build emits, rounded the way the module rounds
 *  it: one value per frame is read by an eye, and `1.03125rem` is not. */
const remOf = (px: number) => `${Math.round((px / 16) * 1000) / 1000}rem`;

describe("scaledTextVariables", () => {
	it("scales content in full and caps chrome, touching nothing else", () => {
		const variables = scaledTextVariables(2);
		// Content steps — everything a reader reads — follow the platform exactly.
		for (const name of [
			"body",
			"body-sm",
			"mono",
			"heading",
			"body-lg",
		] as const) {
			// `rem` on the web, so the browser's own root font size — the platform's
			// text scale — multiplies every size.
			expect(variables[`--text-${name}`]).toBe(
				remOf(TYPE_STEPS[name].size * 2),
			);
		}
		// Chrome caps at 1.5: a 28 pt title at 200 % leaves no room for the content
		// on a 320 pt phone (measured, in a captured frame).
		for (const name of ["display", "meta", "mono-label"] as const) {
			expect(variables[`--text-${name}`]).toBe(
				remOf(TYPE_STEPS[name].size * 1.5),
			);
		}
		// Spacing, radii and control heights stay put: this is a text setting, and
		// growing a 44 pt button to 88 pt is a different change.
		//
		// Line height and letter spacing are deliberately absent too. The token line
		// height is unitless and the tracking is in `em`, so both already follow the
		// font size — emitting them here would square the ratio, and the variable list
		// is the contract that says so.
		expect(variables["--text-body--line-height"]).toBeUndefined();
		expect(variables["--text-body--letter-spacing"]).toBeUndefined();
		expect(
			Object.keys(variables).every((key) => key.startsWith("--text-")),
		).toBe(true);
	});
});

describe("the cap bounds what renders, not just the preference", () => {
	it("divides the platform's factor back out of the chrome cap", () => {
		// The web case: a 2x root font size multiplies every `rem` value, so a cap
		// applied to the preference alone renders at 3x — which is why a 28 pt title
		// still ellipsised on a 320 pt phone after the first fix.
		const web = scaledTextVariables(1, "rem", 2);
		expect(Number.parseFloat(web["--text-display"] ?? "") * 16 * 2).toBeCloseTo(
			TYPE_STEPS.display.size * 1.5,
			1,
		);
		// Content is untouched by the cap: it follows the platform exactly.
		expect(Number.parseFloat(web["--text-body"] ?? "") * 16 * 2).toBeCloseTo(
			TYPE_STEPS.body.size * 2,
			1,
		);
		// And at the default platform factor nothing changes.
		expect(scaledTextVariables(1)["--text-display"]).toBe(
			scaledTextVariables(1, "rem", 1)["--text-display"],
		);
	});
});

describe("parseTextScalePreference", () => {
	it("reads anything unrecognised as system, so a corrupt value cannot pin the app", () => {
		expect(parseTextScalePreference("200")).toBe("200");
		expect(parseTextScalePreference("400")).toBe("system");
		expect(parseTextScalePreference(undefined)).toBe("system");
	});
});
