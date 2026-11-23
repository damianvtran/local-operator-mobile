/**
 * Two-size resize arithmetic for a `Sheet` with the opt-in `resizable` prop:
 * Medium and Large, the drag between them, and the size a release settles on.
 *
 * WHY THIS EXISTS (docs/design/components.md § 8 used to say "No drag gesture —
 * a drag handle with no drag is worse than no handle", and this file is the
 * other half of that sentence): the ask sheet's list is capped at the `content`
 * detent, so a long question plus its option cards and the Other field did not
 * fit and there was no way to make the surface taller. The reader can now drag
 * the header between two sizes. Resize only: a downward fling must never close
 * the sheet, because closing discards a typed answer (ADR 0005 § 2).
 *
 * Plain module, no `react-native` import, so the arithmetic is unit-tested in
 * Node (`vitest.config.ts`) — the same shape as `sheet-keyboard.ts`. `sheet.tsx`
 * owns the gesture and the animation; every number the spec fixes lives here.
 */

/** Medium is the `content` detent's own fraction (`SHEET_CONTENT_MAX_FRACTION`),
 *  so a resizable sheet's smaller size is the height every other sheet opens at. */
export const SHEET_RESIZE_MEDIUM = 0.6;

/** Large is the `full` detent's fraction — the tallest a non-resizable sheet can
 *  ever be, so the resize can never exceed what the primitive already allows. */
export const SHEET_RESIZE_LARGE = 0.92;

/**
 * Past either size the surface still follows the finger at this factor, and no
 * further than `SHEET_RESIZE_RESIST_MAX`: the sheet says "it will not go
 * further" by moving a little and springing back, rather than freezing under a
 * finger that is still travelling.
 */
export const SHEET_RESIZE_RESIST = 0.35;
export const SHEET_RESIZE_RESIST_MAX = 48;

/** A flick faster than this (pt/s) picks the direction on its own, whatever the
 *  release height: a fast flick says which way the reader meant. */
export const SHEET_RESIZE_FLICK = 600;

/**
 * Where the finger would have come to rest: the height at release, carried on by
 * the release velocity for this long. A slow drag settles by where it is, a
 * flick by where it was going — iOS scroll views use the same idea.
 */
export const SHEET_RESIZE_PROJECTION = 0.15;

export type SheetResizeSize = "medium" | "large";

/**
 * The two body heights, in pt.
 *
 * Both are SURFACE fractions minus `chrome` (the header and footer that never
 * scroll), because only the body's height is animated: a taller sheet that also
 * moved its footer would slide Answer/Decline off the bottom edge, which is the
 * one region the sheet must never lose.
 *
 * Medium hugs the content when the content is shorter than its ceiling (so a
 * one-line ask does not open as a half-empty slab); Large is always its full
 * ceiling. `floor` keeps a body under a very tall type setting from collapsing
 * to nothing, and `ceiling` is the keyboard's bound while it is up, when the
 * surface has to fit between the safe top and the keyboard's top.
 */
export const sheetResizeSizes = ({
	capHeight,
	chrome,
	contentHeight,
	floor,
	ceiling,
}: {
	capHeight: number;
	chrome: number;
	contentHeight: number;
	floor: number;
	ceiling: number;
}): { medium: number; large: number } => {
	const mediumCeiling = Math.round(capHeight * SHEET_RESIZE_MEDIUM) - chrome;
	const largeCeiling = Math.round(capHeight * SHEET_RESIZE_LARGE) - chrome;
	const medium = Math.min(
		ceiling,
		Math.max(floor, Math.min(contentHeight, mediumCeiling)),
	);
	const large = Math.min(ceiling, Math.max(medium, largeCeiling));
	return { medium, large };
};

/**
 * The height a drag shows for a raw target: inside `[min, max]` it is the target
 * itself, past either end it is the end plus `SHEET_RESIZE_RESIST` of the excess,
 * capped. `min` may be negative-safe: the caller passes body heights, never
 * surface ones.
 */
export const resistResizeDrag = ({
	height,
	min,
	max,
}: {
	height: number;
	min: number;
	max: number;
}): number => {
	// Called from the pan's UI-thread callbacks, so it must run there too — the
	// same shape as the dictation meter's `barHeight`.
	"worklet";
	if (height > max) {
		return (
			max +
			Math.min(SHEET_RESIZE_RESIST_MAX, (height - max) * SHEET_RESIZE_RESIST)
		);
	}
	if (height < min) {
		return (
			min -
			Math.min(SHEET_RESIZE_RESIST_MAX, (min - height) * SHEET_RESIZE_RESIST)
		);
	}
	return height;
};

/**
 * The size a release settles on.
 *
 * `velocityY` is the gesture's own vertical velocity in pt/s, POSITIVE DOWNWARD
 * (RNGH's convention) — so a downward flick shrinks the sheet and an upward one
 * grows it. A flick over `SHEET_RESIZE_FLICK` decides alone; otherwise the
 * projected height decides against the midpoint, which is what makes a small
 * nudge past the middle settle large and a small nudge back settle medium.
 */
export const settleResize = ({
	height,
	velocityY,
	min,
	max,
}: {
	height: number;
	velocityY: number;
	min: number;
	max: number;
}): SheetResizeSize => {
	// Release arithmetic runs on the UI thread; see `resistResizeDrag`.
	"worklet";
	if (velocityY <= -SHEET_RESIZE_FLICK) return "large";
	if (velocityY >= SHEET_RESIZE_FLICK) return "medium";
	const projected = height - velocityY * SHEET_RESIZE_PROJECTION;
	return projected > (min + max) / 2 ? "large" : "medium";
};
