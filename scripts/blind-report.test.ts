/**
 * The blind decision lives in `tools/lib/blind-report.ts`, which `vitest` does not reach
 * by itself — its `include` is `src/**` and `scripts/**`, so every file in the harness's
 * `tools/` tree otherwise has the sweep as its only guard. That gap has hidden a defect
 * three times on this branch (see the PR thread), and it is why this test exists here
 * rather than beside the module: it is the only placement the suite actually runs.
 *
 * The defect it pins is a FALSE PASS: the decision once re-derived the `missed` term and
 * ignored the canary's own `ok`, so a run that failed still recorded a passing blind.
 */
import { describe, expect, it } from "vitest";
import {
	blindDiagnostic,
	blindPasses,
	parseCanaryVerdict,
} from "../tools/lib/blind-report.ts";

const base = {
	status: 1,
	missed: ["U-05-top"],
	defect: "U-05-top",
};
const healthy = {
	ok: true,
	failedTerms: [],
	vacuous: false,
	missed: ["U-05-top"],
	cleanFails: 0,
	defectsStatus: 1,
	cleanStatus: 0,
	cells: { defects: 3, clean: 3 },
	rows: { defects: 12, clean: 12 },
};

describe("a blind passes only when the canary says so", () => {
	it("passes a healthy blind", () => {
		expect(blindPasses({ ...base, verdict: healthy })).toBe(true);
	});

	// Each of the four non-`missed` terms, and the unparsable case: all of these used to
	// record as PASSING because only `missed` was re-derived here.
	for (const [term, verdict] of [
		[
			"vacuous",
			{ ...healthy, ok: false, failedTerms: ["vacuous"], vacuous: true },
		],
		[
			"cleanFails",
			{ ...healthy, ok: false, failedTerms: ["cleanFails"], cleanFails: 2 },
		],
		[
			"defectsStatus",
			{
				...healthy,
				ok: false,
				failedTerms: ["defectsStatus"],
				defectsStatus: 0,
			},
		],
		[
			"cleanStatus",
			{ ...healthy, ok: false, failedTerms: ["cleanStatus"], cleanStatus: 2 },
		],
	] as const) {
		it(`fails a blind whose own verdict failed the ${term} term`, () => {
			expect(blindPasses({ ...base, verdict })).toBe(false);
			expect(
				blindDiagnostic({
					exitCode: 1,
					signal: null,
					named: base.missed,
					verdict,
					keptTree: "/tmp/…/canary-U-05-top",
				}),
			).toContain(`failed terms: ${term}`);
		});
	}

	it("fails a blind whose verdict could not be parsed, rather than reading it as health", () => {
		expect(
			blindPasses({ ...base, verdict: parseCanaryVerdict("no verdict line") }),
		).toBe(false);
		expect(
			blindDiagnostic({
				exitCode: 1,
				signal: null,
				named: base.missed,
				verdict: {},
				keptTree: "kept",
			}),
		).toContain("failed terms: not reported");
	});

	it("does not read a killed run or the wrong defect as a pass", () => {
		expect(blindPasses({ ...base, status: null, verdict: healthy })).toBe(
			false,
		);
		expect(
			blindPasses({ ...base, missed: ["U-05-bottom"], verdict: healthy }),
		).toBe(false);
		expect(
			blindPasses({ ...base, missed: [], verdict: { ...healthy, missed: [] } }),
		).toBe(false);
	});

	it("names VACUOUS in the canary's own words, so a blank cannot read as a pass", () => {
		const message = blindDiagnostic({
			exitCode: 1,
			signal: null,
			named: [],
			verdict: {
				...healthy,
				ok: false,
				vacuous: true,
				failedTerms: ["vacuous"],
			},
			keptTree: "kept",
		});
		expect(message).toContain("VACUOUS");
		expect(message).toContain("cells defects/clean 3/3");
	});
});
