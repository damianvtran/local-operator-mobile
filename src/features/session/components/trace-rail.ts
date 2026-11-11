/**
 * Shared horizontal rail and vertical spacing vocabulary for the transcript.
 *
 * WHY ONE MODULE. Before this rail, glyphs landed at 16 pt, 22 pt and 24 pt
 * while labels landed across 16 pt, 24 pt, 36 pt, 38 pt, 40 pt, 46 pt and
 * 48 pt — every row component spelled its own padding and gap. Declaring the
 * geometry once keeps every trace, bar, notice and disclosure on two exact
 * vertical lines:
 *
 *   - Outer row inset: `px-4` (`16 pt`), inner bar inset: `px-0` (`0 pt`).
 *   - Glyph box: fixed `w-4` (`16 pt`) `shrink-0 text-start font-mono text-mono-sm`,
 *     starting at `x = 16 pt`.
 *   - Column gap: `gap-2` (`8 pt`), putting the `min-w-0 flex-1` text column —
 *     its wrapped second lines AND any expanded disclosure panel (`ps-6` = 24 pt
 *     inside `px-4` = 40 pt) — on the exact `x = 40 pt` rail.
 *
 * All spacing steps sit strictly on `space.scale` (`0, 4, 8, 12, 16, 20, 24…`)
 * so U-41 (summary rail & first-line caret) and U-42 (token spacing scale) hold
 * by construction.
 */

import { createContext } from "react";

import type { TranscriptEntry } from "@/contracts";
import type { TranscriptItem } from "@/features/session/turn-condensing";

/** Outer full-width horizontal inset (`16 pt` each side) shared by every transcript row. */
export const TRACE_ROW_OUTER_CLASS = "px-4";

/** Inner bar horizontal inset (`0 pt`) inside `TRACE_ROW_OUTER_CLASS`. */
export const TRACE_BAR_PAD_CLASS = "px-0";

/** Gap (`8 pt`) between the `16 pt` glyph column (`w-4`) and the `x = 40 pt` text column. */
export const TRACE_COLUMN_GAP_CLASS = "gap-2";

/** Fixed `16 pt` leading glyph box, left-aligned so wrapped lines and sibling glyphs share `x = 16 pt`. */
export const TRACE_GLYPH_BOX_CLASS =
	"w-4 shrink-0 text-start font-mono text-mono-sm";

/**
 * A disclosure row's glyph sits OUTSIDE its pressable, in a baseline-aligned
 * sibling slot, and the pressable starts right after it.
 *
 * WHY. U-41 (`tools/audit/probe.ts`) reads every text node inside a
 * caret-bearing pressable as a line of that row, aria-hidden or not. With the
 * ✓/⟳/↔ glyph INSIDE the pressable, line 1 started at the glyph (16 pt) while a
 * wrapped or second line started on the 40 pt text rail — "rail drift: line 2
 * starts 24pt off the row's rail" on every wrapped bar (PR #223 CI). With the
 * glyph a sibling, every text line the pressable owns starts at 40 pt.
 *
 * WHY BESIDE, NOT UNDER. Pulling the pressable back under the glyph (`-ms-6`)
 * kept the glyph column tappable, but U-08 then measures the glyph's ink inside
 * a control's box it does not belong to — an overlap, 30 FAIL rows on S5/S6
 * (measured on this change's own capture). So the pressable's box starts at
 * 32 pt, after the slot; the glyph's own 16 pt is not a tap target, and the
 * row's press wash is lifted to the row wrapping both (`TRACE_PRESS_WASH_CLASS`
 * gated on the pressable's `onPressIn`/`onPressOut`), so the glyph is still
 * tinted with the row it belongs to.
 *
 * WHY BASELINE. The pressable centres its content inside the touch floor when
 * it is one line, and top-anchors it when it wraps, so the first line's height
 * depends on how many lines there are — something no static offset on a
 * sibling can know. `items-baseline` hands the glyph the pressable's own first
 * baseline (its first text line's, wherever centring put it), on web and Yoga
 * alike, with no measurement pass and no off-scale nudge (U-42).
 *
 * THE GEOMETRY. Slot `w-4` at 16 pt, the pressable from 32 pt, its content's
 * `ps-2` (8 pt, on `space.scale`) putting the text on 40 pt.
 */
export const TRACE_GLYPH_ROW_CLASS = "flex-row items-baseline";

/** The glyph slot: the 16 pt column, never the touch target. */
export const TRACE_GLYPH_SLOT_CLASS = "w-4 shrink-0";

/** The pressable beside the glyph slot: its box starts at 32 pt. */
export const TRACE_PRESSABLE_BESIDE_GLYPH_CLASS = "min-w-0 flex-1";

/** The pressable's content inset: the column gap, so text sits on 40 pt. */
export const TRACE_TEXT_RAIL_INSET_CLASS = "ps-2";

/** The row's press wash, on the row holding glyph AND pressable while pressed. */
export const TRACE_PRESS_WASH_CLASS = "bg-row-hover";

/** Left indent (`24 pt` inside `px-4` = `40 pt`) for expanded panels beneath a trace row. */
export const TRACE_EXPANDED_INDENT_CLASS = "ps-6";

/** Horizontal chrome consumed by `px-4` (`16 pt` left + `16 pt` right = `32 pt`). */
export const TRACE_ROW_CHROME_PT = 32;

/**
 * Context-aware vertical spacing tiers between adjacent rendered transcript items,
 * mirrored from the desktop's `spacingTier` (`canonical-transcript.tsx`):
 *
 *   - `first`: `0 pt` above the first rendered item.
 *   - `turn`: `pt-4` (`16 pt`, on `space.scale`) before a fresh user turn after
 *     prior turn content so exchanges read as distinct beats.
 *   - `block`: `pt-2` (`8 pt`, on `space.scale`) at register transitions between
 *     user bubbles, ledger/trace runs, assistant prose, and supplements.
 *   - `trace`: `0 pt` between consecutive trace, fold, turn-bar, quiet-group,
 *     ask-receipt and notice rows so machine-voice ledger lines sit cohesively
 *     on their `TOUCH_FLOOR` rhythm without extra air.
 */
export type TranscriptSpacingTier = "first" | "turn" | "block" | "trace";

export const SPACING_TIER_CLASS: Record<TranscriptSpacingTier, string> = {
	first: "",
	turn: "pt-4",
	block: "pt-2",
	trace: "",
};

/** Visual register of a rendered transcript item for vertical rhythm calculation.
 *  `none` is a row that paints nothing (`isBlankAssistantEntry`): it takes no
 *  tier of its own and does not change the register its neighbours see. */
export type ItemRegister = "user" | "prose" | "trace" | "none";

/**
 * An assistant row with nothing to paint: no visible text and no media.
 *
 * WHY THIS EXISTS. The relay's live fold appends an assistant entry at every
 * `MessageStartEvent` (`local_operator/mobile/projection.py`, the
 * `MessageStartEvent` arm), and a tool-only model message never gets text — so
 * a live turn carries one blank assistant row per tool batch. (The history
 * fold drops them through `assistant_row_text`, which is why a reload looked
 * fine.) Rendered as prose, each blank row cost 24 pt of empty space between
 * two tool rows: the `block` tier above it (8 pt, trace → prose), its own
 * `py-1` (8 pt) around an empty `Markdown`, and the `block` tier on the next
 * trace row (8 pt, prose → trace). That is the uneven spacing the operator saw
 * inside an expanded turn on iOS build 836 — a gap wherever the model started
 * a new tool batch, none between calls of the same batch.
 *
 * The row still renders (a zero-size box carrying its testID and anchors), so
 * the streaming anchor, find and the offset table keep addressing it; text
 * arriving on a streaming row turns it back into ordinary prose.
 */
export function isBlankAssistantEntry(entry: TranscriptEntry): boolean {
	return (
		entry.kind === "assistant" &&
		entry.text.trim() === "" &&
		entry.images.length === 0 &&
		(entry.videos?.length ?? 0) === 0
	);
}

/** Classify a raw entry into its vertical spacing register. */
export function entryRegister(entry: TranscriptEntry): ItemRegister {
	if (isBlankAssistantEntry(entry)) return "none";
	if (entry.kind === "user" || entry.kind === "steer") return "user";
	if (entry.kind === "assistant") return "prose";
	// Unstamped parent/subagent rows that paint full prose blocks read as prose;
	// hub receipts, peer messages, notices, tools, reasoning and asks are trace-rail rows.
	if (
		(entry.kind === "parent_message" || entry.kind === "subagent_message") &&
		entry.details.direction !== "to_child" &&
		entry.details.direction !== "to_parent"
	) {
		return "prose";
	}
	return "trace";
}

/** Compute the vertical spacing tier before `current` when preceded by `previous`.
 *  `startsNewTurn` distinguishes a genuine turn-opening `user` prompt (`16 pt`
 *  exchange boundary) from an in-flight mid-turn steer (`8 pt` block transition). */
export function spacingTierBetween(
	previous: ItemRegister | null,
	current: ItemRegister,
	startsNewTurn: boolean,
): TranscriptSpacingTier {
	if (current === "none") return "trace";
	if (previous === null) return "first";
	if (startsNewTurn) return "turn";
	if (previous === "trace" && current === "trace") return "trace";
	return "block";
}

/** The tier before every rendered item, in one pass over the plan. Bars,
 *  folds and groups are trace lines. A `none` row (`isBlankAssistantEntry`)
 *  gets no air and is skipped as the `previous` register, so the rows either
 *  side of it meet exactly as if it were not there. */
export function spacingTiersOf(
	items: readonly TranscriptItem[],
): ReadonlyMap<string, TranscriptSpacingTier> {
	const tiers = new Map<string, TranscriptSpacingTier>();
	let previous: ItemRegister | null = null;
	for (const item of items) {
		const register: ItemRegister =
			item.kind === "entry" ? entryRegister(item.entry) : "trace";
		tiers.set(
			item.id,
			spacingTierBetween(
				previous,
				register,
				item.kind === "entry" && item.opensTurn === true,
			),
		);
		if (register !== "none") previous = register;
	}
	return tiers;
}

/**
 * Containment for rows inside an OPENED turn bar or run fold
 * (`group-containment.ts` decides membership; this is the geometry).
 *
 * WHY. Opened, a bar's rows came back on the bar's own 16 pt glyph rail, so
 * nothing on screen said which rows the bar had been standing for (operator
 * report, iOS build 836). The mobile relay indents an opened group's body one
 * step (`condense-rows.tsx`: `ps-[22px]`); this rail's step is 24 pt (`ps-6`,
 * on `space.scale`), which puts a member's glyph exactly on the bar's 40 pt
 * text rail. A 1 pt hairline guide per level, under the bar's glyph, carries
 * the eye from the bar down its members. No card and no fill (visual audit D4):
 * the guide is the only new ink.
 *
 * GEOMETRY. Level `d` (1-based) indents by `24 × d` pt and draws its guide at
 * `x = 20 + 24 × (d − 1)` pt: the centre of a ✓ glyph that starts on its
 * level's 16 pt rail. The guide is absolutely positioned inside the row's
 * measured wrapper and spans its full height, so consecutive members join into
 * one unbroken line and the guide adds nothing to any measured height.
 * Depth is capped at `GROUP_MAX_DEPTH` (a fold inside a turn is 2; 3 covers a
 * quiet group member inside both without walking off the narrow phone).
 */
export const GROUP_MAX_DEPTH = 3;

/** Start padding per containment depth (index = depth); 0 is the page rail. */
export const GROUP_INSET_CLASS: readonly string[] = [
	"",
	"ps-6",
	"ps-12",
	"ps-18",
];

/** Points of start inset per containment depth, for width arithmetic that
 *  subtracts the row's chrome (`tool-row.tsx`'s chip layout). */
export const GROUP_STEP_PT = 24;

/** The guide for level `d` sits at `GROUP_GUIDE_START_CLASS[d - 1]`. */
export const GROUP_GUIDE_START_CLASS: readonly string[] = [
	"start-5",
	"start-11",
	"start-17",
];

/** The guide's ink: the 1 pt `hairline` token, the same ink as every divider. */
export const GROUP_GUIDE_CLASS = "absolute top-0 bottom-0 w-px bg-hairline";

/** Clamp a membership depth to what the rail can draw. */
export const groupDepth = (depth: number | undefined): number =>
	Math.min(GROUP_MAX_DEPTH, Math.max(0, depth ?? 0));

/**
 * Extra start inset (pt) the row is drawn under, beyond `TRACE_ROW_CHROME_PT`.
 * Provided by the list around a member row so width arithmetic done from the
 * window (not `onLayout`) still matches the narrower box; 0 everywhere else.
 */
export const GroupInsetContext = createContext(0);
