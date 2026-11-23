import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PALETTE } from "@/ui/tokens.gen";
import {
	COMPOSER_CARD_MARGIN,
	COMPOSER_CONTROLS_GAP,
	COMPOSER_FIELD_BOX,
	COMPOSER_GLASS_LAYER_RADIUS,
	COMPOSER_MORPH_EASING,
	COMPOSER_MORPH_MS,
	COMPOSER_PILL_MARGIN,
	COMPOSER_REST_PAD,
	COMPOSER_REST_ROW,
	composerFieldRowAlign,
	composerPaintedHeight,
	composerPillRow,
	composerPinsCard,
	composerPresentation,
	composerRestInsets,
	composerShellPadding,
	composerShellRadius,
	controlsTrailing,
	dictationDropsSend,
	dockMotionStyle,
	fieldSelectionOverride,
	keyboardOverlap,
	morphPillRadius,
	openOnlyForDictation,
	PILL_ELLIPSIS_CUE_PT,
	pillShowsEllipsis,
	pillShowsPlaceholder,
	pillShowsSend,
	seedFor,
} from "./composer-presentation";

const read = (path: string) =>
	readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

const empty = {
	focused: false,
	draft: "",
	attachments: 0,
	dictation: false,
	stop: false,
	error: false,
	keyboard: false,
	inset: 34,
	scale: 1,
};
describe("build389 uniform dock", () => {
	it("keeps home-indicator clearance outside the idle capsule", () => {
		expect(composerPresentation(empty)).toEqual({
			expanded: false,
			height: 56,
			radius: 28,
			gap: 42,
			side: 12,
		});
	});
	it("expands for each retained editing state, including whitespace", () => {
		for (const delta of [
			{ focused: true },
			{ draft: " " },
			{ attachments: 1 },
			{ dictation: true },
			{ stop: true },
			{ error: true },
		]) {
			expect(composerPresentation({ ...empty, ...delta })).toMatchObject({
				expanded: true,
				height: 112,
				radius: 24,
			});
		}
	});
	it("pays no second safe inset above the keyboard", () => {
		expect(composerPresentation({ ...empty, keyboard: true })).toMatchObject({
			gap: 8,
		});
		expect(keyboardOverlap(500, 500)).toBe(0);
		expect(keyboardOverlap(844, 500)).toBe(344);
	});
	it("grows idle capsule with text rather than clipping scaled targets", () => {
		const p = composerPresentation({ ...empty, scale: 2 });
		expect(p.height).toBeGreaterThan(56);
		expect(p.radius).toBe(p.height / 2);
	});

	/* PAINTED heights, not class names: the dock's own padding plus the field's
	 * painted box plus the expanded controls row and its gap must add up to the
	 * record's 56 / 112. A web `<textarea>` is content-box, which is how the
	 * first build measured 60 / 116 — the +4 came from the field's padding, so
	 * the arithmetic below is what the regression watches. */
	it("sums to the record's 56 and 112 from the parts the shell actually paints", () => {
		expect(COMPOSER_FIELD_BOX).toBe(44);
		const rest = composerShellPadding(false);
		const expanded = composerShellPadding(true);
		/* H5: one `space.1` step at rest, balanced against the 48 pt row. */
		expect(rest).toEqual({ top: COMPOSER_REST_PAD, bottom: COMPOSER_REST_PAD });
		expect(COMPOSER_REST_PAD % 4).toBe(0);
		expect(rest.top + COMPOSER_REST_ROW + rest.bottom).toBe(56);
		expect(expanded).toEqual({ top: 12, bottom: 8 });
		expect(composerPaintedHeight(false)).toBe(56);
		expect(composerPaintedHeight(true)).toBe(112);
		/* The web/Android floor is 48. The OPEN card follows it (120 there); the
		 *  resting pill no longer does — the 48 pt row is the resting ruler on every
		 *  platform, so the pill is 56 everywhere (H5). */
		expect(composerPaintedHeight(false, 48)).toBe(56);
		expect(composerPaintedHeight(true, 48)).toBe(120);
		expect(
			expanded.top +
				COMPOSER_FIELD_BOX +
				COMPOSER_CONTROLS_GAP +
				COMPOSER_FIELD_BOX +
				expanded.bottom,
		).toBe(112);
		// The shape follows the PAINTED pill on the floor it is given: 44 gives the
		// record's 56/28, and the 48 floor the composer actually paints on gives
		// 60/30 — reporting 28 over a 30 pt paint was a second source of truth
		// (round 7, R7-4). Both floors are asserted, so neither can drift alone.
		expect(composerPresentation({ ...empty, floor: 44 }).height).toBe(56);
		expect(composerPresentation({ ...empty, floor: 44 }).radius).toBe(28);
		expect(
			composerPresentation({ ...empty, focused: true, floor: 44 }).height,
		).toBe(112);
		expect(
			composerPresentation({ ...empty, focused: true, floor: 44 }).radius,
		).toBe(24);
		expect(composerPresentation({ ...empty, floor: 48 }).height).toBe(56);
		expect(composerPresentation({ ...empty, floor: 48 }).radius).toBe(28);
	});
});

describe("round 7 — the seed is a decision, not an expression", () => {
	it("seeds the collapsed end whenever the card is not expanded", () => {
		expect(seedFor(false, 60)).toEqual({ kind: "collapsed", total: 60 });
		expect(seedFor(true, 120)).toEqual({ kind: "expanded", total: 120 });
	});

	it("has no second condition that could skip a layout", () => {
		// The regression this replaces: a `!compactSingle` guard left short
		// landscape unmeasured while the seeded floor stayed in place.
		const source = read("src/features/session/components/composer.tsx");
		const call = source.slice(
			source.indexOf("const seed = seedFor("),
			source.indexOf("const seed = seedFor(") + 200,
		);
		expect(call).toContain("presentation.expanded");
		expect(call).not.toContain("compactSingle");
	});
});

describe("round 8 — one radius for the two edges the shell paints", () => {
	/* The shell's fill and the 1 px ring over it are concentric, so they read ONE
	 *  helper. Asserted as values at both floors rather than only as a grep,
	 *  because the defect a copy would cause is visible: a ring on its own curve
	 *  shows as a second corner outside the first. */
	it("travels from the padded pill to the expanded card, on both floors", () => {
		expect(composerShellRadius(0, 56)).toBe(28);
		expect(composerShellRadius(1, 56)).toBe(24);
		expect(composerShellRadius(0, 60)).toBe(30);
		expect(composerShellRadius(1, 60)).toBe(24);
	});

	it("is the same motion the radius already had, mid-flight included", () => {
		expect(composerShellRadius(0.5, 60)).toBe(27);
		/* Clamped past the ends, like the morph itself: progress is a shared value,
		 *  and a frame at 1.0001 must not paint a corner outside the box. */
		expect(composerShellRadius(2, 60)).toBe(24);
		expect(composerShellRadius(-1, 60)).toBe(30);
	});

	it("leaves the painted heights and the pill radius untouched", () => {
		expect(composerPaintedHeight(false)).toBe(56);
		expect(composerPaintedHeight(true)).toBe(112);
		expect(composerPaintedHeight(false, 48)).toBe(56);
		expect(composerPaintedHeight(true, 48)).toBe(120);
		expect(morphPillRadius(56)).toBe(28);
	});
});

/* Review R1: the resting row is 48 on every floor, so its alignment decides
 * where a 44 pt iOS control lands. Bottom alignment painted it 8 pt from the
 * shell's top and 4 pt from its bottom; centred, the slack splits evenly. */
describe("H5 resting row alignment, per platform floor", () => {
	const COMPOSER = read("src/features/session/components/composer.tsx");
	it("centres the resting row and keeps the open field row bottom-aligned", () => {
		expect(composerFieldRowAlign(false)).toBe("items-center");
		expect(composerFieldRowAlign(true)).toBe("items-end");
		/* The component reads THIS decision, not a literal class beside it. */
		expect(COMPOSER).toContain("composerFieldRowAlign(presentation.expanded)");
		expect(COMPOSER).not.toContain('className="flex-row items-end"');
	});
	it("paints a resting control equidistant from both shell edges", () => {
		/* iOS: 44 pt discs in the 48 pt row, 4 + 2 = 6 on both edges. */
		expect(composerRestInsets(44)).toEqual({ top: 6, bottom: 6 });
		/* Web/Android: the 48 pt floor fills the row, 4 on both edges. */
		expect(composerRestInsets(48)).toEqual({ top: 4, bottom: 4 });
		for (const floor of [44, 48]) {
			const inset = composerRestInsets(floor);
			expect(inset.top + floor + inset.bottom).toBe(
				composerPaintedHeight(false, floor),
			);
		}
	});
});

/* Review R2 / design D5a: the glass layer sits inside the shell's animated
 * clip, so its radius must never exceed the clip's at any point of the morph,
 * on any measured base the pill can take. */
describe("shell glass layer radius", () => {
	it("never exceeds the shell's live radius", () => {
		for (const base of [56, 60, 72, 96, 120]) {
			for (let step = 0; step <= 20; step += 1) {
				expect(COMPOSER_GLASS_LAYER_RADIUS).toBeLessThanOrEqual(
					composerShellRadius(step / 20, base),
				);
			}
		}
		const COMPOSER = read("src/features/session/components/composer.tsx");
		expect(COMPOSER).toContain("top: COMPOSER_GLASS_LAYER_RADIUS");
		expect(COMPOSER).toContain("bottom: COMPOSER_GLASS_LAYER_RADIUS");
		expect(COMPOSER).not.toContain("top: presentation.radius");
	});
});

describe("the dock rests as the card (visual audit D1/D5)", () => {
	it("is the two-row card with nothing typed, at the card's own height and radius", () => {
		const card = composerPresentation({ ...empty, card: true });
		expect(card.expanded).toBe(true);
		expect(card.height).toBe(composerPaintedHeight(true));
		expect(card.radius).toBe(24);
		/* The clearance below is a device fact, not a presentation one. */
		expect(card.gap).toBe(composerPresentation(empty).gap);
	});

	it("changes nothing for a caller that does not ask for it", () => {
		expect(composerPresentation({ ...empty, card: false })).toEqual(
			composerPresentation(empty),
		);
		expect(composerPresentation(empty).expanded).toBe(false);
	});
});

describe("the controls row's trailing slot (UX U2 / U7, design D2)", () => {
	const at = (
		openForDictationOnly: boolean,
		recording: boolean,
		micShown = true,
	) => controlsTrailing({ openForDictationOnly, recording, micShown });

	it("keeps Stop/Send whenever the card is open for its own reasons", () => {
		expect(at(false, false)).toBe("actions");
		expect(at(false, true)).toBe("actions");
	});

	it("keeps the mic under the finger that opened the card (U2, and D6's failed start)", () => {
		expect(at(true, false)).toBe("mic");
	});

	it("puts ✓ there while recording rather than a disabled Send (U7)", () => {
		expect(at(true, true)).toBe("finish");
	});

	it("falls back to Stop/Send when no mic renders at all", () => {
		expect(at(true, false, false)).toBe("actions");
		expect(at(true, true, false)).toBe("actions");
	});

	it("moves ✓ rather than copying it: one finish control (D2)", () => {
		const COMPOSER = read("src/features/session/components/composer.tsx");
		expect(COMPOSER).toContain(
			'voice.phase === "recording" && finishOnRow ? dictationFinish : null',
		);
		expect(COMPOSER).toContain('dictationControls(trailing !== "finish")');
		expect(
			COMPOSER.match(/testID=\{CONTROL\.composerDictationFinish\}/g),
		).toHaveLength(1);
	});
});

/* SCROLL COMPACTION (design spec 2026-11-23). Every assertion above is untouched:
 *  `shrunk` is an extra fact that is absent for Home and every earlier caller. */
describe("scroll-compacted pill", () => {
	const shrunk = { ...empty, shrunk: true };

	it("is the 56 pt pill with the card's content facts that do NOT pin", () => {
		/* A draft of any length (whitespace included), a running turn and the
		 *  portrait `card: true` all force the card today; shrunk, they do not. */
		for (const delta of [
			{},
			{ card: true },
			{ draft: "a" },
			{ draft: " " },
			{ draft: "line one\nline two\nline three" },
			{ stop: true },
			{ draft: "x", stop: true, card: true },
		]) {
			expect(composerPresentation({ ...shrunk, ...delta })).toMatchObject({
				expanded: false,
				height: 56,
				radius: 28,
			});
		}
	});

	it("keeps the card under every pin, scrolled or not", () => {
		for (const delta of [
			{ focused: true },
			{ keyboard: true },
			{ attachments: 1 },
			{ dictation: true },
			{ error: true },
			{ skillTray: true },
			{ slashSheet: true },
		]) {
			expect(composerPinsCard({ ...empty, ...delta })).toBe(true);
			/* A pin only withdraws the shrink; the rest is today's rule. Portrait
			 *  rests as the card (`card: true`), so a pinned portrait dock is it. */
			expect(
				composerPresentation({ ...shrunk, ...delta, card: true }),
			).toMatchObject({ expanded: true, height: 112, radius: 24 });
			expect(composerPresentation({ ...shrunk, ...delta }).expanded).toBe(
				composerPresentation({ ...empty, ...delta }).expanded,
			);
		}
	});

	it("names a draft and Stop as NOT pins (operator, 2026-11-23)", () => {
		expect(composerPinsCard(empty)).toBe(false);
		expect(
			composerPinsCard({ ...empty, draft: "hello", stop: true } as never),
		).toBe(false);
	});

	it("is a no-op when not shrunk: the card forcing facts still expand it", () => {
		for (const shrunkFact of [undefined, false]) {
			for (const delta of [{ card: true }, { draft: "a" }, { stop: true }]) {
				expect(
					composerPresentation({ ...empty, shrunk: shrunkFact, ...delta })
						.expanded,
				).toBe(true);
			}
			expect(
				composerPresentation({ ...empty, shrunk: shrunkFact }).expanded,
			).toBe(false);
		}
	});

	it("does not let the tray or slash sheet change a dock that is not shrunk", () => {
		/* They pin only; Home and the unscrolled composer expand on the same facts
		 *  as before. */
		expect(composerPresentation({ ...empty, skillTray: true }).expanded).toBe(
			false,
		);
		expect(composerPresentation({ ...empty, slashSheet: true }).expanded).toBe(
			false,
		);
	});

	it("grows with text like any pill rather than clipping scaled targets", () => {
		const p = composerPresentation({ ...shrunk, scale: 2 });
		expect(p.height).toBeGreaterThan(56);
		expect(p.radius).toBe(p.height / 2);
	});

	it("insets the pill further than the card, and morphs in 220 ms", () => {
		expect(COMPOSER_CARD_MARGIN).toBe(12);
		expect(COMPOSER_PILL_MARGIN).toBe(16);
		expect(COMPOSER_PILL_MARGIN).toBeGreaterThan(COMPOSER_CARD_MARGIN);
		expect(COMPOSER_MORPH_MS).toBe(220);
		expect(COMPOSER_MORPH_EASING).toBe("cubic-bezier(0.2, 0, 0, 1)");
	});

	it("keeps the helpers a worklet may call free of the new non-worklet one", () => {
		/* `composerPinsCard` is render-time only. If it were reachable from a
		 *  `useAnimatedStyle` body it would need "worklet" (composer-worklets.test). */
		const component = read("src/features/session/components/composer.tsx");
		const worklets = component.slice(component.indexOf("const shellMotion"));
		const dock = worklets.slice(0, worklets.indexOf("const dangerInk"));
		expect(dock).not.toContain("composerPinsCard");
		expect(dock).not.toContain("composerPresentation(");
	});
});

/* PR #384 review round 1 + web frames. */
describe("the dock's animated margins (W2)", () => {
	it("animate marginLeft/marginRight, never the marginHorizontal shorthand", () => {
		/* Reanimated's web driver writes the style onto the element; the shorthand
		 *  is no CSS property, so only the first render's 12 ever painted. */
		const style = dockMotionStyle(0, 0, COMPOSER_PILL_MARGIN);
		expect(Object.keys(style).sort()).toEqual([
			"marginBottom",
			"marginLeft",
			"marginRight",
		]);
		expect(style).not.toHaveProperty("marginHorizontal");
	});

	it("runs 16 -> 12 off progress, both sides equal, and carries the keyboard lift", () => {
		expect(dockMotionStyle(0, 0, 16)).toEqual({
			marginBottom: 8,
			marginLeft: 16,
			marginRight: 16,
		});
		expect(dockMotionStyle(1, 0, 16)).toMatchObject({
			marginLeft: 12,
			marginRight: 12,
		});
		expect(dockMotionStyle(0.5, 0, 16)).toMatchObject({ marginLeft: 14 });
		expect(dockMotionStyle(0, 300, 16).marginBottom).toBe(308);
		/* Short landscape's pill is its resting form: it keeps the card's 12. */
		expect(dockMotionStyle(0, 0, COMPOSER_CARD_MARGIN)).toMatchObject({
			marginLeft: 12,
		});
	});

	it("is what the dock paints, and the shorthand is gone from it", () => {
		const component = read("src/features/session/components/composer.tsx");
		expect(component).toContain("dockMotionStyle(");
		expect(component).not.toContain("marginHorizontal: morphHeight");
	});
});

describe("the pill's row holds the line at large text (W3)", () => {
	it("is the 48 resting row at 100 % on both floors", () => {
		expect(composerPillRow(44, 1)).toBe(48);
		expect(composerPillRow(48, 1)).toBe(48);
	});

	it("paints exactly what composerPresentation announces, at every scale", () => {
		for (const floor of [44, 48]) {
			for (const scale of [1, 1.15, 1.3, 1.5, 2, 3]) {
				const row = composerPillRow(floor, scale);
				const painted =
					composerShellPadding(false).top +
					row +
					composerShellPadding(false).bottom;
				expect(painted, `floor ${floor} scale ${scale}`).toBe(
					composerPresentation({ ...empty, shrunk: true, floor, scale }).height,
				);
				/* The line (24 x scale) plus the field's 8 pt of padding above and
				 *  below always fits: the glyphs are never cut at the bottom edge. */
				expect(row).toBeGreaterThanOrEqual(24 * scale + 16);
			}
		}
	});

	it("is 64 at 200 %, so the pill is 72 (was 56 with the glyphs cut)", () => {
		expect(composerPillRow(48, 2)).toBe(64);
		expect(
			composerPresentation({ ...empty, shrunk: true, scale: 2 }).height,
		).toBe(72);
	});
});

describe("the pill shows Send only for a draft with something in it (R6)", () => {
	it("hides the dead disc for empty and whitespace-only drafts", () => {
		for (const draft of ["", " ", "     ", "\n\t \n"])
			expect(pillShowsSend(draft), JSON.stringify(draft)).toBe(false);
	});

	it("shows it for any other draft", () => {
		for (const draft of ["a", " a ", "line one\nline two"])
			expect(pillShowsSend(draft)).toBe(true);
	});

	it("leaves whitespace a draft for the presentation: nothing is normalised", () => {
		expect(composerPresentation({ ...empty, draft: "   " }).expanded).toBe(
			true,
		);
		expect(
			composerPresentation({ ...empty, draft: "   ", shrunk: true }).expanded,
		).toBe(false);
	});
});

describe("a take that starts from the pill drops the dead Send (R2)", () => {
	it("drops it only for a dictation-only card that began on the pill", () => {
		expect(
			dictationDropsSend({ openForDictationOnly: true, startedFromPill: true }),
		).toBe(true);
	});

	it("keeps the card's own layout when the take began on the card (U2/U7 stay true)", () => {
		expect(
			dictationDropsSend({
				openForDictationOnly: true,
				startedFromPill: false,
			}),
		).toBe(false);
	});

	it("never drops it for a card open for its own reasons", () => {
		for (const startedFromPill of [true, false])
			expect(
				dictationDropsSend({ openForDictationOnly: false, startedFromPill }),
			).toBe(false);
	});

	it("leaves the trailing-slot rule alone: mic or finish, in the slot Send vacates", () => {
		expect(
			controlsTrailing({
				openForDictationOnly: true,
				recording: false,
				micShown: true,
			}),
		).toBe("mic");
		expect(
			controlsTrailing({
				openForDictationOnly: true,
				recording: true,
				micShown: true,
			}),
		).toBe("finish");
	});

	it("is wired: the mic press records where it began and the card arm honours it", () => {
		const component = read("src/features/session/components/composer.tsx");
		expect(component).toContain("onPress={pressMic}");
		expect(component).toContain("dropSendForDictation ? null : actionCluster");
	});
});

describe("a blank draft and the dictation card (R2-2)", () => {
	/* The facts of a shrunk dock whose mic was just pressed, so a take is live. */
	const taking = { ...empty, dictation: true, shrunk: true };

	it("reads a whitespace-only draft as no draft when asked, and only then", () => {
		for (const draft of [" ", "\n\t \n"]) {
			expect(openOnlyForDictation({ ...taking, draft })).toBe(false);
			expect(
				openOnlyForDictation({ ...taking, draft }, { blankIsEmpty: true }),
			).toBe(true);
		}
	});

	it("an empty draft is dictation-only either way", () => {
		expect(openOnlyForDictation(taking)).toBe(true);
		expect(openOnlyForDictation(taking, { blankIsEmpty: true })).toBe(true);
	});

	it("a real draft, Stop, an attachment, focus and an error keep the card their own", () => {
		for (const delta of [
			{ draft: "hi" },
			{ draft: " hi " },
			{ stop: true },
			{ attachments: 1 },
			{ focused: true },
			{ error: true },
		])
			expect(
				openOnlyForDictation({ ...taking, ...delta }, { blankIsEmpty: true }),
				JSON.stringify(delta),
			).toBe(false);
	});

	it("Stop beside a blank draft keeps the action cluster: the Stop disc must not vanish", () => {
		const facts = { ...taking, draft: " ", stop: true };
		expect(
			dictationDropsSend({
				openForDictationOnly: openOnlyForDictation(facts, {
					blankIsEmpty: true,
				}),
				startedFromPill: true,
			}),
		).toBe(false);
	});

	it("a take that began on the pill beside a blank draft drops the dead Send, so the mic does not slide", () => {
		const open = openOnlyForDictation(
			{ ...taking, draft: " " },
			{ blankIsEmpty: true },
		);
		expect(
			dictationDropsSend({ openForDictationOnly: open, startedFromPill: true }),
		).toBe(true);
		expect(
			dictationDropsSend({
				openForDictationOnly: open,
				startedFromPill: false,
			}),
		).toBe(false);
	});

	it("ends with the take: a card left open by a blank draft alone keeps its layout", () => {
		expect(
			openOnlyForDictation(
				{ ...empty, draft: " ", dictation: false },
				{ blankIsEmpty: true },
			),
		).toBe(false);
	});

	it("does not read a ref during render (R2-4)", () => {
		const component = read("src/features/session/components/composer.tsx");
		expect(component).not.toContain("dictationFromPill.current");
		expect(component).toContain("setDictationFromPill(");
	});
});

describe("the pill's first-line cue (D1/U1)", () => {
	it("shows a trailing ellipsis when text follows a line break", () => {
		for (const draft of [
			"first\nsecond",
			"first\r\nsecond",
			"first\n\nsecond",
			"\nonly the second",
			"first\n  second  ",
		])
			expect(pillShowsEllipsis(draft), JSON.stringify(draft)).toBe(true);
	});

	it("does not, for one line, however long, or a draft that only ends in whitespace", () => {
		for (const draft of [
			"",
			"one line",
			"one line ",
			"one line\n",
			"one line\n\n  \t",
			"x".repeat(500),
		])
			expect(pillShowsEllipsis(draft), JSON.stringify(draft)).toBe(false);
	});

	it("does not, for a blank draft: it has no first line to be cut after", () => {
		for (const draft of [" ", "\n", "\n \n\t"])
			expect(pillShowsEllipsis(draft), JSON.stringify(draft)).toBe(false);
	});

	it("keeps clear room for the glyph, and reads ink-dim at 3:1 on the pill fill in every theme", () => {
		expect(PILL_ELLIPSIS_CUE_PT).toBe(16);
		const channel = (hex: string, at: number) => {
			const c = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
			return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
		};
		const luminance = (hex: string) =>
			0.2126 * channel(hex.replace("#", ""), 0) +
			0.7152 * channel(hex.replace("#", ""), 2) +
			0.0722 * channel(hex.replace("#", ""), 4);
		for (const theme of ["light", "dark"] as const) {
			const [hi, lo] = [
				luminance(PALETTE[theme]["ink-dim"]),
				luminance(PALETTE[theme].elevated),
			].sort((a, b) => b - a) as [number, number];
			expect((hi + 0.05) / (lo + 0.05), theme).toBeGreaterThanOrEqual(3);
		}
	});

	it("is wired: painted over the one field, out of the tap and accessibility paths", () => {
		const component = read("src/features/session/components/composer.tsx");
		const cue = component.slice(
			component.indexOf("{pillCue ? ("),
			component.indexOf("{pillBlank ? ("),
		);
		expect(cue).toContain("aria-hidden");
		expect(cue).toContain('pointerEvents="none"');
		expect(cue).toContain("\\u2026");
		/* One mounted field: the cue is a sibling, never a second Textarea. */
		expect(component.split("<Textarea").length - 1).toBe(1);
	});
});

describe("a blank draft in the pill shows the placeholder (D5)", () => {
	it("is a whitespace-only, non-empty draft", () => {
		for (const draft of [" ", "   ", "\n", "\t \n "])
			expect(pillShowsPlaceholder(draft), JSON.stringify(draft)).toBe(true);
		for (const draft of ["", "a", " a ", "\n a"])
			expect(pillShowsPlaceholder(draft), JSON.stringify(draft)).toBe(false);
	});

	it("never overlaps the ellipsis cue", () => {
		for (const draft of ["", " ", "\n", "a", "a\nb", " \n "])
			expect(
				pillShowsPlaceholder(draft) && pillShowsEllipsis(draft),
				JSON.stringify(draft),
			).toBe(false);
	});

	it("is wired over the field with the field's own value untouched", () => {
		const component = read("src/features/session/components/composer.tsx");
		const blank = component.slice(
			component.indexOf("{pillBlank ? ("),
			component.indexOf("THE PILL'S TAP TARGET"),
		);
		expect(blank).toContain("aria-hidden");
		expect(blank).toContain('pointerEvents="none"');
		expect(blank).toContain("composerCopy().placeholder");
		expect(component).toContain("value={draft}");
	});
});

describe("the field's selection while the pill stands (R3)", () => {
	it("holds the caret at the start so the first line is the one in view", () => {
		expect(
			fieldSelectionOverride({ shrunkPill: true, restoreCaretAt: null }),
		).toEqual({ start: 0, end: 0 });
		/* The pill wins over a pending restore: the restore is for the render that
		 *  focuses the field, by which time the pill is gone. */
		expect(
			fieldSelectionOverride({ shrunkPill: true, restoreCaretAt: 9 }),
		).toEqual({ start: 0, end: 0 });
	});

	it("puts the caret at the end of the draft for the tap that opens the card", () => {
		expect(
			fieldSelectionOverride({ shrunkPill: false, restoreCaretAt: 42 }),
		).toEqual({ start: 42, end: 42 });
		expect(
			fieldSelectionOverride({ shrunkPill: false, restoreCaretAt: 0 }),
		).toEqual({ start: 0, end: 0 });
	});

	it("forces nothing otherwise: the skills tray's one-shot is untouched", () => {
		expect(
			fieldSelectionOverride({ shrunkPill: false, restoreCaretAt: null }),
		).toBeNull();
	});

	it("keeps ONE mounted field with a tap catcher beside it, and never alters value", () => {
		const component = read("src/features/session/components/composer.tsx");
		expect(component.split("<Textarea").length - 1).toBe(1);
		expect(component).toContain("singleLine={shrunkPill}");
		/* The skills pass-through stays the default; the override spreads after it. */
		expect(component).toMatch(
			/onSelectionChange=\{skills\?\.onSelectionChange\}\s*selection=\{skills\?\.selection\}/,
		);
		expect(component).toContain("selection: selectionOverride");
		expect(component).toContain("CONTROL.composerPillField");
		expect(component).toContain("value={draft}");
	});
});
