/**
 * The blind decision lives in `tools/lib/blind-report.ts`, which `vitest` does not reach by
 * itself — its `include` is `src/**` and `scripts/**`, so the rest of `tools/**` has the
 * sweep as its only guard. That gap has hidden a defect three times on this branch.
 *
 * Two false readings are pinned here, and the second is the reason the fixture is shaped
 * the way it is:
 *  - a FALSE PASS, when the predicate re-derived the `missed` term and ignored the canary's
 *    own verdict, so `cleanFails`/`cleanStatus`/`vacuous` failures still recorded as passes;
 *  - a FALSE FAIL, when the predicate required `verdict.ok === true` — which no blinded run
 *    can produce, because a healthy blinding IS a failure of the `missed` term by design.
 * The earlier fixture paired `status: 1` with `ok: true`, a combination no run emits, so
 * five of these cases passed even with `blindPasses` reverted.
 */
import { describe, expect, it } from "vitest";
import {
	blindDiagnostic,
	blindPasses,
	type CanaryVerdict,
	parseCanaryVerdict,
} from "../tools/lib/blind-report.ts";

const DEFECT = "U-05-top";

/**
 * The one rule with more than one fixture, and the two ledger entries it expects.
 *
 * `U-05:top`'s single top-edge wording catches both elements, so a realistic
 * `missed:` ledger for it carries two entries under one marker — the shape the
 * expectation is a list for (the red `main` after PR #50 declared the second).
 */
const FULL_BLEED = "U-05-top (#full-bleed)";
const TRANSLUCENT_BAR = "U-05-top (#translucent-bar)";
const TWO_FIXTURE_DEFECTS = [FULL_BLEED, TRANSLUCENT_BAR];

/** The realistic healthy blinded verdict: exit 1, `ok: false`, and ONE failed term. */
const healthyBlind: CanaryVerdict = {
	ok: false,
	failedTerms: ["missed"],
	vacuous: false,
	missed: [DEFECT],
	cleanFails: 0,
	defectsStatus: 1,
	cleanStatus: 0,
	cells: { defects: 3, clean: 3 },
	rows: { defects: 12, clean: 12 },
};

const call = (
	verdict: CanaryVerdict,
	overrides: { missed?: string[]; defects?: string[] } = {},
) => ({
	status: 1,
	missed: overrides.missed ?? [DEFECT],
	defects: overrides.defects ?? [DEFECT],
	verdict,
});

const diagnose = (verdict: CanaryVerdict): string =>
	blindDiagnostic({
		exitCode: 1,
		signal: null,
		named: [DEFECT],
		verdict,
		keptTree: "/tmp/…/canary-U-05-top",
	});

describe("a blind passes only when the canary's own verdict permits it", () => {
	it("passes a healthy blinded run — exit 1, ok false, failedTerms ['missed']", () => {
		expect(blindPasses(call(healthyBlind))).toBe(true);
	});

	it("fails when a second term failed as well, and names it", () => {
		for (const [term, verdict] of [
			[
				"vacuous",
				{ ...healthyBlind, vacuous: true, failedTerms: ["missed", "vacuous"] },
			],
			[
				"cleanFails",
				{
					...healthyBlind,
					cleanFails: 2,
					failedTerms: ["missed", "cleanFails"],
				},
			],
			[
				"defectsStatus",
				{
					...healthyBlind,
					defectsStatus: 0,
					failedTerms: ["missed", "defectsStatus"],
				},
			],
			[
				"cleanStatus",
				{
					...healthyBlind,
					cleanStatus: 2,
					failedTerms: ["missed", "cleanStatus"],
				},
			],
		] as Array<[string, CanaryVerdict]>) {
			expect(blindPasses(call(verdict))).toBe(false);
			expect(diagnose(verdict)).toContain(term);
		}
	});

	it("fails when the expected miss is itself absent, or there is more than one", () => {
		expect(blindPasses({ ...call(healthyBlind), missed: [] })).toBe(false);
		expect(
			blindPasses({ ...call(healthyBlind), missed: [DEFECT, "U-04"] }),
		).toBe(false);
		expect(
			blindPasses({ ...call(healthyBlind), missed: ["U-05-bottom"] }),
		).toBe(false);
		expect(blindPasses({ ...call(healthyBlind), status: null })).toBe(false);
	});

	it("accepts a rule whose single wording catches TWO fixtures, in either order", () => {
		// Order is not part of the property — the canary emits the fixture's document
		// order, so both ledgers below describe the same set.
		for (const missed of [TWO_FIXTURE_DEFECTS, [TRANSLUCENT_BAR, FULL_BLEED]]) {
			expect(
				blindPasses(
					call(
						{ ...healthyBlind, missed },
						{ missed, defects: TWO_FIXTURE_DEFECTS },
					),
				),
			).toBe(true);
		}
	});

	it("still fails a two-fixture rule that missed only one of them", () => {
		// The exactness this pins: a blind that missed SOMETHING is not a blind that
		// missed everything the rule catches, and the harness's value is the second.
		const missed = [FULL_BLEED];
		expect(
			blindPasses(
				call(
					{ ...healthyBlind, missed },
					{ missed, defects: TWO_FIXTURE_DEFECTS },
				),
			),
		).toBe(false);
	});

	it("fails an unreadable verdict rather than reading it as health", () => {
		for (const output of [
			"no verdict line here",
			"VERDICT null",
			"VERDICT [1,2]",
			'VERDICT "healthy"',
			"VERDICT 7",
			"VERDICT {not json",
			"VERDICT {}",
		]) {
			const verdict = parseCanaryVerdict(output);
			expect(verdict).toEqual({});
			expect(blindPasses(call(verdict))).toBe(false);
			expect(diagnose(verdict)).toContain("failed terms: not reported");
		}
	});

	it("parses a healthy verdict line into its five terms", () => {
		expect(
			parseCanaryVerdict(`x\nVERDICT ${JSON.stringify(healthyBlind)}\n`),
		).toEqual(healthyBlind);
	});
});

describe("the diagnostic can always be rendered", () => {
	it("does not throw on any JSON value a verdict field can hold", () => {
		const values: unknown[] = [
			null,
			[],
			"string",
			7,
			{ cells: null, rows: undefined, failedTerms: null, cleanFails: "two" },
			{ failedTerms: ["missed"], cells: { defects: 1 } },
		];
		for (const value of values) {
			expect(() => diagnose(value as CanaryVerdict)).not.toThrow();
		}
		expect(diagnose({ cells: null } as unknown as CanaryVerdict)).toContain(
			"cells defects/clean unknown/unknown",
		);
	});
});
