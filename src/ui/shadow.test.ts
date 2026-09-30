import { describe, expect, it } from "vitest";

import { parseColour, parseCssShadow } from "@/ui/shadow";
import { ELEVATIONS } from "@/ui/tokens.gen";

describe("parseColour", () => {
	it("reads the modern space-separated form the tokens use", () => {
		expect(parseColour("rgb(20 17 12 / 0.25)")).toEqual({
			hex: "#14110c",
			opacity: 0.25,
		});
	});

	it("reads the comma form too, without an alpha", () => {
		expect(parseColour("rgb(0, 0, 0)")).toEqual({ hex: "#000000", opacity: 1 });
	});

	it("refuses anything that is not an rgb colour", () => {
		expect(() => parseColour("#14110c")).toThrow();
	});
});

describe("parseCssShadow", () => {
	it("resolves the overlay token in both themes", () => {
		// `overlay` is the shadow the shell actually uses — the sheet and the dialog,
		// the only two objects that leave the flow.
		for (const theme of ["light", "dark"] as const) {
			const shadow = parseCssShadow(
				ELEVATIONS.overlay[theme],
				ELEVATIONS.overlay.androidElevation,
			);
			expect(shadow, `overlay ${theme}`).not.toBeNull();
			expect(shadow?.shadowOffset.height).toBeGreaterThan(0);
			// Both platforms are set from one token (`tokens.json § elevation`).
			expect(shadow?.elevation).toBe(ELEVATIONS.overlay.androidElevation);
		}
	});

	it("refuses the frame token, which is a two-layer shadow, rather than approximating it", () => {
		// `elevation.frame` is `0 1px 2px …, 0 24px 48px -24px …`: two layers, and
		// React Native's classic shadow fields express one. Approximating would
		// silently change how far a matted image looks from the page, so this pins
		// the refusal — and pins that nothing has quietly made it work by accident.
		// The fix, when something needs `frame`, is React Native's `boxShadow` style
		// (CSS-shaped, new architecture), which is a decision of its own.
		expect(() =>
			parseCssShadow(ELEVATIONS.frame.light, ELEVATIONS.frame.androidElevation),
		).toThrow(/multi-layer|single-layer/i);
	});

	it("folds the negative spread into the blur rather than dropping it", () => {
		// React Native has no spread radius; ignoring `-12px` would render a visibly
		// larger shadow than the token describes.
		const shadow = parseCssShadow(ELEVATIONS.overlay.light, 8);
		expect(shadow?.shadowRadius).toBe(32 - 12);
	});

	it("reports `none` as no shadow", () => {
		expect(parseCssShadow("none", 0)).toBeNull();
	});

	it("refuses a multi-layer shadow instead of approximating it", () => {
		expect(() =>
			parseCssShadow(
				"0 1px 2px rgb(0 0 0 / 0.5), 0 8px 8px rgb(0 0 0 / 0.5)",
				2,
			),
		).toThrow();
	});
});
