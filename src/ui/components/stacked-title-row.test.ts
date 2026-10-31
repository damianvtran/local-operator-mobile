import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * `Screen`'s stacked title row, asserted over ITS OWN body only.
 *
 * Kit geometry lives with the kit (agent review round 3, R3-2): the assertion used
 * to sit in the agent-avatar feature suite and anchored on a 160-character window
 * after a non-unique `items-start gap-2`, so it could pass by matching some other
 * row in `screen.tsx`. The body is cut out of the source by its declaration and
 * its closing `};`, and every pattern below must hold inside that slice.
 *
 * Source, not a render: the Node host cannot mount `@/ui` (it reaches uniwind).
 * The geometry itself — an empty mark costs 0 pt, a pictured one is centred on
 * the title's first line — is proved by frames in the design round (D8, D12).
 */
const SCREEN = readFileSync(new URL("./screen.tsx", import.meta.url), "utf8");
const START = SCREEN.indexOf("const StackedTitleRow = (");
const BODY = SCREEN.slice(START, SCREEN.indexOf("\n};\n", START));

/* The row itself spaces nothing: no gap, no padding on the row's own classes. */
const ROW_CLASS = /<View className="flex-row items-start">/;
/* The mark's box is one `display` line tall and carries the 8 pt as a GAP between
 *  the mark and a zero-width end item — so an element rendering `null` leaves a
 *  single item and no gap (D12), and a picture gets exactly 28 + 8 (D8 budget). */
const MARK_BOX =
	/className="flex-row items-center gap-2"\s*style=\{\{ height: lineBoxPt\("display", effectiveScale\) \}\}\s*>\s*\{leading\}\s*<View \/>\s*<\/View>/;
const PADDED = /\bp[rxl]?-\d/;

describe("StackedTitleRow", () => {
	it("is found, and is the only declaration of it", () => {
		expect(START).toBeGreaterThan(0);
		expect(SCREEN.indexOf("const StackedTitleRow = (", START + 1)).toBe(-1);
	});

	it("charges an empty mark nothing and a mark 8 pt, centred on the first line (D8/D12)", () => {
		expect(BODY).toMatch(ROW_CLASS);
		expect(BODY).toMatch(MARK_BOX);
		/* Padding is drawn whether or not the box holds anything — the D12 cost. */
		expect(BODY).not.toMatch(PADDED);
	});
});
