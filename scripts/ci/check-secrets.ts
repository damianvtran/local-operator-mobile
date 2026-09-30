#!/usr/bin/env node
/**
 * Assert that the secrets a build path needs are actually present, by NAME.
 *
 *     node scripts/ci/check-secrets.ts --mode release  --need ANDROID_KEYSTORE_BASE64,…
 *     node scripts/ci/check-secrets.ts --mode internal --need ANDROID_KEYSTORE_BASE64,…
 *
 * Why this exists rather than `if: secrets.X != ''` on every step. GitHub does
 * not pass repository secrets to a `pull_request` run from a fork, so every
 * signing and upload step needs a guard or a fork PR fails on a step it could
 * never have run. Spread across a dozen `if:` expressions, those guards make the
 * one thing that matters invisible: on a RELEASE, a missing credential must stop
 * the run loudly, while on an internal build of `main` it is a state worth
 * warning about. Centralising the decision in one script is what keeps the two
 * cases from looking alike — and it is the reason a release can never "skip" a
 * required store upload by accident: `--mode release` is a hard failure, and it
 * names every absent variable so the fix is one visit to the settings page.
 *
 * The values never touch stdout. A presence check prints a name and a byte
 * count, which is enough to tell "unset" from "set to an empty string" — the
 * latter being the failure that looks configured and behaves as absent.
 *
 * Run directly by Node (type-stripping, no build step, no dependency): this runs
 * before `pnpm install` in every job.
 */

import { appendFileSync } from "node:fs";

const MODES = ["release", "internal"] as const;

type Mode = (typeof MODES)[number];

const isMode = (value: string): value is Mode =>
	MODES.some((mode) => mode === value);

/** Read `--name value` (or a comma-separated list for `--need`). */
const arg = (name: string, fallback: string): string => {
	const i = process.argv.indexOf(`--${name}`);
	return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
};

const rawMode = arg("mode", "");
const need = arg("need", "")
	.split(",")
	.map((name) => name.trim())
	.filter(Boolean);

if (!isMode(rawMode)) {
	console.error(
		`::error::--mode release|internal is required (got ${rawMode ? `"${rawMode}"` : "nothing"}). ` +
			"The mode is the whole point: `release` must fail on a missing credential, " +
			"`internal` must warn and carry on.",
	);
	process.exit(1);
}
const mode: Mode = rawMode;

if (need.length === 0) {
	console.error(
		"::error::--need is required: a comma-separated list of variable NAMES.",
	);
	process.exit(1);
}

const present: string[] = [];
const empty: string[] = [];
const absent: string[] = [];

for (const name of need) {
	const value = process.env[name];
	if (value === undefined) absent.push(name);
	else if (value.trim() === "") empty.push(name);
	else present.push(`${name} (${value.length} bytes)`);
}

for (const line of present) console.log(`present: ${line}`);
// An empty string is its own diagnosis: the variable is configured (someone set
// it), so the reader is looking at a truncated paste or a blanked value rather
// than at a missing one.
for (const name of empty) console.log(`present-but-empty: ${name}`);
for (const name of absent) console.log(`absent: ${name}`);

const missing = [...absent, ...empty];
const summary =
	`secrets (${mode}): ${present.length} present, ${missing.length} missing` +
	(missing.length ? ` — ${missing.join(", ")}` : "");

if (missing.length > 0 && mode === "release") {
	console.error(
		`::error::${summary}. A release cannot proceed without these: the artefact ` +
			"would be unsigned, or the upload would be skipped, and either is a " +
			"silently broken release. Set them in the repository's `release` " +
			'environment (docs/ci.md, "Secrets"), then re-run.',
	);
	process.exit(1);
}
if (missing.length > 0) {
	// Expected on a fork PR, and on this repository until the first signing
	// material is configured. Loud, so it is never mistaken for a passing upload.
	//
	// The wording matters as much as the exit code: the jobs that produce signed
	// artefacts are SKIPPED when this reports a gap (they gate on this step's
	// `all_present`), so a run without credentials has no green tick claiming a
	// signature — see docs/ci.md, "Secrets".
	console.log(
		`::warning::${summary}. The signing jobs are SKIPPED for this push, so ` +
			"nothing was signed and nothing was uploaded. A tagged release FAILS " +
			"rather than skipping.",
	);
}

if (process.env.GITHUB_OUTPUT) {
	appendFileSync(
		process.env.GITHUB_OUTPUT,
		`all_present=${missing.length === 0}\nmissing=${missing.join(" ")}\n`,
	);
}

console.log(summary);
