#!/usr/bin/env node

/**
 * The canary run: capture the audit fixture, audit it, and assert both directions.
 *
 *   node e2e/run-canary.ts [--worktree <path>] [--out <dir>]
 *
 * Why this exists: **an instrument that cannot fail is worthless.** The fixture
 * page declares its own defects as `data-defect="U-xx"` attributes, so this
 * script can assert that the audit caught every declared one — and that the same
 * audit passes the clean path of the same page. Either half alone is a trap: an
 * audit that fails everything would pass the first assertion, and one that
 * passes everything would pass the second.
 *
 * Plain Node with no dependencies, so it runs anywhere the other tools do
 * (ADR 0003). Exit code 0 means the instrument is discriminating.
 */

import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_WORKTREE = resolve(HERE, "..");

const args = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
	const index = args.indexOf(`--${name}`);
	return index === -1 ? fallback : (args[index + 1] ?? fallback);
};

/** The manifest fields this script reads, as the capture harness writes them. */
interface CanaryManifest {
	meta: Record<string, unknown>;
	records: Array<{ screen: string; [key: string]: unknown }>;
}

/** One audit row, as the report writes it. */
interface AuditRow {
	check: string;
	verdict: string;
	screen?: string;
	state?: string;
	measured?: string | null;
}

/** The audit report fields this script reads. */
interface AuditReport {
	cells: number;
	rows: AuditRow[];
	blocked?: number;
	verdict?: string;
}

const readReport = (path: string): AuditReport => {
	const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
	const bag =
		typeof parsed === "object" && parsed !== null
			? (parsed as Record<string, unknown>)
			: {};
	const rows = Array.isArray(bag.rows) ? (bag.rows as AuditRow[]) : [];
	return { cells: typeof bag.cells === "number" ? bag.cells : 0, rows };
};

const readManifest = (path: string): CanaryManifest => {
	const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
	const bag =
		typeof parsed === "object" && parsed !== null
			? (parsed as Record<string, unknown>)
			: {};
	const records = Array.isArray(bag.records)
		? (bag.records as Array<{ screen: string }>)
		: [];
	// `meta` is carried through verbatim: the audit reads `buildDir` (to serve the
	// build), `relay` (to proxy it) and `textScaleLive` off it, so replacing it
	// with an empty object makes the clean run unable to render anything at all.
	const meta =
		typeof bag.meta === "object" && bag.meta !== null
			? (bag.meta as Record<string, unknown>)
			: {};
	return { meta, records };
};

const worktree = flag("worktree", DEFAULT_WORKTREE);
// A unique output directory per run, and never a shared fixed name: two canaries
// — a developer's and CI's, or two shards — otherwise write one manifest and one
// report over each other mid-run, and each reads the other's numbers.
const scratchRoot = process.env.LOCAL_OPERATOR_SCRATCHPAD ?? tmpdir();
const out = flag("out", mkdtempSync(join(scratchRoot, "canary-")));
const canaryDir = join(worktree, "e2e", "fixtures", "audit-canary");

/**
 * The design tokens gate the per-frame canvas comparison, and they are resolved
 * from the REPOSITORY — never from a path outside it.
 *
 * The earlier revision also looked in an agent's scratchpad, and that fallback
 * was load-bearing: with it removed the canary printed FAIL, so the PASS it had
 * been printing was not reproducible from the repository at all. A canary that
 * cannot find the tokens now exits non-zero with the reason, rather than
 * continuing with the comparison skipped.
 */
const tokens = join(worktree, "design", "tokens", "tokens.json");
if (!existsSync(tokens)) {
	console.error(
		`canary: design tokens not found at ${tokens}.\n` +
			"The design kit ships them (design/tokens/tokens.json); without them the canvas-vs-token\n" +
			"comparison cannot run, and a canary that cannot run a check must not report PASS.",
	);
	process.exit(2);
}

const run = (label: string, command: string, commandArgs: string[]): number => {
	console.log(`\n=== ${label}`);
	const result = spawnSync(command, commandArgs, {
		stdio: "inherit",
		cwd: worktree,
	});
	return result.status ?? 2;
};

const npx = process.execPath;

console.log(`canary: ${canaryDir}`);
console.log(`tokens: ${tokens}`);
console.log(`out:    ${out}`);

const captureStatus = run("capture the canary matrix", npx, [
	join(worktree, "tools", "visual", "capture.ts"),
	"--dir",
	canaryDir,
	"--out",
	out,
	"--cells",
	"path:/defects/defects,path:/clean/clean",
	"--devices",
	"iphone-se,iphone-15",
	"--themes",
	"dark,light",
	"--scales",
	"100,200",
	"--consecutive",
	"--tokens",
	tokens,
	"--yes",
]);
if (captureStatus !== 0) {
	console.error(`\ncapture failed (${captureStatus}); the canary cannot run`);
	process.exit(captureStatus);
}

const tokenArgs = ["--tokens", tokens];
const defectsStatus = run(
	"audit the defect page (a non-zero exit is the expected result)",
	npx,
	[
		join(worktree, "tools", "audit", "audit.ts"),
		"--manifest",
		join(out, "manifest.json"),
		"--settle",
		"900",
		"--quiet",
		...tokenArgs,
	],
);

// The clean path on its own, so a failure of the defect run cannot be excused by
// "the audit fails on everything".
const manifest = readManifest(join(out, "manifest.json"));
if (manifest.records.length === 0) {
	console.error(
		"\ncanary: the capture produced no frames, so neither direction can be asserted",
	);
	process.exit(1);
}
const cleanManifest = {
	meta: { ...manifest.meta },
	records: manifest.records.filter((record: { screen: string }) =>
		record.screen.includes("clean"),
	),
};
// The clean direction must be *non-vacuous*: a filter that matched nothing would
// produce `0 cells, 0 FAIL` and read as a pass, which is exactly the vacuity the
// reviewer demonstrated by making the filter match nothing.
if (cleanManifest.records.length === 0) {
	console.error(
		"\ncanary: no clean-page records were selected; the second direction would be vacuous",
	);
	process.exit(1);
}
const cleanManifestPath = join(out, "clean-manifest.json");
mkdirSync(dirname(cleanManifestPath), { recursive: true });
writeFileSync(cleanManifestPath, `${JSON.stringify(cleanManifest, null, 2)}\n`);
// Its own report directory: both runs are otherwise rooted at the manifest's
// directory, and the clean run would overwrite the defect run's report — which
// silently turned the first assertion into a comparison of one report with
// itself.
const cleanReportDir = join(out, "clean-report");
const cleanStatus = run("audit the clean page (must pass)", npx, [
	join(worktree, "tools", "audit", "audit.ts"),
	"--manifest",
	cleanManifestPath,
	"--out",
	cleanReportDir,
	"--settle",
	"900",
	"--quiet",
	...tokenArgs,
]);

const defects = readReport(join(out, "audit-report.json"));
const clean = readReport(join(cleanReportDir, "audit-report.json"));
const html = readFileSync(join(canaryDir, "index.html"), "utf8");

const declared = [
	...new Set(
		[...html.matchAll(/data-defect="([^"]+)"/g)]
			.map((m) => m[1] ?? "")
			.filter((id) => id !== ""),
	),
]
	// `U-01-exception` is the rubric's recorded exception, not a defect: the check
	// must PASS it *by name*, which is a different assertion from catching it.
	.filter((id) => !id.endsWith("-exception"));
const caught = [
	...new Set(
		defects.rows
			.filter((r: AuditRow) => r.verdict === "FAIL")
			.map((r: AuditRow) => r.check),
	),
];
const missing = declared.filter((id) => !caught.includes(id));
const cleanFails = clean.rows.filter((r: AuditRow) => r.verdict === "FAIL");
const exceptions = defects.rows.filter(
	(r: AuditRow) => r.verdict === "EXCEPTION",
);

console.log("\n=== verdict");
console.log(`  declared by the fixture: ${declared.join(", ")}`);
console.log(`  caught by the audit:     ${caught.join(", ")}`);
console.log(
	`  missed:                  ${missing.length ? missing.join(", ") : "none"}`,
);
console.log(
	`  recorded exceptions:     ${exceptions.length}${exceptions.length ? ` (${exceptions.map((e: AuditRow) => e.measured).join("; ")})` : ""}`,
);
console.log(`  clean-page FAIL rows:    ${cleanFails.length}`);
for (const fail of cleanFails)
	console.log(
		`    - ${fail.check} ${fail.screen}/${fail.state} ${fail.measured}`,
	);
console.log(
	`  defect-page exit: ${defectsStatus} (non-zero expected) · clean-page exit: ${cleanStatus} (zero expected)`,
);

const cleanCells = clean.cells ?? 0;
const cleanRows = clean.rows?.length ?? 0;
const defectRows = defects.rows?.length ?? 0;
console.log(`  defect-page cells/rows:  ${defects.cells}/${defectRows}`);
console.log(`  clean-page cells/rows:   ${cleanCells}/${cleanRows}`);
const vacuous = cleanCells === 0 || cleanRows === 0 || defectRows === 0;
if (vacuous)
	console.log(
		"  VACUOUS: a direction produced no cells or no rows, so nothing was actually asserted",
	);
const ok =
	!vacuous &&
	missing.length === 0 &&
	cleanFails.length === 0 &&
	defectsStatus !== 0 &&
	cleanStatus === 0;
console.log(
	ok
		? "\nCANARY: PASS — the audit catches every declared defect and passes the clean page"
		: "\nCANARY: FAIL — the instrument is not discriminating",
);
process.exit(ok ? 0 : 1);
