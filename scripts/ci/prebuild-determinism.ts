#!/usr/bin/env node
/**
 * Assert that a regenerated native project is byte-identical to the one that was
 * built, so a build can never have come from a hand-edited file.
 *
 *     node scripts/ci/prebuild-determinism.ts --built "$RUNNER_TEMP/android-built" \
 *                                             --regenerated android
 *
 * Why this is a gate rather than a nicety (ADR 0004): `ios/` and `android/` are
 * NOT committed. Continuous native generation is the source of truth, which means
 * the config and its plugins are the reviewed artefact and the native tree is a
 * build product. The failure this catches is the one that has no other symptom:
 * someone edits `android/app/build.gradle` to make a build work, the build
 * passes, and the next `expo prebuild --clean` silently discards the fix.
 *
 * Build OUTPUT is excluded on purpose — `build/`, `.gradle/`, `Pods/`,
 * `local.properties` and friends are written by the build itself and differ
 * between any two runs of the same source. Comparing them would make this gate
 * fail for a reason that has nothing to do with the claim it is making, and a
 * gate that fails for the wrong reason is one people learn to ignore.
 *
 * Run directly by Node (type-stripping, no build step, no dependency).
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";

/** Directory and file names that are build output or machine-local state. */
const IGNORED = new Set<string>([
	// Gradle / Android
	"build",
	".gradle",
	".cxx",
	"local.properties",
	// CocoaPods / Xcode
	"Pods",
	"DerivedData",
	".xcode.env.local",
	"xcuserdata",
	// Metro / tooling
	".expo",
	"node_modules",
	".DS_Store",
]);

/** Read `--name value`, falling back to `fallback`. */
const arg = (name: string, fallback: string): string => {
	const i = process.argv.indexOf(`--${name}`);
	return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
};

const message = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

const built = arg("built", "");
const regenerated = arg("regenerated", "");
if (!built || !regenerated) {
	console.error(
		"::error::--built <dir> and --regenerated <dir> are both required.",
	);
	process.exit(1);
}

for (const name of arg("ignore", "")
	.split(",")
	.map((entry) => entry.trim())
	.filter(Boolean)) {
	IGNORED.add(name);
}

/** Walk a tree into a map of tree-relative path → file contents. */
const walk = (root: string): Map<string, Buffer> => {
	const files = new Map<string, Buffer>();
	const visit = (dir: string): void => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (IGNORED.has(entry.name)) continue;
			const full = join(dir, entry.name);
			if (entry.isDirectory()) visit(full);
			else if (entry.isFile()) {
				files.set(
					relative(root, full).split(sep).join("/"),
					readFileSync(full),
				);
			}
		}
	};
	visit(root);
	return files;
};

let a: Map<string, Buffer>;
let b: Map<string, Buffer>;
try {
	a = walk(built);
	b = walk(regenerated);
} catch (error) {
	console.error(`::error::could not read a tree: ${message(error)}`);
	process.exit(1);
}

const onlyBuilt: string[] = [];
const onlyRegenerated: string[] = [];
const differing: string[] = [];

for (const [path, content] of a) {
	const other = b.get(path);
	if (other === undefined) onlyBuilt.push(path);
	else if (!content.equals(other)) differing.push(path);
}
for (const path of b.keys()) if (!a.has(path)) onlyRegenerated.push(path);

const problems = [...onlyBuilt, ...onlyRegenerated, ...differing];

console.log(`built:       ${built} (${a.size} file(s))`);
console.log(`regenerated: ${regenerated} (${b.size} file(s))`);
for (const path of onlyBuilt) console.log(`  only in built:       ${path}`);
for (const path of onlyRegenerated)
	console.log(`  only in regenerated: ${path}`);
for (const path of differing) console.log(`  differs:             ${path}`);

/**
 * Why a file differs, so the next step is a reading rather than a guess.
 *
 * The gate used to name the path and nothing else, which is not enough to act on:
 * a `project.pbxproj` that differs can mean a plugin is not idempotent, a build
 * wrote into the source tree, or a generator is non-deterministic, and the fix is
 * different for each. Text files get a bounded unified diff; binary files get
 * their sizes, because a diff of those is noise.
 */
const explainDifference = (
	label: string,
	left: Buffer,
	right: Buffer,
): void => {
	if (left.includes(0) || right.includes(0)) {
		console.log(
			`    ${label}: binary, ${left.length} bytes built vs ${right.length} regenerated`,
		);
		return;
	}
	const dir = mkdtempSync(join(tmpdir(), "cng-diff-"));
	const leftPath = join(dir, "built");
	const rightPath = join(dir, "regenerated");
	writeFileSync(leftPath, left);
	writeFileSync(rightPath, right);
	let output = "";
	try {
		execFileSync("diff", ["-u", leftPath, rightPath], { encoding: "utf8" });
	} catch (error) {
		// `diff` exits 1 precisely when the files differ, which is why we are here.
		output = (error as { stdout?: string }).stdout ?? "";
	}
	const changed = output
		.split("\n")
		.filter(
			(line) =>
				line.startsWith("+") || line.startsWith("-") || line.startsWith("@@"),
		);
	const shown = changed.slice(0, 40);
	for (const line of shown) console.log(`    ${line}`);
	if (changed.length > shown.length) {
		console.log(`    … ${changed.length - shown.length} more changed line(s)`);
	}
};

for (const path of differing) {
	const left = a.get(path);
	const right = b.get(path);
	if (left !== undefined && right !== undefined) {
		explainDifference(path, left, right);
	}
}

if (problems.length > 0) {
	console.error(
		`::error::the regenerated native project differs from the one that was ` +
			`built in ${problems.length} path(s). Since \`ios/\` and \`android/\` are ` +
			"generated (ADR 0004), this means the config or a config plugin does not " +
			"account for something the build did — fix the plugin, not the generated " +
			"file, which the next `expo prebuild --clean` will discard.",
	);
	process.exit(1);
}

console.log("native project: regenerates byte-identical to the built tree.");
