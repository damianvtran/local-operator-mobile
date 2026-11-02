import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CENTRED = /\btext-center\b/;
/** The two wiring lines R7 and Q1 depend on. Their pure decisions are tested in
 *  `bridge-row.test.ts`; the one-line wiring had no guard but the audit frames. */
const GLYPH_CALL = /const glyphOverride = bridgeGlyphFor\(bridge\);/;
const CHIP_GATE = /chipLayout === "words" ?/;
/** R17: the layout's scale argument must reach it from the provider, not default. */
const CHIP_SCALE =
	/bridgeChipLayout\(\s*rowWidthPt,\s*chipWord,\s*mark !== null,\s*effectiveScale,\s*\)/;

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

/**
 * R11 — the component's WIRING, which is where R7 and Q1 can silently come back.
 *
 * Both defects lived on one line: re-gating the glyph on the copy
 * (`bridgeOutcome === null ? null : bridgeGlyphFor(bridge)`) restores R7 exactly,
 * and dropping the `chipLayout === "words"` gate re-opens Q1's ellipsis. The pure
 * functions stayed green through both mutations (round-3 review, executed), so
 * these source assertions are the only cheap guard that does not need a render.
 */
describe("tool row bridge wiring", () => {
	const source = readFileSync(
		fileURLToPath(new URL("./tool-row.tsx", import.meta.url)),
		"utf8",
	);

	it("asks the glyph decision with the row alone, never gated on copy", () => {
		expect(source).toMatch(GLYPH_CALL);
		expect(source).not.toMatch(/bridgeGlyphFor\(bridge, bridgeCopy\)/);
	});

	it("paints the chip only when the layout says the phrase fits", () => {
		expect(source).toMatch(CHIP_GATE);
	});

	it("passes the live text scale into the chip layout (R17)", () => {
		/* Dropping the fourth argument silently pins every frame to 100 % while the
		 *  function's scale arm stays green in the unit tests (round-3 review, R17). */
		expect(source).toMatch(CHIP_SCALE);
	});
});
