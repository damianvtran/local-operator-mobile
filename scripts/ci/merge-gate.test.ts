/**
 * Contract and unit tests for the two-tier CI model:
 *   1. `ci.yml` (`CI Gate` fail-closed aggregate over every fast-tier job).
 *   2. `ios.yml` & `android.yml` (`workflow_call` `full: true` unconditional
 *      override, native-input path classifier on per-push PRs, fail-open empty
 *      diff, and signing/upload isolation).
 *   3. `e2e.yml` (`pull_request` removed from `on:`, `workflow_call` added,
 *      `harness` + `mock-relay-contract` selected under `pull_request`).
 *   4. `merge-gate.yml` (`pull_request: [labeled]` + `workflow_dispatch`,
 *      zero label/event skip guards, fail-closed `Merge gate (full suite)`).
 *   5. `scripts/ci/merge-gate.ts` (`CI Gate` green precondition on `headRefOid`,
 *      label remove-then-add ritual, bounded run polling, error handling).
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	CI_WORKFLOW_PATH,
	FAST_GATE_JOB_NAME,
	LABEL,
	MERGE_GATE_WORKFLOW,
	MergeGateError,
	parseBoundedEnv,
	REQUIRED_CHECK_NAME,
	runMergeGateCli,
	verifyFastCiGateGreen,
} from "./merge-gate.ts";

const ROOT = new URL("../../", import.meta.url);
const readRepoFile = (rel: string): string =>
	readFileSync(new URL(rel, ROOT), "utf8");

const JOB_HEADER = /^ {2}([a-z0-9-]+):\n/gm;
const NEXT_JOB_HEADER = /^ {2}[a-z0-9-]+:\n/m;
const INLINE_NODE_HEREDOC =
	/node --input-type=module <<'NODE'\n([\s\S]*?)\n\s*NODE/;
const INDENT_10 = /^ {10}/;
const IF_ALWAYS_JOB = /^ {4}if: always\(\)$/m;
const NEEDS_ITEM = /^ {6}- ([a-z0-9-]+)$/gm;
const GIT_WORD = /\bgit\b/g;
const TOP_PULL_REQUEST = /^ {2}pull_request:/m;
const ANY_IF_LINE = /^\s*if:\s*(.+)$/gm;
const RUN_ATTEMPT_JOBS_ENDPOINT =
	/\/actions\/runs\/(\d+)\/attempts\/(\d+)\/jobs/;

function jobIds(workflowSource: string): string[] {
	const jobsStart = workflowSource.indexOf("\njobs:\n");
	if (jobsStart === -1) throw new Error("missing jobs: block");
	const body = workflowSource.slice(jobsStart);
	return [...body.matchAll(JOB_HEADER)].map((match) => match[1] ?? "");
}

function jobBlock(workflowSource: string, id: string): string {
	const jobsStart = workflowSource.indexOf("\njobs:\n");
	if (jobsStart === -1) throw new Error("missing jobs: block");
	const body = workflowSource.slice(jobsStart);
	const marker = `\n  ${id}:\n`;
	const start = body.indexOf(marker);
	if (start === -1) throw new Error(`missing job ${id}`);
	const rest = body.slice(start + marker.length);
	const next = rest.search(NEXT_JOB_HEADER);
	return next === -1 ? rest : rest.slice(0, next);
}

function extractInlineNodeScript(block: string): string {
	const match = INLINE_NODE_HEREDOC.exec(block);
	if (!match?.[1]) throw new Error("missing inline NODE heredoc");
	return match[1]
		.split("\n")
		.map((line) => line.replace(INDENT_10, ""))
		.join("\n");
}

function runInlineNode(
	script: string,
	env: Record<string, string>,
): { status: number | null; stdout: string; stderr: string } {
	const res = spawnSync(
		process.execPath,
		["--input-type=module", "-e", script],
		{
			encoding: "utf8",
			env: { ...process.env, ...env },
			timeout: 10_000,
		},
	);
	return {
		status: res.status,
		stdout: res.stdout ?? "",
		stderr: res.stderr ?? "",
	};
}

describe("ci.yml CI Gate contract", () => {
	const ci = readRepoFile(".github/workflows/ci.yml");
	const ids = jobIds(ci);
	const gate = jobBlock(ci, "ci-gate");
	const script = extractInlineNodeScript(gate);

	it("needs every other job in ci.yml and runs with if: always()", () => {
		expect(ids).toContain("ci-gate");
		expect(gate).toContain("name: CI Gate");
		expect(gate).toMatch(IF_ALWAYS_JOB);
		const listedNeeds = [
			...(gate.split("    if:")[0]?.matchAll(NEEDS_ITEM) ?? []),
		].map((m) => m[1] ?? "");
		expect([...listedNeeds].sort()).toEqual(
			ids.filter((id) => id !== "ci-gate").sort(),
		);
	});

	it("passes on PR when design-kit ran or was legitimately skipped (design=false), and fails closed otherwise", () => {
		const baseNeeds = (
			overrides: Partial<Record<string, { result: string }>>,
		) =>
			JSON.stringify({
				changes: { result: "success" },
				checks: { result: "success" },
				"team-bridge-qa": { result: "success" },
				"release-staging": { result: "success" },
				"design-kit": { result: "success" },
				...overrides,
			});

		// Full green PR run -> pass
		expect(
			runInlineNode(script, {
				NEEDS: baseNeeds({}),
				EVENT: "pull_request",
				DESIGN_NEEDED: "true",
			}).status,
		).toBe(0);

		// PR run where classifier set design=false and design-kit skipped -> pass
		expect(
			runInlineNode(script, {
				NEEDS: baseNeeds({ "design-kit": { result: "skipped" } }),
				EVENT: "pull_request",
				DESIGN_NEEDED: "false",
			}).status,
		).toBe(0);

		// Negative control: design-kit skipped while DESIGN_NEEDED is true or empty -> FAIL
		for (const designNeeded of ["true", ""]) {
			const badSkip = runInlineNode(script, {
				NEEDS: baseNeeds({ "design-kit": { result: "skipped" } }),
				EVENT: "pull_request",
				DESIGN_NEEDED: designNeeded,
			});
			expect(badSkip.status).toBe(1);
			expect(badSkip.stdout).toContain(
				"::error title=CI Gate::design-kit=skipped",
			);
		}

		// Negative control: non-PR push where team-bridge-qa skipped (expected) passes,
		// but design-kit skipped on push MUST fail!
		expect(
			runInlineNode(script, {
				NEEDS: baseNeeds({ "team-bridge-qa": { result: "skipped" } }),
				EVENT: "push",
				DESIGN_NEEDED: "true",
			}).status,
		).toBe(0);

		expect(
			runInlineNode(script, {
				NEEDS: baseNeeds({
					"team-bridge-qa": { result: "skipped" },
					"design-kit": { result: "skipped" },
				}),
				EVENT: "push",
				DESIGN_NEEDED: "false",
			}).status,
		).toBe(1);

		// Negative control: any core job skipped, failed, or cancelled -> FAIL
		for (const job of ["changes", "checks", "release-staging"]) {
			for (const result of ["failure", "cancelled", "skipped"]) {
				const res = runInlineNode(script, {
					NEEDS: baseNeeds({ [job]: { result } }),
					EVENT: "pull_request",
					DESIGN_NEEDED: "false",
				});
				expect(res.status, `${job}=${result}`).toBe(1);
			}
		}
	});
});

describe("ios.yml and android.yml two-tier native-input filter", () => {
	function extractChangesShell(workflowSource: string): string {
		const changes = jobBlock(workflowSource, "changes");
		const step = changes.split(
			"- name: Decide whether the native jobs are worth running",
		)[1];
		if (!step) throw new Error("missing diff step");
		const runPart = step.split("        run: |\n")[1];
		if (!runPart) throw new Error("missing run body");
		return runPart
			.split("\n")
			.map((line) => line.replace(INDENT_10, ""))
			.join("\n");
	}

	function evaluateNativeFilter(
		script: string,
		options: { event: string; full: string; files: string[] | null },
	): string {
		const scratch = mkdtempSync(
			join(process.env.LOCAL_OPERATOR_SCRATCHPAD ?? tmpdir(), "native-filter-"),
		);
		try {
			const outFile = join(scratch, "github_output");
			writeFileSync(outFile, "");
			const binDir = join(scratch, "bin");
			writeFileSync(
				join(scratch, "fake-git.sh"),
				[
					"#!/usr/bin/env bash",
					'if [ "$1" = "fetch" ]; then exit 0; fi',
					'if [ "$1" = "diff" ]; then',
					options.files === null
						? "  exit 0"
						: `  printf '%s\\n' ${options.files.map((f) => JSON.stringify(f)).join(" ")}`,
					"  exit 0",
					"fi",
					"exit 1",
				].join("\n"),
				{ mode: 0o755 },
			);
			const patched = script.replaceAll(
				GIT_WORD,
				JSON.stringify(join(scratch, "fake-git.sh")),
			);
			const res = spawnSync("bash", ["-c", patched], {
				encoding: "utf8",
				env: {
					...process.env,
					PATH: `${binDir}:${process.env.PATH ?? ""}`,
					GITHUB_OUTPUT: outFile,
					BASE_REF: "main",
					EVENT: options.event,
					FULL: options.full,
				},
				timeout: 5_000,
			});
			expect(res.status, res.stderr).toBe(0);
			return readFileSync(outFile, "utf8").trim();
		} finally {
			rmSync(scratch, { recursive: true, force: true });
		}
	}

	it.each(["ios.yml", "android.yml"])(
		"%s runs unconditionally on full=true or non-PR, fails open on empty diff, and scopes per-push PRs to native inputs",
		(file) => {
			const source = readRepoFile(`.github/workflows/${file}`);
			expect(source).toContain("workflow_call:");
			const script = extractChangesShell(source);

			// Merge gate calls reusable workflow on a labeled PR: EVENT is still 'pull_request', FULL is 'true' -> native=true
			expect(
				evaluateNativeFilter(script, {
					event: "pull_request",
					full: "true",
					files: ["src/features/chat/Composer.tsx"],
				}),
			).toBe("native=true");

			// Push to main -> native=true even for pure TS diff
			expect(
				evaluateNativeFilter(script, {
					event: "push",
					full: "false",
					files: ["src/features/chat/Composer.tsx"],
				}),
			).toBe("native=true");

			// Empty diff on PR -> fail open (native=true)
			expect(
				evaluateNativeFilter(script, {
					event: "pull_request",
					full: "false",
					files: null,
				}),
			).toBe("native=true");

			// Pure JS/TS, tools, and docs PR push -> native=false
			expect(
				evaluateNativeFilter(script, {
					event: "pull_request",
					full: "false",
					files: [
						"src/features/chat/Composer.tsx",
						"app/(tabs)/index.tsx",
						"tools/visual/capture.ts",
						"docs/ci.md",
						".github/workflows/ci.yml",
					],
				}),
			).toBe("native=false");

			// Any native-affecting file on PR push -> native=true
			for (const nativePath of [
				"ios/LocalOperatorMobile/Info.plist",
				"android/app/build.gradle",
				"modules/radient-loopback/index.ts",
				"plugins/with-android-local-network.js",
				"assets/icon.png",
				"app.config.ts",
				"app.json",
				"eas.json",
				"package.json",
				"pnpm-lock.yaml",
				"babel.config.js",
				"metro.config.js",
				"tsconfig.json",
				"scripts/ci/version.ts",
				".github/workflows/ios.yml",
				".github/workflows/android.yml",
				".github/workflows/merge-gate.yml",
			]) {
				expect(
					evaluateNativeFilter(script, {
						event: "pull_request",
						full: "false",
						files: ["src/index.ts", nativePath],
					}),
					`${file} -> ${nativePath}`,
				).toBe("native=true");
			}
		},
	);
});

describe("e2e.yml and merge-gate.yml two-tier contracts", () => {
	const e2e = readRepoFile(".github/workflows/e2e.yml");
	const mergeGate = readRepoFile(".github/workflows/merge-gate.yml");
	const gateJob = jobBlock(mergeGate, "merge-gate");
	const gateScript = extractInlineNodeScript(gateJob);

	it("removes per-push pull_request from e2e.yml and adds workflow_call", () => {
		const onSection =
			e2e.split("\non:\n")[1]?.split("\nconcurrency:\n")[0] ?? "";
		expect(onSection).toContain("  workflow_call:");
		expect(onSection).not.toMatch(TOP_PULL_REQUEST);
	});

	it("wires merge-gate.yml fail-closed with zero label or event skip guards", () => {
		expect(mergeGate).toContain("  pull_request:\n    types: [labeled]");
		expect(mergeGate).toContain("  workflow_dispatch:");
		expect(mergeGate).toContain("cancel-in-progress: false");

		const ids = jobIds(mergeGate);
		expect(ids).toEqual(["ios", "android", "e2e", "merge-gate"]);
		expect(jobBlock(mergeGate, "ios")).toContain(
			"uses: ./.github/workflows/ios.yml\n    with:\n      full: true",
		);
		expect(jobBlock(mergeGate, "android")).toContain(
			"uses: ./.github/workflows/android.yml\n    with:\n      full: true",
		);
		expect(jobBlock(mergeGate, "e2e")).toContain(
			"uses: ./.github/workflows/e2e.yml",
		);

		expect(gateJob).toContain(`name: ${REQUIRED_CHECK_NAME}`);
		expect(gateJob).toMatch(IF_ALWAYS_JOB);
		expect(gateJob).toContain("needs: [ios, android, e2e]");

		// Hostile case 1: no job or step `if:` in merge-gate.yml may inspect labels or events.
		const ifLines = [...mergeGate.matchAll(ANY_IF_LINE)].map(
			(m) => m[1]?.trim() ?? "",
		);
		expect(ifLines).toEqual(["always()"]);

		// Aggregate passes ONLY when ios, android, and e2e all conclude 'success'.
		expect(
			runInlineNode(gateScript, {
				NEEDS: JSON.stringify({
					ios: { result: "success" },
					android: { result: "success" },
					e2e: { result: "success" },
				}),
			}).status,
		).toBe(0);

		for (const job of ["ios", "android", "e2e"]) {
			for (const badResult of ["skipped", "failure", "cancelled"]) {
				const res = runInlineNode(gateScript, {
					NEEDS: JSON.stringify({
						ios: { result: "success" },
						android: { result: "success" },
						e2e: { result: "success" },
						[job]: { result: badResult },
					}),
				});
				expect(res.status, `${job}=${badResult}`).toBe(1);
				expect(res.stdout).toContain(
					`::error title=Merge gate::${job}=${badResult}`,
				);
			}
		}
	});
});

describe("scripts/ci/merge-gate.ts CLI & CI Gate precondition", () => {
	const REPO = "damianvtran/local-operator-mobile";
	const HEAD_SHA = "0123456789abcdef0123456789abcdef01234567";

	function mockRunner(
		calls: string[][],
		fixtures: {
			prView?: Record<string, unknown>;
			ciRuns?: Array<Record<string, unknown>>;
			ciJobsByRunAttempt?: Record<string, Array<Record<string, unknown>>>;
			mergeGateRuns?: Array<Record<string, unknown>>;
		},
	) {
		return (args: string[]) => {
			calls.push(args);
			if (args[0] === "pr" && args[1] === "view") {
				if (!fixtures.prView) {
					return {
						ok: false,
						stdout: "",
						detail: "GraphQL: Could not resolve",
					};
				}
				return {
					ok: true,
					stdout: JSON.stringify(fixtures.prView),
					detail: "",
				};
			}
			if (args[0] === "api") {
				const endpoint = args[1] ?? "";
				if (endpoint.includes("/actions/workflows/ci.yml/runs")) {
					return {
						ok: true,
						stdout: JSON.stringify({ workflow_runs: fixtures.ciRuns ?? [] }),
						detail: "",
					};
				}
				const attemptMatch = RUN_ATTEMPT_JOBS_ENDPOINT.exec(endpoint);
				if (attemptMatch) {
					const key = `${attemptMatch[1]}:${attemptMatch[2]}`;
					return {
						ok: true,
						stdout: JSON.stringify({
							jobs: fixtures.ciJobsByRunAttempt?.[key] ?? [],
						}),
						detail: "",
					};
				}
			}
			if (args[0] === "label" && args[1] === "create") {
				return { ok: true, stdout: "", detail: "" };
			}
			if (args[0] === "pr" && args[1] === "edit") {
				return { ok: true, stdout: "", detail: "" };
			}
			if (args[0] === "run" && args[1] === "list") {
				return {
					ok: true,
					stdout: JSON.stringify(fixtures.mergeGateRuns ?? []),
					detail: "",
				};
			}
			return {
				ok: false,
				stdout: "",
				detail: `unhandled args: ${args.join(" ")}`,
			};
		};
	}

	it("refuses to arm when CI Gate is missing, pending, red, or from an unbound fork", () => {
		// 1. Missing run
		expect(() =>
			verifyFastCiGateGreen({
				runGh: mockRunner([], { ciRuns: [] }),
				repo: REPO,
				prNumber: 250,
				headSha: HEAD_SHA,
				headRepo: REPO,
			}),
		).toThrow("has no `ci.yml` pull_request run bound to PR #250");

		// 2. Unbound fork run (empty pull_requests array or mismatched head_repository)
		expect(() =>
			verifyFastCiGateGreen({
				runGh: mockRunner([], {
					ciRuns: [
						{
							id: 99,
							path: CI_WORKFLOW_PATH,
							event: "pull_request",
							status: "completed",
							head_sha: HEAD_SHA,
							run_attempt: 1,
							repository: { full_name: REPO },
							head_repository: { full_name: "attacker/local-operator-mobile" },
							pull_requests: [],
						},
					],
				}),
				repo: REPO,
				prNumber: 250,
				headSha: HEAD_SHA,
				headRepo: REPO,
			}),
		).toThrow("has no `ci.yml` pull_request run bound to PR #250");

		// 3. In-progress run
		expect(() =>
			verifyFastCiGateGreen({
				runGh: mockRunner([], {
					ciRuns: [
						{
							id: 100,
							path: CI_WORKFLOW_PATH,
							event: "pull_request",
							status: "in_progress",
							head_sha: HEAD_SHA,
							run_attempt: 1,
							repository: { full_name: REPO },
							head_repository: { full_name: REPO },
							pull_requests: [{ number: 250 }],
						},
					],
				}),
				repo: REPO,
				prNumber: 250,
				headSha: HEAD_SHA,
				headRepo: REPO,
			}),
		).toThrow("is `in_progress` (not completed)");

		// 4. Completed run whose CI Gate job failed
		expect(() =>
			verifyFastCiGateGreen({
				runGh: mockRunner([], {
					ciRuns: [
						{
							id: 101,
							path: CI_WORKFLOW_PATH,
							event: "pull_request",
							status: "completed",
							head_sha: HEAD_SHA,
							run_attempt: 2,
							repository: { full_name: REPO },
							head_repository: { full_name: REPO },
							pull_requests: [{ number: 250 }],
						},
					],
					ciJobsByRunAttempt: {
						"101:2": [{ name: FAST_GATE_JOB_NAME, conclusion: "failure" }],
					},
				}),
				repo: REPO,
				prNumber: 250,
				headSha: HEAD_SHA,
				headRepo: REPO,
			}),
		).toThrow("concluded `failure`, not `success`");
	});

	it("removes then re-adds ready-to-merge when CI Gate is green and returns the fresh queued run", async () => {
		const calls: string[][] = [];
		const nowMs = Date.parse("2026-11-18T12:00:00Z");
		const runner = mockRunner(calls, {
			prView: {
				number: 250,
				url: "https://github.com/damianvtran/local-operator-mobile/pull/250",
				state: "OPEN",
				isDraft: false,
				headRefName: "ci/two-tier",
				headRefOid: HEAD_SHA,
				headRepository: { nameWithOwner: REPO },
				labels: [{ name: LABEL }],
			},
			ciRuns: [
				{
					id: 101,
					path: CI_WORKFLOW_PATH,
					event: "pull_request",
					status: "completed",
					conclusion: "success",
					head_sha: HEAD_SHA,
					run_attempt: 1,
					created_at: "2026-11-18T11:55:00Z",
					repository: { full_name: REPO },
					head_repository: { full_name: REPO },
					pull_requests: [{ number: 250 }],
				},
			],
			ciJobsByRunAttempt: {
				"101:1": [{ name: FAST_GATE_JOB_NAME, conclusion: "success" }],
			},
			mergeGateRuns: [
				{
					databaseId: 555001,
					url: "https://github.com/damianvtran/local-operator-mobile/actions/runs/555001",
					status: "completed",
					conclusion: "success",
					createdAt: "2026-11-18T11:00:00Z",
				},
				{
					databaseId: 555002,
					url: "https://github.com/damianvtran/local-operator-mobile/actions/runs/555002",
					status: "queued",
					conclusion: null,
					createdAt: "2026-11-18T12:00:05Z",
				},
			],
		});

		const logs: string[] = [];
		const queued = await runMergeGateCli({
			argv: ["250"],
			env: { MERGE_GATE_POLL_ATTEMPTS: "2", MERGE_GATE_POLL_INTERVAL_MS: "0" },
			runGh: runner,
			now: () => nowMs,
			sleep: async () => {},
			log: (line) => logs.push(line),
		});

		expect(queued.databaseId).toBe(555002);
		const editCalls = calls.filter(
			(args) => args[0] === "pr" && args[1] === "edit",
		);
		expect(editCalls).toEqual([
			["pr", "edit", "250", "--remove-label", LABEL],
			["pr", "edit", "250", "--add-label", LABEL],
		]);
		expect(logs.join("\n")).toContain(REQUIRED_CHECK_NAME);
	});

	it("skips --remove-label when PR does not yet carry ready-to-merge, and fails if no run appears", async () => {
		const calls: string[][] = [];
		const runner = mockRunner(calls, {
			prView: {
				number: 251,
				url: "https://github.com/damianvtran/local-operator-mobile/pull/251",
				state: "OPEN",
				isDraft: false,
				headRefName: "ci/two-tier",
				headRefOid: HEAD_SHA,
				headRepository: { nameWithOwner: REPO },
				labels: [],
			},
			ciRuns: [
				{
					id: 101,
					path: CI_WORKFLOW_PATH,
					event: "pull_request",
					status: "completed",
					conclusion: "success",
					head_sha: HEAD_SHA,
					run_attempt: 1,
					created_at: "2026-11-18T12:00:00Z",
					repository: { full_name: REPO },
					head_repository: { full_name: REPO },
					pull_requests: [{ number: 251 }],
				},
			],
			ciJobsByRunAttempt: {
				"101:1": [{ name: FAST_GATE_JOB_NAME, conclusion: "success" }],
			},
			mergeGateRuns: [],
		});

		await expect(
			runMergeGateCli({
				argv: ["251"],
				env: {
					MERGE_GATE_POLL_ATTEMPTS: "2",
					MERGE_GATE_POLL_INTERVAL_MS: "0",
				},
				runGh: runner,
				now: () => Date.parse("2026-11-18T12:00:00Z"),
				sleep: async () => {},
				log: () => {},
			}),
		).rejects.toThrow(
			`no \`${MERGE_GATE_WORKFLOW}\` pull_request run appeared`,
		);

		const editCalls = calls.filter(
			(args) => args[0] === "pr" && args[1] === "edit",
		);
		expect(editCalls).toEqual([["pr", "edit", "251", "--add-label", LABEL]]);
	});

	it("refuses closed PRs, bad arguments, and invalid env overrides before touching labels", async () => {
		expect(() => parseBoundedEnv({ X: "0" }, "X", 5, 1)).toThrow(
			MergeGateError,
		);
		expect(() => parseBoundedEnv({ X: "abc" }, "X", 5, 1)).toThrow(
			MergeGateError,
		);
		expect(parseBoundedEnv({}, "X", 5, 1)).toBe(5);

		await expect(
			runMergeGateCli({ argv: ["not-a-number"], log: () => {} }),
		).rejects.toThrow("usage: pnpm merge-gate <pull-request-number>");

		const calls: string[][] = [];
		const runner = mockRunner(calls, {
			prView: {
				number: 252,
				url: "https://github.com/damianvtran/local-operator-mobile/pull/252",
				state: "MERGED",
				isDraft: false,
				headRefName: "ci/two-tier",
				headRefOid: HEAD_SHA,
			},
		});
		await expect(
			runMergeGateCli({ argv: ["252"], runGh: runner, log: () => {} }),
		).rejects.toThrow("#252 is MERGED");
		expect(calls).toHaveLength(1);
	});
});
