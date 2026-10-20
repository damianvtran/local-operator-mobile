import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CENTRED = /\btext-center\b/;

/**
 * SOURCE CHECK, not a render (the Node test environment has no render seam for a
 * `uniwind` component): the tool row's delivery glyph is left-aligned with its label
 * rail, so a label that wraps puts line 2 on the same rail as line 1. It was
 * `text-center`, which put line 2 at -2.6 pt on the real app at 150 % (CI audit U-41,
 * 18 rows on `S5/send-delivery`). The discriminating proof is the audit's U-41 rows on
 * that state, which are what the PR's evidence and CI carry; this test only stops the
 * class returning silently.
 */
describe("tool row rail", () => {
	const source = readFileSync(
		fileURLToPath(new URL("./tool-row.tsx", import.meta.url)),
		"utf8",
	);

	it("does not centre the delivery glyph's text", () => {
		expect(source).not.toMatch(CENTRED);
	});
});
