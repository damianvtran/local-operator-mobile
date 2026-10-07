import { describe, expect, it } from "vitest";

import {
	clampTextScale,
	parseTextScalePreference,
	resolveTextScale,
	scaledTextVariables,
	textUnit,
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
	it("defers to the platform by returning no factor of its own", () => {
		// The platform's factor is not this function's business: the unit applies
		// it (`TextUnit`) and the provider bounds it where it is READ. The signature
		// no longer accepts it, so the double application B1 found cannot be
		// reintroduced by a call site that passes it here.
		expect(resolveTextScale("system")).toBe(1);
	});

	it("returns the chosen step as a factor", () => {
		expect(resolveTextScale("200")).toBe(2);
		expect(resolveTextScale("100")).toBe(1);
	});

	it("bounds a chosen step that a corrupt preference got past the parser", () => {
		expect(resolveTextScale("400" as never)).toBe(3);
		expect(resolveTextScale("10" as never)).toBe(0.8);
	});
});

describe("clampTextScale", () => {
	it("bounds the platform reading the provider takes", () => {
		// `platformTextScale` divides the browser's root font size by the baseline
		// and clamps the result, because that number reaches `effectiveScale`, the
		// diagnostics row and every large-text layout decision: a misreported root
		// size must not become a 3.5x ramp (R2-2).
		expect(clampTextScale(0)).toBe(0.8);
		expect(clampTextScale(99)).toBe(3);
		expect(clampTextScale(Number.NaN)).toBe(1);
		expect(clampTextScale(2)).toBe(2);
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
		expect(
			Number.parseFloat(String(web["--text-body"] ?? "")) * 16,
		).toBeCloseTo(TYPE_STEPS.body.size, 1);
		expect(
			Number.parseFloat(String(web["--text-display"] ?? "")) * 16,
		).toBeCloseTo(TYPE_STEPS.display.size, 1);
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
		expect(
			Number.parseFloat(String(explicit["--text-body"] ?? "")),
		).toBeCloseTo(TYPE_STEPS.body.size * 1.5, 1);
		const system = scaledTextVariables(1, "px");
		expect(Number.parseFloat(String(system["--text-body"] ?? ""))).toBeCloseTo(
			TYPE_STEPS.body.size,
			1,
		);
	});

	it("still caps what the APP chooses, which is what the cap is for", () => {
		// An in-app 200 % preference: content doubles, chrome stops at 1.5x, because
		// the app chose those sizes and a 28 pt title is already large.
		const preferred = scaledTextVariables(2, "rem");
		expect(
			Number.parseFloat(String(preferred["--text-display"] ?? "")) * 16,
		).toBeCloseTo(TYPE_STEPS.display.size * 1.5, 1);
		expect(
			Number.parseFloat(String(preferred["--text-body"] ?? "")) * 16,
		).toBeCloseTo(TYPE_STEPS.body.size * 2, 1);
	});
});

describe("the value's FORM, which is a type and not a pixel", () => {
	/* A web build CANNOT catch a defect here: CSS accepts `"16px"` where React
	 *  Native's `fontSize` requires a number, so every frame the project captured was
	 *  consistent with the crash. The guard therefore asserts the type at the
	 *  boundary between the two styling worlds, not a rendered size. */
	it("hands a device target the number form, for every preference", () => {
		/* This is the exact line that crashed: it used to answer `px` off the web, and
		 *  `px` means the value is a `"16px"` string, which `RCTText` casts to Double
		 *  and dies on (`Error while updating property 'fontSize'`, Android). */
		for (const preference of ["system", "100", "150", "200"] as const) {
			expect(textUnit(false, preference)).toBe("native");
		}
	});

	it("keeps the unit the web target needs, where it is not optional", () => {
		expect(textUnit(true, "system")).toBe("rem");
		expect(textUnit(true, "200")).toBe("px");
	});

	it("emits no string at all for the native target", () => {
		/* Asserted over EVERY step rather than one, because the emission is a loop and
		 *  a per-caller guard would leave the next step free to reintroduce the suffix. */
		const native = scaledTextVariables(2, "native");
		for (const [key, value] of Object.entries(native)) {
			expect(typeof value, `${key} must be a number natively`).toBe("number");
			expect(Number.isFinite(value)).toBe(true);
		}
	});

	it("natively emits the same sizes it emits today, without the suffix", () => {
		// The fix changes the form and nothing else: content doubles, chrome caps, and
		// the numbers are the ones the web build states in `px`.
		const native = scaledTextVariables(2, "native");
		const css = scaledTextVariables(2, "px");
		expect(native["--text-body"]).toBe(TYPE_STEPS.body.size * 2);
		expect(native["--text-display"]).toBe(TYPE_STEPS.display.size * 1.5);
		for (const key of Object.keys(native)) {
			expect(native[key]).toBe(Number.parseFloat(String(css[key])));
		}
	});

	it("keeps a unit on every CSS value, so the web build cannot regress", () => {
		for (const unit of ["px", "rem"] as const) {
			const css = scaledTextVariables(1, unit);
			for (const [key, value] of Object.entries(css)) {
				expect(typeof value, `${key} must stay a string`).toBe("string");
				expect(String(value).endsWith(unit)).toBe(true);
			}
		}
	});
});

describe("parseTextScalePreference", () => {
	it("reads anything unrecognised as system, so a corrupt value cannot pin the app", () => {
		expect(parseTextScalePreference("200")).toBe("200");
		expect(parseTextScalePreference("400")).toBe("system");
		expect(parseTextScalePreference(undefined)).toBe("system");
	});
});
