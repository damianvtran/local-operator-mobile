import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * SOURCE CHECK on the two sheets `session-health.tsx` fills: the health sheet
 * (Ended / Resume) and the header's session menu.
 *
 * The shared `Sheet` already insets its body (`contentContainerClassName="px-4"`,
 * the same 16 pt as its title row), so a body that adds its own `px-4` lands its
 * text and buttons 32 pt in under a 16 pt title — the misaligned left edge in
 * A-session-health-sheet and A-session-header-menu (iphone-15, both themes). The
 * fix belongs in this content, not in `sheet.tsx`, whose inset every other
 * sheet relies on. The discriminating proof is the rendered frame; this test
 * stops the double inset returning.
 */
const SOURCE = readFileSync(
	fileURLToPath(new URL("./session-health.tsx", import.meta.url)),
	"utf8",
);

/** The class list of the first View inside each `<Sheet …>` this file renders
 *  (a leading JSX comment between the two is allowed). */
const SHEET_BODY =
	/<Sheet\b[\s\S]*?>\s*(?:\{\/\*[\s\S]*?\*\/\}\s*)?<View className="([^"]*)"/g;
/** Any horizontal padding or margin utility, logical or physical. */
const HORIZONTAL_INSET = /(^|\s)(px|ps|pe|pl|pr|mx|ms|me)-/;
const sheetBodies = (): string[] =>
	[...SOURCE.matchAll(SHEET_BODY)].map((match) => match[1] ?? "");

describe("session health sheets", () => {
	it("render both sheet bodies", () => {
		expect(sheetBodies()).toHaveLength(2);
	});

	it("add no horizontal inset of their own inside the Sheet's", () => {
		for (const body of sheetBodies())
			expect(body).not.toMatch(HORIZONTAL_INSET);
	});
});
