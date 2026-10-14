#!/usr/bin/env node
/**
 * Weekly flake report: which CI results changed their mind about the SAME code.
 *
 *     GH_TOKEN=… GITHUB_REPOSITORY=owner/repo node scripts/ci/flake-report.ts [days]
 *
 * WHY THIS EXISTS. The nightly's Maestro step re-runs the whole flow set once
 * (ADR 0003) and, when the re-run passes, the job goes GREEN with a
 * `Maestro flaked once` warning annotation. Two nights in a row that annotation was
 * the only trace of a real transport flake, and nothing reads annotations. The
 * same is true of a rerun that clears a red job. This report reads the signals
 * GitHub already keeps and puts them where a person looks, so a flake costs a
 * line in a summary instead of seven silent minutes a night.
 *
 * WHAT COUNTS (all read from the Actions API, nothing re-run, nothing installed):
 *   1. the same workflow, event AND commit with both a failure and a success;
 *   2. a run that needed attempt > 1;
 *   3. a successful Maestro job carrying the `Maestro flaked once` warning.
 * Different EVENTS on one commit are deliberately not compared: a nightly runs jobs
 * a push never does, so "push green, nightly red" is a different check failing, not a
 * flake (that mistake would have put the 7 genuine nightly defects of 10/04–10/12
 * in this report).
 *
 * It only REPORTS (a job summary). It never opens an issue or fails the workflow:
 * a report that can turn red is a new flaky thing. The grouping is a pure function
 * (`flakyGroups`) so it is unit-tested without the network.
 */

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

export type RunRow = {
	id: number;
	name: string;
	event: string;
	sha: string;
	branch: string;
	conclusion: string | null;
	attempt: number;
};

export type FlakyGroup = {
	reason: "mixed-outcomes" | "rerun";
	workflow: string;
	event: string;
	sha: string;
	branch: string;
	runs: number[];
};

/** Conclusions that say the code was judged; cancelled/skipped say nothing about it. */
const JUDGED = new Set(["success", "failure"]);

export function flakyGroups(rows: readonly RunRow[]): FlakyGroup[] {
	const out: FlakyGroup[] = [];
	const byKey = new Map<string, RunRow[]>();
	for (const row of rows) {
		if (!JUDGED.has(row.conclusion ?? "")) continue;
		const key = `${row.name}\u0000${row.event}\u0000${row.sha}`;
		byKey.set(key, [...(byKey.get(key) ?? []), row]);
	}
	for (const group of byKey.values()) {
		const first = group[0] as RunRow;
		const outcomes = new Set(group.map((row) => row.conclusion));
		if (outcomes.size > 1) {
			out.push({
				reason: "mixed-outcomes",
				workflow: first.name,
				event: first.event,
				sha: first.sha,
				branch: first.branch,
				runs: group.map((row) => row.id),
			});
		}
	}
	for (const row of rows) {
		if (row.attempt > 1) {
			out.push({
				reason: "rerun",
				workflow: row.name,
				event: row.event,
				sha: row.sha,
				branch: row.branch,
				runs: [row.id],
			});
		}
	}
	return out;
}

const gh = (path: string): unknown =>
	JSON.parse(
		execFileSync("gh", ["api", path], {
			encoding: "utf8",
			maxBuffer: 64 * 1024 * 1024,
		}),
	);

function main(): void {
	const repo = process.env.GITHUB_REPOSITORY;
	if (repo === undefined || repo === "") {
		throw new Error("GITHUB_REPOSITORY is not set");
	}
	const days = Number(process.argv[2] ?? 7);
	const since = new Date(Date.now() - days * 86_400_000)
		.toISOString()
		.slice(0, 10);
	type ApiRun = {
		id: number;
		name: string;
		event: string;
		head_sha: string;
		head_branch: string;
		conclusion: string | null;
		run_attempt: number;
	};
	// Paged: a week of this repository's history is several hundred runs, and the
	// first page alone covers about three days — the report would silently describe
	// only the newest half of the window it names.
	const listing: { workflow_runs: ApiRun[] } = { workflow_runs: [] };
	for (let page = 1; page <= 20; page += 1) {
		const body = gh(
			`repos/${repo}/actions/runs?per_page=100&page=${page}&created=>=${since}`,
		) as { workflow_runs: ApiRun[] };
		listing.workflow_runs.push(...body.workflow_runs);
		if (body.workflow_runs.length < 100) break;
	}
	const rows: RunRow[] = listing.workflow_runs.map((run) => ({
		id: run.id,
		name: run.name,
		event: run.event,
		sha: run.head_sha,
		branch: run.head_branch,
		conclusion: run.conclusion,
		attempt: run.run_attempt,
	}));

	// Maestro jobs only exist in nightly/dispatch runs. The RUN need not be green:
	// the 10/13 nightly was red on its web job while its Maestro job had gone green
	// only on the re-run, so the filter is the JOB's conclusion, read below.
	const flakedOnce: Array<{ run: number; branch: string }> = [];
	for (const row of rows) {
		if (row.event !== "schedule" && row.event !== "workflow_dispatch") continue;
		const jobs = gh(
			`repos/${repo}/actions/runs/${row.id}/jobs?per_page=100`,
		) as {
			jobs: Array<{ id: number; name: string; conclusion: string | null }>;
		};
		for (const job of jobs.jobs) {
			if (!job.name.startsWith("Maestro flows") || job.conclusion !== "success")
				continue;
			const notes = gh(
				`repos/${repo}/check-runs/${job.id}/annotations`,
			) as Array<{
				title: string | null;
			}>;
			if (notes.some((note) => note.title === "Maestro flaked once")) {
				flakedOnce.push({ run: row.id, branch: row.branch });
			}
		}
	}

	const groups = flakyGroups(rows);
	const link = (id: number) =>
		`[${id}](https://github.com/${repo}/actions/runs/${id})`;
	const lines = [
		`## Flake report — last ${days} day(s) of ${repo}`,
		"",
		`${rows.length} run(s) read. ${groups.length} flaky group(s), ${flakedOnce.length} green Maestro run(s) that only passed on the re-run.`,
		"",
	];
	if (groups.length > 0) {
		lines.push(
			"| Why | Workflow | Event | Branch | Commit | Runs |",
			"|---|---|---|---|---|---|",
		);
		for (const g of groups) {
			lines.push(
				`| ${g.reason} | ${g.workflow} | ${g.event} | ${g.branch} | \`${g.sha.slice(0, 8)}\` | ${g.runs.map(link).join(", ")} |`,
			);
		}
		lines.push("");
	}
	if (flakedOnce.length > 0) {
		lines.push(
			"Green only after the one re-run (`Maestro flaked once`): " +
				flakedOnce.map((f) => `${link(f.run)} (${f.branch})`).join(", "),
			"",
		);
	}
	const text = `${lines.join("\n")}\n`;
	process.stdout.write(text);
	const summary = process.env.GITHUB_STEP_SUMMARY;
	if (summary !== undefined && summary !== "") appendFileSync(summary, text);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
