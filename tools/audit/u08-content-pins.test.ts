/** The admission guard's own tests: real git fixture, real content, no browser.
 *
 * WHY A FIXTURE REPOSITORY AND NOT A MOCKED SNAPSHOT. The bug this replaces was
 * an admission rule that a merged, harmless file could refuse (hosted run
 * 40179237342). Proving the replacement needs the real enumerator — `git
 * ls-files`, the index, tracked-vs-untracked — against real file content, not a
 * hand-built map that would agree with the guard by construction. Only the
 * pinned scopes are copied, so the fixture is a few MB.
 *
 * WHY THE FIXTURE IS ITS OWN BASELINE. Admission is judged against
 * `pinTablesFrom(fixture)`, captured before any case mutates it, never against
 * the committed tables. Judging against the committed tables made "committed
 * `src` pin == this PR's `src`" a unit gate: every app-source PR had to re-pin
 * and concurrent PRs conflicted on that one line (98 of 116 first-parent merges
 * to main, 2026-10-18..11-17, edited the pins file). Whether the LIVE tree still
 * matches the committed scene is the dispatch proof's preflight question
 * (u08-geometry-proof.ts, fail-closed), and a re-pin stays a visible reviewed
 * line made with --print. Two committed-value checks remain on purpose: the
 * instrument files the proof loads must match INSTRUMENT_PINS, and the table
 * keys must match the drivers' import closure.
 *
 * `app` and `src` are past even that: no committed digest exists for them
 * (RUN_DERIVED_ROOTS), so the dispatch preflight cannot go stale on an app merge
 * and no PR re-pins for one. The cases below prove an app edit is admitted AND
 * recorded, and that two sibling app PRs merge without touching this table.
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
	statSync,
	writeFileSync,
} from "node:fs";
import { isBuiltin } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import * as ts from "typescript/unstable/ast";
import { API } from "typescript/unstable/sync";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
	assertPinnedContent,
	COMMITTED_PINS,
	contentDrift,
	INPUT_TREE_PINS,
	INSTRUMENT_PINS,
	isPinnedContentPath,
	type PinTables,
	pinnedScopes,
	pinTablesFrom,
	RENDER_FILE_PINS,
	RENDER_TREE_PINS,
	RUN_DERIVED_ROOTS,
	renderedSource,
	snapshotContent,
	treeDigest,
} from "./u08-content-pins.ts";

const root = resolve(import.meta.dirname, "../..");
const sha = (bytes: Uint8Array) =>
	createHash("sha256").update(bytes).digest("hex");

let fixture: string;
/** Pins of the unmutated fixture: what every admission case is judged against. */
let baseline: PinTables;
let parserRoot: string;
let parser: API;
let parserConfig: string | undefined;
let parserSequence = 0;

/** Copy every pinned scope into a throwaway git repository. `git add -A` is what
 * the guard reads: a merged file is in the index, a scratch file is not. */
beforeAll(() => {
	parserRoot = mkdtempSync(join(tmpdir(), "u08-import-parser-"));
	parser = new API({ cwd: parserRoot });
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
	baseline = pinTablesFrom(snapshotContent(fixture));
	// Real git/index and corpus copying shares host I/O with other sessions;
	// keep setup bounded without mistaking a 10s fleet-load delay for drift.
}, 30_000);

afterAll(() => {
	parser?.close();
	if (parserRoot) rmSync(parserRoot, { recursive: true, force: true });
	if (fixture) rmSync(fixture, { recursive: true, force: true });
});

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
		expect(contentDrift(content, baseline)).toEqual([]);
		expect(() => assertPinnedContent(content, baseline)).not.toThrow();
	});

	it("refuses an edited instrument file and names it with both hashes", () => {
		const path = "tools/audit/checks.ts";
		append(path, "\n// policy drift\n");
		execFileSync("git", ["add", "-A"], { cwd: fixture });
		const actual = sha(readFileSync(resolve(fixture, path)));
		const pinned = baseline.instrument[path];
		expect(actual).not.toBe(pinned);
		// Exact, not contains: against the fixture baseline this edit is the only
		// drift, so nothing else can satisfy the refusal.
		expect(contentDrift(snapshotContent(fixture), baseline)).toEqual([
			{ kind: "instrument", scope: path, pinned, actual },
		]);
		expect(() =>
			assertPinnedContent(snapshotContent(fixture), baseline),
		).toThrow(`instrument ${path} pinned=${pinned} actual=${actual}`);
	});

	it("refuses an edited harness module the driver loads and names it", () => {
		// chrome.ts chooses the browser flags the paint-fragment measurement runs
		// under; it is not app source, so no render root covers it.
		const path = "tools/lib/chrome.ts";
		append(path, "\n// flag drift\n");
		execFileSync("git", ["add", "-A"], { cwd: fixture });
		expect(() =>
			assertPinnedContent(snapshotContent(fixture), baseline),
		).toThrow(
			`instrument ${path} pinned=${baseline.instrument[path]} actual=${sha(
				readFileSync(resolve(fixture, path)),
			)}`,
		);
	});

	it.each(["fixtures/relay", "fixtures/supplements"])(
		"admits README-only edits and deletion in %s",
		(scope) => {
			append(`${scope}/README.md`, "\nDocumentation only.\n");
			execFileSync("git", ["add", "-A"], { cwd: fixture });
			expect(() =>
				assertPinnedContent(snapshotContent(fixture), baseline),
			).not.toThrow();
			rmSync(resolve(fixture, `${scope}/README.md`));
			expect(() =>
				assertPinnedContent(snapshotContent(fixture), baseline),
			).not.toThrow();
		},
	);

	it("keeps fixture selection aligned with reader behavior, not prose extensions", () => {
		for (const path of [
			"fixtures/relay/http/new.json",
			"fixtures/relay/synthetic/new.json",
			"fixtures/relay/sse/new.txt",
			"fixtures/relay/sse/README.md",
			"fixtures/supplements/rows/new.json",
			"fixtures/supplements/documents/populated.html",
		])
			expect(isPinnedContentPath(path), path).toBe(true);
		for (const path of [
			"fixtures/relay/README.md",
			"fixtures/supplements/README.md",
			"fixtures/relay/LICENSE",
			"fixtures/relay/http/notes.md",
			"fixtures/supplements/messages/messages.json",
			"fixtures/relay/probes/unused.json",
		])
			expect(isPinnedContentPath(path), path).toBe(false);
	});

	it.each([
		"fixtures/supplements/rows/done_populated.json",
		"fixtures/supplements/documents/populated.html",
	])("refuses a real supplement input edit: %s", (path) => {
		append(path, "\n");
		expect(() =>
			assertPinnedContent(snapshotContent(fixture), baseline),
		).toThrow("input-tree fixtures/supplements");
	});

	it.each(["fixtures/relay/http/new.json", "fixtures/relay/sse/README.md"])(
		"refuses newly tracked reader inputs, including SSE prose: %s",
		(path) => {
			writeFileSync(resolve(fixture, path), "{}");
			execFileSync("git", ["add", "-A"], { cwd: fixture });
			expect(() =>
				assertPinnedContent(snapshotContent(fixture), baseline),
			).toThrow("input-tree fixtures/relay");
		},
	);

	it("refuses an edited relay fixture through the input digest, not just the scenario name", () => {
		// RECORD.pinnedScenario pins the scenario name; the rows behind it come
		// from the corpus, and a changed row moves the line boxes.
		const path = "fixtures/relay/http/checkpoints-deep.json";
		append(path, "\n");
		execFileSync("git", ["add", "-A"], { cwd: fixture });
		const content = snapshotContent(fixture);
		const actual = treeDigest(content, "fixtures/relay");
		expect(actual).not.toBe(baseline.inputTree["fixtures/relay"]);
		expect(() => assertPinnedContent(content, baseline)).toThrow(
			`input-tree fixtures/relay pinned=${baseline.inputTree["fixtures/relay"]} actual=${actual}`,
		);
	});

	it("admits an edited app source file but records it, while still refusing an edited relay input", () => {
		const before = renderedSource(snapshotContent(fixture));
		append("src/ui/theme.css", "\n/* repaint */\n");
		append("fixtures/relay/http/checkpoints-deep.json", "\n");
		execFileSync("git", ["add", "-A"], { cwd: fixture });
		const content = snapshotContent(fixture);
		const relay = treeDigest(content, "fixtures/relay");
		// Only the scene input refuses; the app is what the proof measures.
		expect(contentDrift(content, baseline)).toEqual([
			{
				kind: "input-tree",
				scope: "fixtures/relay",
				pinned: baseline.inputTree["fixtures/relay"],
				actual: relay,
			},
		]);
		expect(() => assertPinnedContent(content, baseline)).toThrow(
			`input-tree fixtures/relay pinned=${baseline.inputTree["fixtures/relay"]} actual=${relay}`,
		);
		expect(renderedSource(content).src).not.toBe(before.src);
		expect(renderedSource(content).app).toBe(before.app);
	});

	it("judges against the table it is given, and defaults to the committed tables", () => {
		const content = snapshotContent(fixture);
		// The baseline is the fixture, so it carries every committed key.
		for (const table of [
			"instrument",
			"renderTree",
			"inputTree",
			"renderFile",
		] as const)
			expect(Object.keys(baseline[table]).sort()).toEqual(
				Object.keys(COMMITTED_PINS[table]).sort(),
			);
		// A shifted expectation is reported against itself, not the committed pin:
		// the parameter is honoured, so the baseline cases above are not vacuous.
		const shifted: PinTables = {
			...baseline,
			renderTree: {
				...baseline.renderTree,
				"design/tokens": "0".repeat(64),
			},
		};
		expect(contentDrift(content, shifted)).toEqual([
			{
				kind: "render-tree",
				scope: "design/tokens",
				pinned: "0".repeat(64),
				actual: baseline.renderTree["design/tokens"],
			},
		]);
		// No argument means the committed trust root — what the proof calls.
		expect(COMMITTED_PINS.instrument).toBe(INSTRUMENT_PINS);
		expect(COMMITTED_PINS.renderTree).toBe(RENDER_TREE_PINS);
		expect(COMMITTED_PINS.inputTree).toBe(INPUT_TREE_PINS);
		expect(COMMITTED_PINS.renderFile).toBe(RENDER_FILE_PINS);
		expect(contentDrift(content)).toEqual(
			contentDrift(content, COMMITTED_PINS),
		);
	});

	it("holds the committed instrument pins to the files the proof loads", () => {
		// Deliberately NOT fixture-relative: the instrument is the measuring code
		// (closure-checked below), and an edit to it must re-pin in the same PR so
		// the change is a visible reviewed line. Render/input roots are the scene
		// and are checked by the dispatch preflight instead.
		expect(
			contentDrift(snapshotContent(fixture)).filter(
				(entry) =>
					entry.kind === "instrument" ||
					(entry.kind === "missing" && entry.scope in INSTRUMENT_PINS),
			),
		).toEqual([]);
	});

	it("admits an edited app source file and returns its digest for the receipt", () => {
		// The regression this file exists to prevent: an app edit used to refuse
		// here unless the PR re-pinned `src`, which serialized every app PR.
		const before = renderedSource(snapshotContent(fixture));
		append("src/ui/theme.css", "\n/* repaint */\n");
		mkdirSync(resolve(fixture, "app/(new)"), { recursive: true });
		writeFileSync(resolve(fixture, "app/(new)/route.tsx"), "export {};\n");
		execFileSync("git", ["add", "-A"], { cwd: fixture });
		const content = snapshotContent(fixture);
		expect(contentDrift(content, baseline)).toEqual([]);
		// Same snapshot, same digest function as a historical pin: the receipt
		// names exactly the bytes that were rendered.
		expect(assertPinnedContent(content, baseline)).toEqual({
			app: treeDigest(content, "app"),
			src: treeDigest(content, "src"),
		});
		// And the recorded identity really moved with the edit, for both roots.
		expect(treeDigest(content, "src")).not.toBe(before.src);
		expect(treeDigest(content, "app")).not.toBe(before.app);
	});

	it("still refuses a tracked app source file deleted without staging", () => {
		const path = "src/ui/theme.css";
		rmSync(resolve(fixture, path));
		const content = snapshotContent(fixture);
		expect(contentDrift(content, baseline)).toEqual([
			{ kind: "missing", scope: path, pinned: "tracked", actual: "absent" },
		]);
		expect(renderedSource(content).src).toBe("absent");
	});

	it("merges two sibling app-source branches without a conflict or a re-pin", () => {
		// Before: each branch had to paste its own `src:` digest on the same line
		// of u08-content-pins.ts, so whichever merged second was CONFLICTING.
		// After: neither touches the table, git merges the two, and the merged
		// tree is admitted with its own recorded digest.
		const git = (...args: string[]) =>
			execFileSync(
				"git",
				[
					"-c",
					"user.name=fixture",
					"-c",
					"user.email=fixture@example.invalid",
					...args,
				],
				{ cwd: fixture, encoding: "utf8" },
			);
		const sibling = (branch: string, path: string) => {
			git("checkout", "-q", "-b", branch, "main");
			writeFileSync(resolve(fixture, path), `// ${branch}\n`);
			git("add", "-A");
			git("commit", "-qm", branch);
			const content = snapshotContent(fixture);
			expect(contentDrift(content, baseline)).toEqual([]);
			return renderedSource(content).src;
		};
		try {
			const a = sibling("feat-a", "src/feat-a.ts");
			const b = sibling("feat-b", "src/feat-b.ts");
			git("checkout", "-q", "feat-a");
			git("merge", "-q", "--no-edit", "feat-b");
			const merged = snapshotContent(fixture);
			expect(contentDrift(merged, baseline)).toEqual([]);
			expect(new Set([a, b, renderedSource(merged).src]).size).toBe(3);
		} finally {
			git("checkout", "-q", "-f", "main");
			git("branch", "-q", "-D", "feat-a", "feat-b");
		}
	});

	it("refuses an edited design token and an edited dependency-input file", () => {
		writeFileSync(
			resolve(fixture, "design/tokens/tokens.json"),
			`${readFileSync(resolve(fixture, "design/tokens/tokens.json"), "utf8")}\n`,
		);
		execFileSync("git", ["add", "-A"], { cwd: fixture });
		expect(
			contentDrift(snapshotContent(fixture), baseline).map(
				(entry) => `${entry.kind} ${entry.scope}`,
			),
		).toContain("render-tree design/tokens");
		execFileSync("git", ["reset", "-q", "--hard"], { cwd: fixture });
		append("pnpm-lock.yaml", "\n# dependency drift\n");
		execFileSync("git", ["add", "-A"], { cwd: fixture });
		expect(() =>
			assertPinnedContent(snapshotContent(fixture), baseline),
		).toThrow(
			`render-file pnpm-lock.yaml pinned=${baseline.renderFile["pnpm-lock.yaml"]} actual=${sha(
				readFileSync(resolve(fixture, "pnpm-lock.yaml")),
			)}`,
		);
	});

	it("refuses an edited package.json — its main and export script decide the bundle", () => {
		append("package.json", "\n");
		execFileSync("git", ["add", "-A"], { cwd: fixture });
		expect(() =>
			assertPinnedContent(snapshotContent(fixture), baseline),
		).toThrow(
			`render-file package.json pinned=${baseline.renderFile["package.json"]}`,
		);
	});

	it("refuses a deleted instrument file as absent rather than skipping it", () => {
		const path = "tools/audit/color.ts";
		rmSync(resolve(fixture, path));
		execFileSync("git", ["add", "-A"], { cwd: fixture });
		expect(() =>
			assertPinnedContent(snapshotContent(fixture), baseline),
		).toThrow(
			`instrument ${path} pinned=${baseline.instrument[path]} actual=absent`,
		);
	});

	it("reports a tracked file removed without staging by path, not as a crash", () => {
		// Index says the file exists, disk says it does not: the old read threw
		// ENOENT before any verdict could be printed.
		rmSync(resolve(fixture, "tools/audit/color.ts"));
		expect(() =>
			assertPinnedContent(snapshotContent(fixture), baseline),
		).toThrow("missing tools/audit/color.ts pinned=tracked actual=absent");
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
			"design/fonts",
			"design/tokens",
			"public",
		]);
		// The app is run-derived: a committed digest of it is what made every app
		// PR conflict with every other. Re-adding one must fail here.
		expect([...RUN_DERIVED_ROOTS]).toEqual(["app", "src"]);
		for (const derived of RUN_DERIVED_ROOTS)
			expect(Object.keys(RENDER_TREE_PINS)).not.toContain(derived);
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
			...RUN_DERIVED_ROOTS,
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

	it("records the admitted app identity in every receipt the drivers write", () => {
		// The guarantee the old `src` pin gave — these frames came from exactly
		// these bytes — now lives in the receipt; a receipt without it is the gap.
		const proof = readFileSync(
			resolve(root, "tools/audit/u08-geometry-proof.ts"),
			"utf8",
		);
		expect(proof).toContain("const renderedSource = assertPinnedContent();");
		// geometry.json, NOT-REPRODUCED.json, and the hand-off to verifyFragments.
		expect(proof.match(/^\t+renderedSource,$/gm)?.length).toBe(3);
		const fragments = readFileSync(
			resolve(root, "tools/audit/u08-fragment-verification.ts"),
			"utf8",
		);
		// failure.json, each partial cell, and the final receipt.
		expect(
			fragments.match(/renderedSource: ctx\.renderedSource,/g)?.length,
		).toBe(3);
	});
});

/* ------------------------------------------------------------- the closure -- */

/** Use the already-installed compiler: regexes silently lost side effects and
 * quote variants. Unknown/computed edges must stop the completeness claim, not
 * disappear from it. Node builtins are the only non-repository exemption. */
function valueSpecifiers(source: string, entry: string): string[] {
	// TypeScript 7 exposes parsing through its native API, not createSourceFile.
	// One isolated noResolve/noLib project parses only the supplied source; it
	// must not load the app, installed @types or the operator's configuration.
	// Use unique source/project identities: TS 7's API caches source ASTs across
	// snapshots even after disk invalidation. Reusing input.ts made consecutive
	// negative controls parse the first control's bytes instead of their own.
	const sequence = ++parserSequence;
	const input = join(parserRoot, `input-${sequence}.ts`);
	const config = join(parserRoot, `tsconfig-${sequence}.json`);
	writeFileSync(input, source);
	writeFileSync(
		config,
		JSON.stringify({
			compilerOptions: { noResolve: true, noLib: true, types: [] },
			files: [input],
		}),
	);
	const snapshot = parser.updateSnapshot({
		openProjects: [config],
		...(parserConfig ? { closeProjects: [parserConfig] } : {}),
	});
	parserConfig = config;
	try {
		const program = snapshot.getProject(config)?.program;
		if (!program || program.getSyntacticDiagnostics(input).length)
			throw new Error(`Cannot parse import closure: ${entry}`);
		const file = program.getSourceFile(input);
		if (!file) throw new Error(`Missing parsed source: ${entry}`);
		const specs: string[] = [];
		const literal = (node: ts.Node | undefined) => {
			if (
				!node ||
				!(ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
			)
				throw new Error(
					`Unsupported module load ${node?.getText(file) ?? "<missing>"} in ${entry}`,
				);
			specs.push(node.text);
		};
		const visit = (node: ts.Node) => {
			if (ts.isImportDeclaration(node)) {
				const clause = node.importClause;
				const bindings = clause?.namedBindings;
				const onlyTypes =
					clause?.phaseModifier === ts.SyntaxKind.TypeKeyword ||
					(!clause?.name &&
						bindings &&
						ts.isNamedImports(bindings) &&
						bindings.elements.length > 0 &&
						bindings.elements.every((item) => item.isTypeOnly));
				if (!onlyTypes) literal(node.moduleSpecifier);
			} else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
				const clause = node.exportClause;
				const onlyTypes =
					node.isTypeOnly ||
					(clause &&
						ts.isNamedExports(clause) &&
						clause.elements.length > 0 &&
						clause.elements.every((item) => item.isTypeOnly));
				if (!onlyTypes) literal(node.moduleSpecifier);
			} else if (ts.isImportEqualsDeclaration(node) && !node.isTypeOnly) {
				if (!ts.isExternalModuleReference(node.moduleReference))
					throw new Error(
						`Unsupported module alias ${node.getText(file)} in ${entry}`,
					);
				literal(node.moduleReference.expression);
			} else if (
				ts.isCallExpression(node) &&
				(node.expression.kind === ts.SyntaxKind.ImportKeyword ||
					(ts.isIdentifier(node.expression) &&
						node.expression.text === "require") ||
					(ts.isPropertyAccessExpression(node.expression) &&
						node.expression.name.text === "require"))
			) {
				literal(node.arguments[0]);
			}
			node.forEachChild(visit);
		};
		visit(file);
		return specs;
	} finally {
		snapshot.dispose();
	}
}
const REPO_SCOPE = /^(?:tools|src)\//;
const TRUSTED = new Set(["tools/audit/u08-content-pins.ts"]);

function resolveSpecifier(spec: string, from: string): string {
	const base = resolve(root, dirname(from), spec);
	for (const candidate of [
		base,
		`${base}.ts`,
		`${base}.tsx`,
		join(base, "index.ts"),
		join(base, "index.tsx"),
	])
		if (existsSync(candidate) && statSync(candidate).isFile()) {
			const module = candidate.slice(root.length + 1);
			if (!candidate.startsWith(`${root}/`) || !REPO_SCOPE.test(module))
				throw new Error(`Outside pinned roots: ${spec} from ${from}`);
			if (
				!TRUSTED.has(module) &&
				INSTRUMENT_PINS[module] === undefined &&
				!(module.startsWith("src/") && RUN_DERIVED_ROOTS.includes("src"))
			)
				throw new Error(`Unpinned module: ${spec} from ${from}`);
			return module;
		}
	throw new Error(`Unresolved module: ${spec} from ${from}`);
}

/** Static value imports and dynamic imports, which is what Node actually loads. */
function loadedModules(
	entry: string,
	source = readFileSync(resolve(root, entry), "utf8"),
): string[] {
	return valueSpecifiers(source, entry).flatMap((spec) => {
		if (isBuiltin(spec)) return [];
		if (!spec.startsWith("."))
			throw new Error(`Unpinned module: ${spec} from ${entry}`);
		return [resolveSpecifier(spec, entry)];
	});
}

describe("import discovery refuses incomplete closure evidence", () => {
	it.each([
		'import "./u08-content-pins.test.ts";',
		"import { x } from './u08-content-pins.test.ts';",
		"import(`./u08-content-pins.test.ts`);",
		"require('./u08-content-pins.test.ts');",
		'export * from "./u08-content-pins.test.ts";',
	])("refuses an unpinned value edge: %s", (source) => {
		expect(() =>
			loadedModules("tools/audit/u08-geometry-proof.ts", source),
		).toThrow("Unpinned module: ./u08-content-pins.test.ts");
	});

	it.each(["import(path)", "require(path)", `import(\`./\${path}.ts\`)`])(
		"refuses computed loads: %s",
		(source) => {
			expect(() =>
				loadedModules("tools/audit/u08-geometry-proof.ts", source),
			).toThrow("Unsupported module load");
		},
	);

	it.each([
		'import "../../fixtures/relay/README.md";',
		"import('../../fixtures/relay/README.md')",
	])("rejects outside-root edges in every load form: %s", (source) => {
		expect(() =>
			loadedModules("tools/audit/u08-geometry-proof.ts", source),
		).toThrow("Outside pinned roots: ../../fixtures/relay/README.md");
	});

	it("allows pinned literals, builtins and erased type-only imports", () => {
		expect(
			loadedModules(
				"tools/audit/u08-geometry-proof.ts",
				`
			import './color.ts';
			export * from "./color.ts";
			import(\`./color.ts\`);
			require('./color.ts');
			import { readFileSync } from 'node:fs';
			import type { T } from './missing-type.ts';
			import { type T } from './missing-type.ts';
			export type { T } from './missing-type.ts';
		`,
			),
		).toEqual(Array(4).fill("tools/audit/color.ts"));
	});

	it("refuses unpinned packages and invalid syntax", () => {
		expect(() =>
			loadedModules(
				"tools/audit/u08-geometry-proof.ts",
				"import 'unknown-package';",
			),
		).toThrow("Unpinned module: unknown-package");
		expect(() =>
			loadedModules("tools/audit/u08-geometry-proof.ts", "import {"),
		).toThrow("Cannot parse import closure");
	});

	it.each([
		'import "./missing-u08-module.ts";',
		'import { x } from "./missing-u08-module.ts";',
	])(
		"refuses an unresolved specifier rather than dropping it: %s",
		(source) => {
			expect(() =>
				loadedModules("tools/audit/u08-geometry-proof.ts", source),
			).toThrow("Unresolved module: ./missing-u08-module.ts");
		},
	);
});

describe("the pin table covers what the drivers load", () => {
	/** The trust root cannot pin itself; the test asserts this is the only
	 * exemption, so a newly imported module cannot inherit one by accident. */
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
		const instrument = [...seen]
			.filter((module) => !module.startsWith("src/"))
			.filter((module) => !TRUSTED.has(module));
		// Exact keys, including the separately loaded positive-control document:
		// neither dropping a key nor leaving stale exemptions can shrink coverage.
		expect(Object.keys(INSTRUMENT_PINS).sort()).toEqual(
			[...instrument, "e2e/fixtures/audit-canary/index.html"].sort(),
		);
		// App modules the harness imports are recorded in the run-derived `src`
		// digest (RUN_DERIVED_ROOTS explains why they are not pinned), and
		// nothing may load from outside tools/ and src/.
		expect([...seen].filter((module) => !REPO_SCOPE.test(module))).toEqual([]);
		expect([...TRUSTED]).toEqual(["tools/audit/u08-content-pins.ts"]);
	});
});
