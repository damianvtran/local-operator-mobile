import { LARGE_TEXT_SCALE } from "@/ui/text-scale";

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

/**
 * The home strip's folder chip: a folder glyph and the folder's own name, capped,
 * and the glyph alone at large text (design D2 / UX U4).
 *
 * WHY. Once the chip names the real folder instead of `~` (UX U1), a whole path
 * took up to the old 160 pt cap before anything else yielded, and at 320 pt /
 * 200 % the model chip was already down to `Cla…` — Opus 5 and Opus 4.8 then
 * read the same. The name is what tells two folders apart at a glance; the whole
 * path stays on the chip's spoken label and in the sheet. The glyph is what makes
 * a bare `~` or `app` read as a control rather than a stray character.
 */
export const FOLDER_CHIP_MAX_PT = 112;

/** The folder chip's visible text at this text scale: its name, or nothing (the
 *  glyph alone) past `LARGE_TEXT_SCALE`, where the strip's width belongs to the
 *  model's name. */
export const folderChipText = (name: string, scale: number): string =>
	scale > LARGE_TEXT_SCALE ? "" : name;

/**
 * The order the home strip's chips give up width: folder first, then effort,
 * then model (design D2). Flex weights, not a measured ladder: a chip's shrink
 * is weighted by its own width, so a factor of ten between neighbours makes the
 * earlier one give nearly all of the overflow before the next moves, and each
 * still stops at its 44 pt floor. Home only — the session strip (no folder) has
 * its own order, `SESSION_EFFORT_SHRINK`.
 */
export const HOME_STRIP_SHRINK = { folder: 100, effort: 10, model: 1 } as const;

/**
 * The session strip's shrink pair: the MODEL yields the overflow first, down to
 * its `MODEL_FLOOR_PT`, and only then does effort give up width (an ellipsis,
 * stopped at its own 44 pt floor) — so the trailing controls (More, the queued
 * chip, keyboard-dismiss) never reach the row's `overflow-hidden` edge.
 *
 * WHY a weighted pair and not 0. Effort used to hold at `flexShrink: 0` (code
 * review M1 / design D2: two `shrink` chips on auto bases split the overflow by
 * width, so effort read "H…" beside the queued chip). But at 320 pt / 200 % in
 * portrait the strip is ~292 pt, and model floor 44 + More 44 + queued 44 +
 * keyboard 44 + four 4 pt gaps leave ~100 pt, while a whole "Extra high" needs
 * ~151 pt: a rigid effort pushed the keyboard button and then the queued chip
 * past the clip (round-2 review R2-M1). The compact row does not rescue it — it
 * is short-landscape only.
 *
 * WHY 1000 : 1. Flex shrink is weighted by `factor × basis`, and an item frozen
 * at its min-width hands the rest of the overflow to the others (Yoga's
 * two-pass flexible-length resolution). Until the model is at its floor,
 * effort's share of the overflow is under `effortBasis / 1000` — about 0.15 pt
 * for the widest rung, below half a device pixel at 3x, which pixel rounding
 * absorbs, so effort still reads whole at ordinary sizes (D2 holds). Once the
 * model is frozen at 44 pt, effort takes everything that is left.
 */
export const SESSION_STRIP_SHRINK = { model: 1000, effort: 1 } as const;
