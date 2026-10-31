/**
 * What the home header keeps when the text is large and the inbox is busy.
 *
 * WHY THIS EXISTS. The header's action row holds three controls — the computer
 * switcher, the bell with its count, and Settings — inside a 320 pt phone at
 * 200 % text. Before this module the switcher was the only one that could give
 * way: it carried `min-w-0 flex-1` and a `minHeight` floor, so with a `99+`
 * pill beside it the flex row shrank it to **36.4 pt** and the middle-fit
 * painted "…1" — below the 44 pt touch floor and naming nothing (design review
 * round 9, D24; the four E2E U-01 rows on `S15/move-progress` at 135/200 %).
 *
 * TWO RULES, and the second is what makes the first hold:
 *
 * 1. **The switcher keeps the floor on BOTH axes.** A minimum WIDTH alone is not
 *    enough on a 320 pt row — a floor with no room to honour it overflows the
 *    header instead of shrinking something else — so the control that yields is
 *    the one that can afford to.
 * 2. **The bell's count yields first, at large text.** The pill is an accessory
 *    to the bell: the bell itself is still the target, its accessible name still
 *    carries the count ("Notifications, 120 unread"), and the same number is on
 *    the rail's own row. Dropping the pill at and above 200 % returns ~55 pt to
 *    the switcher — the difference between "…1" and the "1…:47211" the header
 *    already paints at 100 % — while the control a reader taps never moves.
 *
 * THE THRESHOLD IS THE TYPE STEP, not a measured pixel: measurement arrives
 * after the first paint on native (`onLayout`), and a placement decided from it
 * can flash a 36 pt target for a frame. A scale-gated rule is decided before the
 * text is laid out, so there is no state to flash.
 *
 * The alternative the design round offered — an icon-only switcher — was
 * rejected: a bare monitor glyph does not tell a reader WHICH computer the next
 * message will run on, which `listLabel()`'s ladder exists to name.
 */

import { TOUCH_FLOOR } from "@/ui/layout";

/** The switcher's floor, in both axes. Re-exported rather than re-declared so a
 *  change to the platform floor reaches the header with everything else. */
export const HEADER_SWITCHER_FLOOR = TOUCH_FLOOR;

/** The type step at which the bell's pill stops being affordable. 200 % is the
 *  scale the failing cells are measured at; 135 % still fits both (the switcher
 *  keeps 65.5 pt beside a `5` and 58.2 pt beside `99+` at 100 %). */
export const COMPACT_BELL_SCALE = 2;

/** Whether the bell paints its count pill at this text scale. */
export const headerBellShowsCount = (scale: number): boolean =>
	scale < COMPACT_BELL_SCALE;

/**
 * Whether the bell paints the icon set's BELL-WITH-DOT rather than the plain
 * bell: the count pill has yielded (D24), and there is still something waiting.
 *
 * WHY A GLYPH AND NOT A MARKER. A small accent dot beside the bell was exactly
 * the "status carried by colour alone" the audit forbids (U-03, 96 of 1212 cells
 * on 5a64243..f8acc4c), and a U-03 exception is not an option. Swapping the
 * glyph says the same thing with SHAPE, in the control's normal ink, at the same
 * size — so no rule has anything to flag, and the exact number stays in the
 * control's accessible name and on the rail row. It also resolves the size
 * question: the variant is drawn at the plain bell's size and scales with the
 * type step like every other glyph (design round 11, D33).
 */
export const headerBellShowsDot = (
	scale: number,
	count: number | null,
): boolean => count !== null && count > 0 && !headerBellShowsCount(scale);
