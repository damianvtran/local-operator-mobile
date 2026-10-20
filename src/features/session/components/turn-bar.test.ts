import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Pins the turn bar's U-41/U-42 geometry at the SOURCE, because the audit ledger that
 * used to cover it is gone: `px-2.5` (10 pt) and `gap-1.5` (6 pt) are off the spacing
 * scale, and a ✓ in its own flex column plus a row-centred caret is what put the first
 * line 27.8 pt inside the row at 150 % text. Units run in Node and cannot render, so
 * this is a regression tripwire; the rendered proof is in the PR's artifact index.
 */
const source = readFileSync(new URL("./turn-bar.tsx", import.meta.url), "utf8");

describe("turn-bar.tsx geometry", () => {
	it("uses on-scale spacing only", () => {
		expect(source).not.toMatch(/\b(?:px|py|gap)-\d+\.5\b/);
	});

	it("keeps the caret keyed to the first line and the ✓ inline", () => {
		expect(source).toContain("items-start");
		expect(source).not.toContain("items-center");
		expect(source).toMatch(/✓ /);
	});

	it("keeps each detail's unit unbreakable", () => {
		expect(source).toContain("u00A0");
	});
});
