import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const PATH_SEPARATOR = /[\\/]/;

// Freeze the complete requested evidence, including the English negative
// control. A green driver exit alone must not admit an incomplete frame set.
export const PROJECT_CREATE_FRAMES = {
	"ur-light": [
		"projects-list",
		"sheet-first",
		"sheet-settled",
		"sheet-archived",
		"sheet-lower",
	],
	"ur-dark": [
		"projects-list",
		"sheet-first",
		"sheet-settled",
		"sheet-archived",
		"sheet-lower",
	],
	"en-control": ["projects-list", "sheet-settled"],
} as const;
export function assertFrameInventory(label: string, names: string[]) {
	const expected =
		PROJECT_CREATE_FRAMES[label as keyof typeof PROJECT_CREATE_FRAMES];
	assert(expected, "unknown proof frame lane");
	for (const name of expected)
		assert(names.includes(`${name}.png`), `missing ${label}/${name}.png`);
}
export function collectProofFrames(
	output: string,
	destination: string,
	label: string,
) {
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
	assertFrameInventory(label, found);
	return found;
}
