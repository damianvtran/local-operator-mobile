import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	COMPOSER_ACTION_CLUSTER,
	COMPOSER_CHIP_CAPSULE_ALIGN,
	COMPOSER_CHIP_TRAILING,
	COMPOSER_CONTROLS_ROW,
	COMPOSER_DISC,
	COMPOSER_META_GAP_PT,
	COMPOSER_META_ROW,
	chipWidthEstimate,
	composerChipPlan,
	FOLDER_CHIP_MAX_PT,
	folderChipText,
	HOME_STRIP_SHRINK,
	MODEL_FLOOR_PT,
	queuedChipWidthEstimate,
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
	it("keeps model and effort explicit on the card's controls row and in More", () => {
		/* D5: the chips ride the card's controls row, in the zone between attach
		 *  and the mic/send cluster — not a strip above the shell. */
		const zone = COMPOSER.slice(
			COMPOSER.indexOf("const chipZone = ("),
			COMPOSER.indexOf("const clearDraft ="),
		);
		expect(zone).toContain("className={COMPOSER_CHIP_ZONE}");
		expect(zone).toContain("CONTROL.composerModelChip");
		expect(zone).toContain("CONTROL.composerEffortChip");
		expect(zone).toContain("CONTROL.composerDismissKeyboard");
		expect(zone).toContain("CONTROL.composerContext");
		/* The queued count is on the card ONLY where the host says it has no
		 *  activity line to carry it (review round 1, M1) — never the strip's
		 *  own shrinking chip, and never unconditionally. */
		expect(zone).not.toContain("{queuedChip}");
		expect(zone).toContain("{cardQueuedChip}");
		/* More still names both, as label/value rows on one edge. */
		expect(COMPOSER).toContain("testID={CONTROL.composerContextModel}");
		expect(COMPOSER).toContain("testID={CONTROL.composerContextEffort}");
		const sheet = COMPOSER.slice(
			COMPOSER.indexOf("testID={CONTROL.composerContextSheet}"),
		);
		expect(sheet.match(/<ContextRow\b/g) ?? []).toHaveLength(5);
		expect(sheet).not.toContain("<ComposerChipButton");
		// D2 (round 6): landscape has ONE context affordance — the compact strip's.
		expect(COMPOSER).not.toContain("CONTROL.composerCompactContext");
	});
});
describe("the above-composer stack (relay above-composer.spacing)", () => {
	it("is ONE slot: the activity line then the ask bar, aligned with the composer's 8 pt edge", () => {
		const at = SCREEN.indexOf("<PinnedWorkingLine");
		const slot = SCREEN.slice(SCREEN.lastIndexOf('className="gap-2', at), at);
		expect(slot).toContain('className="gap-2 px-2 pb-1"');
		expect(SCREEN.indexOf("<AskBar")).toBeGreaterThan(at);
	});
	it("has no capsule band: tasks, agents and the queue are the line's trailing counts (D1)", () => {
		expect(SCREEN).not.toContain("StatusChips");
		const line = SCREEN.slice(
			SCREEN.indexOf("<PinnedWorkingLine"),
			SCREEN.indexOf("<AskBar"),
		).replace(/\s+/g, " ");
		const flat = SCREEN.replace(/\s+/g, " ");
		/* Portrait phone only, as the capsules were. */
		expect(flat).toContain("const activityLineHost = tray && !compact;");
		expect(flat).toContain("{activityLineHost ? ( <PinnedWorkingLine");
		/* The counts element is memoised (review round 1, m1): built inline it
		 *  was a new object per streamed frame and defeated the line's memo. */
		expect(line).toContain("trailing={lineCountsElement}");
		expect(line).not.toContain("<ActivityCounts");
		expect(flat).toContain(
			"const lineCountsElement = useMemo( () => lineCounts.length > 0 ? ( <ActivityCounts counts={lineCounts} onOpen={openStatusSheet} /> ) : null, [lineCounts, openStatusSheet], );",
		);
		expect(line).toContain("trailingStacked={activityCountsStack({");
		/* The tasks/agents counts yield to a pending card (UX U12); the queue
		 *  count is the only place the queue shows, so it does not. */
		expect(SCREEN.replace(/\s+/g, " ")).toContain(
			"activityCounts( pendingShowing ? null : {",
		);
	});
	it("keeps the queued count on the card wherever there is no activity line (M1)", () => {
		/* ONE flag, read twice: the line mounts where it is true and the card
		 *  carries the count where it is false. Written as two conditions, a
		 *  tablet (`tray` false) matched neither and the count was on no surface. */
		const flat = SCREEN.replace(/\s+/g, " ");
		expect(flat).toContain("queueOnCard={!activityLineHost}");
		expect(flat.match(/\bactivityLineHost\b/g)).toHaveLength(3);
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
		/* The strip survives ONLY in short landscape; the card carries its own
		 *  chips, so there is no strip above it to mount (D1/D5). */
		expect(SRC).toMatch(/compactSingle \? compactReceipt : null/);
		expect(SRC).not.toContain("const receipt = (");
		expect(SRC).not.toMatch(/height: 0, overflow: "hidden"/);
		// D2: the strip's More is the only one in landscape.
		expect(SRC).not.toContain("composerCompactContext");
		const row = SRC.slice(
			SRC.indexOf("testID={SURFACE.composerControls}"),
			SRC.indexOf("testID={SURFACE.composerReceipt}"),
		);
		expect(
			row.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\s+/g, " "),
		).toContain("{restsAsCard ? ( <> {pasteChip} {chipZone}");
	});
	it("bounds the queue chip so large text cannot push a control off the card", () => {
		/* The strip's chip keeps the 160 pt cap; the card's takes the width the
		 *  chip plan charged for it, which is itself capped at 160. */
		expect(SRC).toContain("maxWidth: planned === null ? 160 : planned.width");
		expect(queuedChipWidthEstimate(400, 2, 44)).toBe(160);
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
	it("draws the edge on an absolutely positioned child, and only for focus (D8)", () => {
		const ring = ringTag(SRC);
		expect(ring).not.toBe("");
		/* The boundary IS the assertion: the id has to sit inside one self-closing
		 *  `Animated.View`, so a slice can never start at an element that is not it. */
		expect(ring.startsWith("<Animated.View")).toBe(true);
		expect(ring.endsWith("/>")).toBe(true);
		expect(ring).toContain('pointerEvents="none"');
		expect(ring).toContain('position: "absolute"');
		expect(ring).toContain("borderWidth: 1");
		/* D8: no line at rest — the operator asked for none and the fill is the
		 *  card's separation — but focus keeps a visible mark, in the token whose
		 *  contrast against the canvas is known. The width never changes, so the
		 *  ring appearing cannot move a pixel of layout. */
		expect(ring).toContain(
			'borderColor: focused ? borderControl : "transparent"',
		);
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
		/* The card's chips sit ON the shell's own surface (D5), so they are not
		 *  glass capsules of their own and no group merges them. */
		expect(COMPOSER).not.toContain("<ChromeGroup");
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

describe("the home strip's folder chip (design D2 / UX U4 / U5)", () => {
	it("shows the folder's name at ordinary text and the glyph alone past large text", () => {
		expect(folderChipText("app", 1)).toBe("app");
		expect(folderChipText("app", 1.4)).toBe("app");
		expect(folderChipText("app", 1.5)).toBe("");
		expect(folderChipText("app", 2)).toBe("");
	});

	it("caps the chip below the old 160 pt and above its 44 pt floor", () => {
		expect(FOLDER_CHIP_MAX_PT).toBe(112);
		expect(FOLDER_CHIP_MAX_PT).toBeGreaterThan(MODEL_FLOOR_PT);
	});

	it("yields folder first, then effort, then model", () => {
		expect(HOME_STRIP_SHRINK.folder).toBeGreaterThan(HOME_STRIP_SHRINK.effort);
		expect(HOME_STRIP_SHRINK.effort).toBeGreaterThan(HOME_STRIP_SHRINK.model);
		const strip = COMPOSER.slice(
			COMPOSER.indexOf("{folderChip ? ("),
			COMPOSER.indexOf("testID={CONTROL.composerEffortChip}"),
		);
		expect(strip).toContain("flexShrink: HOME_STRIP_SHRINK.folder");
		expect(strip).toContain("maxWidth: FOLDER_CHIP_MAX_PT");
		expect(strip).toContain("folderChipText(folderChip.label, effectiveScale)");
		expect(strip).toContain("<Folder");
		expect(strip).toContain("flexShrink: HOME_STRIP_SHRINK.model");
		/* D5: effort no longer SHRINKS at all — it is whole or it is in More. */
		expect(strip.replace(/\s+/g, " ")).toContain(
			"{effortChip && chipPlan.effort ? (",
		);
		expect(strip).toContain("flexShrink: 0");
	});
	it("lets only the model shrink on the card; effort is rigid and leaves by plan", () => {
		const model = COMPOSER.slice(
			COMPOSER.indexOf("{chipPlan.model ? ("),
			COMPOSER.indexOf("testID={CONTROL.composerModelChip}"),
		).replace(/\s+/g, " ");
		expect(model).toContain('className="min-w-0 shrink"');
		expect(model).toContain("minWidth: MODEL_FLOOR_PT");
		expect(model).toContain('flexBasis: "auto"');
		/* The plan counts the ONE trailing slot the zone renders (More, or
		 *  keyboard-dismiss in its place) and reads the zone's own width. */
		const plan = COMPOSER.slice(
			COMPOSER.indexOf("const chipPlan = composerChipPlan({"),
			COMPOSER.indexOf("const chipZone = ("),
		).replace(/\s+/g, " ");
		expect(plan).toContain("width: chipZoneWidth,");
		expect(plan).toContain("trailing: moreSlot,");
		expect(COMPOSER).toContain("{keyboardVisible || focused ? (");
		/* R3-M1 stands: effort is RIGID, so on native Yoga (0.86.3, yoga#2006)
		 *  the model is the only chip after the folder that floors. The same
		 *  goes for the card's queued count: rigid, at its planned width. */
		const effort = COMPOSER.slice(
			COMPOSER.indexOf("{effortChip && chipPlan.effort ? ("),
			COMPOSER.indexOf("testID={CONTROL.composerEffortChip}"),
		);
		expect(effort).toContain("<View style={{ flexShrink: 0 }}>");
		expect(COMPOSER).toContain("flexShrink: planned === null ? 1 : 0");
	});

	/* Review round 1, M1: the count was visible only on the compact strip and
	 *  on the host's activity line, so a tablet and a narrow short-landscape
	 *  split — which have neither — showed nothing for a queued message. */
	describe("the queued count on the card (no activity line above it)", () => {
		const LABEL = "2 queued";
		const at = (width: number, scale = 1, extra = {}) =>
			composerChipPlan({
				width,
				scale,
				modelChars: "claude-opus-5".length,
				effortChars: "High".length,
				folder: false,
				trailing: 1,
				touchFloor: 44,
				queued: { labelChars: LABEL.length, countChars: 1 },
				...extra,
			});
		const label = queuedChipWidthEstimate(LABEL.length, 1, 44);
		const model = chipWidthEstimate("claude-opus-5".length, 1);
		const effort = chipWidthEstimate("High".length, 1);

		it("wires the plan to the host's flag and paints the planned form", () => {
			const plan = COMPOSER.slice(
				COMPOSER.indexOf("const chipPlan = composerChipPlan({"),
				COMPOSER.indexOf("const chipZone = ("),
			).replace(/\s+/g, " ");
			expect(plan).toContain("queueOnCard && queuedCount > 0 ? {");
			expect(plan).toContain(
				'dictationLargeText || chipPlan.queued.form === "count",',
			);
			/* Off unless the host asks: the home and the portrait phone show the
			 *  queue elsewhere, and their rows must not change. */
			expect(COMPOSER).toContain("queueOnCard = false,");
			expect(at(600, 1, { queued: null })).toEqual({
				model: true,
				effort: true,
			});
			expect(at(600, 1, { queued: null }).queued).toBeUndefined();
		});

		it("tablet arm: a wide zone shows the sentence beside model and effort", () => {
			expect(label).toBe(Math.ceil(8 * 7.2) + 8);
			/* A 768 pt tablet's zone is several hundred points wide. */
			expect(at(500)).toEqual({
				model: true,
				effort: true,
				queued: { form: "label", width: label },
			});
			/* The count is charged before the chips: effort leaves exactly one
			 *  point under More + count + model + effort and their three gaps. */
			const all = 44 + 4 + label + 4 + model + 4 + effort;
			expect(at(all).effort).toBe(true);
			expect(at(all - 1)).toEqual({
				model: true,
				effort: false,
				queued: { form: "label", width: label },
			});
			/* Unmeasured: everything, as without a queue. */
			expect(at(0)).toEqual({
				model: true,
				effort: true,
				queued: { form: "label", width: label },
			});
		});

		it("compact-not-single arm: a narrow zone keeps the COUNT, whatever else goes", () => {
			/* The sentence holds while the model still fits at its floor… */
			const floor = 44 + 4 + label + 4 + 44;
			expect(at(floor)).toEqual({
				model: true,
				effort: false,
				queued: { form: "label", width: label },
			});
			/* …one point under, it becomes the bare number and the model stays… */
			expect(at(floor - 1)).toEqual({
				model: true,
				effort: false,
				queued: { form: "count", width: 44 },
			});
			/* …and when even the model cannot fit, the count is still there. */
			for (const width of [44 + 4 + 44 + 4 + 43, 92, 60, 1]) {
				expect(at(width), String(width)).toEqual({
					model: false,
					effort: false,
					queued: { form: "count", width: 44 },
				});
			}
			/* The zone's floor is More + the planned count, so the clip that may
			 *  cut a chip can never cut either of them. */
			expect(COMPOSER.replace(/\s+/g, " ")).toContain(
				"minWidth: TOUCH_FLOOR + (chipPlan.queued ? chipPlan.queued.width + COMPOSER_META_GAP_PT : 0),",
			);
		});

		it("charges the number, not the sentence, at large text", () => {
			/* The composer passes the number's length as the label there. */
			expect(queuedChipWidthEstimate(1, 2, 44)).toBe(44);
			expect(queuedChipWidthEstimate(3, 2, 44)).toBe(Math.ceil(3 * 14.4) + 8);
		});
	});

	it("drops effort whole before the model's name is cut (D5)", () => {
		const at = (width: number, scale = 1, extra = {}) =>
			composerChipPlan({
				width,
				scale,
				modelChars: "claude-opus-5".length,
				effortChars: "High".length,
				folder: false,
				trailing: 1,
				touchFloor: 44,
				...extra,
			});
		const model = chipWidthEstimate("claude-opus-5".length, 1);
		const effort = chipWidthEstimate("High".length, 1);
		const both = 44 + 4 + model + 4 + effort;
		/* Unmeasured: everything, so the common case does not flicker in. */
		expect(at(0)).toEqual({ model: true, effort: true });
		expect(at(both)).toEqual({ model: true, effort: true });
		/* One point short: effort goes, WHOLE; the model keeps the row. */
		expect(at(both - 1)).toEqual({ model: true, effort: false });
		/* The model stays (and may truncate) down to its floor beside More… */
		expect(at(44 + 4 + 44)).toEqual({ model: true, effort: false });
		/* …and under that More, which lists both, is all that is left. */
		expect(at(44 + 4 + 43)).toEqual({ model: false, effort: false });
		/* 200 % text needs twice the label width, so effort leaves sooner. */
		expect(at(both, 2).effort).toBe(false);
		/* No effort offered for the row (home's unnamed default): never shown. */
		expect(at(both + 200, 1, { effortChars: null }).effort).toBe(false);
		/* The home's folder chip is charged at its floor, plus its gap. */
		expect(at(both + 47, 1, { folder: true }).effort).toBe(false);
		expect(at(both + 48, 1, { folder: true }).effort).toBe(true);
	});
	/* TestFlight 578: "Left justify the effort selector with the other selectors
	 *  on that row." A growing model slot left effort floating right of a gap on
	 *  BOTH strips: `[folder][Claude Opus 5.5]      [Medium] ⋯`. */
	it("packs the chips left; only More's slot takes the zone's free width", () => {
		/* Comments stripped: the WHY comments name `grow`/`flex-1` themselves. */
		const code = COMPOSER.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, "").replace(
			/\s+/g,
			" ",
		);
		const strip = code.slice(
			code.indexOf("{folderChip ? ("),
			code.indexOf("testID={CONTROL.composerContext}"),
		);
		const model = strip.slice(
			strip.indexOf("{chipPlan.model ? ("),
			strip.indexOf("testID={CONTROL.composerModelChip}"),
		);
		expect(model).toContain('className="min-w-0 shrink"');
		expect(model).toContain('flexBasis: "auto"');
		expect(model).not.toMatch(/\bgrow\b|flex-1|flexGrow/);
		const effort = strip.slice(
			strip.indexOf("{effortChip && chipPlan.effort ? ("),
			strip.indexOf("testID={CONTROL.composerEffortChip}"),
		);
		expect(effort).not.toMatch(/\bgrow\b|flex-1|flexGrow/);
		/* The ONLY thing that absorbs the zone's free width is the trailing
		 *  slot's auto margin, so More holds one place whatever the chips do. */
		expect(strip).toContain(
			"<View className={COMPOSER_CHIP_TRAILING} testID={SURFACE.composerStripTrailing} >",
		);
		expect(COMPOSER_CHIP_TRAILING.match(/\bgrow\b|flex-1|ms-auto/g)).toEqual([
			"ms-auto",
		]);
		expect(strip.match(/\bgrow\b|flex-1|flexGrow|ms-auto/g)).toBeNull();
	});
	it("offers the folder once: the More sheet no longer repeats it", () => {
		expect(COMPOSER).not.toContain("folderChip.onPress();");
	});
});

describe("the composer's failure notice is one borderless block (visual audit D6)", () => {
	const code = stripComments(COMPOSER).replace(/\s+/g, " ");
	const notice = code.slice(
		code.indexOf("testID={SURFACE.composerFailureNotice}"),
		code.indexOf("testID={SURFACE.composerDisabledReason}"),
	);

	it("holds the retained sentence, the error and both actions in ONE block", () => {
		expect(
			code.match(/testID=\{SURFACE\.composerFailureNotice\}/g) ?? [],
		).toHaveLength(1);
		for (const id of [
			"SURFACE.composerRetained",
			"SURFACE.composerError",
			"CONTROL.composerRetry",
			"CONTROL.composerDismissError",
		])
			expect(notice).toContain(`testID={${id}}`);
		expect(notice).toContain("<TriangleAlert");
	});

	it("draws no box, no wash and no outlined button", () => {
		expect(notice).not.toMatch(/border-danger-border|bg-danger-wash/);
		expect(notice).not.toContain("<Button");
		expect(notice).not.toContain('variant="outline"');
		expect(notice.match(/<NoticeAction\b/g) ?? []).toHaveLength(2);
		/* Nowhere else in the extras either: the two red boxes are gone. */
		expect(code).not.toContain(
			"rounded-sm border border-danger-border bg-danger-wash px-3 py-2",
		);
	});

	it("keeps #206's behaviour: Retry and Dismiss are the host's, and Dismiss needs an error", () => {
		expect(notice).toContain("onPress={onRetry}");
		expect(notice).toContain("onPress={onDismissError}");
		/* Dismiss is offered for the ERROR line only: a retained instruction has
		 *  no dismiss, so the notice cannot drop a retained UUID or a queue. */
		expect(notice).toContain(
			"{feedback.errorText !== null && onDismissError ? ( <NoticeAction",
		);
		expect(notice).toContain(
			"{feedback.retainedText !== null ? ( <NoticeAction",
		);
	});

	it("does not repeat the reason under the notice, and keeps it on the disabled Send", () => {
		expect(code).toContain(
			"{controls.disabledReason !== null && presentation.expanded && feedback.retainedText === null && !suppressDisabledHint ? (",
		);
		const at = code.indexOf("testID={CONTROL.composerSend}");
		const send = code.slice(code.lastIndexOf("<Pressable", at), at);
		expect(send).toContain(
			"accessibilityHint={ controls.primary.disabled ? (controls.disabledReason ?? undefined) : undefined }",
		);
	});
});

describe("Clear draft is a trailing icon on the field row (visual audit D7)", () => {
	const code = stripComments(COMPOSER).replace(/\s+/g, " ");

	it("is an icon button with the accessible name kept, shown only with a draft", () => {
		const clear = code.slice(
			code.indexOf("const clearDraft ="),
			code.indexOf("const compactReceipt = ("),
		);
		expect(clear).toContain(
			"onClearDraft && (draft.length > 0 || images.length > 0) ? ( <IconButton",
		);
		expect(clear).toContain(
			'accessibilityLabel={t("mobile.composer_input.clear_draft")}',
		);
		expect(clear).toContain("testID={CONTROL.composerClearDraft}");
		expect(clear).toContain("<X ");
	});

	it("sits after the field in the field row, not in the extras above it", () => {
		const extras = code.slice(
			code.indexOf("const extras = ("),
			code.indexOf("const queuedChip ="),
		);
		expect(extras).not.toContain("composerClearDraft");
		const row = code.slice(
			code.indexOf("testID={CONTROL.composerInput}"),
			code.indexOf("{dictationRow}"),
		);
		expect(row).toContain("{clearDraft}");
		expect(code.match(/\{clearDraft\}/g) ?? []).toHaveLength(1);
	});
});
