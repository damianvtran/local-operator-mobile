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
 * Three skeleton rows are 96 pt of a pane that, on a phone on its side or at
 * large text on a short phone, has the pill, the header and the scrolling
 * footer to fit as well: the bars ended up past the fold and the frame read as
 * an EMPTY list — the symptom the skeleton exists to prevent. A short pane draws
 * one bar instead, so the loading cue stays on screen.
 *
 * "Short" is the pane's own existing definition: the panes whose routes footer
 * cannot stay pinned (`sidebarFooterScrolls`), decided before measuring so the
 * first paint is the one the reader keeps.
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
		["iPhone 15 landscape, 100 % → compact", 844, 390, false, "compact"],
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
