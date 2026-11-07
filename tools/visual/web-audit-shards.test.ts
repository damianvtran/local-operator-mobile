/* The `web-audit` job is sharded over device profiles (see the comment above that
 * job in `.github/workflows/e2e.yml`): each leg captures ONE profile and the legs
 * together must be the `ci` tier's device list, exactly once each. That partition
 * is the whole reason the job fits its bound, and it is the one thing a later edit
 * to `CI_DEVICES` could silently break — a device added to the tier and not to the
 * matrix is coverage the job would simply stop capturing, with every leg green and
 * nothing to say so. So the partition is asserted against the harness's own
 * constant rather than against a second copy of the list in prose.
 *
 * It also pins the two things the shard must not do: no leg may select a device
 * outside the tier (a leg that captures nothing is worse than no leg), and the
 * capture step must still pass `--devices`, because without it every leg would
 * capture the whole tier and the shard would be a duplicate, not a split.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CI_DEVICES } from "./matrix.ts";

const workflow = readFileSync(
	resolve(import.meta.dirname, "../../.github/workflows/e2e.yml"),
	"utf8",
);

/** A job's block ends where the next top-level job key starts. */
const NEXT_JOB = /^ {2}[\w-]+:\n/m;

/** The capture's device flag, with the workflow expression spelled exactly — a
 *  regex because a quoted `${{ … }}` is a template placeholder to the linter. */
const DEVICE_FLAG = /--devices "\$\{\{ matrix\.device \}\}"/;

/** The `web-audit` job's own block: every other job starts at the same indent. */
const block = (() => {
	const start = workflow.indexOf("\n  web-audit:\n");
	expect(start, "the web-audit job is gone from the workflow").toBeGreaterThan(
		-1,
	);
	const rest = workflow.slice(start + 1);
	const next = rest.slice(2).search(NEXT_JOB);
	return next === -1 ? rest : rest.slice(0, next + 2);
})();

/** The `device:` values under the job's `matrix.include` list. */
const legs = [...block.matchAll(/^\s+- device: (\S+)$/gm)].map(
	(match) => match[1],
);

describe("the web audit's device shards", () => {
	it("partitions the ci tier's device list exactly once each", () => {
		expect(legs.length).toBeGreaterThan(1);
		expect([...legs].sort()).toEqual([...CI_DEVICES].sort());
	});

	it("gives each leg a flows flag, so the once-per-run proofs have one home", () => {
		const flags = [...block.matchAll(/^\s+flows: (true|false)$/gm)].map(
			(match) => match[1],
		);
		expect(flags).toHaveLength(legs.length);
		expect(flags.filter((flag) => flag === "true")).toHaveLength(1);
	});

	it("hands the leg's device to the capture and keeps the audit per leg", () => {
		/* The workflow's own expression, so the assertion names what the leg passes. */
		expect(block).toMatch(DEVICE_FLAG);
		expect(block).toContain(
			'pnpm audit:run --manifest "$RUNNER_TEMP/frames/manifest.json"',
		);
	});

	it("folds the legs into one verdict job that selects with them", () => {
		expect(workflow).toContain("\n  web-audit-verdict:\n");
		const verdict = workflow.slice(
			workflow.indexOf("\n  web-audit-verdict:\n"),
		);
		expect(verdict).toContain("needs: web-audit");
		/* `needs.<matrix job>.result` is `success` only when every leg passed, and
		 *  anything else — failure, cancelled, skipped — must not read as a pass. */
		expect(verdict).toContain('test "$RESULT" = success');
	});
});
