import type { Reaction } from "@/team-bridge/contract";

/** Labels are a hub sample, NOT identities. Ownership is an independent bit:
 * never insert "You", resolve profiles, or subtract the viewer from the sample. */
export function sampledReactionDetails(reaction: Reaction) {
	return {
		labels: reaction.sample_labels,
		others: Math.max(0, reaction.count - reaction.sample_labels.length),
		mine: reaction.reacted_by_me,
	};
}

/** Pack measured touch boxes, not character counts: emoji, locale, compact
 * counts and text scaling all change width. Unknown measurements retain every
 * pill until layout answers; hidden pills unmount rather than remaining focusable
 * behind a clipping mask. Logical ordering makes the same packing work in RTL. */
export function collapsedReactionCount(
	width: number,
	widths: readonly number[],
	trailingWidth = 0,
): number {
	if (width <= 0 || widths.some((item) => item <= 0)) return widths.length;
	let line = 1;
	let used = 0;
	for (let i = 0; i < widths.length; i++) {
		const item = Math.min(widths[i] ?? 0, width);
		if (used > 0 && used + 6 + item > width) {
			line++;
			used = 0;
		}
		if (line > 3) return i;
		used += (used > 0 ? 6 : 0) + item;
		// Keep the inline plus inside the same three lines, with its own
		// non-overlapping touch box, rather than clipping it at the row edge.
		if (line === 3 && trailingWidth > 0 && used + 6 + trailingWidth > width)
			return i;
	}
	return widths.length;
}
