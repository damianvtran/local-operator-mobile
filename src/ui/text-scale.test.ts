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

describe("the cap bounds the preference, never the platform", () => {
	it("lets the platform's own factor through every role, chrome included", () => {
		/* The reading this pins: the harness's dimension is the ROOT FONT SIZE, so a
		 *  cell at 200 % must double every role. Capping the combined factor pinned
		 *  chrome at 1.5x, and on a chrome-heavy screen (Settings) that is most of the
		 *  text — the run reported a median of 1.40x and failed the cell by name. */
		const web = scaledTextVariables(1, "rem", 2);
		expect(Number.parseFloat(web["--text-display"] ?? "") * 16 * 2).toBeCloseTo(
			TYPE_STEPS.display.size * 2,
			1,
		);
		expect(Number.parseFloat(web["--text-meta"] ?? "") * 16 * 2).toBeCloseTo(
			TYPE_STEPS.meta.size * 2,
			1,
		);
	});

	it("still caps what the APP chooses, which is what the cap is for", () => {
		// An in-app 200 % preference: content doubles, chrome stops at 1.5x, because
		// the app chose those sizes and a 28 pt title is already large.
		const preferred = scaledTextVariables(2, "rem", 1);
		expect(
			Number.parseFloat(preferred["--text-display"] ?? "") * 16,
		).toBeCloseTo(TYPE_STEPS.display.size * 1.5, 1);
		expect(Number.parseFloat(preferred["--text-body"] ?? "") * 16).toBeCloseTo(
			TYPE_STEPS.body.size * 2,
			1,
		);
	});

	it("applies the platform factor in the value only where the unit cannot", () => {
		// Native has no root font size, so `px` values carry the factor themselves.
		const native = scaledTextVariables(1, "px", 2);
		expect(Number.parseFloat(native["--text-body"] ?? "")).toBeCloseTo(
			TYPE_STEPS.body.size * 2,
			1,
		);
		expect(Number.parseFloat(native["--text-display"] ?? "")).toBeCloseTo(
			TYPE_STEPS.display.size * 2,
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
