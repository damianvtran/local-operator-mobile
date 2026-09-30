#!/usr/bin/env node
/**
 * Derive this build's version numbers from the git ref.
 *
 *     node scripts/ci/version.mjs                        # read the GitHub env, print them
 *     node scripts/ci/version.mjs --write                # also export them to the job
 *     node scripts/ci/version.mjs --ref-name v1.2.3 --ref-type tag --run-number 42
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
 * No third-party dependency: this runs before `pnpm install` in every job, so
 * it must work on a bare checkout.
 */

import { appendFileSync } from "node:fs";

/** `v1.2.3` is the only accepted tag shape. A moving tag or a suffixed one is a
 * mistake rather than a version, and silently deriving something from it would
 * put a version on a build that no store will accept. */
const TAG = /^v(\d+)\.(\d+)\.(\d+)$/;

const PLACEHOLDER_VERSION = "0.0.0";

/** Read `--name value`, falling back to `fallback`. */
const arg = (name, fallback) => {
	const i = process.argv.indexOf(`--${name}`);
	return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
};

/**
 * The whole rule, as a pure function, so the CLI below is only about wiring.
 *
 * @param {{refType: string, refName: string, runNumber: string}} ref
 * @returns {{version: string, displayVersion: string, versionCode: string, fromTag: boolean}}
 */
export const derive = ({ refType, refName, runNumber }) => {
	const match = refType === "tag" ? TAG.exec(refName) : null;
	const code = Number(runNumber);
	if (!Number.isSafeInteger(code) || code <= 0) {
		throw new Error(
			"a build number is required and must be a positive integer — pass " +
				"--run-number, or set GITHUB_RUN_NUMBER (GitHub sets it for you). " +
				"Both stores compare it at upload time, so it is never optional.",
		);
	}
	if (match) {
		const [, major, minor, patch] = match;
		const version = `${major}.${minor}.${patch}`;
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

const refType = arg("ref-type", process.env.GITHUB_REF_TYPE ?? "");
const refName = arg("ref-name", process.env.GITHUB_REF_NAME ?? "");
const runNumber = arg("run-number", process.env.GITHUB_RUN_NUMBER ?? "");

let derived;
try {
	derived = derive({ refType, refName, runNumber });
} catch (error) {
	console.error(`::error::${error.message}`);
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
