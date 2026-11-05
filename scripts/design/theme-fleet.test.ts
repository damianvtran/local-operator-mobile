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

	it("admits the four palettes the ground adaptation restored, on the full rule set (D164-1)", () => {
		/* The regression the design round asked for: these four were withheld for a
		 * pair the phone asserts on a ground whose job is to carry an ink, and the
		 * bounded hue-preserving move clears it. Asserted by NAME and by the
		 * assertion count, so a later palette edit that quietly re-withholds one of
		 * them fails here rather than shrinking the catalogue. */
		for (const id of [
			"catppuccinMocha",
			"tokyoNightStorm",
			"duskfox",
			"outrun",
		]) {
			const entry = report.find((e) => e.id === id);
			expect(entry, id).toBeDefined();
			expect(entry?.failures, id).toEqual([]);
			expect(entry?.checks, id).toBe(585);
		}
	});

	it("leaves a palette that already clears byte-identical (the adaptation is a no-op there)", () => {
		/* The policy must not move a value it has no reason to move: 55 palettes
		 * shipped before it existed, and every role they copy from the desktop has to
		 * stay exactly as authored. `dracula` is the control — it never failed, so its
		 * derived roles must equal the export's own values for the copied roles. */
		type DesktopPalette = {
			id: string;
			name: string;
			mode: "dark" | "light";
			values: Record<string, string>;
		};
		const all = desktopPalettes() as DesktopPalette[];
		const [control] = all;
		const desktop = all.find((entry) => entry.id === "dracula");
		expect(desktop).toBeDefined();
		expect(control).toBeDefined();
		if (!desktop) return;
		const derived = derivePalette(desktop);
		const kebab = (name: string) =>
			name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
		const dropped = [
			"mediaSurface",
			"chartBarHover",
			"tokenCommand",
			"overlayShadow",
			"scrim",
		];
		for (const [role, value] of Object.entries(desktop.values)) {
			if (dropped.includes(role)) continue;
			expect(derived.colors[kebab(role)], `${desktop.id}.${role}`).toBe(
				String(value).toLowerCase(),
			);
		}
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
