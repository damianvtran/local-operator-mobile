import { describe, expect, it } from "vitest";

import { derivePalette } from "../../design/themes/derive.mjs";
import {
	desktopPalettes,
	EXPECTED_WITHHELD,
	fleetReport,
	judge,
} from "../../design/themes/fleet.mjs";

/**
 * The fleet gate's own behaviour, beside the contract run that CI executes
 * (`node design/tokens/contrast-contract.mjs`). These pin the claims the PR
 * makes about the gate: it covers every desktop palette, it withholds what
 * fails and only that, and a failing palette really is detected (negative
 * control) rather than the gate passing by reading nothing.
 */
describe("the theme fleet", () => {
	const report = fleetReport();

	it("judges every desktop palette, 41 dark and 18 light", () => {
		expect(report).toHaveLength(59);
		expect(report.filter((e) => e.mode === "dark")).toHaveLength(41);
		expect(report.filter((e) => e.mode === "light")).toHaveLength(18);
		for (const entry of report) expect(entry.checks).toBeGreaterThan(500);
	});

	it("solves every derived role on every palette", () => {
		for (const entry of report) expect(entry.unsolved, entry.id).toEqual([]);
	});

	it("withholds exactly the pinned palettes", () => {
		const withheld = report.filter((e) => e.failures.length).map((e) => e.id);
		expect(withheld.sort()).toEqual(Object.keys(EXPECTED_WITHHELD).sort());
	});

	it("detects a palette that breaks a floor (negative control)", () => {
		const [brand] = desktopPalettes() as Array<{
			id: string;
			name: string;
			mode: "dark";
			values: Record<string, string>;
		}>;
		if (!brand) throw new Error("no palettes");
		// Ink the colour of the page: every text pair on canvas collapses.
		const broken = {
			...brand,
			values: { ...brand.values, ink: brand.values.canvas as string },
		};
		const verdict = judge(derivePalette(broken));
		expect(verdict.failures.length).toBeGreaterThan(0);
		expect(verdict.failures.join("\n")).toMatch(/ink on canvas = 1\.00 < 4\.5/);
		// …and the same palette unbroken passes, so the failure is the edit's.
		expect(report.find((e) => e.id === brand.id)?.failures).toEqual([]);
	});

	it("keeps the scrim the app's own fixed literal on every palette", () => {
		for (const entry of report) expect(entry.colors.scrim).toBe("#0b0a08b3");
	});
});
