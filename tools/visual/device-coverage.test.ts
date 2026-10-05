import { describe, expect, it } from "vitest";
import {
	ALL_DEVICES,
	CI_DEVICES,
	CORE_DEVICES,
	describeDeviceCoverage,
	deviceCoverage,
} from "./matrix.ts";

/**
 * The device bound a run states about itself, held still.
 *
 * Why this exists: the per-push job captures `--tier ci` — 2 of the 19 declared profiles —
 * and a run that printed only the devices it used read as "the app is fine" over an
 * assertion about two viewports. The counts and the sentence are derived from `ALL_DEVICES`,
 * and these tests are what keep them from drifting apart from the matrix they describe.
 */
describe("deviceCoverage", () => {
	it("names the profiles the ci tier leaves out, and counts them against the declared list", () => {
		const coverage = deviceCoverage(CI_DEVICES);
		expect(coverage.declared).toEqual(ALL_DEVICES);
		expect(coverage.captured).toEqual(CI_DEVICES);
		// Declaration order, so the list lines up with the table in docs/e2e/README.md.
		expect(coverage.notCaptured).toEqual(
			ALL_DEVICES.filter((name) => !CI_DEVICES.includes(name)),
		);
		expect(coverage.notCaptured).toHaveLength(
			ALL_DEVICES.length - CI_DEVICES.length,
		);
	});

	it("says nothing is missing only when every declared profile was captured", () => {
		const whole = deviceCoverage(ALL_DEVICES);
		expect(whole.notCaptured).toEqual([]);
		expect(describeDeviceCoverage(whole)).toBe(
			`device coverage: all ${ALL_DEVICES.length} declared profiles captured (${ALL_DEVICES.join(", ")})`,
		);
	});

	it("names the missing profiles in the sentence, not just their count", () => {
		const partial = deviceCoverage(["iphone-se"]);
		expect(partial.captured).toEqual(["iphone-se"]);
		expect(describeDeviceCoverage(partial)).toBe(
			`device coverage: 1 of ${ALL_DEVICES.length} declared profiles captured (iphone-se); ` +
				`${ALL_DEVICES.length - 1} NOT captured (${ALL_DEVICES.filter((name) => name !== "iphone-se").join(", ")})`,
		);
	});

	it("orders by the matrix, and keeps a name the matrix does not declare", () => {
		expect(
			deviceCoverage(["tablet-landscape", "made-up", "iphone-se"]).captured,
		).toEqual(["iphone-se", "tablet-landscape", "made-up"]);
	});

	it("reports the core tier as its own five profiles, in the matrix's order", () => {
		const coverage = deviceCoverage(CORE_DEVICES);
		expect(coverage.captured).toEqual(CORE_DEVICES);
		expect(coverage.notCaptured).toHaveLength(
			ALL_DEVICES.length - CORE_DEVICES.length,
		);
	});

	it("names no profile when none was captured, rather than an empty pair of brackets", () => {
		// The reviewer's case: a `--deadline` that fires before the first cell leaves a run
		// with nothing captured, and `captured ()` read as a broken sentence over what is
		// actually the finding — so the brackets only appear when there is a name for them.
		const none = deviceCoverage([]);
		expect(none.captured).toEqual([]);
		expect(none.notCaptured).toEqual(ALL_DEVICES);
		expect(describeDeviceCoverage(none)).toBe(
			`device coverage: 0 of ${ALL_DEVICES.length} declared profiles captured; ` +
				`${ALL_DEVICES.length} NOT captured (${ALL_DEVICES.join(", ")})`,
		);
	});
});
