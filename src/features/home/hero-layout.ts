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

/** The gap between the work list's last row and the composer stack's top. */
export const WORK_LIST_GAP = 12;

/**
 * The least layout gap between the hero block and the work list's top, kept
 * even when the band is too short for both and the region scrolls (design D4:
 * at 200 % text the greeting sat 8 pt above the first section header and read
 * as part of the list). The splash's flexible spacer carries it as a
 * `minHeight`; with room to spare the spacer grows past it, as before.
 */
export const HERO_LIST_MIN_GAP = 16;

/**
 * The hero's top inset when a work list sits at the band's bottom.
 *
 * The hero centres in the space the list LEAVES: the band less the list and its
 * gap, run through the same rule as `heroTopInset` (4 pt grid, −8 pt nudge,
 * 24 pt minimum, fall back to the top anchor when the space cannot hold the
 * block). No list (`listHeight` 0, unmeasured or absent) is exactly
 * `heroTopInset`, so a band without a list is laid out as it always was.
 */
export const heroTopInsetAbove = (
	band: number,
	block: number,
	listHeight: number,
): number =>
	listHeight > 0
		? heroTopInset(band - listHeight - WORK_LIST_GAP, block)
		: heroTopInset(band, block);

/** What the splash gives up, in order, before its region scrolls. */
export type WorkListYield = 0 | 1 | 2;

/**
 * Which pieces give way when the band cannot hold hero + list (spec: the mark
 * first, then the running/recent rows beyond the first, then the region
 * scrolls). All inputs are NATURAL heights — hero with its mark, list with every
 * row — so the answer cannot oscillate: hiding the mark does not change what is
 * compared next frame.
 *
 *  - `0` everything fits with the 24 pt edges the hero keeps;
 *  - `1` it fits once the mark (`mark` pt, its margin included) is hidden;
 *  - `2` it does not: the mark is hidden and the list is trimmed to its needs-you
 *    rows plus one more; whatever still overflows scrolls.
 *
 * Unmeasured (a 0) answers `0`, like `heroTopInset`'s top anchor.
 */
export const workListYield = (input: {
	band: number;
	hero: number;
	mark: number;
	list: number;
}): WorkListYield => {
	const { band, hero, mark, list } = input;
	if (band <= 0 || hero <= 0 || list <= 0) return 0;
	const fits = (h: number) => band >= h + list + WORK_LIST_GAP + 2 * HERO_EDGE;
	if (fits(hero)) return 0;
	return fits(hero - mark) ? 1 : 2;
};

/**
 * The list's NATURAL height (the full list, no yield taken) from one layout.
 *
 * At levels 0 and 1 the list on screen IS the full list, so the measurement is
 * the answer. At level 2 the list is trimmed, and `full` — the last full-list
 * height measured at a lower level — stands in for it. Rebuilding it as
 * `measured + dropped rows * row height` missed the dropped rows' section
 * header (and any row that is taller than the first), so in a band about one
 * header tall level 2 estimated a list that fit, level 1 painted the full one
 * that did not, and the level flipped on every layout (review r1 #1). With no
 * full height known yet (the first layout landed already trimmed) the row-height
 * estimate is the fallback, never zero.
 */
export const listNaturalHeight = (input: {
	measured: number;
	level: WorkListYield;
	/** The last full-list height measured below level 2; 0 when unknown. */
	full: number;
	trimmable: number;
	rowHeight: number;
}): number => {
	const { measured, level, full, trimmable, rowHeight } = input;
	if (level < 2) return measured;
	return full > 0 ? full : measured + trimmable * rowHeight;
};

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

/** What the mark adds to the hero block's height: the disc, its 1 pt ring on
 *  both sides and the `space.4` (16 pt) margin under it. `workListYield` takes
 *  this off the block when the mark gives way. */
export const HERO_MARK_BLOCK = HERO_MARK_SIZE + 2 + 16;

/** The identity pill's largest mark, in pt: the spec's cap for marks beside
 *  scaled text (identity-picker D-S26). */
export const IDENTITY_PILL_MARK_CAP_PT = 28;

/**
 * The identity pill's leading mark and chevron for a text scale (PR #358 D5).
 *
 * WHY. They were fixed at 20 / 14 pt while the label grew with the reader's
 * text size, so at 200 % a 28 px label sat beside a 14 pt chevron — and the
 * chevron is the only sign the line opens something. An icon is geometry, not a
 * font, so it multiplies on every platform (`scaledMarkBox`'s rule), capped so
 * a mark never outgrows the label's line.
 */
export const identityPillMarks = (
	scale: number,
): Readonly<{ mark: number; chevron: number }> => ({
	mark: Math.min(IDENTITY_PILL_MARK_CAP_PT, Math.round(20 * scale)),
	chevron: Math.min(IDENTITY_PILL_MARK_CAP_PT, Math.round(14 * scale)),
});
