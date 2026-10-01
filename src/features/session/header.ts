import { MIN_HEADER_NAME_CHARS } from "@/features/session/projection";
import { maxColumnWidth, type Viewport } from "@/ui/column";

/**
 * How many characters of the conversation name the session header can actually
 * show, so the truncation keeps BOTH ends instead of letting CSS eat the tail.
 *
 * `middleTruncate(title, 40)` was the rule this screen shipped with, and it never
 * ran for any real name: 40 characters is wider than a phone's header row, so a
 * 25-character name was handed to the layout whole and the platform clipped its
 * END — `Refactor th…` at 390 pt, `Refact…` at 320 (design round 1, D2). The
 * distinguishing part of a session name is its tail, which is exactly what an end
 * clip removes, so the budget has to come from the space the header really has.
 *
 * The row is `Screen`'s: `h-14 px-4 gap-2` with the leading control and the
 * title's siblings. Measured in installed headless Chrome at 320 pt (the narrowest
 * device the kit names), the h1's box was exactly `width − 32 − 44 − 8 − 127`: the
 * 16 pt gutters, the 44 pt back control, the row's 8 pt gap, and a 127 pt status
 * chip that used to sit beside it. The chip has moved into the status strip (D8),
 * so only the chrome above remains — and this module's whole job is to not be the
 * thing that yields to a status chip again.
 */
const HEADER_CHROME_PT = 32 + 44 + 8;

/**
 * **Calibrated at 100 % text, and the 2× case is a known, deferred residue.**
 *
 * On this head the type ramp is px-based while spacing and control sizes are
 * rem-derived, so scaling the environment's root font to 32 px leaves every text
 * run the same height while the header's own chrome (the `px-4` gutters, the 44 pt
 * leading control) DOUBLES. Both terms above are then wrong in the generous
 * direction: the chrome is bigger than the constant says and the advance is
 * unchanged, so a 2× render can clip a name this budget thought would fit. It is
 * not fixed here because it is the same defect as the design lane's D1 — the type
 * layer is #11's (`scaledTextVariables`), and re-cutting it in this stream would
 * collide with that work.
 *
 * What the post-#11 head needs, so this is a re-derivation rather than a
 * rediscovery: a scale factor on BOTH terms — the chrome by the root font
 * (`rem`), the advance by the same factor once the type ramp is in rem — with
 * `PixelRatio.getFontScale()` as the native half, where the chrome is pt-based and
 * only the ADVANCE scales.
 *
 * On the WEB build the root font is the only signal for the chrome term, and
 * `PixelRatio.getFontScale()` cannot stand in for it: react-native-web 0.21.3
 * hard-codes `fontScale: 1` in `Dimensions`, so its `getFontScale()` returns the
 * constant 1 whatever the environment's text scale is (`1 || pixelRatio` — the
 * fallback never runs). A constant is not a signal. An earlier revision of this
 * comment said it returns the DEVICE pixel ratio (3 on a 3× display) and would
 * "divide this budget by three"; that was wrong, and it is corrected here rather
 * than dropped because the conclusion it supported still holds (review round 4,
 * R4).
 */

/**
 * The display step's advance in px per character, at 600 weight / 28 px — the
 * WIDEST per-character average measured across prose sample names in installed
 * headless Chrome at the shipped font: `13.34 / 12.26 / 13.14 / **14.06**` px per
 * character for four samples, with whole-string natural widths of 358 px for 28
 * characters and 307 px for 25. The value is the widest sample itself, not a
 * rounded-down neighbour: an earlier revision said "14" and called it the widest,
 * which was simply false (review round 4, R6), and the safety margin this divisor
 * is supposed to buy comes from being the maximum, not from the `floor` applied
 * after it.
 *
 * **What this does not cover, stated rather than implied:** the samples are Latin
 * prose. A name of wide glyphs — CJK (roughly 2× the Latin advance) or a run of
 * `W`s — exceeds this estimate, so its budget is generous and the platform's own
 * ellipsis trims the end. It never overflows the row, and the floor still holds,
 * so the failure mode is D2 for those names only (measured and accepted by QA
 * round 4 Q2). Covering them needs a real text measurement, which the web build
 * cannot give this component without a canvas.
 */
export const DISPLAY_ADVANCE_PT = 14.06;

/**
 * The character budget for a viewport.
 *
 * The measure cap matters as much as the width: a 1366 pt tablet renders this
 * screen in a 640 pt column (`src/ui/column.ts`), and the header row is inside it,
 * so a budget computed from the viewport alone would promise ~90 characters and
 * clip at 30.
 *
 * The floor is the kit's own: `components.md` § F-6.1 owes at least
 * `MIN_HEADER_NAME_CHARS` characters so both ends of a name survive, so a budget
 * computed below it is raised to it rather than to zero.
 */
export const headerTitleChars = ({ width, height }: Viewport): number => {
	const row = Math.min(width, maxColumnWidth({ width, height }) ?? width);
	const available = row - HEADER_CHROME_PT;
	return Math.max(
		MIN_HEADER_NAME_CHARS,
		Math.floor(available / DISPLAY_ADVANCE_PT),
	);
};
