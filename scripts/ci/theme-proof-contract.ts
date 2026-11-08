import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * The theme proof's frame inventory (decision record § 7, PR 2): the picker in
 * each mode, a search, the selected card, and home + session in each theme. A
 * green driver exit alone must not admit an incomplete set, so the runner
 * refuses one; the test beside this file keeps the flow and this list in step.
 */
export const PROOF_THEMES = [
	"localOperatorDark",
	"localOperatorLight",
	"dracula",
	"obsidian",
	"rosePine",
	"rosePineDawn",
	"highContrastLight",
	// Restored maps and the third light-palette safety-margin neighbor. The
	// other two (localOperatorLight/rosePineDawn) are already above.
	"catppuccinMocha",
	"tokyoNightStorm",
	"duskfox",
	"outrun",
	"everforestLight",
] as const;

export const THEME_FRAMES: readonly string[] = [
	"picker-mode-system",
	"picker-mode-light",
	"picker-mode-dark",
	"picker-search-rose",
	"picker-selected-dracula",
	...PROOF_THEMES.flatMap((theme) => [`home-${theme}`, `session-${theme}`]),
	"home-persisted-everforestLight",
	"picker-persisted-everforestLight",
];

const PATH_SEPARATOR = /[\\/]/;

export function collectThemeFrames(output: string, destination: string) {
	const found: string[] = [];
	const visit = (dir: string) => {
		for (const row of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, row.name);
			// No link traversal: only Maestro-owned regular screenshots are collected.
			if (row.isDirectory()) visit(path);
			else if (
				row.isFile() &&
				row.name.endsWith(".png") &&
				relative(output, path).split(PATH_SEPARATOR).includes("takeScreenshot")
			) {
				assert(!found.includes(row.name), `duplicate screenshot ${row.name}`);
				mkdirSync(destination, { recursive: true });
				copyFileSync(path, join(destination, row.name));
				found.push(row.name);
			}
		}
	};
	visit(output);
	for (const name of THEME_FRAMES)
		assert(found.includes(`${name}.png`), `missing ${name}.png`);
	return found;
}
