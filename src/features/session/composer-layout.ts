/** Build389 shared layout. Model/effort live in a permanent context strip,
 * never in a keyboard-inline receipt. Optional facts live in More, so no
 * measured-width ladder can temporarily paint all facts or evict effort. */
/* The discs sit one 4 pt step apart (`gap-1`), the smallest non-zero step of
 * `space.scale`. `gap-0.5`'s 2 pt was off the scale and failed U-42 on every
 * composer frame (2752 rows on main after #163); the 44 pt discs and their
 * touch floors are unchanged, only the seam between them moves by 2 pt. */
export const COMPOSER_CONTROLS_ROW = "min-h-11 flex-row items-center gap-x-1";

export const COMPOSER_ACTION_CLUSTER =
	"ms-auto shrink-0 flex-row items-center gap-1";

export const COMPOSER_DISC =
	"h-11 w-11 items-center justify-center rounded-full";

export const COMPOSER_META_ROW =
	"min-h-11 min-w-0 flex-row items-center gap-1 overflow-hidden";

/** The strip's `gap-1`, in pt, for the glass arithmetic below. */
export const COMPOSER_META_GAP_PT = 4;

/** The strip's glass merge distance (design D1). iOS fuses glass capsules
 *  closer than their container's spacing; at the group default (8) the model
 *  and effort capsules, 4 pt apart, would paint as ONE bar, while spec §12
 *  asks for per-chip capsules. Zero keeps them separate without widening the
 *  strip's gap — the gap is shared with the solid row, which must not move. */
export const COMPOSER_META_GLASS_SPACING = 0;

/** The strip chip's glass capsule hugs its chip (design D1): the model slot is
 *  a `flex-1` column whose default `alignItems: stretch` would otherwise draw
 *  the capsule across the whole slot with the label at its left end. Set on
 *  the capsule, not the slot, so the SOLID chip keeps its full-slot target. */
export const COMPOSER_CHIP_CAPSULE_ALIGN = "flex-start" as const;

export const ATTACH_GLYPH_PT = 20;

export const MODEL_FLOOR_PT = 44;
