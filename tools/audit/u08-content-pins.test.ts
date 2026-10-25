/** The admission guard's own tests: real git fixture, real content, no browser.
 *
 * WHY A FIXTURE REPOSITORY AND NOT A MOCKED SNAPSHOT. The bug this replaces was
 * an admission rule that a merged, harmless file could refuse (hosted run
 * 40179237342). Proving the replacement needs the real enumerator — `git
 * ls-files`, the index, tracked-vs-untracked — against real file content, not a
 * hand-built map that would agree with the guard by construction. Only the
 * pinned scopes are copied, so the fixture is a few MB and matches the pins.
 *
 * The last case walks the drivers' real import graph. Without it the pin table
 * only claims to cover what the proof loads; with it, a module added to either
 * driver fails the suite until it is pinned.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
	assertPinnedContent,
	contentDrift,
	INPUT_TREE_PINS,
	INSTRUMENT_PINS,
	pinnedScopes,
	RENDER_FILE_PINS,
	RENDER_TREE_PINS,
	snapshotContent,
	treeDigest,
} from "./u08-content-pins.ts";

const root = resolve(import.meta.dirname, "../..");
const sha = (bytes: Uint8Array) =>
	createHash("sha256").update(bytes).digest("hex");

let fixture: string;

/** Copy every pinned scope into a throwaway git repository. `git add -A` is what
 * the guard reads: a merged file is in the index, a scratch file is not. */
beforeAll(() => {
	fixture = mkdtempSync(join(tmpdir(), "u08-content-pins-"));
	for (const scope of pinnedScopes()) {
		const source = resolve(root, scope);
		if (!existsSync(source)) continue;
		cpSync(source, resolve(fixture, scope), { recursive: true });
	}
	execFileSync("git", ["init", "-q", "-b", "main"], { cwd: fixture });
	execFileSync("git", ["add", "-A"], { cwd: fixture });
	// A base commit gives every case a restore point: the staged-deletion cases
	// rewrite the index, so `checkout -- .` alone cannot bring the file back.
	execFileSync(
		"git",
		[
			"-c",
			"user.name=fixture",
			"-c",
			"user.email=fixture@example.invalid",
			"commit",
			"-qm",
			"fixture baseline",
		],
		{ cwd: fixture },
	);
});

afterAll(() => rmSync(fixture, { recursive: true, force: true }));

/** Restore the base commit and drop untracked additions between cases. */
afterEach(() => {
	execFileSync("git", ["reset", "-q", "--hard"], { cwd: fixture });
	execFileSync("git", ["clean", "-fdq"], { cwd: fixture });
});

const append = (path: string, text: string) =>
	writeFileSync(
		resolve(fixture, path),
		`${readFileSync(resolve(fixture, path), "utf8")}${text}`,
	);

describe("U08 content-identity admission", () => {
	it("admits documentation assets merged since the incident: a store capture and a docs file", () => {
		mkdirSync(resolve(fixture, "design/store-screenshots/iphone-6.9"), {
			recursive: true,
		});
		writeFileSync(
			resolve(fixture, "design/store-screenshots/iphone-6.9/new-frame.png"),
			"not a render input",
		);
		mkdirSync(resolve(fixture, "docs"), { recursive: true });
		writeFileSync(resolve(fixture, "docs/INCIDENT-NOTES.md"), "merged prose");
		execFileSync("git", ["add", "-A"], { cwd: fixture });
		const content = snapshotContent(fixture);
		expect(
			content.files.has("design/store-screenshots/iphone-6.9/new-frame.png"),
		).toBe(false);
		expect(contentDrift(content)).toEqual([]);
		expect(() => assertPinnedContent(content)).not.toThrow();
	});

	it("refuses an edited instrument file and names it with both hashes", () => {
		const path = "tools/audit/checks.ts";
		append(path, "\n// policy drift\n");
		execFileSync("git", ["add", "-A"], { cwd: fixture });
		const actual = sha(readFileSync(resolve(fixture, path)));
		const pinned = INSTRUMENT_PINS[path];
		expect(actual).not.toBe(pinned);
		expect(contentDrift(snapshotContent(fixture))).toContainEqual({
			kind: "instrument",
			scope: path,
			pinned,
			actual,
		});
		expect(() => assertPinnedContent(snapshotContent(fixture))).toThrow(
			`instrument ${path} pinned=${pinned} actual=${actual}`,
		);
	});

	it("refuses an edited harness module the driver loads and names it", () => {
		// chrome.ts chooses the browser flags the paint-fragment measurement runs
		// under; it is not app source, so no render root covers it.
		const path = "tools/lib/chrome.ts";
		append(path, "\n// flag drift\n");
		execFileSync("git", ["add", "-A"], { cwd: fixture });
		expect(() => assertPinnedContent(snapshotContent(fixture))).toThrow(
			`instrument ${path} pinned=${INSTRUMENT_PINS[path]} actual=${sha(
				readFileSync(resolve(fixture, path)),
			)}`,
		);
	});

	it("refuses an edited relay fixture through the input digest, not just the scenario name", () => {
		// RECORD.pinnedScenario pins the scenario name; the rows behind it come
		// from the corpus, and a changed row moves the line boxes.
		const path = "fixtures/relay/http/checkpoints-deep.json";
		append(path, "\n");
		execFileSync("git", ["add", "-A"], { cwd: fixture });
		const content = snapshotContent(fixture);
		const actual = treeDigest(content, "fixtures/relay");
		expect(actual).not.toBe(INPUT_TREE_PINS["fixtures/relay"]);
		expect(() => assertPinnedContent(content)).toThrow(
			`input-tree fixtures/relay pinned=${INPUT_TREE_PINS["fixtures/relay"]} actual=${actual}`,
		);
	});

	it("refuses an edited app source file through the render-tree digest", () => {
		const path = "src/ui/theme.css";
		append(path, "\n/* repaint */\n");
		execFileSync("git", ["add", "-A"], { cwd: fixture });
		const content = snapshotContent(fixture);
		const actual = treeDigest(content, "src");
		expect(actual).not.toBe(RENDER_TREE_PINS.src);
		expect(() => assertPinnedContent(content)).toThrow(
			`render-tree src pinned=${RENDER_TREE_PINS.src} actual=${actual}`,
		);
	});

	it("refuses an edited design token and an edited dependency-input file", () => {
		writeFileSync(
			resolve(fixture, "design/tokens/tokens.json"),
			`${readFileSync(resolve(fixture, "design/tokens/tokens.json"), "utf8")}\n`,
		);
		execFileSync("git", ["add", "-A"], { cwd: fixture });
		expect(
			contentDrift(snapshotContent(fixture)).map(
				(entry) => `${entry.kind} ${entry.scope}`,
			),
		).toContain("render-tree design/tokens");
		execFileSync("git", ["reset", "-q", "--hard"], { cwd: fixture });
		append("pnpm-lock.yaml", "\n# dependency drift\n");
		execFileSync("git", ["add", "-A"], { cwd: fixture });
		expect(() => assertPinnedContent(snapshotContent(fixture))).toThrow(
			`render-file pnpm-lock.yaml pinned=${RENDER_FILE_PINS["pnpm-lock.yaml"]} actual=${sha(
				readFileSync(resolve(fixture, "pnpm-lock.yaml")),
			)}`,
		);
	});

	it("refuses an edited package.json — its main and export script decide the bundle", () => {
		append("package.json", "\n");
		execFileSync("git", ["add", "-A"], { cwd: fixture });
		expect(() => assertPinnedContent(snapshotContent(fixture))).toThrow(
			`render-file package.json pinned=${RENDER_FILE_PINS["package.json"]}`,
		);
	});

	it("refuses a deleted instrument file as absent rather than skipping it", () => {
		const path = "tools/audit/color.ts";
		rmSync(resolve(fixture, path));
		execFileSync("git", ["add", "-A"], { cwd: fixture });
		expect(() => assertPinnedContent(snapshotContent(fixture))).toThrow(
			`instrument ${path} pinned=${INSTRUMENT_PINS[path]} actual=absent`,
		);
	});

	it("reports a tracked file removed without staging by path, not as a crash", () => {
		// Index says the file exists, disk says it does not: the old read threw
		// ENOENT before any verdict could be printed.
		rmSync(resolve(fixture, "tools/audit/color.ts"));
		expect(() => assertPinnedContent(snapshotContent(fixture))).toThrow(
			"missing tools/audit/color.ts pinned=tracked actual=absent",
		);
	});

	it("never prints a deletion as a pinnable value", () => {
		rmSync(resolve(fixture, "tools/audit/color.ts"));
		const result = spawnSync(
			process.execPath,
			["tools/audit/u08-content-pins.ts", "--print", `--root=${fixture}`],
			{ cwd: root, encoding: "utf8", timeout: 60_000 },
		);
		const stdout = result.stdout ?? "";
		expect(result.status).toBe(1);
		expect(stdout).not.toContain('"absent"');
		expect(stdout).toContain("// MISSING tools/audit/color.ts");
		expect(stdout).toContain("never pin a deletion");
		// Paste-ready: complete declarations, not bare entries.
		expect(stdout).toContain(
			"export const INSTRUMENT_PINS: Readonly<Record<string, string>> = {",
		);
		expect(stdout).toContain(
			"export const RENDER_FILE_PINS: Readonly<Record<string, string>> = {",
		);
		expect(result.stderr).toContain("are gone from the tree");
	});

	it("keeps documentation, the design kit's own preview and native plugins outside the pinned scope", () => {
		const scopes = pinnedScopes();
		expect(scopes).toEqual([...scopes].sort());
		// Exact roots: a key dropped by an edit must fail here, not just shrink
		// the loop below.
		expect(Object.keys(RENDER_TREE_PINS).sort()).toEqual([
			"app",
			"design/fonts",
			"design/tokens",
			"public",
			"src",
		]);
		expect(Object.keys(INPUT_TREE_PINS).sort()).toEqual([
			"fixtures/relay",
			"fixtures/supplements",
		]);
		expect(Object.keys(RENDER_FILE_PINS).sort()).toEqual([
			"app.config.ts",
			"metro.config.js",
			"package.json",
			"pnpm-lock.yaml",
			"pnpm-workspace.yaml",
		]);
		for (const out of [
			"design/store-screenshots",
			"design/preview",
			"design/app-icon",
			"plugins",
			"docs",
			"fixtures/quiet-groups.parity.json",
		])
			expect(
				scopes.some((scope) => scope === out || scope.startsWith(`${out}/`)),
			).toBe(false);
		for (const inside of [
			// Every render root, so dropping one cannot pass as a tidy-up.
			...Object.keys(RENDER_TREE_PINS),
			...Object.keys(INPUT_TREE_PINS),
			...Object.keys(RENDER_FILE_PINS),
			"e2e/fixtures/audit-canary/index.html",
			"tools/lib/chrome.ts",
			"tools/mock-relay/scenarios.ts",
		])
			expect(
				scopes.some(
					(scope) => scope === inside || scope.startsWith(`${inside}/`),
				),
			).toBe(true);
	});

	it("gates the real driver before any browser or relay launch", () => {
		const source = readFileSync(
			resolve(root, "tools/audit/u08-geometry-proof.ts"),
			"utf8",
		);
		const gate = source.indexOf("assertPinnedContent()");
		expect(gate).toBeGreaterThan(-1);
		expect(gate).toBeLessThan(source.indexOf("createRelay("));
		expect(gate).toBeLessThan(source.indexOf("launchChrome("));
		expect(source).not.toContain("git diff --exit-code");
	});
});

/* ------------------------------------------------------------- the closure -- */

const STATEMENT =
	/(?:^|\n)\s*(?:import|export)\s+(type\s+)?[^;]*?from\s+"([^"]+)"/g;
const DYNAMIC = /import\(\s*"([^"]+)"\s*\)/g;
const REPO_SCOPE = /^(?:tools|src)\//;

function resolveSpecifier(spec: string, from: string): string | null {
	const base = resolve(root, dirname(from), spec);
	for (const candidate of [
		base,
		`${base}.ts`,
		`${base}.tsx`,
		join(base, "index.ts"),
		join(base, "index.tsx"),
	])
		if (existsSync(candidate)) return candidate.slice(root.length + 1);
	return null;
}

/** Static value imports and dynamic imports, which is what Node actually loads. */
function loadedModules(entry: string): string[] {
	const source = readFileSync(resolve(root, entry), "utf8");
	const specs = [
		...[...source.matchAll(STATEMENT)]
			.filter((match) => !match[1])
			.map((match) => match[2] as string),
		...[...source.matchAll(DYNAMIC)].map((match) => match[1] as string),
	];
	return specs
		.filter((spec) => spec.startsWith("."))
		.map((spec) => resolveSpecifier(spec, entry))
		.filter((module): module is string => module !== null);
}

describe("the pin table covers what the drivers load", () => {
	/** The trust root cannot pin itself; the test asserts this is the only
	 * exemption, so a newly imported module cannot inherit one by accident. */
	const TRUSTED = new Set(["tools/audit/u08-content-pins.ts"]);
	const DRIVERS = [
		"tools/audit/u08-geometry-proof.ts",
		"tools/audit/u08-fragment-verification.ts",
	];

	it("pins every module either driver loads, and only exempts the pins module itself", () => {
		const seen = new Set<string>();
		const stack = [...DRIVERS];
		while (stack.length > 0) {
			const current = stack.pop() as string;
			if (seen.has(current)) continue;
			seen.add(current);
			stack.push(...loadedModules(current));
		}
		const unpinned = [...seen]
			.filter((module) => !module.startsWith("src/"))
			.filter((module) => !TRUSTED.has(module))
			.filter((module) => INSTRUMENT_PINS[module] === undefined);
		expect(unpinned).toEqual([]);
		// App modules the harness imports are covered by the render tree, and
		// nothing may load from outside tools/ and src/.
		expect([...seen].filter((module) => !REPO_SCOPE.test(module))).toEqual([]);
		expect([...TRUSTED]).toEqual(["tools/audit/u08-content-pins.ts"]);
	});
});
