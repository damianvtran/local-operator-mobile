import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
	PANE_LOADING_BARS,
	paneLoadingVariant,
} from "@/features/sessions/pane-loading";
import { layoutFor } from "@/ui/size-class";

/**
 * The conversations pane's loading state has a COMPACT form for short panes
 * (docs/ux/audits/2026-10-11-full-surface-pass.md, D3 loading variant).
 *
 * At large text on a pane whose routes footer scrolls with the list (a phone on
 * its side), the three skeleton rows and the footer compete for one short
 * viewport: the audit saw the bars clipped away, and on the f5498d3c export the
 * bars pushed the footer's last row off the bottom instead. One bar keeps both
 * the loading cue and the footer on screen. Everywhere else the three rows fit
 * and stay — the kit's form, and the stronger cue.
 *
 * Decided before measuring, so the first paint is the one the reader keeps.
 */
const ROUTES = 3;

describe("paneLoadingVariant", () => {
	it.each([
		["iPhone 15 portrait, 100 % → full", 390, 844, false, "full"],
		["iPhone 15 portrait, 200 % → full", 390, 844, true, "full"],
		["iPhone SE, 100 % → full", 320, 568, false, "full"],
		/* The pinned footer's floor leaves a 568 pt pane at least the 136 pt a
		 *  header and one row need (`PINNED_ROUTES_BASE_FLOOR`), and three bars
		 *  are 96 pt: they fit, so the pane keeps the kit's form. */
		["iPhone SE, 200 % → full", 320, 568, true, "full"],
		/* Measured on the f5498d3c export at 844 × 390: at 100 % the three bars
		 *  and the whole scrolling footer fit; only at 200 % did they push the
		 *  footer's last row (More) off the bottom. */
		["iPhone 15 landscape, 100 % → full", 844, 390, false, "full"],
		["iPhone 15 landscape, 200 % → compact", 844, 390, true, "compact"],
		["tablet split, 200 % → full", 1112, 834, true, "full"],
	] as const)("%s", (_label, width, height, largeText, expected) => {
		expect(
			paneLoadingVariant(layoutFor(width, height), {
				largeText,
				routes: ROUTES,
			}),
		).toBe(expected);
	});

	it("draws one bar when compact and the kit's three otherwise", () => {
		expect(PANE_LOADING_BARS.compact).toBe(1);
		expect(PANE_LOADING_BARS.full).toBe(3);
	});

	it("is what the pane's loading state renders", () => {
		const pane = readFileSync(
			fileURLToPath(new URL("./conversations-pane.tsx", import.meta.url)),
			"utf8",
		);
		expect(pane).toMatch(LOADING_WIRING);
		expect(pane).toContain("PANE_LOADING_BARS[loadingVariant]");
	});
});

/* Top-level for biome's useTopLevelRegex. */
const LOADING_WIRING =
	/loadingVariant=\{paneLoadingVariant\(layout, \{\s*largeText,\s*routes: pinnedRoutes,?\s*\}\)\}/;
