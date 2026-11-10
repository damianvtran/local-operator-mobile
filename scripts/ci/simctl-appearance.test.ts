import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	APPEARANCE_CAP_SECONDS,
	appearanceArgs,
	appearanceTimingLine,
} from "./simctl-appearance.ts";

/* Durations of `xcrun simctl ui <udid> appearance dark` on GitHub-hosted macOS
 * (chrome-ios-proof): the run before 42875725248, and 42875725248 itself, which
 * the old 60 s cap killed. The cap must clear the observed max with margin. */
const MEASURED_SECONDS = [63.5, 66.6];

/* Whitespace-tolerant so formatter line-wrapping never changes the verdict. */
const RAW_APPEARANCE_ARGV = /"appearance",/;
const CAPPED_RUN =
	/await run\(\s*step,\s*"xcrun",\s*appearanceArgs\(udid, theme\),\s*APPEARANCE_CAP_SECONDS,?\s*\)/;
const LOGGED = /note\(appearanceTimingLine\(step, Date\.now\(\) - t0\)\)/;
const CALL = /await setAppearance\(/g;

const RUNNERS = [
	"chrome-ios-proof.ts",
	"projects-create-ios-proof.ts",
	"theme-ios-proof.ts",
];

describe("simctl appearance cap", () => {
	it("clears the measured distribution with margin", () => {
		expect(APPEARANCE_CAP_SECONDS).toBe(180);
		expect(APPEARANCE_CAP_SECONDS).toBeGreaterThan(
			2 * Math.max(...MEASURED_SECONDS),
		);
	});

	it("builds the simctl argv and a grep-able duration line", () => {
		expect(appearanceArgs("UDID", "dark")).toEqual([
			"simctl",
			"ui",
			"UDID",
			"appearance",
			"dark",
		]);
		expect(appearanceTimingLine("appearance-dark", 66_600)).toBe(
			"simctl-appearance appearance-dark: 66.6s (cap 180s)",
		);
	});

	/* The runners execute on import (env-gated, spawn simctl), so they are held
	 * to the contract by source: every appearance switch goes through the
	 * measured, logged helper, and none is left on an ad-hoc cap. */
	it.each(RUNNERS)(
		"%s routes every appearance switch via setAppearance",
		(f) => {
			const source = readFileSync(join(import.meta.dirname, f), "utf8");
			expect(source).not.toMatch(RAW_APPEARANCE_ARGV);
			expect(source).toMatch(CAPPED_RUN);
			expect(source).toMatch(LOGGED);
			expect(source.match(CALL)?.length ?? 0).toBeGreaterThan(0);
		},
	);
});
