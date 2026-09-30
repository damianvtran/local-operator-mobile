#!/usr/bin/env node
/**
 * Derive this build's version numbers from the git ref and the repository.
 *
 *     node scripts/ci/version.ts                       # read the GitHub env, print them
 *     node scripts/ci/version.ts --write               # also export them to the job
 *     node scripts/ci/version.ts --ref-type tag --ref-name v1.2.3 --write
 *
 * Run directly by Node: Node 26 strips the type annotations, so there is no build
 * step and no dependency here. That constrains the SYNTAX (no `enum`, no
 * `namespace`, no parameter properties, no decorators — anything that would need
 * emit) and nothing else.
 *
 * Why derived rather than committed (ADR 0004, "Versioning"): the tag is the one
 * source of truth; a version bumped inside a pull request is a version two
 * branches can disagree about (the sibling repositories spent hours serialising
 * releases that way); and both stores enforce a monotonic build number at upload
 * time.
 *
 * THE BUILD NUMBER IS A REPOSITORY-GLOBAL COUNTER, WHICH A RUN NUMBER IS NOT.
 * `github.run_number` is "a unique number for each run of a PARTICULAR WORKFLOW"
 * (GitHub's wording), so Android, iOS, CI and E2E each reach 30 independently and
 * `release.yml` sat at 17 — a release cut there would claim a lower `versionCode`
 * than an internal build already uploaded from `main`, and Play rejects a lower
 * one. Measured 2026-09-30: all four workflows at 30, `release.yml` at 17, both
 * artefacts deriving 30. So:
 *
 *   * an internal or pull-request build takes its number from the repository:
 *     the commit count of the ref it builds. Monotonic as the branch grows,
 *     identical for every workflow building the same commit, stored nowhere;
 *   * a RELEASE takes its number from the counter file
 *     (`release/build-number.txt`), which the release pull request bumps, and
 *     this script FAILS unless that number is strictly greater than both the
 *     value at the previous tag and the commit count of the commit being tagged.
 *     The failure names the minimum it needs, so the fix is a number rather than
 *     a search.
 *
 * A re-run of an internal build of the same commit therefore repeats its number;
 * Play rejects a duplicate upload, so re-publishing needs a new commit — or, for
 * a release, the counter bump the failure message asks for. That is deliberate: a
 * number that changes while the code does not is a number nobody can trace back
 * to a build.
 *
 * WHY THE NON-TAG VERSION IS `0.0.0` AND NOT `0.0.0-dev.<number>`. The ADR writes
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

import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";

/** `v1.2.3` is the only accepted tag shape. A moving tag or a suffixed one is a
 * mistake rather than a version, and silently deriving something from it would
 * put a version on a build that no store will accept. */
const TAG = /^v(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)$/;

const PLACEHOLDER_VERSION = "0.0.0";

/** The committed counter a release reads, and the release pull request bumps.
 * Beside the Fastfile rather than at the repository root: it is release
 * machinery, and `release/` is where a reader looks for it. */
const DEFAULT_COUNTER = "release/build-number.txt";

export type Derived = {
	version: string;
	displayVersion: string;
	versionCode: string;
	fromTag: boolean;
};

export type Ref = {
	refType: string;
	refName: string;
	/** Commit count of the built ref: the build number of a non-release build. */
	commitCount: number;
	/** The counter's value, when this ref is a release tag. */
	releaseBuildNumber: number | null;
	/** The counter's value at the previous tag, or 0 when there is none. */
	previousReleaseBuildNumber: number;
	/** Where the counter lives: named in the failure message, so the fix needs no search. */
	counterPath: string;
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
 * failed run. It throws just as hard about a release whose number would not
 * outrank what has already been published — that failure is the one that would
 * otherwise arrive from Play, after the GitHub Release exists.
 */
export const derive = ({
	refType,
	refName,
	commitCount,
	releaseBuildNumber,
	previousReleaseBuildNumber,
	counterPath,
}: Ref): Derived => {
	if (!Number.isSafeInteger(commitCount) || commitCount <= 0) {
		throw new Error(
			"the commit count of this ref is not a positive integer, so there is no " +
				"build number to derive. Check out with `fetch-depth: 0`: a shallow " +
				"clone counts only the commits it fetched.",
		);
	}
	const isTag = refType === "tag";
	const tag = isTag ? parseTag(refName) : null;
	if (isTag && tag === null) {
		throw new Error(
			`"${refName}" is a tag that is not vMAJOR.MINOR.PATCH, so there is no ` +
				"version to derive from it. A suffixed or moving tag is a mistake " +
				"rather than a version, and deriving something from it would put a " +
				"version on a build no store will accept.",
		);
	}

	let releaseNumber = 0;
	if (isTag) {
		if (releaseBuildNumber === null || releaseBuildNumber <= 0) {
			throw new Error(
				`a release needs its build number in ${counterPath} — both stores ` +
					"compare it, and a run number is not a repository-wide counter.",
			);
		}
		const minimum = Math.max(previousReleaseBuildNumber + 1, commitCount + 1);
		if (releaseBuildNumber < minimum) {
			throw new Error(
				`the release build number ${releaseBuildNumber} is not greater than ` +
					`${minimum}. It has to outrank both the previous release's ` +
					`${previousReleaseBuildNumber} and this commit's count of ` +
					`${commitCount} (internal builds use commit counts, so a release ` +
					`must beat the builds already published from main). Set ` +
					`${counterPath} to ${minimum} or higher in the release pull ` +
					"request, then tag.",
			);
		}
		releaseNumber = releaseBuildNumber;
	}

	const code = isTag ? releaseNumber : commitCount;
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

const git = (args: string[], quiet = false): string =>
	execFileSync("git", args, {
		encoding: "utf8",
		// `describe` with no tags prints `fatal: No names found` on stderr, and that
		// is a legitimate answer here (there is no previous release to outrank), so
		// the optional lookups silence it rather than putting a fatal line in the
		// log of every first release.
		stdio: ["ignore", "pipe", quiet ? "ignore" : "inherit"],
	}).trim();

/**
 * The repository-global build number: how many commits this ref has.
 *
 * A shallow clone would count only what it fetched, and silently derive a number
 * that is too low — the exact failure mode this whole scheme exists to prevent —
 * so it is refused rather than corrected.
 */
const commitCount = (ref: string): number => {
	if (git(["rev-parse", "--is-shallow-repository"]) === "true") {
		throw new Error(
			"this is a shallow clone, so a commit count would be the count of what " +
				"was fetched rather than of the repository. Check out with " +
				"`fetch-depth: 0`.",
		);
	}
	return Number(git(["rev-list", "--count", ref]));
};

/** A counter file's value, in the working tree or (with `ref`) at a revision. */
const counterAt = (path: string, ref?: string): number => {
	const text =
		ref === undefined
			? readFileSync(path, "utf8")
			: git(["show", `${ref}:${path}`]);
	const value = Number(text.trim());
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new Error(`${path} must hold a single positive integer.`);
	}
	return value;
};

/**
 * The counter's value at the release before this one.
 *
 * `0` when there is no previous tag, and also when that tag predates the counter
 * file's introduction — in which case there is nothing published to outrank and
 * the commit-count floor still applies. Both are printed by the run summary, so
 * which of the two it was is visible rather than assumed.
 */
const previousCounter = (path: string, tag: string): number => {
	let previousTag: string;
	try {
		previousTag = git(["describe", "--tags", "--abbrev=0", `${tag}^`], true);
	} catch {
		return 0;
	}
	try {
		return counterAt(path, previousTag);
	} catch {
		return 0;
	}
};

const refType = arg("ref-type", process.env.GITHUB_REF_TYPE ?? "");
const refName = arg("ref-name", process.env.GITHUB_REF_NAME ?? "");
const counterPath = arg("counter", DEFAULT_COUNTER);

let derived: Derived;
let count = 0;
let previousReleaseBuildNumber = 0;
let releaseBuildNumber: number | null = null;
try {
	count = commitCount("HEAD");
	if (refType === "tag") {
		releaseBuildNumber = counterAt(counterPath);
		previousReleaseBuildNumber = previousCounter(counterPath, refName);
	}
	derived = derive({
		refType,
		refName,
		commitCount: count,
		releaseBuildNumber,
		previousReleaseBuildNumber,
		counterPath,
	});
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

// Printed, not exported: they are the numbers behind the derivation, and the
// table is what makes a dry run of the release path readable ("the number it
// would publish for main versus for a tag") without a store to compare against.
const diagnostics = [
	`internal_build_number=${count}`,
	`release_build_number=${releaseBuildNumber ?? "none"}`,
	`previous_release_build_number=${previousReleaseBuildNumber}`,
	`minimum_release_build_number=${Math.max(previousReleaseBuildNumber + 1, count + 1)}`,
	`counter_file=${counterPath}`,
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
	// `display_version` is printed for the run log and deliberately NOT exported:
	// nothing consumes it, and a variable in the job environment that no file
	// reads is the shape of bug this pipeline was reviewed for (the version
	// reaching the artefact is asserted in android.yml and ios.yml).
	appendFileSync(
		envFile,
		`LOCAL_OPERATOR_MOBILE_VERSION=${derived.version}\n` +
			`LOCAL_OPERATOR_MOBILE_VERSION_CODE=${derived.versionCode}\n`,
	);
	appendFileSync(outputFile, `${lines.join("\n")}\n`);
}

for (const line of lines) console.log(line);
for (const line of diagnostics) console.log(line);
