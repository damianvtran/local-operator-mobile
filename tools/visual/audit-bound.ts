/**
 * The `web-audit-core` audit step, held to the plan it audits.
 *
 * WHY THIS EXISTS: the step's `timeout-minutes` sat below the audit's own cost,
 * and a killed audit is SILENT — it never writes its summary, so the rubric
 * rows it exists to report are not visible. The bound is a budget that has to
 * hold the work, not a threshold to raise when it fires.
 *
 * WHAT IT CHECKS — THE ARITHMETIC, NOT THE CI. `coreAuditBoundMinutes` reads the
 * bound out of the workflow text; `auditBoundProblem` holds it against
 * `auditPlanMinutes(cells)`: the plan the harness prints for `core`, times the
 * per-cell cost the run that broke the old bound measured. A slower runner is
 * invisible here; what this can refuse is a bound the plan provably does not
 * fit. The pins below carry their source run id and are re-derived with it.
 *
 * WHY A MODULE AND NOT ONLY A TEST: the guard must also run where the test
 * runner is not installed — `node` on a `.ts` file, how every tool in this tree
 * runs — so the arithmetic lives here and `plan-figures.test.ts` asserts over
 * it beside the plan the harness prints. This file imports nothing.
 */

/** The run whose kill exposed the old bound: job 115741848014, head 80ed4a35,
 *  a workflow_dispatch (2026-10-14). The step ran 70m12s (4,212 s) and the
 *  log's last line is `2870/3024 cells audited`, one second before
 *  `##[error]The action 'Audit the frames against the rubric' has timed out
 *  after 70 minutes.` */
export const AUDIT_KILLED_RUN = "38530472075";

/** What that run printed, and nothing smoothed: cells audited when the bound
 *  killed it, and the step's wall time in seconds. */
export const AUDIT_MEASURED_CELLS = 2870;
export const AUDIT_MEASURED_SECONDS = 4212;

/** The measured per-cell cost — derived, never retyped: 4,212 / 2,870 =
 *  1.4676 s/cell (40.9 cells/min). */
export const AUDIT_SECONDS_PER_CELL =
	AUDIT_MEASURED_SECONDS / AUDIT_MEASURED_CELLS;

/** Minutes a plan of `cells` needs at the measured rate. */
export function auditPlanMinutes(cells: number): number {
	return (cells * AUDIT_SECONDS_PER_CELL) / 60;
}

/**
 * The `web-audit-core` job's audit step as text; `null` when the job or the
 * step cannot be found. A missing step must FAIL the guard, never pass it
 * vacuously — the per-push `web-audit` job carries a step with the same name,
 * and the job split is what keeps the two apart.
 */
function coreAuditStep(workflow: string): string | null {
	const parts = workflow.split("  web-audit-core:\n");
	const rest = parts[1];
	if (rest === undefined) return null;
	const job = rest.split("  maestro-android:\n")[0];
	if (job === undefined) return null;
	const after = job.split("- name: Audit the frames against the rubric")[1];
	if (after === undefined) return null;
	return after.split("\n      - ")[0] ?? null;
}

/** The step's bound line, hoisted so the literal is not rebuilt per call
 *  (`useTopLevelRegex`). */
const TIMEOUT_MINUTES = /timeout-minutes:\s*(\d+)/;

/** The step's `timeout-minutes`, or `null` when it has none. */
export function coreAuditBoundMinutes(workflow: string): number | null {
	const step = coreAuditStep(workflow);
	if (step === null) return null;
	const match = TIMEOUT_MINUTES.exec(step);
	if (match === null || match[1] === undefined) return null;
	return Number(match[1]);
}

/** `null` when a bound of `boundMinutes` holds the plan, else the reason with
 *  the numbers in it — so a failure reads as the arithmetic it broke. */
export function auditBoundProblem(
	cells: number,
	boundMinutes: number | null,
): string | null {
	if (boundMinutes === null) {
		return "the core audit step carries no timeout-minutes";
	}
	const required = auditPlanMinutes(cells);
	if (boundMinutes >= required) return null;
	const rate = AUDIT_SECONDS_PER_CELL.toFixed(2);
	const need = required.toFixed(1);
	return (
		`the core audit step is bound at ${boundMinutes} min; the ` +
		`${cells}-cell plan needs ~${need} min at ${rate} s/cell ` +
		`(run ${AUDIT_KILLED_RUN})`
	);
}
