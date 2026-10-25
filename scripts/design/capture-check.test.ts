import { expect, it } from "vitest";
import { checkStaleFrame } from "../../design/preview/capture-stale.probe.mjs";

/**
 * The frame gate's failing path, from `pnpm test`.
 *
 * The scenario lives in `design/preview/capture-stale.probe.mjs`, which the design
 * job runs with plain `node` — because that job has a browser and this one may not.
 * `pnpm test` runs on `ubuntu-latest` without Chrome, so the import below skips
 * here and the guard that actually executes on every PR is the probe step in the
 * design job. Keeping one implementation means an assertion fixed in one place
 * cannot drift in the other.
 *
 * WHY THE SCENARIO EXISTS AT ALL: round 2 moved the comparison arithmetic out of
 * `capture.mjs` and the `const failures = []` declaration went with it. Every
 * passing run never reaches `stale()`, so nothing noticed until the first stale
 * frame — which is the only frame this gate is for. The throw was uncaught: the
 * stale line printed, the closing summary never did, the remaining captures went
 * unchecked and the browser tree leaked (CI run 40204513522: `ReferenceError:
 * failures is not defined`, nine orphan processes reaped at job end).
 */
it("a stale frame fails the gate with its summary, its teardown and a non-zero exit", (ctx) => {
	const result = checkStaleFrame();
	if (result.skipped) {
		console.warn(
			`capture-stale: skipped (${result.skipped}) — ` +
				"the same scenario runs in the design job as `node design/preview/capture-stale.probe.mjs`",
		);
		ctx.skip();
	}
	expect(result.problems).toEqual([]);
}, 120_000);
