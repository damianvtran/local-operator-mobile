import { describe, expect, it } from "vitest";
import { flakyGroups, type RunRow } from "./flake-report.ts";

const run = (over: Partial<RunRow>): RunRow => ({
	id: 1,
	name: "CI",
	event: "pull_request",
	sha: "aaaaaaaa",
	branch: "feat/x",
	conclusion: "success",
	attempt: 1,
	...over,
});

describe("flakyGroups", () => {
	it("reports one commit that both failed and passed under the same workflow and event", () => {
		const groups = flakyGroups([
			run({ id: 1, conclusion: "failure" }),
			run({ id: 2, conclusion: "success" }),
		]);
		expect(groups).toHaveLength(1);
		expect(groups[0]?.reason).toBe("mixed-outcomes");
		expect(groups[0]?.runs).toEqual([1, 2]);
	});

	it("does not compare different events: a nightly red next to a push green is another check", () => {
		expect(
			flakyGroups([
				run({ id: 1, event: "push", conclusion: "success" }),
				run({ id: 2, event: "schedule", conclusion: "failure" }),
			]),
		).toEqual([]);
	});

	it("ignores cancelled and skipped runs, which judged nothing", () => {
		expect(
			flakyGroups([
				run({ id: 1, conclusion: "cancelled" }),
				run({ id: 2, conclusion: "success" }),
				run({ id: 3, conclusion: "skipped" }),
			]),
		).toEqual([]);
	});

	it("reports a run that needed a second attempt, once", () => {
		const groups = flakyGroups([run({ id: 9, attempt: 2 })]);
		expect(groups).toEqual([
			expect.objectContaining({ reason: "rerun", runs: [9] }),
		]);
	});

	it("keeps unrelated commits apart", () => {
		expect(
			flakyGroups([
				run({ id: 1, sha: "aaaaaaaa", conclusion: "failure" }),
				run({ id: 2, sha: "bbbbbbbb", conclusion: "success" }),
			]),
		).toEqual([]);
	});
});
