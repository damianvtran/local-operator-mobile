/**
 * Which rendered transcript items sit INSIDE an opened group, and how deep.
 *
 * WHY. Opening a turn bar (`TurnBar`, Tier B) or a run fold (`FoldBar`,
 * Tier A) puts the rows it stood for back into the list as ordinary items, on
 * the same 16 pt glyph rail as the bar itself. On device (iOS build 836) the
 * operator could not tell which rows belonged to the bar he had just opened:
 * "it's hard to tell what's part of the group". The mobile relay answers the
 * same question by indenting an opened group's body one step
 * (`condense-rows.tsx`, `<div className="flex flex-col ps-[22px]">`); this
 * module is the data half of that treatment for a virtualised list, where the
 * members are separate `FlatList` cells and no single wrapper can hold them.
 *
 * WHAT. A pure walk over the planned items plus the two plans' own membership
 * facts — `TurnView.hiddenIds` (the rows a condensed turn's bar stands for) and
 * `FoldView.itemIds` (the bar first, then the rows an OPEN fold re-emitted).
 * Each member gets its nesting depth (a fold opened inside an opened turn is
 * depth 2). The rendering half (`transcript-list.tsx`) turns depth into
 * a `ps-6` step per level and one 1 pt hairline guide per level.
 *
 * CONSTRAINTS.
 *   - Collapsing must restore the exact previous layout: a closed bar has no
 *     members, so every item is absent from the map and renders exactly as it
 *     did before this module existed.
 *   - The result is a function of the plan alone (computed in the same memo
 *     as the spacing tiers), so it adds no per-scroll work and changes only
 *     when the rendered items do.
 *   - Turn membership is the CONTIGUOUS span from the bar to the last item
 *     that covers a hidden row. A row the collapse never hid (a pinned media
 *     or error row, `staysVisibleOutsideTurnBar`) that sits inside that span is
 *     still part of the turn the reader opened, so it shares the indent rather
 *     than punching a hole in the guide. The closing answer comes after the
 *     span and stays on the page rail, as it does when the turn is closed.
 */

import type {
	FoldView,
	TranscriptItem,
	TurnView,
} from "@/features/session/turn-condensing";

/** The row ids an item stands for, for turn-membership tests: an entry is
 *  itself; a fold or quiet-group bar is every row it covers. A turn bar is
 *  never inside another turn. */
function coveredIds(item: TranscriptItem): readonly string[] {
	switch (item.kind) {
		case "entry":
			return [item.id];
		case "fold":
			return item.fold.rowIds;
		case "group":
			return item.group.rowIds;
		default:
			return [];
	}
}

/** One opened group's span in `items`: the first and last member index. */
interface Span {
	start: number;
	end: number;
}

/**
 * Map each item inside an opened turn or fold to how many opened groups
 * enclose it (1 = directly under a bar). Items not in the map are not inside
 * any opened group.
 */
export function groupContainment(
	items: readonly TranscriptItem[],
	turns: readonly TurnView[],
	folds: readonly FoldView[],
): ReadonlyMap<string, number> {
	const spans: Span[] = [];
	const indexOf = new Map<string, number>();
	items.forEach((item, at) => {
		if (!indexOf.has(item.id)) indexOf.set(item.id, at);
	});

	const hiddenByTurn = new Map<string, ReadonlySet<string>>();
	for (const turn of turns) {
		if (turn.hiddenIds.length > 0) {
			hiddenByTurn.set(turn.key, new Set(turn.hiddenIds));
		}
	}
	items.forEach((item, at) => {
		if (item.kind !== "bar" || !item.expanded) return;
		const hidden = hiddenByTurn.get(item.turnKey);
		if (hidden === undefined) return;
		let end = -1;
		for (let next = at + 1; next < items.length; next += 1) {
			const candidate = items[next];
			// The next turn's opening row or bar ends this turn's span.
			if (candidate === undefined || candidate.kind === "bar") break;
			if (candidate.kind === "entry" && candidate.opensTurn === true) break;
			if (coveredIds(candidate).some((id) => hidden.has(id))) end = next;
		}
		if (end > at) spans.push({ start: at + 1, end });
	});

	for (const fold of folds) {
		// Closed: only the bar is emitted, so there is nothing to contain.
		if (fold.itemIds.length < 2) continue;
		const first = indexOf.get(fold.itemIds[1] ?? "");
		const last = indexOf.get(fold.itemIds[fold.itemIds.length - 1] ?? "");
		if (first !== undefined && last !== undefined && last >= first) {
			spans.push({ start: first, end: last });
		}
	}

	const result = new Map<string, number>();
	for (const span of spans) {
		for (let at = span.start; at <= span.end; at += 1) {
			const id = items[at]?.id;
			if (id !== undefined) result.set(id, (result.get(id) ?? 0) + 1);
		}
	}
	return result;
}
