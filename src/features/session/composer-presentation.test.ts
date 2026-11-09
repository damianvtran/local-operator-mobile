import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	COMPOSER_CONTROLS_GAP,
	COMPOSER_FIELD_BOX,
	COMPOSER_GLASS_LAYER_RADIUS,
	COMPOSER_REST_PAD,
	COMPOSER_REST_ROW,
	composerFieldRowAlign,
	composerPaintedHeight,
	composerPresentation,
	composerRestInsets,
	composerShellPadding,
	composerShellRadius,
	controlsTrailing,
	keyboardOverlap,
	morphPillRadius,
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
