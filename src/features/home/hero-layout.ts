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
 *  - The result is floored to the 4 pt `space.scale` — it is applied as a
 *    padding, and U-42 reads an off-scale padding as a defect. Flooring moves
 *    the block up by at most 3 pt, inside the spec's ±8 pt centring tolerance,
 *    and never past the bottom clamp.
 */

/** `space.6`: the hero's minimum distance from either end of the band. */
export const HERO_EDGE = 24;
/** The spec's optical correction: a geometrically centred block reads low. */
export const HERO_OPTICAL_NUDGE = 8;
/** The `space.scale` step the padding is floored to (U-42). */
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
