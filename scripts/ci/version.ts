#!/usr/bin/env node
/**
 * Derive this build's version numbers from the git ref.
 *
 *     node scripts/ci/version.ts                        # read the GitHub env, print them
 *     node scripts/ci/version.ts --write                # also export them to the job
 *     node scripts/ci/version.ts --ref-name v1.2.3 --ref-type tag --run-number 42
 *
 * Run directly by Node: Node 26 strips the type annotations, so there is no build
 * step and no dependency here. That constrains the SYNTAX (no `enum`, no
 * `namespace`, no parameter properties, no decorators — anything that would need
 * emit) and nothing else.
 *
 * Why derived rather than committed (ADR 0004, "Versioning"): the tag is the one
 * source of truth; a version bumped inside a pull request is a version two
 * branches can disagree about (the sibling repositories spent hours serialising
 * releases that way); and both app stores enforce a monotonic build number at
 * upload time. `github.run_number` is monotonic across every build of the
 * repository and is never reused, so it is the one value that cannot go
 * backwards — which is why it carries `versionCode`/`CFBundleVersion` and the
 * tag carries the human-facing version.
 *
 * WHY THE NON-TAG VERSION IS `0.0.0` AND NOT `0.0.0-dev.<run>`. The ADR writes
 * the JavaScript version as `0.0.0-dev.<run_number>`, but the value that leaves
 * this script is also the one `app.config.ts` writes into the native projects:
 * the same string becomes Android's `versionName` and iOS's
 * `CFBundleShortVersionString`. Apple rejects a non-numeric short version at
 * upload, so a `-dev` suffix would make the internal TestFlight upload fail on
 * every push to `main` — and a build-number-only distinction is exactly what a
 * store wants for an internal build. The dev string is still reported as
 * `display_version`, for summaries. See docs/ci.md, "Versioning".
 *
 * No third-party dependency: this runs before `pnpm install` in every job, so it
 * must work on a bare checkout.
 */

import { appendFileSync } from "node:fs";

/** `v1.2.3` is the only accepted tag shape. A moving tag or a suffixed one is a
 * mistake rather than a version, and silently deriving something from it would
 * put a version on a build that no store will accept. */
const TAG = /^v(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)$/;

const PLACEHOLDER_VERSION = "0.0.0";

export type Derived = {
	version: string;
	displayVersion: string;
	versionCode: string;
	fromTag: boolean;
};

export type Ref = {
	refType: string;
	refName: string;
	runNumber: string;
};

/** The three parts of a tag, or `null` when the ref is not a release tag. */
const parseTag = (refName: string): [number, number, number] | null => {
	const groups = TAG.exec(refName)?.groups;
	if (!groups) return null;
	const { major, minor, patch } = groups;
	// `noUncheckedIndexedAccess` makes every named group possibly-undefined, and
	// that is the truth: a pattern that matched still gives no guarantee about
	// which groups it captured. Narrow rather than assert.
	if (major === undefined || minor === undefined || patch === undefined) {
		return null;
	}
	return [Number(major), Number(minor), Number(patch)];
};

/**
 * The whole rule, as a pure function, so the CLI below is only about wiring.
 *
 * Throws rather than inventing a build number: both stores compare it, so a
 * build without one is not uploadable and a guessed value would be worse than a
 * failed run.
 */
export const derive = ({ refType, refName, runNumber }: Ref): Derived => {
	const code = Number(runNumber);
	if (!Number.isSafeInteger(code) || code <= 0) {
		throw new Error(
			"a build number is required and must be a positive integer — pass " +
				"--run-number, or set GITHUB_RUN_NUMBER (GitHub sets it for you). " +
				"Both stores compare it at upload time, so it is never optional.",
		);
	}
	const tag = refType === "tag" ? parseTag(refName) : null;
	if (tag) {
		const version = tag.join(".");
		return {
			version,
			displayVersion: version,
			versionCode: String(code),
			fromTag: true,
		};
	}
	return {
		version: PLACEHOLDER_VERSION,
		displayVersion: `${PLACEHOLDER_VERSION}-dev.${code}`,
		versionCode: String(code),
		fromTag: false,
	};
};

/** Read `--name value`, falling back to `fallback`. */
const arg = (name: string, fallback: string): string => {
	const i = process.argv.indexOf(`--${name}`);
	return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
};

const message = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

const ref: Ref = {
	refType: arg("ref-type", process.env.GITHUB_REF_TYPE ?? ""),
	refName: arg("ref-name", process.env.GITHUB_REF_NAME ?? ""),
	runNumber: arg("run-number", process.env.GITHUB_RUN_NUMBER ?? ""),
};

let derived: Derived;
try {
	derived = derive(ref);
} catch (error) {
	console.error(`::error::${message(error)}`);
	process.exit(1);
}

const lines = [
	`version=${derived.version}`,
	`display_version=${derived.displayVersion}`,
	`version_code=${derived.versionCode}`,
	`from_tag=${derived.fromTag}`,
];

if (process.argv.includes("--write")) {
	const envFile = process.env.GITHUB_ENV;
	const outputFile = process.env.GITHUB_OUTPUT;
	if (!envFile || !outputFile) {
		console.error(
			"::error::--write needs GITHUB_ENV and GITHUB_OUTPUT, which only exist " +
				"inside a GitHub Actions step. Drop --write to just print the values.",
		);
		process.exit(1);
	}
	// The two variables the app's own config reads, so `expo prebuild` and every
	// Gradle/xcodebuild invocation agree on one version without a committed bump.
	appendFileSync(
		envFile,
		`LOCAL_OPERATOR_MOBILE_VERSION=${derived.version}\n` +
			`LOCAL_OPERATOR_MOBILE_VERSION_CODE=${derived.versionCode}\n` +
			`LOCAL_OPERATOR_MOBILE_VERSION_DISPLAY=${derived.displayVersion}\n`,
	);
	appendFileSync(outputFile, `${lines.join("\n")}\n`);
}

for (const line of lines) console.log(line);
