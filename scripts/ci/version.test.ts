import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import { derive, floorFor } from "./version";

/**
 * The release build number, exercised against a REAL repository.
 *
 * WHY A GIT FIXTURE AND NOT MOCKS. Every defect in this rule so far — six review
 * rounds of them — came from the part that reads git: which tag counts as the
 * previous release, what a shallow clone does to a commit count, whether the tag
 * being cut is itself a candidate for the floor. A mocked `git` would encode the
 * author's belief about those answers, and that belief is the thing under test. So
 * each case builds a bare origin, a clone, real commits, a real tag and a real
 * `origin/main`, and runs `version.ts` as a subprocess with the fixture as its
 * working directory — the same way `release.yml` runs it.
 *
 * THE SCRIPT'S REPOSITORY IS ITS WORKING DIRECTORY, not its own path: it shells out
 * to `git` without a `cwd`, so running it from inside the fixture is what makes the
 * fixture the repository under test. Worth knowing before writing anything else
 * against this script.
 *
 * `os.tmpdir()` and not a directory in the repository: these are throwaway
 * repositories that must not show up in a reviewer's `git status`. Each root is
 * named with this process's pid, so two suites running side by side on one machine
 * cannot share a fixture, and `afterAll` removes them.
 */

const M = 120_000;

/** The script under test, run as a subprocess so the fixture is its repository. */
const SCRIPT = fileURLToPath(new URL("./version.ts", import.meta.url));

// Module scope because biome asks for it (`useTopLevelRegex`), and because these
// are the two messages a maintainer greps for.
const FLOOR_MESSAGE = /below the floor of 1011/;
const FLOOR_VALUE = /below the floor of (\d+)/;
const TAG_MESSAGE = /not vMAJOR\.MINOR\.PATCH/;
const COUNTER_MESSAGE = /needs its build number/;

const roots: string[] = [];

afterAll(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const tempRoot = (): string => {
	const root = mkdtempSync(join(tmpdir(), `lo-version-${process.pid}-`));
	roots.push(root);
	return root;
};

/**
 * The environment a fixture subprocess gets: this process's, minus the variables
 * GitHub sets that would turn a fixture call into a release probe.
 *
 * ON A TAG PUSH THIS SUITE RUNS INSIDE THE RELEASE GATE. `release.yml`'s `gate` job
 * calls `ci.yml`, whose `checks` job runs `pnpm test`, and a called workflow sees
 * the caller's context — so `GITHUB_REF_TYPE=tag` with `GITHUB_REF_NAME=vX.Y.Z`. A
 * fixture call that passes no `--ref-type` falls back to that, derives a release
 * from a tag that is not in the fixture, refuses, and the file goes red *inside the
 * release gate*, where `android`, `ios` and `publish` are all waiting on it (review
 * round 6, R6-1 — and a push or pull-request run can never show it).
 *
 * Deleting them here is only half the fix: the fixture probe also names its ref
 * explicitly, so the suite is green with these set or unset.
 *
 * `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM` are blanked for the keychain rule — on a
 * maintainer's macOS machine the system config is the one carrying
 * `credential.helper = osxkeychain`, which is how a test process ends up asking the
 * OS for a keychain. The fixture's own identity lives in the fixture's config.
 */
const childEnv = (): NodeJS.ProcessEnv => {
	const env: NodeJS.ProcessEnv = { ...process.env };
	for (const name of [
		"GITHUB_REF_TYPE",
		"GITHUB_REF_NAME",
		"GITHUB_ENV",
		"GITHUB_OUTPUT",
	]) {
		delete env[name];
	}
	env.GIT_CONFIG_GLOBAL = "/dev/null";
	env.GIT_CONFIG_SYSTEM = "/dev/null";
	env.GIT_TERMINAL_PROMPT = "0";
	return env;
};

const git = (cwd: string, args: string[]): string =>
	execFileSync("git", args, { cwd, encoding: "utf8", env: childEnv() }).trim();

type Run = { rc: number; out: string; value: (key: string) => string };

/** Run the script the way a workflow does: from inside the fixture. */
const runScript = (cwd: string, args: string[] = []): Run => {
	let rc = 0;
	let out = "";
	try {
		out = execFileSync("node", [SCRIPT, ...args], {
			cwd,
			encoding: "utf8",
			env: childEnv(),
			stdio: ["ignore", "pipe", "pipe"],
		});
	} catch (error) {
		const failed = error as {
			status?: number;
			stdout?: string;
			stderr?: string;
		};
		rc = failed.status ?? 1;
		out = `${failed.stdout ?? ""}${failed.stderr ?? ""}`;
	}
	return {
		rc,
		out,
		value: (key) => out.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1] ?? "",
	};
};

type Scenario = {
	/** Commits on `main` before the release pull request. */
	commits?: number;
	/**
	 * The counter the release pull request writes, relative to the commit count of
	 * the tagged commit. `1` is the tight value: below the floor, because the bump
	 * is itself a commit. Larger values are the margin `docs/ci.md` recommends.
	 */
	counterOffset?: number;
	/** Land a commit on `main` after the tag, so the tag is no longer the tip. */
	mainAhead?: boolean;
	/** Release a `v0.1.0` first, so this build has a previous release to count from. */
	priorRelease?: boolean;
};

/**
 * The runbook's order, which is the part earlier proofs got wrong: commits, the
 * release pull request's counter bump **as a commit**, the tag **on that commit**,
 * and `origin/main` fetched — optionally with a later commit so the tag is behind
 * the tip.
 */
const scenario = ({
	commits = 3,
	counterOffset = 20,
	mainAhead = false,
	priorRelease = false,
}: Scenario) => {
	const root = tempRoot();
	const origin = join(root, "origin.git");
	const work = join(root, "work");
	git(root, ["init", "-q", "--bare", origin]);
	git(root, ["clone", "-q", origin, work]);
	git(work, ["config", "user.email", "fixture@example.invalid"]);
	git(work, ["config", "user.name", "fixture"]);
	mkdirSync(join(work, "release"), { recursive: true });
	const counterFile = join(work, "release", "build-number.txt");
	const commitAll = (message: string): void => {
		git(work, ["add", "-A"]);
		git(work, ["commit", "-q", "-m", message]);
	};

	writeFileSync(counterFile, "0\n");
	for (let n = 1; n <= (priorRelease ? 1 : commits); n++) {
		writeFileSync(join(work, `m${n}.txt`), `${n}\n`);
		commitAll(`work ${n}`);
	}
	git(work, ["push", "-q", "origin", "HEAD:main"]);

	if (priorRelease) {
		// The first release: its own bump commit and tag, left behind so the second
		// one has a base to count from and a tag name to report.
		writeFileSync(counterFile, "2\n");
		commitAll("chore(release): bump to 2");
		git(work, ["tag", "-a", "v0.1.0", "-m", "v0.1.0"]);
		for (let n = 2; n <= commits; n++) {
			writeFileSync(join(work, `m${n}.txt`), `${n}\n`);
			commitAll(`work ${n}`);
		}
	}

	// The release pull request: the counter, as a commit of its own.
	const counter = (priorRelease ? commits + 1 : commits) + counterOffset;
	writeFileSync(counterFile, `${counter}\n`);
	commitAll(`chore(release): bump to ${counter}`);
	const tag = priorRelease ? "v0.2.0" : "v0.1.0";
	// On the branch ref — named explicitly, never inherited from the environment
	// (R6-1) — so a case can state the number an internal build of the tagged
	// commit claims without recomputing the fixture's arithmetic.
	const tagCommitInternal = Number(
		runScript(work, ["--ref-type", "branch", "--ref-name", "main"]).value(
			"internal_build_number",
		),
	);
	git(work, ["tag", "-f", "-a", tag, "-m", tag]);
	git(work, ["push", "-q", "-f", "origin", "HEAD:main", "--tags"]);
	git(work, [
		"fetch",
		"-q",
		"origin",
		"+refs/heads/main:refs/remotes/origin/main",
	]);

	if (mainAhead) {
		writeFileSync(join(work, "later.txt"), "later\n");
		commitAll("a commit after the tag");
		git(work, ["push", "-q", "origin", "HEAD:main"]);
		git(work, [
			"fetch",
			"-q",
			"origin",
			"+refs/heads/main:refs/remotes/origin/main",
		]);
	}

	git(work, ["checkout", "-q", tag]);
	return {
		tagCommitInternal,
		counter,
		release: () => runScript(work, ["--ref-type", "tag", "--ref-name", tag]),
	};
};

describe("floorFor", () => {
	it("takes the higher of this commit and main's tip, plus one", () => {
		expect(floorFor(100, 102)).toBe(103);
		expect(floorFor(100, 99)).toBe(101);
		// No `origin/main` to compare against: the commit's own number is the floor,
		// which is what a local run reports rather than inventing one.
		expect(floorFor(100, null)).toBe(101);
	});
});

describe("derive", () => {
	it("refuses a release whose counter does not clear the floor", () => {
		// THE ARITHMETIC THAT MADE ROUND 5'S BLOCKER FATAL, not the lookup that
		// caused it: when the tag being cut is its own predecessor, `base` comes back
		// as that tag's own counter with zero commits since, so the floor is
		// `counter + 1` and no counter value satisfies it. The lookup is pinned by
		// the fixture cases below, which run the real search.
		expect(() =>
			derive({
				refType: "tag",
				refName: "v0.1.0",
				base: 1010,
				commitsSinceLastRelease: 0,
				releaseBuildNumber: 1010,
				counterPath: "release/build-number.txt",
				mainInternal: null,
			}),
		).toThrow(FLOOR_MESSAGE);
	});

	it("uses main's tip as the floor when it is ahead, and reports the tag's version", () => {
		// `mainInternal` is an argument, so this case is hermetic: it cannot read the
		// repository the suite happens to be running in, which is what makes it safe
		// once the real repo has tags of its own (review round 6, R6-8).
		expect(
			derive({
				refType: "tag",
				refName: "v1.2.3",
				base: 1000,
				commitsSinceLastRelease: 3,
				releaseBuildNumber: 1010,
				counterPath: "release/build-number.txt",
				mainInternal: 1009,
			}),
		).toEqual({
			version: "1.2.3",
			displayVersion: "1.2.3",
			versionCode: "1010",
			fromTag: true,
		});
		expect(() =>
			derive({
				refType: "tag",
				refName: "v1.2.3",
				base: 1000,
				commitsSinceLastRelease: 3,
				releaseBuildNumber: 1010,
				counterPath: "release/build-number.txt",
				mainInternal: 1010,
			}),
		).toThrow(FLOOR_VALUE);
	});

	it("rejects a tag that is not a version, and a release with no counter", () => {
		expect(() =>
			derive({
				refType: "tag",
				refName: "v1.2",
				base: 0,
				commitsSinceLastRelease: 5,
				releaseBuildNumber: 10,
				counterPath: "release/build-number.txt",
				mainInternal: null,
			}),
		).toThrow(TAG_MESSAGE);
		expect(() =>
			derive({
				refType: "tag",
				refName: "v1.2.3",
				base: 0,
				commitsSinceLastRelease: 5,
				releaseBuildNumber: null,
				counterPath: "release/build-number.txt",
				mainInternal: null,
			}),
		).toThrow(COUNTER_MESSAGE);
	});
});

describe("the build number, against a real repository", () => {
	it(
		"accepts a first release with no previous tag, counting commits from the root",
		() => {
			const { tagCommitInternal, counter, release } = scenario({
				counterOffset: 20,
			});
			const result = release();
			expect(result.rc).toBe(0);
			// No prior tag: the climb starts at zero, so the internal number is the
			// commit count of the tagged commit and the release claims the counter.
			expect(Number(result.value("base_release_number"))).toBe(0);
			expect(result.value("base_release_tag")).toBe("none");
			expect(Number(result.value("internal_build_number"))).toBe(
				tagCommitInternal,
			);
			expect(Number(result.value("version_code"))).toBe(counter);
		},
		M,
	);

	it(
		"counts from the previous release when one exists",
		() => {
			const { tagCommitInternal, counter, release } = scenario({
				counterOffset: 20,
				priorRelease: true,
			});
			const result = release();
			expect(result.rc).toBe(0);
			// The exclusion's other half (R6-2): with a real earlier tag present, the
			// base is that release — not the root, and not this tag itself, which is
			// the neighbouring mistake the exclusion exists to prevent.
			expect(result.value("base_release_tag")).toBe("v0.1.0");
			expect(Number(result.value("base_release_number"))).toBe(2);
			expect(Number(result.value("internal_build_number"))).toBe(
				tagCommitInternal,
			);
			expect(tagCommitInternal).toBeGreaterThan(2);
			expect(Number(result.value("version_code"))).toBe(counter);
		},
		M,
	);

	it.each([
		{ name: "a margin", offset: 20 },
		// TWO margins, because with the tag as its own predecessor the floor moves
		// with the counter and BOTH would refuse — that is the unsatisfiability round
		// 5 found jointly. One margin alone could look like a fluke of the arithmetic.
		{ name: "a larger margin", offset: 40 },
	])(
		"accepts the tag on the tip with $name above the internal number",
		({ offset }) => {
			expect(scenario({ counterOffset: offset }).release().rc).toBe(0);
		},
		M,
	);

	it(
		"refuses a tight counter with the tag on the tip, and names the floor",
		() => {
			const { tagCommitInternal, counter, release } = scenario({
				counterOffset: 1,
			});
			const result = release();
			expect(result.rc).toBe(1);
			// The bump is itself a commit, so the floor at the tagged commit is one
			// above the internal number there: the tight value chases by one per
			// commit, which is what the message warns about and a margin answers.
			//
			// Read from the MESSAGE, not from the `minimum_release_build_number`
			// field: a refused release exits before the diagnostics are printed, so
			// that field is empty here and only exists on the accepting path (the
			// case below asserts it there).
			const floor = Number(result.out.match(FLOOR_VALUE)?.[1]);
			expect(floor).toBe(tagCommitInternal + 1);
			expect(floor).toBeGreaterThan(counter);
		},
		M,
	);

	it(
		"refuses that release once main has moved past the tag",
		() => {
			const result = scenario({ counterOffset: 1, mainAhead: true }).release();
			expect(result.rc).toBe(1);
			// Q4's guard: main's tip is what has already been published, so the floor
			// is measured from there and the refusal says so.
			expect(result.out).toContain("origin/main");
		},
		M,
	);

	it(
		"prints the floor it enforces, so the summary cannot drift from the gate",
		() => {
			const { release } = scenario({ counterOffset: 20 });
			const result = release();
			expect(result.rc).toBe(0);
			// A release used to print the un-maxed value while enforcing the maxed
			// one; both call `floorFor` now, so this asserts they agree.
			expect(Number(result.value("minimum_release_build_number"))).toBe(
				floorFor(Number(result.value("internal_build_number")), 0),
			);
		},
		M,
	);
});
