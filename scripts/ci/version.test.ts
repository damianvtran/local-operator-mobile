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
 * WHY A GIT FIXTURE AND NOT MOCKS. Every defect in this rule so far — five review
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

// Generous: each case builds a repository with ~15 `git` invocations, and this
// host runs ~25 agent sessions beside it. A hang still fails the suite.
const M = 120_000;

/** The script under test, run as a subprocess so the fixture is its repository. */
const SCRIPT = fileURLToPath(new URL("./version.ts", import.meta.url));

// Module scope because biome asks for it (`useTopLevelRegex`), and because these
// are the two messages a maintainer greps for.
const FLOOR_MESSAGE = /below the floor of 1011/;
const FLOOR_VALUE = /below the floor of (\d+)/;
const TAG_MESSAGE = /not vMAJOR\.MINOR\.PATCH/;

const roots: string[] = [];

afterAll(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const tempRoot = (): string => {
	const root = mkdtempSync(join(tmpdir(), `lo-version-${process.pid}-`));
	roots.push(root);
	return root;
};

const git = (cwd: string, args: string[]): string =>
	execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		env: {
			...process.env,
			// The fixture carries its own identity, so blanking the system config
			// costs nothing — and on a maintainer's macOS machine the system config
			// is the one holding `credential.helper = osxkeychain`, which is how a
			// test process ends up asking the OS for a keychain.
			GIT_CONFIG_SYSTEM: "/dev/null",
			GIT_TERMINAL_PROMPT: "0",
		},
	}).trim();

type Run = { rc: number; out: string; value: (key: string) => string };

/** Run the script the way a workflow does: from inside the fixture. */
const runScript = (cwd: string, args: string[] = []): Run => {
	let rc = 0;
	let out = "";
	try {
		out = execFileSync("node", [SCRIPT, ...args], {
			cwd,
			encoding: "utf8",
			env: { ...process.env, GIT_CONFIG_SYSTEM: "/dev/null" },
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
	 * The counter the release pull request writes, relative to the internal number
	 * at the tagged commit. `1` is the tight value the failure message's own advice
	 * produces; larger values are the margin `docs/ci.md` recommends.
	 */
	counterOffset?: number;
	/** Land a commit on `main` after the tag, so the tag is no longer the tip. */
	mainAhead?: boolean;
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
}: Scenario) => {
	const root = tempRoot();
	const origin = join(root, "origin.git");
	const work = join(root, "work");
	git(root, ["init", "-q", "--bare", origin]);
	git(root, ["clone", "-q", origin, work]);
	git(work, ["config", "user.email", "fixture@example.invalid"]);
	git(work, ["config", "user.name", "fixture"]);
	mkdirSync(join(work, "release"), { recursive: true });
	writeFileSync(join(work, "release", "build-number.txt"), "0\n");
	for (let n = 1; n <= commits; n++) {
		writeFileSync(join(work, `m${n}.txt`), `${n}\n`);
		git(work, ["add", "-A"]);
		git(work, ["commit", "-q", "-m", `work ${n}`]);
	}
	git(work, ["push", "-q", "origin", "HEAD:main"]);

	// The release pull request: the counter, as a commit of its own.
	const counter = commits + counterOffset;
	writeFileSync(join(work, "release", "build-number.txt"), `${counter}\n`);
	git(work, ["add", "-A"]);
	git(work, ["commit", "-q", "-m", `chore(release): bump to ${counter}`]);
	// On the branch ref, so a case can state the number an internal build of the
	// tagged commit claims without recomputing the fixture's arithmetic.
	const tagCommitInternal = Number(
		runScript(work).value("internal_build_number"),
	);
	git(work, ["tag", "-f", "-a", "v0.1.0", "-m", "v0.1.0"]);
	git(work, ["push", "-q", "-f", "origin", "HEAD:main", "--tags"]);
	git(work, [
		"fetch",
		"-q",
		"origin",
		"+refs/heads/main:refs/remotes/origin/main",
	]);

	if (mainAhead) {
		writeFileSync(join(work, "later.txt"), "later\n");
		git(work, ["add", "-A"]);
		git(work, ["commit", "-q", "-m", "a commit after the tag"]);
		git(work, ["push", "-q", "origin", "HEAD:main"]);
		git(work, [
			"fetch",
			"-q",
			"origin",
			"+refs/heads/main:refs/remotes/origin/main",
		]);
	}

	git(work, ["checkout", "-q", "v0.1.0"]);
	return {
		tagCommitInternal,
		counter,
		release: () =>
			runScript(work, ["--ref-type", "tag", "--ref-name", "v0.1.0"]),
	};
};

describe("floorFor", () => {
	it("takes the higher of this commit and main's tip, and tolerates an unknown tip", () => {
		// Q4: an internal build of a commit that landed after the counter bump
		// claims the same number a tag on the bump commit would, so the floor is
		// measured from main's tip too.
		expect(floorFor(1001, 1002)).toBe(1003);
		// …and a run that could not read `origin/main` uses what it has rather than
		// inventing a floor.
		expect(floorFor(1001, null)).toBe(1002);
	});
});

describe("derive", () => {
	it("refuses a base that is the released counter — the shape of round 5's blocker", () => {
		// Pre-fix, the tag being cut was its own predecessor in the `origin/main`
		// lookup, so `base` came back as the tag's own counter with zero commits
		// since, the floor became `counter + 1`, and NO counter value satisfied it.
		// The exclusion fixed the lookup; this pins the arithmetic that made it fatal.
		expect(() =>
			derive({
				refType: "tag",
				refName: "v0.1.0",
				base: 1010,
				commitsSinceLastRelease: 0,
				releaseBuildNumber: 1010,
				counterPath: "release/build-number.txt",
			}),
		).toThrow(FLOOR_MESSAGE);
	});

	it("accepts a release above the floor, and rejects a tag that is not a version", () => {
		expect(
			derive({
				refType: "tag",
				refName: "v1.2.3",
				base: 1000,
				commitsSinceLastRelease: 3,
				releaseBuildNumber: 1010,
				counterPath: "release/build-number.txt",
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
				refName: "v1.2",
				base: 0,
				commitsSinceLastRelease: 5,
				releaseBuildNumber: 10,
				counterPath: "release/build-number.txt",
			}),
		).toThrow(TAG_MESSAGE);
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

	it.each([
		{ name: "a margin", offset: 20 },
		// TWO margins, because with the tag as its own predecessor the floor moves
		// with the counter and BOTH refused — that is the unsatisfiability round 5
		// found jointly. One margin alone could look like a fluke of the arithmetic.
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
			expect(result.out).toContain("origin/main");
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
