/**
 * Where the home's hero (greeting + two actions) sits in the free band.
 *
 * WHY THIS EXISTS (operator, build 453: "The new conversation view seems not to
 * be properly centered and doesn't look very slick"; design spec §2). The hero
 * was top-anchored at 24 pt, leaving ~498 pt of nothing between it and the
 * composer on a 402 × 874 pt phone. It is now OPTICALLY centred in the band
 * between the header's bottom and the composer stack's top.
 *
 * THE BAND IS MEASURED TO THE STACK'S TOP, not to the composer: a folder or
 * model notice in the stack shortens the band by its own height and the hero
 * re-centres upward as a unit, while the composer never moves (spec §3).
 *
 * Constraints, all from the spec:
 *  - `top = (band − block) / 2 − 8`: the −8 pt is the optical nudge, because a
 *    block centred by geometry reads low.
 *  - Clamps: `top ≥ 24` (`space.6`) and the hero's bottom ≥ 24 pt above the
 *    stack. A band under `block + 48` cannot honour both, so the hero falls back
 *    to the 24 pt top anchor and its region scrolls (it already is a
 *    ScrollView). The composer never moves to make room.
 *  - The result is floored to the 4 pt base grid, so the hero lands on the
 *    same grid as the rows around it. Flooring moves the block up by at most
 *    3 pt, inside the spec's ±8 pt centring tolerance, and never past the
 *    bottom clamp. A 4 pt multiple is still not always a `space.scale` step
 *    (216, 208 and 156 are not). So the splash applies it as a spacer's
 *    HEIGHT, not a padding, and U-42 does not judge it as a spacing token
 *    (QA Q-R2-3).
 */

/** `space.6`: the hero's minimum distance from either end of the band. */
export const HERO_EDGE = 24;
/** The spec's optical correction: a geometrically centred block reads low. */
export const HERO_OPTICAL_NUDGE = 8;
/** The base grid the computed offset is floored to. */
const SCALE_STEP = 4;

/**
 * The hero's top padding inside its band, in pt.
 *
 * `band` is the region's height (header bottom → composer stack top); `block`
 * is the hero's own measured height. Either still unmeasured (0) answers the
 * top anchor, so the first frame paints where the fallback would.
 */
export const heroTopInset = (band: number, block: number): number => {
	if (band <= 0 || block <= 0) return HERO_EDGE;
	if (band < block + 2 * HERO_EDGE) return HERO_EDGE;
	const centred = (band - block) / 2 - HERO_OPTICAL_NUDGE;
	return Math.max(HERO_EDGE, Math.floor(centred / SCALE_STEP) * SCALE_STEP);
};

/**
 * Whether the hero may paint yet (review R4 / design D4). Until BOTH the band
 * and the block are measured, `heroTopInset` answers the 24 pt anchor, so a
 * visible first frame painted the greeting at the top and the settled frame
 * dropped it ~200 pt to centre on every mount. The block stays laid out (it
 * has to be, to be measured) but transparent until its place is known.
 */
export const heroMeasured = (band: number, block: number): boolean =>
	band > 0 && block > 0;

/**
 * The inset while the reader focuses an EMPTY composer (UX U1 / review R4).
 * The suggestion rows step away on focus, the block shrinks, and a re-centred
 * greeting would drop ~50 pt before a single key was typed. So the greeting
 * holds the inset it had at rest: never LOWER than `held`, but it still rises
 * with the live inset when the band itself shrinks (a keyboard, a notice),
 * because holding it there would push it under the composer stack.
 */
export const heroHeldInset = (live: number, held: number): number =>
	Math.min(live, held);

/**
 * The brand mark's size above the greeting, in pt (operator, TestFlight 578:
 * "make sure the local operator logo is in the center above the 'what would you
 * like to work on' text").
 *
 * 32 pt, the drawer's step, because it is the LARGEST the shipped asset can
 * paint crisply: `assets/brand/navigation-mark.png` is 128 × 128 px, i.e. 32 pt
 * at 3× (`native-interaction-guidelines.md` § Identity). A bigger hero mark
 * needs a bigger cut of the same asset first, never an upscale or a redraw.
 * The mark is part of the measured hero BLOCK (it sits inside the `onLayout`
 * view), so `heroTopInset` centres mark + greeting + rows as one unit and the
 * composer below is untouched.
 */
export const HERO_MARK_SIZE = 32;
