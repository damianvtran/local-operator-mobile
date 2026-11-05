import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { PROOF_THEMES, THEME_FRAMES } from "./theme-proof-contract.ts";

/** The flow and the runner's inventory are two files; this keeps them one list.
 *  A capture the flow takes but the inventory omits would ship unchecked, and
 *  one the inventory names but the flow never takes would fail every run. */
describe("the theme proof's frame inventory", () => {
	const flow = readFileSync(
		new URL("../../e2e/maestro/theme-proof/theme-matrix.yaml", import.meta.url),
		"utf8",
	);
	const shots = [...flow.matchAll(/^- takeScreenshot: (\S+)$/gm)].map(
		(m) => m[1],
	);

	it("captures exactly the frames the runner requires, in order", () => {
		expect(shots).toEqual(THEME_FRAMES);
	});

	it("applies every proof theme through its own picker card", () => {
		for (const theme of PROOF_THEMES) {
			expect(flow).toContain(`id: "theme-card-${theme}"\n      selected: true`);
		}
	});
});
