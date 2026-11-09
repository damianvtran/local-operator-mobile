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

	it("covers the restored four and all three changed light-palette neighbors", () => {
		expect(PROOF_THEMES).toHaveLength(12);
		for (const theme of [
			"catppuccinMocha",
			"tokyoNightStorm",
			"duskfox",
			"outrun",
			"localOperatorLight",
			"rosePineDawn",
			"everforestLight",
		])
			expect(PROOF_THEMES).toContain(theme);
	});

	it("cold-relaunches without clearing storage and reads selection before any card tap", () => {
		const restart = flow.slice(flow.indexOf("- stopApp"));
		expect(restart).toContain("clearState: false");
		expect(restart).not.toContain("clearState: true");
		expect(restart).toContain(
			'id: "theme-card-everforestLight"\n      selected: true',
		);
		expect(restart).toContain(
			'id: "theme-picker-mode-light"\n      selected: true',
		);
		expect(restart).not.toMatch(/- tapOn:\s+id: "theme-(card|picker-mode)-/);
		expect(THEME_FRAMES).toContain("home-persisted-everforestLight");
		expect(THEME_FRAMES).toContain("picker-persisted-everforestLight");
	});

	it("captures exactly the frames the runner requires, in order", () => {
		expect(shots).toEqual(THEME_FRAMES);
	});

	it("applies every proof theme through its own picker card", () => {
		for (const theme of PROOF_THEMES) {
			expect(flow).toContain(`id: "theme-card-${theme}"\n      selected: true`);
		}
	});
});
