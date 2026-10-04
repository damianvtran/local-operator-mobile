#!/usr/bin/env node
/**
 * Derive this build's version numbers from the git ref and the repository.
 *
 *     node scripts/ci/version.ts                       # read the GitHub env, print them
 *     node scripts/ci/version.ts --write               # also export them to the job
 *     node scripts/ci/version.ts --ref-type tag --ref-name v1.2.3 --write
 *
 * Run directly by Node: the pinned runtime (>= 24.2, see the entry-point guard at
 * the bottom) strips the type annotations, so there is no build
 * step and no dependency here. That constrains the SYNTAX (no `enum`, no
 * `namespace`, no parameter properties, no decorators — anything that would need
 * emit) and nothing else.
 *
 * THE SCHEME IS DOCUMENTED IN `docs/ci.md`, "Versioning", and that is the copy to
 * read: it explains why the number is derived rather than committed, why a run
 * number cannot be one, and what `release/build-number.txt` is for. In short —
 *
 *   * an internal build claims `base + commits since the last release`, where
 *     `base` is the counter at the last `v*` tag (0 before the first release);
 *   * a release claims the counter in `release/build-number.txt`, and this script
 *     FAILS unless that number is strictly greater than what an internal build of
 *     the same commit would claim. The failure names the minimum, so the fix is a
 *     number rather than a search.
 *
 * Why the internal arm counts from the last release and not from the repository
 * root or from the counter's own value: both publishers write to one store
 * sequence, and a release must be strictly above every internal build that came
 * before it. Counting from the last release makes that true by construction — the
 * release's number is the bump the internal builds have been climbing toward, and
 * each release restarts the climb from its own value. Deriving the internal number
 * from the counter's CURRENT value instead would collide at the bump commit, whose
 * internal upload claims exactly the counter the release then publishes.
 *
 * A re-run of an internal build of the same commit claims the same number; Play
 * rejects a duplicate upload, so re-publishing needs a new commit — or, for a
 * release, the counter bump the failure message asks for. That is deliberate: a
 * number that moves while the code does not is a number nobody can trace to a
 * build.
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

/**
 * Where the release counter lives. A committed file rather than a secret, a
 * store query or a workflow input: it is the one value a release must set
 * deliberately, and a diff is where a deliberate decision belongs.
 */
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
	/**
	 * What an internal build from the tip of `origin/main` would claim, or `null`
	 * when that ref could not be resolved. AN ARGUMENT, not a lookup: `derive` is
	 * pure, so a caller cannot measure the floor against whatever repository it
	 * happens to run in — a unit test did exactly that and would have gone red the
	 * moment the first tag existed. The one place that reads git is the CLI.
	 */
	mainInternal: number | null;
	/** The counter at the last release tag, or 0 before the first release. */
	base: number;
	/** Commits since that tag: the increment an internal build claims. */
	commitsSinceLastRelease: number;
	/** The counter's value in this tree, when this ref is a release tag. */
	releaseBuildNumber: number | null;
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
 * outrank the internal builds already published from `main` — that failure is the
 * one that would otherwise arrive from Play, after the GitHub Release exists.
 */
export const derive = ({
	refType,
	refName,
	base,
	commitsSinceLastRelease,
	releaseBuildNumber,
	counterPath,
	mainInternal,
}: Ref): Derived => {
	if (
		!Number.isSafeInteger(commitsSinceLastRelease) ||
		commitsSinceLastRelease < 0
	) {
		throw new Error(
			"the number of commits since the last release is not a non-negative " +
				"integer, so there is no build number to derive. Check out with " +
				"`fetch-depth: 0`: a shallow clone counts only the commits it fetched.",
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

	/** What an internal build of this same commit claims. Both arms agree on it,
	 * and it is the floor a release has to clear. */
	const internalNumber = base + commitsSinceLastRelease;

	if (!isTag) {
		return {
			version: PLACEHOLDER_VERSION,
			displayVersion: `${PLACEHOLDER_VERSION}-dev.${internalNumber}`,
			versionCode: String(internalNumber),
			fromTag: false,
		};
	}

	if (releaseBuildNumber === null || releaseBuildNumber <= 0) {
		throw new Error(
			`a release needs its build number in ${counterPath} — both stores ` +
				"compare it, and a run number is not a repository-wide counter.",
		);
	}
	// Q4: THE TAG NEED NOT BE THE TIP OF `main`. An internal build of a commit that
	// landed AFTER the counter bump claims the same number this release would, and
	// Play rejects the second upload — so the floor is the highest internal number
	// this scheme could have published from `main`, not just the one at this commit.
	// Only advisory when `origin/main` is not present (a local run, or a checkout
	// that did not fetch it): the release job fetches it explicitly, and every other
	// caller prints that it could not check rather than inventing a floor.
	// THE TAG BEING CUT IS EXCLUDED FROM ITS OWN SEARCH. The runbook tags main's
	// tip, so the tag is an ancestor of `origin/main`: without this exclusion
	// `lastRelease` accepts the tag itself, `base` becomes the tag's own bumped
	// counter, and the floor becomes `counter + 1` at every value — a release that
	// cannot be built, with a message whose remedy moves with the counter (review
	// round 5's blocker, QA round 4's B1; both reproduced it on a clone).
	const minimum = floorFor(internalNumber, mainInternal);
	if (releaseBuildNumber < minimum) {
		const tip =
			mainInternal === null
				? ""
				: `, and ${mainInternal} from the tip of origin/main`;
		throw new Error(
			`the release build number ${releaseBuildNumber} is below the floor of ` +
				`${minimum}: an internal build of this commit claims ` +
				`${internalNumber} (${base} at the last release + ` +
				`${commitsSinceLastRelease} commits since)${tip}. Set ` +
				`${counterPath} to ${minimum} or higher in the release pull request, ` +
				"then tag: Play rejects an upload whose versionCode is not strictly " +
				"greater than one already published. THIS FLOOR MOVES. The bump is " +
				"itself a commit, so it raises the floor by one, and every commit " +
				"after it raises it again — a second refusal is quoting the floor at " +
				'the new tip, not repeating itself. docs/ci.md, "Versioning", ' +
				"says to leave a margin so one bump is enough.",
		);
	}

	const version = tag?.join(".") ?? PLACEHOLDER_VERSION;
	return {
		version,
		displayVersion: version,
		versionCode: String(releaseBuildNumber),
		fromTag: true,
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
		// Optional lookups (a tag list with no releases in it, a counter file that
		// a pre-release tag predates) silence stderr rather than putting a fatal
		// line in the log of a legitimate first release.
		stdio: ["ignore", "pipe", quiet ? "ignore" : "inherit"],
	}).trim();

/** A counter file's value, in the working tree or (with `ref`) at a revision. */
/**
 * The internal number a given ref claims, or `null` when the ref cannot be
 * resolved. Used for the `origin/main` floor (Q4): an internal build of a commit
 * that landed after the counter bump claims the same number a tag on the bump
 * commit would, and Play rejects the second upload.
 */
const internalNumberAt = (
	path: string,
	ref: string,
	exclude: string | null,
): number | null => {
	try {
		const { base, commitsSince } = lastRelease(path, ref, exclude);
		return base + commitsSince;
	} catch {
		return null;
	}
};

/**
 * The floor a release has to clear: one above the highest number this scheme could
 * already have published. It is `max(this commit, main's tip)` rather than just
 * this commit — an internal build of a commit that landed after the counter bump
 * claims the same number a tag on the bump commit would, and Play rejects the
 * second upload.
 *
 * ONE FUNCTION, TWO CALLERS, because the two drifted: the release arm enforced the
 * max while the run summary printed the un-maxed value, which would have been
 * wrong the first time a tag was not the tip (review round 5, M5-1).
 */
export const floorFor = (
	internal: number,
	mainInternal: number | null,
): number => Math.max(internal, mainInternal ?? internal) + 1;

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
 * The release this build is measured from: the highest `v*` tag that is an
 * ancestor of the ref being built, its counter, and the commits since it.
 *
 * Resolved from the TAG LIST rather than from `git describe <tag>^` (review round
 * 3, m2): on the `workflow_dispatch` path the tag is free text that may not exist
 * yet — `gh release create` would create it — and a tagless lookup returned 0,
 * silently dropping the one floor the release arm exists to enforce. `git tag -l`
 * answers for a tag that does not exist by simply not listing it, which is the
 * honest answer rather than a comparison against nothing.
 *
 * `exclude` is the tag being cut, so a release is measured against the release
 * BEFORE it rather than against itself.
 */
export const lastRelease = (
	path: string,
	ref: string,
	exclude: string | null,
): { tag: string | null; base: number; commitsSince: number } => {
	const tags = git(["tag", "--sort=-v:refname", "-l", "v*"], true)
		.split("\n")
		.filter((name) => name !== "" && name !== exclude);
	for (const candidate of tags) {
		if (!TAG.test(candidate)) continue;
		try {
			// `-v:refname` is a semver-ish sort, not an ancestry test: a tag cut on a
			// sibling branch would otherwise be treated as this build's base.
			git(["merge-base", "--is-ancestor", candidate, ref], true);
		} catch {
			continue;
		}
		let base = 0;
		try {
			base = counterAt(path, candidate);
		} catch {
			// A tag that predates the counter file: nothing was published to outrank,
			// so the climb simply starts from zero. Reported as `base=0`, so which of
			// the two cases it was is visible in the run rather than assumed.
			base = 0;
		}
		return {
			tag: candidate,
			base,
			commitsSince: Number(
				git(["rev-list", "--count", `${candidate}..${ref}`]),
			),
		};
	}
	return {
		tag: null,
		base: 0,
		commitsSince: Number(git(["rev-list", "--count", ref])),
	};
};

/**
 * THE CLI IS THE ENTRY POINT ONLY. Everything above is importable: a test can
 * import `derive` and `floorFor` without the module reading a repository, writing
 * to `GITHUB_ENV`, or exiting the process. That matters beyond tidiness — the
 * unguarded version ran on import, and importing it from the unit suite meant the
 * CLI exited 1 inside the test worker whenever the checkout was a shallow clone
 * (which is what the `checks` job has), taking the whole test FILE down with
 * `process.exit unexpectedly called with "1"`. Reproduced locally: `node
 * scripts/ci/version.ts` inside a `--depth 1` clone exits 1 by design, so a test
 * that merely imports this file inherits that refusal.
 *
 * AND THE GUARD MUST NOT FAIL SILENTLY ON AN OLDER NODE. `import.meta.main` exists
 * from Node 24.2 (review round 6, R6-5): on anything earlier the property is
 * `undefined`, the body below never runs, the process exits 0, and the job
 * continues with whatever version variables the last `--write` left — or with
 * none. That is the worst possible failure for a step whose whole job is to derive
 * a version, so a runtime without the property is a NAMED FAILURE here, not a
 * skip. The workflows pin it as `NODE_VERSION: "24"` (`.github/workflows/*.yml`),
 * which setup-node resolves to the latest 24.x; 24.2 is the floor this file needs.
 */
const isEntryPoint = (import.meta as ImportMeta & { main?: boolean }).main;
if (isEntryPoint === undefined) {
	console.error(
		"::error::this Node does not support `import.meta.main` (needs >= 24.2), " +
			"so running this script as a CLI would silently do nothing and the job " +
			"would carry on with a stale version. The workflows pin " +
			'`NODE_VERSION: "24"`; use that or newer.',
	);
	process.exit(1);
}
if (isEntryPoint) {
	const refType = arg("ref-type", process.env.GITHUB_REF_TYPE ?? "");
	const refName = arg("ref-name", process.env.GITHUB_REF_NAME ?? "");
	const counterPath = arg("counter", DEFAULT_COUNTER);
	const ref = arg("ref", "HEAD");

	let derived: Derived;
	let mainInternal: number | null = null;
	let release: { tag: string | null; base: number; commitsSince: number };
	let releaseBuildNumber: number | null = null;
	try {
		if (git(["rev-parse", "--is-shallow-repository"]) === "true") {
			throw new Error(
				"this is a shallow clone, so a commit count would be the count of what " +
					"was fetched rather than of the repository. Check out with " +
					"`fetch-depth: 0`.",
			);
		}
		release = lastRelease(counterPath, ref, refType === "tag" ? refName : null);
		if (refType === "tag") {
			releaseBuildNumber = counterAt(counterPath);
		}
		// THE TAG BEING CUT IS EXCLUDED FROM ITS OWN SEARCH. The runbook tags
		// main's tip, so the tag is an ancestor of `origin/main`: without this
		// exclusion `lastRelease` accepts the tag itself, `base` becomes the tag's
		// own bumped counter, and the floor becomes `counter + 1` at every value — a
		// release that cannot be built, with a message whose remedy moves with the
		// counter (review round 5's blocker, QA round 4's B1; both reproduced it on
		// a clone).
		mainInternal = internalNumberAt(
			counterPath,
			"origin/main",
			refType === "tag" ? refName : null,
		);
		derived = derive({
			refType,
			refName,
			base: release.base,
			commitsSinceLastRelease: release.commitsSince,
			releaseBuildNumber,
			counterPath,
			mainInternal,
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
	// would claim for main versus for a tag") without a store to compare against.
	// The same floor the release arm applied, printed so a dry run shows both sides
	// of the comparison (Q4: a tag need not be the tip of `main`).
	const minimum = floorFor(release.base + release.commitsSince, mainInternal);
	const diagnostics = [
		`base_release_number=${release.base}`,
		`base_release_tag=${release.tag ?? "none"}`,
		`commits_since_last_release=${release.commitsSince}`,
		`internal_build_number=${release.base + release.commitsSince}`,
		`release_build_number=${releaseBuildNumber ?? "none"}`,
		`minimum_release_build_number=${minimum}`,
		`main_tip_internal_build_number=${mainInternal ?? "not-checked"}`,
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
}
