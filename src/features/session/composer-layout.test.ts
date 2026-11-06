import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	COMPOSER_ACTION_CLUSTER,
	COMPOSER_CONTROLS_ROW,
	COMPOSER_DISC,
	MODEL_FLOOR_PT,
} from "./composer-layout";
import {
	composerPaintedHeight,
	composerShellRadius,
	morphHeight,
	morphPillRadius,
} from "./composer-presentation";

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
		expect(SRC).toMatch(/composerShellRadius\(progress\.value, baseHeight\)/);
		// Measured from the content block, never from the animated shell.
		expect(SRC).toMatch(/measureContent/);
	});

	it("captures ONE seed per state, so the morph is not a constant pair", () => {
		// The design round's D1: one seed gave interpolate([120, 120]) while expanded.
		expect(SRC).toMatch(/setCollapsedSeed\(seed\.total\)/);
		expect(SRC).toMatch(/setExpandedSeed\(seed\.total\)/);
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

/* The shell has no fill contrast to lean on: `elevated` over `canvas` measures
 * 1.1244–1.2799:1 across all 59 themes (cyberpunk 1.1244 worst, solarizedLight
 * 1.1473, localOperatorDark 1.2051), so the boundary has to be a PIXEL rule
 * (`docs/design/components.md` § 5). WHERE that pixel lives is the whole of this
 * suite: on the shell's own border it would also shrink the box. */
const ringTag = (source: string) => {
	/* The ELEMENT, not a window around the token: an earlier draft scanned ±700
	 *  chars and passed with `pointerEvents` deleted, because the comment above the
	 *  ring names the prop too. Locating the tag by its border colour and slicing
	 *  back to its own `<Animated.View` keeps the comment out of the assertion. */
	const at = source.indexOf("borderColor: borderControl");
	if (at < 0) return "";
	const open = source.lastIndexOf("<Animated.View", at);
	const close = source.indexOf("/>", at);
	if (open < 0 || close < 0) return "";
	return source.slice(open, close + 2);
};

describe("the shell boundary is an overlay rule, not a box", () => {
	it("draws the border-control edge on an absolutely positioned child", () => {
		const ring = ringTag(SRC);
		expect(ring).not.toBe("");
		expect(ring).toContain("<Animated.View");
		expect(ring).toContain('pointerEvents="none"');
		expect(ring).toContain('position: "absolute"');
		expect(ring).toContain("borderWidth: 1");
		expect(ring).toContain("borderColor: borderControl");
		expect(ring).toContain("ringMotion");
		/* All four sides, in the file's own logical vocabulary: an inset on three
		 *  is a rule that stops short of a corner, and a physical `left`/`right`
		 *  pair is the RTL bug the physical-edge guard exists to catch. */
		for (const side of ["top: 0", "bottom: 0", "start: 0", "end: 0"]) {
			expect(ring).toContain(side);
		}
		expect(ring).not.toMatch(/\b(left|right): 0/);
	});

	it("keeps the border OFF the shell, which is what holds the geometry", () => {
		/* The negative control, as an assertion about WHERE the border lives: the
		 *  shell's own style object must carry no `borderWidth`, because Yoga's
		 *  border-box would subtract 2 pt from 56/112 (60/120 at the 48 floor),
		 *  squeezing the 44 pt field to 42 and turning R30 into R29. */
		const shell = SRC.slice(
			SRC.indexOf("backgroundColor: elevated"),
			SRC.indexOf("shellMotion,"),
		);
		expect(shell).toContain("backgroundColor: elevated");
		expect(shell).toContain("paddingHorizontal: 12");
		expect(shell).not.toContain("borderWidth");
		expect(shell).not.toContain("borderColor");
		// No shadow either: elevation is a background step on in-flow content (§ 5).
		expect(SRC).not.toMatch(/shadowColor|shadowRadius|elevation:/);
	});

	it("takes its radius from the SAME expression as the shell", () => {
		/* Two call sites, one helper: the shell's fill and its ring. A third form,
		 *  or a copied `morphHeight(...)` in the ring, is the drift this counts. */
		expect(
			SRC.match(/composerShellRadius\(progress\.value, baseHeight\)/g) ?? [],
		).toHaveLength(2);
		expect(SRC).not.toMatch(/morphHeight\(progress\.value, morphPillRadius/);
	});

	it("pins the painted heights and the pill radius at both floors", () => {
		expect(composerPaintedHeight(false)).toBe(56);
		expect(composerPaintedHeight(true)).toBe(112);
		expect(composerPaintedHeight(false, 48)).toBe(60);
		expect(composerPaintedHeight(true, 48)).toBe(120);
		expect(morphPillRadius(56)).toBe(28);
		expect(morphPillRadius(60)).toBe(30);
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
