import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
	COMPOSER_ACTION_CLUSTER,
	COMPOSER_CONTROLS_ROW,
	COMPOSER_DISC,
	COMPOSER_META_INLINE,
	COMPOSER_META_ROW,
	footerFit,
	MODEL_FLOOR_PT,
	metaNeed,
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
			showFolder: true,
			folderGlyphOnly: false,
			showEffort: true,
			showQueued: true,
		});
		expect(footerFit({ ...facts, width: 2000 }).showCost).toBe(true);
	});

	it("yields cost first, then context, the folder's path, effort, queued, and the folder itself — never the model", () => {
		const widths = [2000, 420, 380, 300, 200, 120];
		const fits = widths.map((width) => footerFit({ ...facts, width }));
		// Monotone: once an item yields at a width it stays yielded below it.
		for (let i = 1; i < fits.length; i += 1) {
			const [wide, narrow] = [fits[i - 1], fits[i]];
			if (!wide?.showCost) expect(narrow?.showCost).toBe(false);
			if (!wide?.showContext) expect(narrow?.showContext).toBe(false);
			if (wide?.folderGlyphOnly) expect(narrow?.folderGlyphOnly).toBe(true);
			if (!wide?.showEffort) expect(narrow?.showEffort).toBe(false);
			if (!wide?.showQueued) expect(narrow?.showQueued).toBe(false);
			if (!wide?.showFolder) expect(narrow?.showFolder).toBe(false);
		}
		// The order: cost goes before context, context before the folder's path,
		// effort before queued, and queued before the folder leaves the line.
		const at = (pred: (f: (typeof fits)[number]) => boolean) =>
			fits.findIndex(pred);
		const costGone = at((f) => !f.showCost);
		const contextGone = at((f) => !f.showContext);
		const folderGlyph = at((f) => f.folderGlyphOnly);
		const effortGone = at((f) => !f.showEffort);
		const queuedGone = at((f) => !f.showQueued);
		const folderGone = at((f) => !f.showFolder);
		expect(costGone).toBeGreaterThan(0);
		expect(contextGone).toBeGreaterThanOrEqual(costGone);
		expect(folderGlyph).toBeGreaterThanOrEqual(contextGone);
		expect(effortGone).toBeGreaterThanOrEqual(folderGlyph);
		expect(queuedGone).toBeGreaterThanOrEqual(effortGone);
		expect(folderGone).toBeGreaterThanOrEqual(queuedGone);
	});

	it("yields the queued count and the effort — not the model — on a narrow phone with the keyboard up at 200 % (R163-1)", () => {
		/* The reviewer's discriminating case: with the keyboard up the meta folds
		 * INLINE into the controls row and gets only the leftover width; streaming
		 * keeps stop and mic on the row, a queued instruction and an effort chip are
		 * present, and the text is at 200 %. Before the extended ladder the queued
		 * text and the effort chip were both `shrink-0`, so the model's wrapper — the
		 * only elastic item — could be allocated zero, and the row's `overflow-hidden`
		 * clipped the chip whose 44 pt slot the record promises. */
		const fit = footerFit({ ...facts, scale: 2, width: 200 });
		expect(fit.showQueued).toBe(false);
		expect(fit.showEffort).toBe(false);
		// Nothing else competes with the model either, so its slot is the whole line.
		expect(fit.showFolder).toBe(false);
		expect(fit.showCost).toBe(false);
		expect(fit.showContext).toBe(false);
	});

	it("only keeps a fact when the fit actually fits, and always keeps the model's 44 pt slot", () => {
		/* The property the component relies on, asserted as arithmetic rather than
		 * restated: a chosen fit either fits the measured line — so the inline row
		 * never clips it — or every optional fact has already yielded and the model
		 * alone remains, truncating inside a wrapper that reserves its target. */
		for (const scale of [1, 1.35, 2]) {
			for (let width = MODEL_FLOOR_PT; width <= 600; width += 7) {
				const fit = footerFit({ ...facts, scale, width });
				const optional =
					fit.showCost ||
					fit.showContext ||
					fit.showFolder ||
					fit.showEffort ||
					fit.showQueued;
				if (optional)
					expect(metaNeed({ ...facts, scale, width }, fit)).toBeLessThanOrEqual(
						width,
					);
			}
		}
	});

	it("reserves the model's floor on the flex item, not only inside the chip", () => {
		// The FooterFit shape has no model switch at all: the model is the
		// elastic element and truncates; its floor is reserved by the wrapper.
		expect(Object.keys(footerFit({ ...facts, width: 10 }))).not.toContain(
			"showModel",
		);
		expect(MODEL_FLOOR_PT).toBe(44);
		/* The wrapper's own style, not the chip's class: the reserved slot has to
		 * sit on the flex item, and biome may wrap the expression, so the assertion
		 * is on the presence of both pieces in the wrapper's block rather than on
		 * one line's formatting. */
		const wrapper = COMPOSER.slice(
			COMPOSER.indexOf('<View\n\t\t\t\tclassName="min-w-0 shrink"'),
		);
		expect(wrapper.slice(0, 400)).toContain("minWidth:");
		expect(wrapper.slice(0, 400)).toContain(
			"Math.min(MODEL_FLOOR_PT, metaWidth)",
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
