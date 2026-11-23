#!/usr/bin/env node
/**
 * `pnpm merge-gate <pull-request-number>` — verify `CI Gate` is green on the PR's
 * current head, re-arm the `ready-to-merge` label to trigger `merge-gate.yml`,
 * and confirm the new `Merge Gate` run queued.
 *
 * WHY A TWO-TIER RITUAL. Per-push PR runs execute fast `ci.yml` (`CI Gate`), skip
 * `e2e.yml`, and run `ios.yml` / `android.yml` only when native-affecting files
 * change. Before merging, `merge-gate.yml` (`pull_request: [labeled]`) runs the
 * full iOS Release simulator build+launch, Android APK + manifest + determinism
 * gate, and E2E mock-relay contract together on `refs/pull/<n>/merge` and reports
 * `Merge gate (full suite)`.
 *
 * WHY CHECK `CI Gate` BEFORE ARMING (preventing the #4223 race from day one).
 * `merge-gate.yml` consumes a precious `macos-26` slot (~20-55 min) plus Linux
 * runners. Arming the heavy gate while fast `ci.yml` (`CI Gate`) is still pending
 * or red on `headRefOid` wastes scarce macOS capacity on a commit that hasn't
 * cleared lint/typecheck/unit-tests or is about to receive another push. So this
 * script inspects the PR head's bound `ci.yml` `pull_request` run (specifically
 * its latest attempt's `CI Gate` job) and refuses to arm unless `CI Gate` has
 * concluded `success` on `headRefOid`.
 *
 * WHY REMOVE THEN ADD THE LABEL. `gh pr edit --add-label` on a label already on
 * the PR is a GitHub no-op and delivers NO `labeled` webhook event. Removing
 * `ready-to-merge` first ensures the subsequent `--add-label` always delivers a
 * fresh `labeled` event on the current head SHA.
 *
 * Executed directly by Node >= 24 under `erasableSyntaxOnly` (no enums,
 * namespaces, or parameter properties) with zero third-party dependencies.
 */

import { spawnSync } from "node:child_process";
import process from "node:process";

export const LABEL = "ready-to-merge";
export const MERGE_GATE_WORKFLOW = "merge-gate.yml";
export const MERGE_GATE_WORKFLOW_PATH = ".github/workflows/merge-gate.yml";
export const CI_WORKFLOW_PATH = ".github/workflows/ci.yml";
export const FAST_GATE_JOB_NAME = "CI Gate";
export const REQUIRED_CHECK_NAME = "Merge gate (full suite)";
/** GitHub stamps `createdAt` in whole seconds; tolerate slight clock skew. */
export const SINCE_SKEW_MS = 10_000;
const PR_URL_REPO = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/\d+/;
const DIGITS_ONLY = /^\d+$/u;

export interface GhResult {
	ok: boolean;
	stdout: string;
	detail: string;
}

export type GhRunner = (args: string[]) => GhResult;

export interface PrView {
	number: number;
	url: string;
	state: string;
	isDraft: boolean;
	headRefName: string;
	headRefOid: string;
	headRepository?: { nameWithOwner?: string; name?: string } | null;
	headRepositoryOwner?: { login?: string } | null;
	baseRepository?: { nameWithOwner?: string } | null;
	labels?: Array<{ name?: string }>;
}

export interface WorkflowRunSummary {
	databaseId: number;
	url: string;
	status: string;
	conclusion: string | null;
	createdAt: string;
}

export interface RestWorkflowRun {
	id?: number;
	path?: string;
	event?: string;
	status?: string;
	conclusion?: string | null;
	head_sha?: string;
	run_attempt?: number;
	created_at?: string;
	html_url?: string;
	repository?: { full_name?: string } | null;
	head_repository?: { full_name?: string } | null;
	pull_requests?: Array<{ number?: number }> | null;
}

export interface RestJob {
	name?: string;
	status?: string;
	conclusion?: string | null;
}

export class MergeGateError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "MergeGateError";
	}
}

function fail(message: string): never {
	throw new MergeGateError(message);
}

/**
 * Parse a bounded integer override from `env`. Used by tests so failure paths
 * finish in milliseconds rather than waiting 30 seconds for GitHub's queue.
 */
export function parseBoundedEnv(
	env: Record<string, string | undefined>,
	name: string,
	fallback: number,
	minimum: number,
): number {
	const raw = env[name];
	if (raw === undefined || raw === "") return fallback;
	const value = Number(raw);
	if (!Number.isInteger(value) || value < minimum) {
		fail(
			`${name} must be an integer >= ${minimum}, got ${JSON.stringify(raw)}.`,
		);
	}
	return value;
}

export function defaultGhRunner(args: string[]): GhResult {
	const result = spawnSync("gh", args, { encoding: "utf8" });
	if (result.error) {
		fail(
			`could not run gh (${result.error.message}): install the GitHub CLI and authenticate it.`,
		);
	}
	return {
		ok: result.status === 0,
		stdout: result.stdout ?? "",
		detail: (result.stderr ?? "").trim() || `exit ${String(result.status)}`,
	};
}

function ghExec(runGh: GhRunner, args: string[]): string {
	const result = runGh(args);
	if (!result.ok) {
		fail(`gh ${args.join(" ")} failed: ${result.detail}`);
	}
	return result.stdout;
}

function repoFromPrUrl(url: string): string {
	const match = PR_URL_REPO.exec(url);
	return match?.[1] ?? "";
}

function headRepoFullName(view: PrView): string {
	if (view.headRepository?.nameWithOwner) {
		return view.headRepository.nameWithOwner;
	}
	if (view.headRepositoryOwner?.login && view.headRepository?.name) {
		return `${view.headRepositoryOwner.login}/${view.headRepository.name}`;
	}
	// `gh pr view --json headRepository,headRepositoryOwner` omits `nameWithOwner`
	// on older `gh` builds when owner + name are present; return empty (fail
	// closed at `verifyFastCiGateGreen`'s metadata guard) if neither is present,
	// such as a deleted fork head repository.
	return "";
}

function isWorkflowPath(path: string | undefined, expected: string): boolean {
	const normalized = path ?? "";
	return normalized === expected || normalized.startsWith(`${expected}@`);
}

/**
 * Verify that `ci.yml` (`CI Gate`) has completed with `conclusion === "success"`
 * on the latest attempt of the newest `pull_request` run bound to this PR and
 * exact `headRefOid`. Fails closed on pending, failed, cancelled, missing, or
 * unbound (fork) runs.
 */
export function verifyFastCiGateGreen(options: {
	runGh: GhRunner;
	repo: string;
	prNumber: number;
	headSha: string;
	headRepo: string;
}): { runId: number; attempt: number } {
	const { runGh, repo, prNumber, headSha, headRepo } = options;
	if (!repo || !headSha || !headRepo) {
		fail(
			`cannot verify \`${FAST_GATE_JOB_NAME}\` without repository, head SHA, and head repository metadata.`,
		);
	}

	const runsRaw = ghExec(runGh, [
		"api",
		`/repos/${repo}/actions/workflows/ci.yml/runs?head_sha=${encodeURIComponent(headSha)}&event=pull_request&per_page=100`,
	]);
	const runsPayload = JSON.parse(runsRaw) as {
		workflow_runs?: RestWorkflowRun[];
	};
	const runs = runsPayload.workflow_runs ?? [];

	const bound = runs.filter(
		(run) =>
			run.head_sha === headSha &&
			run.event === "pull_request" &&
			isWorkflowPath(run.path, CI_WORKFLOW_PATH) &&
			run.repository?.full_name === repo &&
			run.head_repository?.full_name === headRepo &&
			(run.pull_requests ?? []).some((pr) => pr.number === prNumber),
	);

	if (bound.length === 0) {
		fail(
			`fast CI (\`${FAST_GATE_JOB_NAME}\`) has no \`ci.yml\` pull_request run bound to PR #${String(prNumber)} at ${headSha.slice(0, 12)}. Wait for \`ci.yml\` to finish green before arming \`pnpm merge-gate ${String(prNumber)}\`.`,
		);
	}

	bound.sort((a, b) => {
		const timeCmp = String(b.created_at ?? "").localeCompare(
			String(a.created_at ?? ""),
		);
		if (timeCmp !== 0) return timeCmp;
		return (b.id ?? 0) - (a.id ?? 0);
	});

	const newest = bound[0];
	const runId = newest?.id;
	const attempt = newest?.run_attempt ?? 1;
	if (typeof runId !== "number") {
		fail("newest `ci.yml` run payload is missing numeric `id`.");
	}
	if (newest?.status !== "completed") {
		fail(
			`\`ci.yml\` run ${String(runId)} on ${headSha.slice(0, 12)} is \`${String(newest?.status ?? "unknown")}\` (not completed). Wait for \`${FAST_GATE_JOB_NAME}\` to turn green before arming the merge gate.`,
		);
	}

	const jobsRaw = ghExec(runGh, [
		"api",
		`/repos/${repo}/actions/runs/${String(runId)}/attempts/${String(attempt)}/jobs?per_page=100`,
	]);
	const jobsPayload = JSON.parse(jobsRaw) as { jobs?: RestJob[] };
	const gates = (jobsPayload.jobs ?? []).filter(
		(job) => job.name === FAST_GATE_JOB_NAME,
	);
	if (gates.length !== 1) {
		fail(
			`\`ci.yml\` run ${String(runId)} attempt ${String(attempt)} has ${String(gates.length)} \`${FAST_GATE_JOB_NAME}\` jobs (expected 1); refusing to arm on an unverified fast gate.`,
		);
	}
	const gateConclusion = gates[0]?.conclusion ?? null;
	if (gateConclusion !== "success") {
		fail(
			`\`${FAST_GATE_JOB_NAME}\` on \`ci.yml\` run ${String(runId)} attempt ${String(attempt)} concluded \`${String(gateConclusion ?? "pending")}\`, not \`success\`. Fix fast CI first, then re-run \`pnpm merge-gate ${String(prNumber)}\`.`,
		);
	}

	return { runId, attempt };
}

/**
 * Query `/repos/<repo>/actions/runs?head_sha=<headSha>&event=pull_request`
 * rather than `gh run list --workflow merge-gate.yml`: `gh run list --workflow`
 * resolves workflow filenames against the default branch only and fails with
 * HTTP 404 before `merge-gate.yml` lands on `main`, whereas `/actions/runs`
 * matches both bootstrap and post-merge runs on the exact `head_sha`.
 */
export async function pollForMergeGateRun(options: {
	runGh: GhRunner;
	repo: string;
	prNumber?: number;
	headSha: string;
	sinceMs: number;
	pollAttempts: number;
	pollIntervalMs: number;
	sleep: (ms: number) => Promise<void>;
}): Promise<WorkflowRunSummary | null> {
	const {
		runGh,
		repo,
		prNumber,
		headSha,
		sinceMs,
		pollAttempts,
		pollIntervalMs,
		sleep,
	} = options;
	for (let attempt = 1; attempt <= pollAttempts; attempt += 1) {
		const output = ghExec(runGh, [
			"api",
			`/repos/${repo}/actions/runs?head_sha=${encodeURIComponent(headSha)}&event=pull_request&per_page=30`,
		]);
		const payload = JSON.parse(output) as {
			workflow_runs?: RestWorkflowRun[];
		};
		const fresh = (payload.workflow_runs ?? [])
			.filter(
				(run): run is RestWorkflowRun & { id: number; created_at: string } => {
					if (
						typeof run.id !== "number" ||
						typeof run.created_at !== "string" ||
						run.head_sha !== headSha ||
						run.event !== "pull_request" ||
						!isWorkflowPath(run.path, MERGE_GATE_WORKFLOW_PATH) ||
						Date.parse(run.created_at) < sinceMs - SINCE_SKEW_MS
					) {
						return false;
					}
					// When GitHub populates `pull_requests`, require it to reference this
					// PR so two PRs sharing `head_sha` armed inside the skew window cannot
					// match each other's run. Keep empty/missing `pull_requests` eligible
					// because plan-time `startup_failure` runs omit PR bindings and still
					// need to surface as an immediate failure below.
					if (
						prNumber !== undefined &&
						Array.isArray(run.pull_requests) &&
						run.pull_requests.length > 0 &&
						!run.pull_requests.some((pr) => pr.number === prNumber)
					) {
						return false;
					}
					return true;
				},
			)
			.sort((a, b) => b.id - a.id);
		const newest = fresh[0];
		if (newest) {
			return {
				databaseId: newest.id,
				url:
					newest.html_url ??
					`https://github.com/${repo}/actions/runs/${String(newest.id)}`,
				status: newest.status ?? "unknown",
				conclusion: newest.conclusion ?? null,
				createdAt: newest.created_at,
			};
		}
		if (attempt < pollAttempts) await sleep(pollIntervalMs);
	}
	return null;
}
export { pollForMergeGateRun as waitForMergeGateRun };

export async function runMergeGateCli(options: {
	argv: string[];
	env?: Record<string, string | undefined>;
	runGh?: GhRunner;
	now?: () => number;
	sleep?: (ms: number) => Promise<void>;
	log?: (line: string) => void;
}): Promise<WorkflowRunSummary> {
	const env = options.env ?? process.env;
	const runGh = options.runGh ?? defaultGhRunner;
	const now = options.now ?? Date.now;
	const sleep =
		options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
	const log = options.log ?? ((line: string) => console.log(line));

	const pollAttempts = parseBoundedEnv(env, "MERGE_GATE_POLL_ATTEMPTS", 6, 1);
	const pollIntervalMs = parseBoundedEnv(
		env,
		"MERGE_GATE_POLL_INTERVAL_MS",
		5_000,
		0,
	);

	const argument = options.argv[0];
	if (!argument || !DIGITS_ONLY.test(argument)) {
		fail("usage: pnpm merge-gate <pull-request-number>");
	}

	const viewCall = runGh([
		"pr",
		"view",
		argument,
		"--json",
		"number,url,state,isDraft,headRefName,headRefOid,headRepository,headRepositoryOwner,labels",
	]);
	if (!viewCall.ok) {
		fail(
			`no pull request #${argument} to arm (${viewCall.detail}). Check the number, and that gh is authenticated against the intended repository.`,
		);
	}
	const view = JSON.parse(viewCall.stdout) as PrView;
	if (view.state !== "OPEN") {
		fail(
			`#${String(view.number)} is ${view.state}: the merge gate only runs for an open pull request.`,
		);
	}

	const repo = env.GITHUB_REPOSITORY?.trim() || repoFromPrUrl(view.url);
	const headRepo = headRepoFullName(view);

	const fastGate = verifyFastCiGateGreen({
		runGh,
		repo,
		prNumber: view.number,
		headSha: view.headRefOid,
		headRepo,
	});
	log(
		`#${String(view.number)}: verified \`${FAST_GATE_JOB_NAME}\` green on ci.yml run ${String(fastGate.runId)} (attempt ${String(fastGate.attempt)}) for ${view.headRefOid.slice(0, 12)}.`,
	);

	// Idempotent label creation (`--force` updates description/color if present).
	ghExec(runGh, [
		"label",
		"create",
		LABEL,
		"--color",
		"0E8A16",
		"--description",
		"Full native + E2E merge gate requested on this head — re-arm with pnpm merge-gate <n>",
		"--force",
	]);

	const alreadyLabeled = (view.labels ?? []).some(
		(label) => label.name === LABEL,
	);
	const startedAt = now();
	if (alreadyLabeled) {
		ghExec(runGh, ["pr", "edit", argument, "--remove-label", LABEL]);
		log(
			`#${String(view.number)}: removed \`${LABEL}\` first (adding a label that is already present delivers no event).`,
		);
	}
	ghExec(runGh, ["pr", "edit", argument, "--add-label", LABEL]);
	log(
		`#${String(view.number)}: added \`${LABEL}\` on ${view.headRefOid.slice(0, 12)} (${view.headRefName}).`,
	);

	const queued = await pollForMergeGateRun({
		runGh,
		repo,
		prNumber: view.number,
		headSha: view.headRefOid,
		sinceMs: startedAt,
		pollAttempts,
		pollIntervalMs,
		sleep,
	});
	if (!queued) {
		fail(
			[
				`no \`${MERGE_GATE_WORKFLOW}\` pull_request run appeared for ${view.headRefOid.slice(0, 12)} (${view.headRefName}) within ${String((pollAttempts * pollIntervalMs) / 1000)}s of the label event. \`${LABEL}\` is now ON #${String(view.number)} — inspect runs before re-arming:`,
				`  gh api "/repos/${repo}/actions/runs?head_sha=${view.headRefOid}&event=pull_request&per_page=30"`,
				`  ${view.url}/checks`,
			].join("\n"),
		);
	}

	if (
		queued.status === "completed" &&
		queued.conclusion !== null &&
		queued.conclusion !== "success"
	) {
		fail(
			`\`${MERGE_GATE_WORKFLOW}\` run ${String(queued.databaseId)} completed immediately with conclusion \`${queued.conclusion}\` (not armed cleanly): ${queued.url}`,
		);
	}

	const verdict = queued.conclusion ? ` (${queued.conclusion})` : "";
	log("");
	log(
		`Run ${String(queued.databaseId)} is ${queued.status}${verdict}: ${queued.url}`,
	);
	log(
		`Required check: \`${REQUIRED_CHECK_NAME}\`, reported by the \`merge-gate\` job.`,
	);
	if (view.isDraft) {
		log(
			"Note: this pull request is a draft. The gate runs, but a draft cannot merge.",
		);
	}
	return queued;
}

const isEntryPoint = (import.meta as ImportMeta & { main?: boolean }).main;
if (isEntryPoint) {
	runMergeGateCli({ argv: process.argv.slice(2) }).catch((error: unknown) => {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`merge-gate: ${message}`);
		process.exit(1);
	});
}
