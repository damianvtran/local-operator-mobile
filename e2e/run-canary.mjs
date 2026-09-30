#!/usr/bin/env node
/**
 * The canary run: capture the audit fixture, audit it, and assert both directions.
 *
 *   node e2e/run-canary.mjs [--worktree <path>]
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

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_WORKTREE = resolve(HERE, "..");

const args = process.argv.slice(2);
const flag = (name, fallback) => {
	const index = args.indexOf(`--${name}`);
	return index === -1 ? fallback : args[index + 1];
};

const worktree = flag("worktree", DEFAULT_WORKTREE);
const scratch = process.env.LOCAL_OPERATOR_SCRATCHPAD ?? "/tmp";
const out = join(scratch, "canary");
const canaryDir = join(worktree, "e2e", "fixtures", "audit-canary");

/**
 * The design tokens gate the per-frame canvas comparison. They ship in their own
 * change, so a run without them is not a failed canary — it is a run that cannot
 * make that one comparison, and it is reported as such rather than silently
 * skipping it.
 */
const tokens = [
	join(worktree, "design", "tokens", "tokens.json"),
	join(scratch, "spec", "design_brand-kit", "design", "tokens", "tokens.json"),
].find((path) => existsSync(path));

const run = (label, command, commandArgs) => {
	console.log(`\n=== ${label}`);
	const result = spawnSync(command, commandArgs, { stdio: "inherit", cwd: worktree });
	return result.status ?? 2;
};

const npx = process.execPath;

console.log(`canary: ${canaryDir}`);
console.log(`tokens: ${tokens ?? "not available — the canvas-vs-token comparison is skipped"}`);

const captureStatus = run("capture the canary matrix", npx, [
	join(worktree, "tools", "visual", "capture.mjs"),
	"--dir", canaryDir,
	"--out", out,
	"--cells", "path:/defects/defects,path:/clean/clean",
	"--devices", "iphone-se,iphone-15",
	"--themes", "dark,light",
	"--scales", "100,200",
	"--consecutive",
	...(tokens ? ["--tokens", tokens] : []),
	"--yes",
]);
if (captureStatus !== 0) {
	console.error(`\ncapture failed (${captureStatus}); the canary cannot run`);
	process.exit(captureStatus);
}

const tokenArgs = tokens ? ["--tokens", tokens] : [];
const defectsStatus = run("audit the defect page (a non-zero exit is the expected result)", npx, [
	join(worktree, "tools", "audit", "audit.mjs"),
	"--manifest", join(out, "manifest.json"),
	"--settle", "900",
	"--quiet",
	...tokenArgs,
]);

// The clean path on its own, so a failure of the defect run cannot be excused by
// "the audit fails on everything".
const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
const cleanManifest = {
	meta: { ...manifest.meta, buildDir: manifest.meta.buildDir },
	records: manifest.records.filter((record) => record.screen.includes("clean")),
};
const cleanManifestPath = join(out, "clean-manifest.json");
mkdirSync(dirname(cleanManifestPath), { recursive: true });
writeFileSync(cleanManifestPath, `${JSON.stringify(cleanManifest, null, 2)}\n`);
// Its own report directory: both runs are otherwise rooted at the manifest's
// directory, and the clean run would overwrite the defect run's report — which
// silently turned the first assertion into a comparison of one report with
// itself.
const cleanReportDir = join(out, "clean-report");
const cleanStatus = run("audit the clean page (must pass)", npx, [
	join(worktree, "tools", "audit", "audit.mjs"),
	"--manifest", cleanManifestPath,
	"--out", cleanReportDir,
	"--settle", "900",
	"--quiet",
	...tokenArgs,
]);

const defects = JSON.parse(readFileSync(join(out, "audit-report.json"), "utf8"));
const clean = JSON.parse(readFileSync(join(cleanReportDir, "audit-report.json"), "utf8"));
const html = readFileSync(join(canaryDir, "index.html"), "utf8");

const declared = [...new Set([...html.matchAll(/data-defect="([^"]+)"/g)].map((m) => m[1]))]
	// `U-01-exception` is the rubric's recorded exception, not a defect: the check
	// must PASS it *by name*, which is a different assertion from catching it.
	.filter((id) => !id.endsWith("-exception"));
const caught = [...new Set(defects.rows.filter((r) => r.verdict === "FAIL").map((r) => r.check))];
const missing = declared.filter((id) => !caught.includes(id));
const cleanFails = clean.rows.filter((r) => r.verdict === "FAIL");
const exceptions = defects.rows.filter((r) => r.verdict === "EXCEPTION");

console.log("\n=== verdict");
console.log(`  declared by the fixture: ${declared.join(", ")}`);
console.log(`  caught by the audit:     ${caught.join(", ")}`);
console.log(`  missed:                  ${missing.length ? missing.join(", ") : "none"}`);
console.log(`  recorded exceptions:     ${exceptions.length}${exceptions.length ? ` (${exceptions.map((e) => e.measured).join("; ")})` : ""}`);
console.log(`  clean-page FAIL rows:    ${cleanFails.length}`);
for (const fail of cleanFails) console.log(`    - ${fail.check} ${fail.screen}/${fail.state} ${fail.measured}`);
console.log(`  defect-page exit: ${defectsStatus} (non-zero expected) · clean-page exit: ${cleanStatus} (zero expected)`);

const ok = missing.length === 0 && cleanFails.length === 0 && defectsStatus !== 0 && cleanStatus === 0;
console.log(
	ok
		? "\nCANARY: PASS — the audit catches every declared defect and passes the clean page"
		: "\nCANARY: FAIL — the instrument is not discriminating",
);
process.exit(ok ? 0 : 1);
