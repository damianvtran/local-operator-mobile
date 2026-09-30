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

describe("the value never carries the platform's factor", () => {
	it("emits the preference alone, in `rem` for the browser to multiply", () => {
		/* The web path with a `system` preference: the unit does the multiplying, so the
		 *  value is the authored size and a browser at 200 % doubles every role. Capping
		 *  the combined factor instead pinned chrome at 1.5x, and on a chrome-heavy screen
		 *  (Settings) that is most of the text — the run reported a median of 1.40x and
		 *  failed the cell by name. */
		const web = scaledTextVariables(1, "rem");
		expect(Number.parseFloat(web["--text-body"] ?? "") * 16).toBeCloseTo(
			TYPE_STEPS.body.size,
			1,
		);
		expect(Number.parseFloat(web["--text-display"] ?? "") * 16).toBeCloseTo(
			TYPE_STEPS.display.size,
			1,
		);
	});

	it("emits `px` values that nothing multiplies — neither the browser nor RN twice", () => {
		/* Two audiences, one property, and this is the test the blocker needed:
		 *  - web with an EXPLICIT preference: the preference REPLACES the browser's
		 *    factor, which is only true if the value carries no platform factor;
		 *  - native: React Native scales a `fontSize` by `PixelRatio.getFontScale()`
		 *    itself (`allowFontScaling` is left on by design), so a value that carried
		 *    the factor too would square it — measured at 64 px for an authored 16 pt
		 *    body on a platform at 2, with both caps bypassed. */
		const explicit = scaledTextVariables(1.5, "px");
		expect(Number.parseFloat(explicit["--text-body"] ?? "")).toBeCloseTo(
			TYPE_STEPS.body.size * 1.5,
			1,
		);
		const system = scaledTextVariables(1, "px");
		expect(Number.parseFloat(system["--text-body"] ?? "")).toBeCloseTo(
			TYPE_STEPS.body.size,
			1,
		);
	});

	it("still caps what the APP chooses, which is what the cap is for", () => {
		// An in-app 200 % preference: content doubles, chrome stops at 1.5x, because
		// the app chose those sizes and a 28 pt title is already large.
		const preferred = scaledTextVariables(2, "rem");
		expect(
			Number.parseFloat(preferred["--text-display"] ?? "") * 16,
		).toBeCloseTo(TYPE_STEPS.display.size * 1.5, 1);
		expect(Number.parseFloat(preferred["--text-body"] ?? "") * 16).toBeCloseTo(
			TYPE_STEPS.body.size * 2,
			1,
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
