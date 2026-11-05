import { describe, expect, it } from "vitest";
import { verifyThemes } from "./capture.ts";

/** Assert the real report boundary, not only its palette helper (R164-1).
 * Node strips types, so a missing required property previously printed undefined
 * even while the helper tests passed. This imports the CLI without launching it. */
describe("capture theme report provenance", () => {
	it("returns the computed source for the actual success-log consumer", () => {
		const report = verifyThemes([], {
			perTheme: { dark: { canvas: "#22201c" }, light: { canvas: "#f2ede3" } },
			reason: null,
		});
		expect(report.canvasSource).toBe(
			"the expected canvas is the shipped palette's own value (palette)",
		);
		expect(report.canvasSource).not.toContain("undefined");
	});
});
