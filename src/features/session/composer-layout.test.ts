import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	COMPOSER_ACTION_CLUSTER,
	COMPOSER_CHIP_CAPSULE_ALIGN,
	COMPOSER_CONTROLS_ROW,
	COMPOSER_DISC,
	COMPOSER_META_GAP_PT,
	COMPOSER_META_GLASS_SPACING,
	COMPOSER_META_ROW,
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
		expect(COMPOSER_CONTROLS_ROW).toContain("gap-x-1");
		expect(COMPOSER_ACTION_CLUSTER).toContain("gap-1");
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
 * suite: on the shell's own border it would also shrink the box.
 *
 * These helpers exist because the first version of this gate asked two questions
 * of STRINGS and both answers were wrong (review round 1). It read ONE literal —
 * the shell's `style` object — so a `borderWidth` inside the `shellMotion` worklet
 * left every test green, though that worklet's output is part of what the shell
 * composites (R1). And it located the ring by slicing back to the nearest
 * `<Animated.View`, which is the SHELL the moment the ring is retagged `<View`
 * (R2). Same mistake twice: reading text where the question is about an ELEMENT.
 * Comments are dropped before any of this runs, because the prose above the ring
 * names `pointerEvents` and `borderWidth`, and a ±700-char window counted them. */
const stripComments = (source: string) =>
	source
		.replace(/\/\*[\s\S]*?\*\//g, "")
		/* `//` only where a comment can start: a bare replace would eat the `//` in a
		 *  string, and a mangled string is a slice that silently stops matching. */
		.replace(/(^|[\s;{}()])\/\/[^\n]*/g, "$1");

/** The bracketed run starting at `at` (`{…}`, `(…)` or `[…]`), both ends included. */
const balancedAt = (source: string, at: number): string => {
	let depth = 0;
	for (let i = at; i < source.length; i += 1) {
		const ch = source[i];
		if (ch === "{" || ch === "(" || ch === "[") depth += 1;
		else if (ch === "}" || ch === ")" || ch === "]") {
			depth -= 1;
			if (depth === 0) return source.slice(at, i + 1);
		}
	}
	return "";
};

/** The JSX open tag enclosing `at`, through the `>` that closes it. An attribute
 *  expression is skipped as a unit, so a `>` inside one cannot end the tag early. */
const openTagAt = (source: string, at: number): string => {
	const start = source.lastIndexOf("<", at);
	if (start < 0) return "";
	let depth = 0;
	for (let i = start + 1; i < source.length; i += 1) {
		const ch = source[i];
		if (ch === "{") depth += 1;
		else if (ch === "}") depth -= 1;
		else if (ch === ">" && depth === 0) return source.slice(start, i + 1);
	}
	return "";
};

/** The names an object literal sets at its OWN level. A nested value is another
 *  object's keys; a `...spread` is the local literal it names, one level down. */
const literalKeys = (literal: string, source: string): string[] => {
	const keys: string[] = [];
	let depth = 0;
	for (let i = 0; i < literal.length; i += 1) {
		const ch = literal[i];
		if (ch === "{" || ch === "(" || ch === "[") depth += 1;
		else if (ch === "}" || ch === ")" || ch === "]") depth -= 1;
		if (depth !== 1) continue;
		const rest = literal.slice(i);
		const spread = /^\.\.\.([A-Za-z_$][\w$]*)/.exec(rest);
		if (spread?.[1]) {
			const at = source.search(new RegExp(`const ${spread[1]} = \\{\\s*`));
			if (at >= 0) {
				const brace = source.indexOf("{", at);
				keys.push(...literalKeys(balancedAt(source, brace), source));
			}
			i += spread[0].length - 1;
			continue;
		}
		const key = /^([A-Za-z_$][\w$]*):/.exec(rest)?.[1];
		if (key) {
			keys.push(key);
			i += key.length - 1;
		}
	}
	return keys;
};

/** Every name one entry of a `style={[…]}` array can set: a literal's own keys, or
 *  — for the animated styles this file binds — the object its worklet RETURNS. That
 *  returned object is composited onto the element and is not inside the literal
 *  beside it, which is exactly the hole R1 found. */
const styleEntryKeys = (entry: string, source: string): string[] => {
	const text = entry.trim();
	if (text.startsWith("{")) return literalKeys(balancedAt(text, 0), source);
	const name = /^([A-Za-z_$][\w$]*)$/.exec(text)?.[1];
	if (!name) return [];
	const decl = new RegExp(`const ${name} = useAnimatedStyle\\(`).exec(source);
	if (!decl) return [];
	const call = balancedAt(source, decl.index + decl[0].length - 1);
	const brace = call.indexOf("{");
	return brace < 0 ? [] : literalKeys(balancedAt(call, brace), source);
};

/** The shell element's COMPOSITED style, flattened to the names it can set across
 *  every entry of its `style={[…]}` array. `borderRadius` is the one
 *  border-prefixed name it is allowed: a radius is a shape, never an edge. */
const shellCompositedKeys = (source: string): string[] => {
	/* Anchored on the fill's own expression: solid `elevated`, or no fill at all
	 *  when the glass layer draws the material (design spec §12). */
	const shell = openTagAt(
		source,
		source.indexOf('backgroundColor: glass ? "transparent" : elevated'),
	);
	if (!/^<Animated\.View\b/.test(shell)) return [];
	const styleAt = shell.indexOf("style={");
	if (styleAt < 0) return [];
	/* The array, not the `{` that opens it: `balancedAt` starts counting at the
	 *  bracket it is handed. */
	const entries = balancedAt(shell, styleAt + "style={".length).slice(1, -1);
	const keys: string[] = [];
	let depth = 0;
	let start = 0;
	for (let i = 0; i <= entries.length; i += 1) {
		const ch = entries[i];
		if (ch === "{" || ch === "(" || ch === "[") depth += 1;
		else if (ch === "}" || ch === ")" || ch === "]") depth -= 1;
		if (i === entries.length || (ch === "," && depth === 0)) {
			keys.push(...styleEntryKeys(entries.slice(start, i), source));
			start = i + 1;
		}
	}
	return keys;
};

/** The ring's OWN open tag, located by the identifier that exists on it alone —
 *  `CONTROL.composerShellRing`, which the shell never carries. Slicing back from a
 *  style token instead started at the shell as soon as the ring was retagged, and
 *  every assertion inside the slice still passed (R2): so the anchor is the id, the
 *  bound is checked to be a single self-closing tag, and the tag's own name is
 *  asserted by the caller. */
const ringTag = (source: string): string => {
	const id = source.indexOf("testID={CONTROL.composerShellRing}");
	if (id < 0) return "";
	const tag = openTagAt(source, id);
	return tag.endsWith("/>") ? tag : "";
};

/** The `ringMotion` worklet's returned object, which is the ring's radius. Takes the
 *  literal out of the CALL rather than by regex: a greedy `[\s\S]*` ran on into the
 *  next worklet in the file and described the composer's dock instead. */
const ringMotionBody = (source: string): string => {
	const decl = /const ringMotion = useAnimatedStyle\(/.exec(source);
	if (!decl) return "";
	const call = balancedAt(source, decl.index + decl[0].length - 1);
	const brace = call.indexOf("{");
	return brace < 0 ? "" : balancedAt(call, brace);
};

describe("the shell boundary is an overlay rule, not a box", () => {
	it("draws the border-control edge on an absolutely positioned child", () => {
		const ring = ringTag(SRC);
		expect(ring).not.toBe("");
		/* The boundary IS the assertion: the id has to sit inside one self-closing
		 *  `Animated.View`, so a slice can never start at an element that is not it. */
		expect(ring.startsWith("<Animated.View")).toBe(true);
		expect(ring.endsWith("/>")).toBe(true);
		expect(ring).toContain('pointerEvents="none"');
		expect(ring).toContain('position: "absolute"');
		expect(ring).toContain("borderWidth: 1");
		expect(ring).toContain("borderColor: borderControl");
		expect(ring).toContain("ringMotion");
		/* The shell is NOT in the slice: its fill and its worklet are what a slice
		 *  that started one element too early contains. */
		expect(ring).not.toContain("backgroundColor: elevated");
		expect(ring).not.toContain("shellMotion");
		/* All four sides, in the file's own logical vocabulary: an inset on three
		 *  is a rule that stops short of a corner, and a physical `left`/`right`
		 *  pair is the RTL bug the physical-edge guard exists to catch. */
		for (const side of ["top: 0", "bottom: 0", "start: 0", "end: 0"]) {
			expect(ring).toContain(side);
		}
		expect(ring).not.toMatch(/\b(left|right): 0/);
	});

	it("binds the ring's own animated radius, declared once and used once", () => {
		/* The radius the ring paints has to be ITS binding, not a shape borrowed from
		 *  a sibling: one declaration, one use, and that use is the ring's. Counted on
		 *  the comment-free source, because prose naming the worklet is not a use. */
		const bare = stripComments(SRC);
		expect(bare.match(/\bringMotion\b/g) ?? []).toHaveLength(2);
		expect(ringTag(SRC)).toContain("ringMotion,");
		const body = ringMotionBody(SRC);
		expect(body).not.toBe("");
		expect(body).toContain(
			"borderRadius: composerShellRadius(progress.value, baseHeight)",
		);
		/* One key: a second property in the ring's worklet is a shape the shell's own
		 *  style does not have, and the two edges would stop agreeing mid-morph. */
		expect(literalKeys(body, SRC)).toEqual(["borderRadius"]);
	});

	it("keeps every border off the shell's COMPOSITED style", () => {
		/* The negative control, as an assertion about where the border lives — over
		 *  everything the shell composites, not one literal. A border on this element
		 *  is charged to its border box: 1 pt off each edge of the interior, so the
		 *  44 pt field paints 42 and every measured seed lands 2 pt short of its end.
		 *  The radii do NOT drop with it (`baseHeight` is `max(seededBase, measured)`,
		 *  and `seededBase` is the same pure helper), and no test in this suite renders
		 *  a box — which is why the shape of the fix, not a pin, is the guard. */
		const keys = shellCompositedKeys(SRC);
		/* Non-vacuous first: the flatten has to see the fill, the paddings (they arrive
		 *  through `...shellBox`), the clip and the worklet's height before its silence
		 *  about borders means anything. */
		expect(keys).toEqual(
			expect.arrayContaining([
				"backgroundColor",
				"paddingHorizontal",
				"paddingTop",
				"paddingBottom",
				"overflow",
				"height",
				"borderRadius",
			]),
		);
		expect(
			keys.filter((key) => /^border/.test(key) && key !== "borderRadius"),
		).toEqual([]);
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
		/* H5: the resting pill is 4 + 48 + 4 = 56 on BOTH floors; the open card
		 *  still follows the floor (112 on iOS, 120 on the 48 floor). */
		expect(composerPaintedHeight(false)).toBe(56);
		expect(composerPaintedHeight(true)).toBe(112);
		expect(composerPaintedHeight(false, 48)).toBe(56);
		expect(composerPaintedHeight(true, 48)).toBe(120);
		expect(morphPillRadius(56)).toBe(28);
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

/* Design D1: on iOS glass the model capsule stretched across its `flex-1`
 * slot, and the effort capsule 4 pt away sat inside the group's 8 pt merge
 * distance, so the two would fuse into one bar. */
describe("strip glass capsules stay per-chip", () => {
	it("keeps the merge distance under the strip's gap", () => {
		expect(COMPOSER_META_ROW).toContain("gap-1");
		expect(COMPOSER_META_GAP_PT).toBe(4);
		expect(COMPOSER_META_GLASS_SPACING).toBeLessThan(COMPOSER_META_GAP_PT);
		const strip = COMPOSER.slice(
			COMPOSER.indexOf("const receipt = ("),
			COMPOSER.indexOf("const compactReceipt = ("),
		);
		expect(strip).toContain("spacing={COMPOSER_META_GLASS_SPACING}");
	});
	it("makes each capsule hug its chip, in the glass branch only", () => {
		expect(COMPOSER_CHIP_CAPSULE_ALIGN).toBe("flex-start");
		const surface = COMPOSER.slice(
			COMPOSER.indexOf("const stripChipSurface ="),
			COMPOSER.indexOf("export const Composer ="),
		);
		expect(surface).toContain("alignSelf: COMPOSER_CHIP_CAPSULE_ALIGN");
		/* The solid branch is the chip itself, unwrapped and unchanged. */
		expect(surface).toMatch(/\) : \(\s*chip\s*\);/);
	});
});
