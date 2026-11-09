import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `--scales` ADMISSION, through the entry point a caller actually runs.
 *
 * The ids are filtered through `SCALES` when the capture's options are built, so an id the
 * table does not declare used to vanish there rather than fail: measured on the base tree,
 * `--scales 175 --plan` printed `capture plan: 0 cells × 1 frame(s) = 0 frames` and exited
 * **0**. A caller asking for a 175 % run got a green exit and no frames — the silent
 * empty-axis failure this harness already refuses for `--tier` and for an empty plan, left
 * open in the one flag that filters instead of erroring.
 *
 * Asserted by RUNNING the command, because the defect was in the CLI's own resolution
 * order (before the plan is built and therefore before any planning output), and a unit
 * test over a helper would not have caught a refusal placed after the plan printed.
 */
const repoRoot = resolve(import.meta.dirname, "../..");
const fixtureDir = resolve(repoRoot, "e2e/fixtures/audit-canary");

/**
 * The plan for one `--scales` list.
 *
 * `--out` points at a throwaway directory: `--plan` still resolves the output path, and a
 * default under the repository would leave a frame tree inside it (ADR 0003).
 */
const plan = (...scales: string[]) => {
	const out = mkdtempSync(join(tmpdir(), "capture-scales-"));
	const run = spawnSync(
		process.execPath,
		[
			"tools/visual/capture.ts",
			"--dir",
			fixtureDir,
			"--out",
			out,
			"--cells",
			"path:/defects/defects",
			"--devices",
			"iphone-se",
			"--themes",
			"dark",
			"--scales",
			scales.join(","),
			"--plan",
		],
		{ cwd: repoRoot, encoding: "utf8", timeout: 120_000 },
	);
	rmSync(out, { recursive: true, force: true });
	return {
		status: run.status,
		stdout: run.stdout ?? "",
		stderr: run.stderr ?? "",
	};
};

describe("capture --scales", () => {
	it("refuses a scale the table does not declare, before any plan", () => {
		const result = plan("175");
		expect(runStatusOf(result)).toBe(2);
		/* Both halves in one sentence, because a refusal that names only the value leaves
		 * the caller guessing which ids the harness would have accepted. */
		expect(result.stderr).toContain("unknown --scales '175'");
		expect(result.stderr).toContain("100, 135, 150, 200");
		// Nothing was planned: the refusal precedes the plan, so no caller can read a
		// plan and believe the run happened.
		expect(result.stdout).not.toContain("capture plan");
		// The CLI spawns a Node process of its own; under this host's load (~50, 25
		// concurrent sessions) it exceeds vitest's 5 s default, so the budget is
		// stated here rather than inherited. A test that times out says nothing about
		// the refusal it was written to prove.
	}, 30_000);

	it("still plans a declared scale (negative control)", () => {
		const result = plan("135");
		expect(runStatusOf(result)).toBe(0);
		expect(result.stdout).toContain("capture plan: 1 cells");
		expect(result.stdout).toContain("scales:  135");
	}, 30_000);

	it("refuses an undeclared id BESIDE a declared one", () => {
		// The filter dropped only the unknown entry, so a mixed list silently ran the
		// declared half under a label that promised the other — the same defect wearing a
		// smaller mask.
		const result = plan("100", "175");
		expect(runStatusOf(result)).toBe(2);
		expect(result.stderr).toContain("unknown --scales '175'");
		expect(result.stdout).not.toContain("capture plan");
	}, 30_000);
});

/** `status` is `null` when the child was killed by a signal; say so rather than pass. */
function runStatusOf(result: { status: number | null }) {
	if (result.status === null)
		throw new Error("the capture CLI was killed before it could exit");
	return result.status;
}
