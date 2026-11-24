import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	COMPOSER_ACTION_CLUSTER,
	COMPOSER_CHIP_TRAILING,
	COMPOSER_CONTROLS_ROW,
	COMPOSER_DISC,
	COMPOSER_META_GAP_PT,
	COMPOSER_META_ROW,
	NOTICE_ACTION_GAP_PT,
	noticeActionPlan,
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
	});
	it("mounts one Textarea independently of idle, focus and keyboard", () => {
		expect(COMPOSER.match(/<Textarea\b/g)).toHaveLength(1);
		expect(COMPOSER).toContain("fieldRef={inputRef}");
		expect(COMPOSER).not.toContain("inlineMetaFits");
		expect(COMPOSER).not.toContain("composerGeometry");
	});
	it("keeps the folder and run settings on the card's controls row, and in More only when off it", () => {
		/* D5 / issue #325: the controls ride the card's controls row, in the zone
		 *  between attach and the mic/send cluster — now as icon controls. */
		const zone = COMPOSER.slice(
			COMPOSER.indexOf("const controlZone = ("),
			COMPOSER.indexOf("const clearDraft ="),
		);
		expect(zone).toContain("className={COMPOSER_CHIP_ZONE}");
		expect(zone).toContain("testID={folder.testID}");
		expect(zone).toContain("CONTROL.composerModelChip");
		expect(zone).not.toContain("CONTROL.composerEffortChip");
		expect(zone).toContain("CONTROL.composerDismissKeyboard");
		expect(zone).toContain("CONTROL.composerContext");
		/* The queued count is on the card ONLY where the host says it has no
		 *  activity line to carry it (review round 1, M1) — never the strip's
		 *  own shrinking chip, and never unconditionally. */
		expect(zone).not.toContain("{queuedChip}");
		expect(zone).toContain("{cardQueuedChip}");
		/* More names a control only while that control is not on the row: one
		 *  way in, never two (UX U5). Its effort row is gone — effort lives in
		 *  the run-settings sheet with the model. */
		const sheet = COMPOSER.slice(
			COMPOSER.indexOf("testID={CONTROL.composerContextSheet}"),
		);
		const folderRow = sheet.indexOf("testID={CONTROL.composerContextFolder}");
		const modelRow = sheet.indexOf("testID={CONTROL.composerContextModel}");
		expect(
			sheet.lastIndexOf("{folder !== null && !onRow.folder ? (", folderRow),
		).toBeGreaterThan(-1);
		expect(sheet.lastIndexOf("{!onRow.settings ? (", modelRow)).toBeGreaterThan(
			folderRow,
		);
		expect(COMPOSER).not.toContain("CONTROL.composerContextEffort");
		/* Seven: the home-only "Agent or team" row (identity-picker spec D-S2)
		 *  leads More, rendered only when the host passes `identityRow`. */
		expect(sheet.match(/<ContextRow\b/g) ?? []).toHaveLength(7);
		expect(sheet.indexOf("CONTROL.composerContextIdentity")).toBeLessThan(
			folderRow,
		);
		expect(sheet).not.toContain("<ComposerChipButton");
		// D2 (round 6): landscape has ONE context affordance — the compact strip's.
		expect(COMPOSER).not.toContain("CONTROL.composerCompactContext");
	});
});
describe("More's Questions row (build 753: no bar for timed-out asks)", () => {
	it("is drawn only when the host passes asks, and opens the asks sheet after closing More", () => {
		const sheet = COMPOSER.slice(
			COMPOSER.indexOf("testID={CONTROL.composerContextSheet}"),
		);
		const at = sheet.indexOf("testID={CONTROL.composerContextQuestions}");
		expect(at).toBeGreaterThan(-1);
		const row = sheet
			.slice(sheet.lastIndexOf("{questions ? (", at), at)
			.replace(/\s+/g, " ");
		expect(row).toContain('label={t("mobile.chrome.composer.row_questions")}');
		expect(row).toContain("setContextOpen(false); questions.onOpen();");
	});
	it("is fed by ANY ask, waiting or timed out, and opens the same sheet as the bar", () => {
		const flat = SCREEN.replace(/\s+/g, " ");
		expect(flat).toContain("const label = askBarLabel(projection?.asks);");
		expect(flat).toContain(
			"? null : { value: label.text, onOpen: asksSheet.open };",
		);
		expect(flat).toContain("onOpen={asksSheet.open}");
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

	it("keeps the attach title keyed, never a raw literal", () => {
		// O3-a keyed this title, so the pin is the key; the guard is that no raw literal returns.
		expect(SRC).toContain('title={t("mobile.session.sheet_title.attach")}');
		expect(SRC).not.toMatch(/title="[Aa]ttach"/);
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
		).toContain("{restsAsCard ? ( <> {pasteChip} {controlZone}");
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
	it("draws no capsule at all since the chips became icon controls (issue #325)", () => {
		/* Transparent `IconButton`s like attach and the mic: nothing to wrap. */
		expect(COMPOSER).not.toContain("stripChipSurface");
		expect(COMPOSER).not.toContain("COMPOSER_CHIP_CAPSULE_ALIGN");
	});
});

describe("the card's icon controls (issue #325)", () => {
	/* The folder and model chips were cut to `loc` / `Claude` with no ellipsis
	 *  on iOS, and More could leave the row while Stop was up: RN 0.86.3's
	 *  vendored Yoga freezes a min-floored shrinker in its first pass and still
	 *  charges the next against the ORIGINAL free space (yoga#2006, fixed
	 *  upstream in 73bebc0, not vendored). The fix removes the shape the bug
	 *  needs: nothing in the zone shrinks. The plan's own arithmetic is pinned in
	 *  `composer-controls.test.ts`; this pins the wiring. */
	const code = COMPOSER.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, "").replace(
		/\s+/g,
		" ",
	);
	const zone = code.slice(
		code.indexOf("const controlZone = ("),
		code.indexOf("const clearDraft ="),
	);

	it("feeds the plan the zone's own width and the trailing slot's occupant", () => {
		const plan = code.slice(
			code.indexOf("const controlsPlan = composerControlsPlan({"),
			code.indexOf("const onRow ="),
		);
		expect(plan).toContain("width: zoneWidth,");
		expect(plan).toContain("touchFloor: TOUCH_FLOOR,");
		expect(plan).toContain("gap: COMPOSER_META_GAP_PT,");
		expect(plan).toContain("folder: folder !== null,");
		expect(plan).toContain("dismiss: keyboardVisible || focused,");
		expect(plan).toContain("moreRows,");
		/* More is shown for its own rows or a displaced control, never empty. */
		expect(code).toContain(
			"const moreRows = !!contextLabel || !!costLabel || queuedCount > 0 || questions !== null;",
		);
		expect(zone).toContain('controlsPlan.trailing === "more" ? (');
	});

	it("has no shrinker left in the zone: every member is a rigid icon square", () => {
		expect(zone).not.toMatch(/flexShrink|\bshrink\b|min-w-0 shrink/);
		expect(zone).not.toContain("<Chip");
		expect(zone.match(/<ComposerIconControl\b/g) ?? []).toHaveLength(2);
		const control = COMPOSER.slice(
			COMPOSER.indexOf("const ComposerIconControl"),
			COMPOSER.indexOf("/** The failure notice's row floor:"),
		);
		expect(control).toContain("<IconButton");
		expect(control).toContain("size={ATTACH_GLYPH_PT}");
	});

	it("packs the icons left; only the trailing slot takes the zone's free width", () => {
		/* TestFlight 578: the selectors stay left-justified beside attach. */
		const strip = zone.slice(
			zone.indexOf("{folder !== null && onRow.folder ? ("),
			zone.indexOf("testID={CONTROL.composerContext}"),
		);
		expect(strip).toContain(
			"<View className={COMPOSER_CHIP_TRAILING} testID={SURFACE.composerStripTrailing} >",
		);
		expect(COMPOSER_CHIP_TRAILING.match(/\bgrow\b|flex-1|ms-auto/g)).toEqual([
			"ms-auto",
		]);
		expect(strip.match(/\bgrow\b|flex-1|flexGrow|ms-auto/g)).toBeNull();
	});

	it("keeps the queued count on the card where the host asks, at its planned form", () => {
		expect(code).toContain(
			"const queuedOnCard = queueOnCard && queuedCount > 0;",
		);
		expect(code).toContain(
			'dictationLargeText || controlsPlan.queued.form === "count",',
		);
		/* Off unless the host asks: the home and the portrait phone show the
		 *  queue elsewhere, and their rows must not change. */
		expect(COMPOSER).toContain("queueOnCard = false,");
		/* The zone's floor is one square + the planned count, so the clip that
		 *  may cut an icon can never cut the count or More. */
		expect(zone).toContain(
			"minWidth: TOUCH_FLOOR + (controlsPlan.queued ? controlsPlan.queued.width + COMPOSER_META_GAP_PT : 0),",
		);
	});

	it("charges the number, not the sentence, at large text", () => {
		/* The composer passes the number's length as the label there. */
		expect(queuedChipWidthEstimate(1, 2, 44)).toBe(44);
		expect(queuedChipWidthEstimate(3, 2, 44)).toBe(Math.ceil(3 * 14.4) + 8);
	});
});

describe("the composer's failure notice is one borderless block (visual audit D6)", () => {
	const code = stripComments(COMPOSER).replace(/\s+/g, " ");
	/* From the two actions' own definitions: they are declared once, above the
	 *  block, because the block places them in one of two spots (QA round 4 Q7). */
	const notice = code.slice(
		code.indexOf("const noticeRetry ="),
		code.indexOf("const extras = ("),
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
		const dismiss = notice.slice(notice.indexOf("const noticeDismiss ="));
		expect(dismiss).toContain(
			"feedback.errorText !== null && onDismissError ? ( <NoticeAction",
		);
		expect(dismiss).not.toContain("onPress={onRetry}");
	});

	/* Design D7 / code R3 M2: beside a trailing action the sentence was whatever
	 *  the action left it. At 320 pt / 200 % that was a sliver, and the retained
	 *  sentence ran to 474 px of two-word lines (QA round 3 Q4). The sentence now
	 *  has a floor that scales with the text, and the row wraps: an action that
	 *  would squeeze it below the floor drops under it, on the trailing edge. */
	it("lets an action wrap under its sentence instead of squeezing it", () => {
		expect(COMPOSER).toContain("const NOTICE_SENTENCE_MIN = 64;");
		expect(
			notice.match(
				/className="flex-row flex-wrap items-start justify-end gap-x-3"/g,
			) ?? [],
		).toHaveLength(2);
		expect(
			notice.match(
				/style=\{\{ paddingVertical: NOTICE_LINE_INSET, minWidth: noticeSentenceMin, \}\}/g,
			) ?? [],
		).toHaveLength(2);
		expect(code).toContain(
			"const noticeSentenceMin = Math.round(NOTICE_SENTENCE_MIN * effectiveScale);",
		);
		/* `min-w-0` on the sentence would be the squeeze again. */
		expect(notice).not.toMatch(/min-w-0 flex-1 text-(body-sm|meta)/);
	});

	/* QA round 3 Q4: after scrolling the notice to reach "Dismiss error" and
	 *  using it, the scroller kept its offset and Retry sat above the fold. */
	it("returns the extras to their top when the notice's contents change", () => {
		expect(code).toContain("ref={extrasScrollRef}");
		expect(code).toContain(
			"extrasScrollRef.current?.scrollTo({ y: 0, animated: false });",
		);
		expect(code).toMatch(
			/const noticeKey = `\$\{feedback\.retainedText \?\? ""\}\|\$\{feedback\.errorText \?\? ""\}`;/,
		);
	});

	/* UX #211 U2: with a retained instruction showing, "Dismiss" under both
	 *  sentences removed only the grey error line and itself, so it read as
	 *  "Dismiss did not work". Each action now lives on the line it acts on. */
	it("puts Retry on the retained sentence and the dismissal on the error line", () => {
		const retainedRow = notice.slice(
			notice.indexOf("{feedback.retainedText !== null ? ("),
			notice.indexOf("{feedback.errorText !== null ? ("),
		);
		expect(retainedRow).toContain("testID={SURFACE.composerRetained}");
		expect(retainedRow).toContain("{noticePlan.lead ? null : noticeRetry}");
		/* The retained sentence keeps Retry ONLY: nothing on its row dismisses. */
		expect(retainedRow).not.toMatch(/onDismissError|noticeDismiss/);
		const errorRow = notice.slice(
			notice.indexOf("{feedback.errorText !== null ? ("),
		);
		expect(errorRow).toContain("testID={SURFACE.composerError}");
		expect(errorRow).toContain("{noticePlan.lead ? null : noticeDismiss}");
		expect(errorRow).not.toContain("noticeRetry");
		/* Each action is DEFINED once, with the id and handler it always had. */
		const retry = notice.slice(0, notice.indexOf("const noticeDismiss ="));
		expect(retry).toContain("testID={CONTROL.composerRetry}");
		expect(retry).not.toContain("onDismissError");
		expect(notice.slice(retry.length)).toContain(
			"testID={CONTROL.composerDismissError}",
		);
	});

	/* QA #211 round 4 Q7 and its English twin. Wrapping an action UNDER its
	 *  sentence kept the sentence readable and lost the action: at 320x568 /
	 *  200 % the extras scroller is 143 px tall, the French Retry landed at
	 *  y 662 (the scroller ends at 452) and the English "Dismiss error" was
	 *  cut by 14 px on its second row. */
	describe("puts the actions on the notice's first row when one would wrap (QA round 4 Q7)", () => {
		/* 320 pt / 200 %: the sentence column QA measured (250) and the scaled
		 *  floor (64 x 2). Widths: "Retry" 69, "Dismiss" 96, "Dismiss error"
		 *  164 and "Réessayer" 129 are QA's (rounds 3 and 4). "Masquer
		 *  l’erreur" was not measured: 202 is 164 scaled by its 16 characters
		 *  over the English 13, an ESTIMATE, and the row count below holds for
		 *  any width over 109 (250 - 12 - 129). */
		const at320 = (actions: readonly number[]) =>
			noticeActionPlan({ column: 250, sentenceMin: 128, actions });
		it("English, retained + error: both actions share one leading row", () => {
			expect(at320([69, 164])).toEqual({ lead: true, rows: 1 });
			/* 69 + 12 + 164 = 245 of 250: "Dismiss error" is whole, on row one. */
			expect(69 + NOTICE_ACTION_GAP_PT + 164).toBeLessThanOrEqual(250);
		});
		it("French, retained + error: Retry leads, the dismissal takes a whole second row", () => {
			expect(at320([129, 202])).toEqual({ lead: true, rows: 2 });
			expect(at320([129, 110])).toEqual({ lead: true, rows: 2 });
		});
		it("French, retained alone: Réessayer (129) no longer drops under its sentence", () => {
			expect(250 - NOTICE_ACTION_GAP_PT - 129).toBeLessThan(128);
			expect(at320([129])).toEqual({ lead: true, rows: 1 });
		});
		it("keeps an action trailing its sentence wherever the sentence keeps its floor", () => {
			expect(at320([69])).toEqual({ lead: false, rows: 1 });
			expect(at320([96])).toEqual({ lead: false, rows: 1 });
			/* 390 pt / 100 %: column 320, floor 64, "Dismiss error" 82. */
			expect(
				noticeActionPlan({ column: 320, sentenceMin: 64, actions: [35, 82] }),
			).toEqual({ lead: false, rows: 1 });
		});
		it("does not flip before it has measured, and reports no rows with no action", () => {
			expect(at320([])).toEqual({ lead: false, rows: 0 });
			expect(at320([0, 164])).toEqual({ lead: false, rows: 1 });
			expect(
				noticeActionPlan({ column: 0, sentenceMin: 128, actions: [164] }),
			).toEqual({ lead: false, rows: 1 });
		});
		it("is one decision for the whole notice, from widths the layout cannot change", () => {
			expect(notice).toContain(
				'{noticePlan.lead ? ( <View className="flex-row flex-wrap justify-end gap-x-3"> {noticeRetry} {noticeDismiss} </View> ) : null}',
			);
			/* The leading row is the first thing in the sentence column. */
			expect(notice.indexOf("{noticePlan.lead ? ( <View")).toBeLessThan(
				notice.indexOf("testID={SURFACE.composerRetained}"),
			);
			expect(code).toContain(
				"column: contentWidth > 0 ? contentWidth - NOTICE_GLYPH_COLUMN_PT : 0,",
			);
			expect(code).toContain(
				"onLayout={(event) => onWidth(Math.ceil(event.nativeEvent.layout.width))}",
			);
			/* The budget is told how many whole action rows lead the extras. */
			expect(code).toContain("noticePlan.rows * NOTICE_ROW_FLOOR, )");
		});
	});

	/* QA #211 round 4 Q6: the model of the loop is in `size-class.test.ts`; this
	 *  is the composer's half, that its extras cannot gain or lose width with
	 *  their overflow state. */
	it("lays the extras out at a width their own scrollbar cannot change (QA round 4 Q6)", () => {
		const scroller = code.slice(
			code.indexOf("ref={extrasScrollRef}"),
			code.indexOf("{main}"),
		);
		expect(scroller).toContain(
			'showsVerticalScrollIndicator={Platform.OS !== "web"}',
		);
		expect(scroller).toContain(
			"<View style={contentWidth > 0 ? { width: contentWidth } : undefined} > {extras} </View>",
		);
		/* Measured on the content block, OUTSIDE the scroller. */
		expect(code).toContain(
			"const width = Math.floor(event.nativeEvent.layout.width); if (width > 0 && width !== contentWidth) setContentWidth(width);",
		);
		expect(code).toContain("<View onLayout={measureContent}> {} <ScrollView");
	});

	it("names the dismissal for the error whenever a retained sentence is beside it", () => {
		expect(notice).toContain(
			'label={ feedback.retainedText !== null ? t("mobile.composer_input.dismiss_error") : t("mobile.composer_input.notice_dismiss") }',
		);
		/* The accessible name and the id are unchanged either way. */
		expect(notice).toContain(
			'accessibilityLabel={t("mobile.composer_input.dismiss_error")}',
		);
	});

	/* UX #211 U4 / QA Q2: at 320x568 and 200 % the actions' own row was below
	 *  the fold of the extras scroller. An action now shares its sentence's
	 *  FIRST row, and that row is the one the budget keeps visible (U1). */
	it("keeps each action on its sentence's first row, inside the guaranteed floor", () => {
		expect(
			notice.match(
				/<View className="flex-row flex-wrap items-start justify-end gap-x-3" style=\{\{ minHeight: NOTICE_ROW_FLOOR \}\} >/g,
			) ?? [],
		).toHaveLength(2);
		/* The wrap floor must not move the actions that fit off that first
		 *  row at 320 pt / 200 %: column 250, gap 12, floor 64 x 2. "Retry"
		 *  (69) and the lone "Dismiss" (96), as QA round 3 measured them,
		 *  keep their row; "Dismiss error" (82 at 100 %, so about 164) left
		 *  its sentence 74 px and is the one that wraps (design D7). */
		for (const action of [69, 96])
			expect(250 - 12 - action).toBeGreaterThanOrEqual(64 * 2);
		expect(250 - 12 - 164).toBeLessThan(64 * 2);
		/* No separate actions row any more. */
		expect(notice).not.toContain("flex-row flex-wrap items-center gap-x-4");
		expect(code).toContain("const NOTICE_ROW_FLOOR = TOUCH_FLOOR;");
		/* The notice is the first thing in the extras scroller... */
		expect(code).toMatch(
			/const extras = \( <> <ComposerStateMarkers controls=\{controls\} \/> \{\} \{failureNotice\}/,
		);
		/* ...and the budget carries no floor for it: a floor it cannot fit put
		 *  the controls row past the window (code R3 M1). */
		expect(code).not.toContain("? NOTICE_ROW_FLOOR : 0");
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
