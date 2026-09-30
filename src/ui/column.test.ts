import { describe, expect, it } from "vitest";

import { maxColumnWidth } from "@/ui/column";

/**
 * The kit's `space.maxContentWidth` is a lookup, so the cases that matter are the
 * boundaries: a phone in portrait is uncapped, the same phone on its side is
 * capped, and the tablet breakpoint changes which cap applies.
 */
describe("maxColumnWidth", () => {
	it("leaves a phone in portrait to the gutters", () => {
		expect(maxColumnWidth({ width: 390, height: 844 })).toBeNull();
		expect(maxColumnWidth({ width: 320, height: 568 })).toBeNull();
	});

	it("caps a landscape phone, where the line would otherwise run the screen", () => {
		expect(maxColumnWidth({ width: 844, height: 390 })).toBe(620);
	});

	it("uses the tablet widths at and above the breakpoint, per orientation", () => {
		expect(maxColumnWidth({ width: 768, height: 1024 })).toBe(560);
		expect(maxColumnWidth({ width: 1024, height: 768 })).toBe(640);
		expect(maxColumnWidth({ width: 700, height: 900 })).toBe(560);
		expect(maxColumnWidth({ width: 699, height: 400 })).toBe(620);
	});
});
