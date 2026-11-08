import { describe, expect, it } from "vitest";

import { chromeGlass, glassEnabled, withAlpha } from "@/ui/glass-rule";

const ON = {
	platform: "ios",
	apiAvailable: true,
	liquidGlassAvailable: true,
	reduceTransparency: false,
};

describe("glassEnabled (record §4)", () => {
	it("is on only on iOS 26 with the API safe and Reduce Transparency off", () => {
		expect(glassEnabled(ON)).toBe(true);
		expect(glassEnabled({ ...ON, platform: "android" })).toBe(false);
		expect(glassEnabled({ ...ON, platform: "web" })).toBe(false);
		// The early-beta crash guard (expo/expo#40911).
		expect(glassEnabled({ ...ON, apiAvailable: false })).toBe(false);
		// iOS < 26.
		expect(glassEnabled({ ...ON, liquidGlassAvailable: false })).toBe(false);
		// The accessibility request wins over the style.
		expect(glassEnabled({ ...ON, reduceTransparency: true })).toBe(false);
	});
});

describe("chromeGlass — what the accessibility read has actually returned (R163-2)", () => {
	/* The composer's own policy, which the component feeds its live state into.
	 * The real frame is the evidence (the acceptance matrix names the Reduce
	 * Transparency initial state); this pins the DECISION that frame shows. */
	const ios = { platform: "ios", available: true };

	it("is SOLID until the Reduce Transparency read resolves, and only a false turns it on", () => {
		expect(chromeGlass({ ...ios, reduceTransparency: null })).toBe(false);
		expect(chromeGlass({ ...ios, reduceTransparency: false })).toBe(true);
		expect(chromeGlass({ ...ios, reduceTransparency: true })).toBe(false);
	});

	it("stays solid on a platform without the material, whatever the read says", () => {
		expect(
			chromeGlass({
				platform: "android",
				available: false,
				reduceTransparency: false,
			}),
		).toBe(false);
	});
});

describe("withAlpha", () => {
	it("appends an alpha byte to a hex colour", () => {
		expect(withAlpha("#1d1b17", 0.6)).toBe("#1d1b1799");
		expect(withAlpha("#fff", 1)).toBe("#ffffffff");
	});
	it("leaves a non-hex colour opaque rather than guessing", () => {
		expect(withAlpha("rgb(1, 2, 3)", 0.6)).toBe("rgb(1, 2, 3)");
	});
});
