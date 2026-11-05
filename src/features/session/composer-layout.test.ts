import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	COMPOSER_ACTION_CLUSTER,
	COMPOSER_CONTROLS_ROW,
	COMPOSER_DISC,
	MODEL_FLOOR_PT,
} from "./composer-layout";
import { morphHeight, morphPillRadius } from "./composer-presentation";

const read = (path: string) =>
	readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
const COMPOSER = read("src/features/session/components/composer.tsx");
const SCREEN = read("app/(app)/session/[id].tsx");
const PANE = read("src/features/sessions/conversations-pane.tsx");
describe("build389 persistent field and context", () => {
	it("retains disc spacing and target floors", () => {
		expect(COMPOSER_CONTROLS_ROW).toContain("gap-x-0.5");
		expect(COMPOSER_ACTION_CLUSTER).toContain("gap-0.5");
		expect(COMPOSER_DISC).toContain("h-11 w-11");
		expect(MODEL_FLOOR_PT).toBe(44);
	});
	it("mounts one Textarea independently of idle, focus and keyboard", () => {
		expect(COMPOSER.match(/<Textarea\b/g)).toHaveLength(1);
		expect(COMPOSER).toContain("fieldRef={inputRef}");
		expect(COMPOSER).not.toContain("inlineMetaFits");
		expect(COMPOSER).not.toContain("composerGeometry");
	});
	it("keeps model and effort explicit in the context strip and compact disclosure", () => {
		const strip = COMPOSER.slice(
			COMPOSER.indexOf("const receipt = ("),
			COMPOSER.indexOf("const mic = voice"),
		);
		expect(strip).toContain("CONTROL.composerModelChip");
		expect(strip).toContain("CONTROL.composerEffortChip");
		expect(strip).toContain("CONTROL.composerDismissKeyboard");
		expect(COMPOSER).toContain("CONTROL.composerContextEffort");
		// D2 (round 6): landscape has ONE context affordance — the compact strip's.
		expect(COMPOSER).not.toContain("CONTROL.composerCompactContext");
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

const SRC = COMPOSER;

describe("round 5 — regressions that fail if the fix is reverted", () => {
	it("renders the attach sheet (it existed as a value nobody mounted)", () => {
		expect(SRC.match(/\{attachSheet\}/g) ?? []).toHaveLength(1);
	});

	it("keeps the attach title on the ratcheted literal rather than a new one", () => {
		expect(SRC).toContain('title="attach"');
		expect(SRC).not.toContain('title="Attach"');
	});

	it("left no clearance margin from the removed absolute layer", () => {
		expect(SRC).not.toMatch(/marginStart:\s*interpolate/);
		expect(SRC).not.toMatch(/marginEnd:\s*interpolate/);
	});

	it("derives the resting radius from the measured painted pill, in every state", () => {
		expect(SRC).toMatch(/morphPillRadius\(baseHeight\)/);
		// Measured from the content block, never from the animated shell.
		expect(SRC).toMatch(/measureContent/);
	});

	it("captures ONE seed per state, so the morph is not a constant pair", () => {
		// The design round's D1: one seed gave interpolate([120, 120]) while expanded.
		expect(SRC).toMatch(/setCollapsedSeed\(total\)/);
		expect(SRC).toMatch(/setExpandedSeed\(total\)/);
		expect(SRC).toMatch(
			/morphHeight\(progress\.value, baseHeight, targetExpanded\)/,
		);
		// The negative control QA used: a fixed expanded height clips the field.
		expect(SRC).not.toMatch(/height: compactSingle \? idleHeight/);
	});

	it("keeps the short-landscape strip, and only ONE context affordance", () => {
		expect(SRC).toMatch(/compactSingle \? compactReceipt : receipt/);
		expect(SRC).not.toMatch(/height: 0, overflow: "hidden"/);
		// D2: the strip's More is the only one in landscape.
		expect(SRC).not.toContain("composerCompactContext");
	});

	it("bounds the queue chip so large text cannot push a control off the card", () => {
		expect(SRC).toMatch(/maxWidth: 160/);
	});
});

describe("round 6 — the morph is a shape, not a pair of constants", () => {
	it("travels through values strictly between its ends", () => {
		const mid = morphHeight(0.5, 60, 120);
		expect(mid).toBeGreaterThan(60);
		expect(mid).toBeLessThan(120);
		expect(mid).toBe(90);
	});

	it("moves the radius on the same progress value as the height", () => {
		expect(morphPillRadius(60)).toBe(30);
		expect(morphPillRadius(56)).toBe(28);
		expect(morphHeight(0.5, morphPillRadius(60), 24)).toBe(27);
	});
});
