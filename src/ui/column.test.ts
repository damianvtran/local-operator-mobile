import { describe, expect, it } from "vitest";

import { estimatedColumnWidth, maxColumnWidth } from "@/ui/column";

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

/* Seeds a markdown table's width before onLayout (PR #224 m1 / D2): at 390
 * the settled table QA measured was 356 px = 358 column − 2·1 border. */
describe("estimatedColumnWidth", () => {
	it("is the portrait phone viewport less a 16pt gutter each side", () => {
		expect(estimatedColumnWidth({ width: 390, height: 844 })).toBe(358);
		expect(estimatedColumnWidth({ width: 320, height: 640 })).toBe(288);
	});

	it("caps a landscape phone and a tablet at the content column", () => {
		expect(estimatedColumnWidth({ width: 844, height: 390 })).toBe(620 - 32);
		expect(estimatedColumnWidth({ width: 1194, height: 834 })).toBe(640 - 32);
	});

	it("never goes negative on an unmeasured window", () => {
		expect(estimatedColumnWidth({ width: 0, height: 0 })).toBe(0);
	});
});
