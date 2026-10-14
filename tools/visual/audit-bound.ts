/**
 * The `web-audit-core` audit step, held to the plan it audits.
 *
 * WHY THIS EXISTS: the step's `timeout-minutes` sat below the audit's own cost,
 * and a killed audit is SILENT — it never writes its summary, so the rubric
 * rows it exists to report are not visible. The bound is a budget that has to
 * hold the work, not a threshold to raise when it fires.
 *
 * WHAT IT CHECKS — THE ARITHMETIC, NOT THE CI. `coreAuditBoundMinutes` reads the
 * bound out of the workflow text; `auditBoundProblem` holds it against the plan's
 * measured need plus the ~20% headroom floor (`AUDIT_BOUND_HEADROOM`), and
 * `coreJobHeadroomProblem` holds the job's REAL requirement — the capture bound
 * plus the audit's measured need, not the step caps' paper sum — under the job's
 * own cap. A slower runner is invisible here; what this can refuse is a bound or
 * a cap the work provably does not fit. The pins below carry their source run id
 * and are re-derived with it.
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

/** The headroom a step bound must carry over the measured need — ~20%, the
 *  shape this file's bounds claim, now ENFORCED rather than assumed (review
 *  round 1, minor 1: a bound equal to the measured need used to pass with zero
 *  room to move). */
export const AUDIT_BOUND_HEADROOM = 1.2;

/** Minutes a plan of `cells` needs at the measured rate. */
export function auditPlanMinutes(cells: number): number {
	return (cells * AUDIT_SECONDS_PER_CELL) / 60;
}

/** The floor a step bound must clear: the measured need with the headroom
 *  applied and rounded UP — 74 min of work requires 89 (ceil(74 x 1.2)) at the
 *  current figures, which the shipped 90 carries. */
export function auditRequiredMinutes(cells: number): number {
	return Math.ceil(auditPlanMinutes(cells) * AUDIT_BOUND_HEADROOM);
}

/** The text between the `web-audit-core:` job key and the next job; `null` when
 *  the job is not found — a caller must FAIL on `null`, never skip. */
function coreJobSection(workflow: string): string | null {
	const rest = workflow.split("  web-audit-core:\n")[1];
	if (rest === undefined) return null;
	return rest.split("  maestro-android:\n")[0] ?? null;
}

/** The named step's block inside `job`, to the next step; `null` when absent. */
function stepSection(job: string, marker: string): string | null {
	const after = job.split(marker)[1];
	if (after === undefined) return null;
	return after.split("\n      - ")[0] ?? null;
}

/**
 * The `web-audit-core` job's audit step as text; `null` when the job or the
 * step cannot be found. A missing step must FAIL the guard, never pass it
 * vacuously — the per-push `web-audit` job carries a step with the same name,
 * and the job split is what keeps the two apart.
 */
function coreAuditStep(workflow: string): string | null {
	const job = coreJobSection(workflow);
	if (job === null) return null;
	return stepSection(job, "- name: Audit the frames against the rubric");
}

/** A bound line, matched on non-comment lines only — a comment that merely
 *  mentions `timeout-minutes: N` is documentation, not the bound (QA round 1,
 *  Q1: the raw-text read could be fooled by one). Hoisted so the literal is not
 *  rebuilt per call (`useTopLevelRegex`). */
const TIMEOUT_MINUTES = /timeout-minutes:\s*(\d+)/;

/** The first non-comment `timeout-minutes` a block carries, or `null`. */
function blockBoundMinutes(block: string): number | null {
	for (const raw of block.split("\n")) {
		const line = raw.trim();
		if (line === "" || line.startsWith("#")) continue;
		const match = TIMEOUT_MINUTES.exec(line);
		if (match?.[1] !== undefined) return Number(match[1]);
	}
	return null;
}

/** The job-LEVEL `timeout-minutes` — the key at the job's own indent, before
 *  any step; steps carry theirs deeper, and comments are skipped. */
const JOB_BOUND = /^ {4}timeout-minutes:\s*(\d+)/;
function jobBoundMinutes(job: string): number | null {
	for (const raw of job.split("\n")) {
		if (raw.trimStart().startsWith("#")) continue;
		const match = JOB_BOUND.exec(raw);
		if (match?.[1] !== undefined) return Number(match[1]);
	}
	return null;
}

/** The step's `timeout-minutes`, or `null` when it has none. */
export function coreAuditBoundMinutes(workflow: string): number | null {
	const step = coreAuditStep(workflow);
	if (step === null) return null;
	return blockBoundMinutes(step);
}

/** `null` when a bound of `boundMinutes` clears the plan's headroom floor, else
 *  the reason with the numbers in it — so a failure reads as the arithmetic it
 *  broke. */
export function auditBoundProblem(
	cells: number,
	boundMinutes: number | null,
): string | null {
	if (boundMinutes === null) {
		return "the core audit step carries no timeout-minutes";
	}
	const required = auditRequiredMinutes(cells);
	if (boundMinutes >= required) return null;
	const rate = AUDIT_SECONDS_PER_CELL.toFixed(2);
	const need = auditPlanMinutes(cells).toFixed(1);
	return (
		`the core audit step is bound at ${boundMinutes} min; the ` +
		`${cells}-cell plan needs ~${need} min at ${rate} s/cell and the ` +
		`${AUDIT_BOUND_HEADROOM}x headroom floor is ${required} min ` +
		`(run ${AUDIT_KILLED_RUN})`
	);
}

/**
 * The core job's real remaining margin, or the reason it is gone. The capture
 * step's bound plus the audit's measured need must sit UNDER the job's own cap —
 * the REAL requirement (160 + 74 = 234 < 240 at this head), not the step caps'
 * paper sum (`160 + 90`), which is ceiling policy and deliberately exceeds it
 * (review round 1, minor 2 / QA round 1, Q2: the old invariant was prose-only,
 * and this asserts the weaker replacement so a capture bump or cap cut fails
 * loudly instead of pushing the audit under the cap silently). Fails closed: a
 * missing job, step or bound is a refusal, never a pass.
 */
export function coreJobHeadroomProblem(
	workflow: string,
	cells: number,
): string | null {
	const job = coreJobSection(workflow);
	if (job === null) return "the web-audit-core job could not be found";
	const capture = stepSection(
		job,
		"- name: Capture the frames (the core device sample)",
	);
	if (capture === null) return "the core capture step could not be found";
	const captureBound = blockBoundMinutes(capture);
	if (captureBound === null)
		return "the core capture step carries no timeout-minutes";
	const jobCap = jobBoundMinutes(job);
	if (jobCap === null) return "the core job carries no timeout-minutes";
	const need = Math.ceil(auditPlanMinutes(cells));
	const total = captureBound + need;
	if (total >= jobCap) {
		return (
			`the job's real requirement is not under its ${jobCap}-minute cap: ` +
			`capture bound ${captureBound} + the audit's measured ~${need} min ` +
			`= ${total} min`
		);
	}
	return null;
}
