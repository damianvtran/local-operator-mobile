import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
	COMPOSER_ACTION_CLUSTER,
	COMPOSER_CONTROLS_ROW,
	COMPOSER_DISC,
	COMPOSER_META_INLINE,
	COMPOSER_META_ROW,
	footerFit,
} from "@/features/session/composer-layout";

/**
 * Native mirror of the relay's `composer.spacing.test.tsx`,
 * `above-composer.spacing.test.tsx` and `session-list.chrome.test.tsx`
 * (decision record 2026-11-04 §2.2/§3), as far as a Node host can go.
 *
 * Node does no layout, so the PIXELS — the 8 pt gap, the shared centre y of
 * the four controls, the list's share of the panel — are measured on rendered
 * simulator frames (the PR's evidence). What is pinned HERE is the structure
 * that makes those numbers true and the one thing a later edit can silently
 * break: the classes, the row order, and the meta line's yield rule.
 */
const read = (path: string) =>
	readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
const COMPOSER = read("src/features/session/components/composer.tsx");
const SCREEN = read("app/(app)/session/[id].tsx");
const PANE = read("src/features/sessions/conversations-pane.tsx");
const classes = (value: string) => value.split(/\s+/);
/* Comments between the children are allowed; the ORDER is what is pinned. */
const ACTION_ORDER =
	/\{attach\}\s*\{mic\}[\s\S]{0,240}?\{keyboardVisible \? receipt : null\}\s*\{actionCluster\}/;

describe("the composer's spacing constants (relay composer.spacing)", () => {
	it("puts every control in the row 2 pt apart, and groups stop/send at the end", () => {
		expect(classes(COMPOSER_CONTROLS_ROW)).toContain("gap-x-0.5");
		expect(classes(COMPOSER_ACTION_CLUSTER)).toEqual(
			expect.arrayContaining(["ms-auto", "gap-0.5", "shrink-0"]),
		);
	});

	it("draws every control as a 44 pt disc, and the stop as a danger-wash disc", () => {
		expect(classes(COMPOSER_DISC)).toEqual(
			expect.arrayContaining(["h-11", "w-11", "rounded-full"]),
		);
		expect(COMPOSER).toContain('cx(COMPOSER_DISC, "bg-danger-wash")');
		// D-S5: the bare text glyph is gone (only the comment recording why remains).
		expect(COMPOSER).not.toContain(">\n\t\t\t\t\t\t\t\t\t■");
		expect(COMPOSER).toContain(
			"<Square size={14} color={dangerInk} fill={dangerInk}",
		);
	});

	it("keeps the mic on the CONTROLS row, never the meta line (D-S4)", () => {
		expect(COMPOSER).toMatch(ACTION_ORDER);
		const meta = COMPOSER.slice(
			COMPOSER.indexOf("const receipt = ("),
			COMPOSER.indexOf("const mic = voice"),
		);
		expect(meta).not.toContain("CONTROL.composerMic");
	});

	it("gives the meta facts their own unwrapped line, and the leftover width with the keyboard up (relay O1)", () => {
		expect(classes(COMPOSER_META_ROW)).toEqual(
			expect.arrayContaining(["min-h-11", "min-w-0", "overflow-hidden"]),
		);
		expect(COMPOSER_META_ROW).not.toContain("flex-wrap");
		expect(classes(COMPOSER_META_INLINE)).toEqual(
			expect.arrayContaining(["basis-0", "flex-1", "min-w-0"]),
		);
	});

	it("pays the shell geometry from the device-corner model, not a Tailwind radius", () => {
		expect(COMPOSER).toContain("composerGeometry({");
		expect(COMPOSER).not.toContain("rounded-xl");
		expect(COMPOSER).toContain("paddingBottom: geometry.paddingBottom");
	});
});

describe("footerFit — the meta line's yield order (record §2.2)", () => {
	const facts = {
		scale: 1,
		queued: "2 queued",
		folder: "~/local-operator",
		model: "Claude Opus 5.5",
		effort: "high",
		context: "21% context",
		cost: "$0.42",
	};

	it("shows everything before it is measured, and when it fits", () => {
		expect(footerFit({ ...facts, width: 0 })).toEqual({
			showCost: true,
			showContext: true,
			folderGlyphOnly: false,
		});
		expect(footerFit({ ...facts, width: 2000 }).showCost).toBe(true);
	});

	it("yields cost first, then context, then the folder's path — never the model", () => {
		const widths = [2000, 420, 380, 300, 120];
		const fits = widths.map((width) => footerFit({ ...facts, width }));
		// Monotone: once an item yields at a width it stays yielded below it.
		for (let i = 1; i < fits.length; i += 1) {
			const [wide, narrow] = [fits[i - 1], fits[i]];
			if (!wide?.showCost) expect(narrow?.showCost).toBe(false);
			if (!wide?.showContext) expect(narrow?.showContext).toBe(false);
			if (wide?.folderGlyphOnly) expect(narrow?.folderGlyphOnly).toBe(true);
		}
		// The order: cost goes before context, context before the folder's path.
		const at = (pred: (f: (typeof fits)[number]) => boolean) =>
			fits.findIndex(pred);
		const costGone = at((f) => !f.showCost);
		const contextGone = at((f) => !f.showContext);
		const folderGlyph = at((f) => f.folderGlyphOnly);
		expect(costGone).toBeGreaterThan(0);
		expect(contextGone).toBeGreaterThanOrEqual(costGone);
		expect(folderGlyph).toBeGreaterThanOrEqual(contextGone);
	});

	it("never has a step that drops the model chip", () => {
		// The FooterFit shape has no model switch at all: the model is the
		// elastic element and truncates; its 44 pt floor keeps it on the line.
		expect(Object.keys(footerFit({ ...facts, width: 10 }))).not.toContain(
			"showModel",
		);
	});
});

describe("the above-composer stack (relay above-composer.spacing)", () => {
	it("is ONE slot: chips then the ask bar, aligned with the composer's 8 pt edge", () => {
		const at = SCREEN.indexOf("<StatusChips");
		const slot = SCREEN.slice(SCREEN.lastIndexOf("<View", at - 60), at);
		expect(slot).toContain('className="gap-2 px-2 pb-1"');
		expect(SCREEN.indexOf("<AskBar")).toBeGreaterThan(at);
	});

	it("yields to a pending card, and only exists on a portrait phone", () => {
		expect(SCREEN).toContain("tray && !compact && pendingViewProps === null");
	});
});

describe("sidebar chrome (relay session-list.chrome)", () => {
	it("leads with search, new chat and close — no switcher, no brand mark", () => {
		const header = PANE.slice(
			PANE.indexOf("---- the header row (record §2.5)"),
			PANE.indexOf("{notice ? ("),
		);
		expect(header).toContain("testID={CONTROL.sidebarSearch}");
		expect(header).toContain("testID={CONTROL.sidebarNewChat}");
		expect(header).toContain("testID={CONTROL.sidebarClose}");
		expect(PANE).not.toContain("<NavigationMark");
	});
});
