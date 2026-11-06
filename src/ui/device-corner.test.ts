import { describe, expect, it } from "vitest";
import { composerOuterGap } from "./device-corner";

describe("build389 outer safe-area clearance", () => {
	it("pays each supported navigation band once, outside the shell", () => {
		for (const inset of [0, 16, 24, 34, 48])
			expect(composerOuterGap(inset, false)).toBe(inset + 8);
	});
	it("uses the same 8 pt keyboard gap on home-button, gesture and button navigation", () => {
		for (const inset of [0, 16, 24, 34, 48])
			expect(composerOuterGap(inset, true)).toBe(8);
	});
});
