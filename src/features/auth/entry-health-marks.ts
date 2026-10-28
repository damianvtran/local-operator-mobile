/**
 * The visible mark each navigation entry point paints for the computer in use,
 * and the size it paints at — plus NOTHING else.
 *
 * WHY THIS IS A MODULE OF ITS OWN, WITH NO IMPORTS AT ALL. The frame audit
 * asserts U-03 over the REAL mark set (`tools/audit/checks.test.ts` — a status
 * may never be carried by colour alone), and the audit tooling is type-checked
 * by `tools/tsconfig.json`, which deliberately does not resolve the app's `@/`
 * alias. Every other tools→src import reaches an alias-free module for exactly
 * that reason. Keeping these marks in `computer-entry.ts` — which imports
 * `@/connection`, `@/relay`, … — broke CI's "Type-check the harness" with 9×
 * TS2307 BEFORE a single frame was audited, so the clearance it was supposed to
 * give was unverifiable rather than passing (QA round 2, Q6). This file imports
 * nothing, so the app and the harness can both read it.
 *
 * WHY SOME MARKS ARE TEXT AND SOME ARE DRAWN. The app ships the Latin subsets of
 * Figtree and JetBrains Mono; a codepoint outside them resolves to whatever face
 * the platform falls back to — a different weight beside Figtree text, and a tofu
 * box where nothing covers it. Measured against the cmaps of the shipped
 * `design/fonts/Figtree-Regular.ttf` and `-Medium.ttf` (392 codepoints each):
 *
 *     U+0021 !   present      U+2713 ✓   ABSENT
 *     U+2212 −   present      U+21AA ↪   ABSENT
 *     U+2026 …   present      U+2161 Ⅱ   ABSENT
 *
 * So the three the face does not cover are drawn here as paths, and the three it
 * does cover stay text — which is also the carrier U-03 reads directly as
 * `ownText`, and the shape the toast and banner already use. U+2161 was wrong
 * twice over: a Roman numeral is not a pause mark (design round 2, D10). D11's
 * "the punctuation marks look thinner than ✓" has the same cause — ✓ was the one
 * mark coming from a fallback face.
 */

/** The health kinds the switcher can report, restated here so this module needs
 *  no import. `computer-entry.test.ts` asserts the two lists are the same set, so
 *  a new kind in `computer-switcher-view.ts` cannot ship without a mark. */
export type EntryHealthKind =
	| "online"
	| "asleep"
	| "refused"
	| "sign-in"
	| "paused"
	| "checking";

/**
 * One visible, non-colour carrier for a status: a glyph the shipped face covers,
 * or a set of paths drawn in a square viewBox.
 *
 * The union is the point. A reader must be able to tell states apart without
 * hue (U-03), and either form does that; which form a given kind takes is a font
 * -coverage fact (see above), not a style choice, so it is data rather than a
 * component branch.
 */
export type EntryHealthMark =
	| { readonly form: "text"; readonly glyph: string }
	| { readonly form: "drawn"; readonly paths: readonly string[] };

/** The drawn marks' coordinate space, square so a mark stays centred in the
 *  12-wide slot the header reserves. */
export const MARK_VIEW_BOX = 12;

/** Stroke weight for the drawn marks, in viewBox units. Matching the text's
 *  apparent weight is the reason it is stated: at 1.6 units a path reads at the
 *  same density as the Figtree glyphs beside it (design D11). */
export const MARK_STROKE = 1.6;

/** The slot the mark occupies at 100 % text: `meta` type in a 12 × 16 box — the
 *  line box of the 12 pt step (`TYPE_STEPS.meta`), so the mark is optically
 *  centred against the name it precedes. */
export const MARK_BOX = { width: 12, height: 16 } as const;

export const ENTRY_HEALTH_MARK: Record<EntryHealthKind, EntryHealthMark> = {
	checking: { form: "text", glyph: "…" },
	online: {
		form: "drawn",
		paths: ["M2.5 6.3 L4.9 8.7 L9.5 3.3"],
	},
	asleep: { form: "text", glyph: "−" },
	refused: { form: "text", glyph: "!" },
	"sign-in": {
		form: "drawn",
		/* A door on the right and an arrow entering it: "sign in again" — the
		 *  arrow points INTO the door, which is what the reader has to do. */
		paths: [
			"M7.6 2.8 H9.7 V9.2 H7.6",
			"M2.4 6 H7.4",
			"M5.7 3.8 L7.9 6 L5.7 8.2",
		],
	},
	paused: {
		form: "drawn",
		/* Two bars, not U+2161. */
		paths: ["M4.4 3.2 V8.8", "M7.6 3.2 V8.8"],
	},
};

/**
 * A mark's font size in dp for a text scale — and why the caller passes the
 * platform rather than this module importing it.
 *
 * The two platforms apply the reader's text size by different mechanisms, and
 * doing both is a silent 4× at 200 %:
 *
 *  - **web**: an inline `fontSize` is a px number and the browser's root font
 *    size does not multiply it. Measured: the glyph stayed at 12 px while the
 *    name beside it doubled, so at 200 % the status mark was HALF the name's
 *    step rather than sharing it (design round 2, D9). It must be multiplied
 *    here.
 *  - **native**: React Native multiplies a `fontSize` by
 *    `PixelRatio.getFontScale()` itself — the same number `effectiveScale`
 *    reports — so multiplying again would square the setting.
 *
 * `isWeb` is a parameter, not a `Platform.OS` read, for the reason
 * `textUnit(isWeb, preference)` gives: this module has to stay importable and
 * testable outside the app, so the caller decides and the test states a target.
 */
export const scaledMarkSize = (
	base: number,
	scale: number,
	isWeb: boolean,
): number => (isWeb ? Math.round(base * scale) : base);

/**
 * A mark's SLOT in dp for a text scale — geometry, so it multiplies on BOTH
 * platforms.
 *
 * The asymmetry with `scaledMarkSize` is real and is the whole reason they are
 * two functions: a box never scales itself, so at 200 % a fixed 12 × 16 slot
 * beside a 24 pt name clips the mark on web and lets it collide with its
 * neighbour on native (design round 2, D9 — native unrendered, stated as such).
 * A drawn mark has no font at all, so its `Svg` dimensions are geometry too.
 */
export const scaledMarkBox = (base: number, scale: number): number =>
	Math.round(base * scale);
