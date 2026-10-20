import type { Capabilities, TagCatalogueEntry, TagRef } from "@/contracts";
import { sansTextWidthDp } from "@/ui/components/list-row-meta";

/**
 * The pure half of conversation tags: how a row's assignment compresses into one
 * line, what a toggle asks the relay, and whether this relay offers the routes.
 *
 * It lives apart from the rendered components for the same reason
 * `list-row-meta.ts` does: the rules are testable in Node, where no `react-native`
 * import exists, and the component then only paints the answer rather than
 * carrying a second copy of it.
 *
 * THE STORE IS THE RELAY'S. Nothing here caches an assignment: the sheet's
 * display settles from the write's read-back, and the list row settles from the
 * next SSE frame. `desiredTagWrite` derives a whole desired state (never a toggle
 * delta) because that is the route's contract — a retry of the same desired state
 * is idempotent, where a delta replayed would flip the tag back.
 */

/** How many labels a row paints before the `+N` cue. */
export const TAG_VISIBLE_LIMIT = 2;

/**
 * A badge's non-text width: `px-2` either side (8 + 8) plus its 1 px border on
 * both sides (`variants.ts` `badgeClasses`). The fit below subtracts it per
 * label, so a painted name plus its chrome stays inside the share it was given.
 */
const BADGE_CHROME_DP = 18;

/** `gap-1` between labels, in dp. The spacing scale is a flat 4 px (see
 *  `list-row-meta.ts` `META_GAP_DP`), so this does not follow the text scale. */
const TAG_GAP_DP = 4;

/**
 * The kit's floor for an interactive target, in dp. WCAG 2.5.8 asks 24; this
 * app's own floor is 44, so the header disclosure takes the larger one. It is a
 * REAL box (`minHeight`), not `hitSlop`: react-native-web drops `Pressable`
 * hitSlop, and the audit measures the painted box (review round 2, R2-3).
 */
export const TAG_LINE_TARGET_DP = 44;

/** The disclosure's min height: the platform's floor, never under the kit's 44. */
export const tagLineTargetHeightDp = (platformFloor: number): number =>
	Math.max(TAG_LINE_TARGET_DP, platformFloor);

/**
 * Split `room` between labels, giving each one what it naturally needs before
 * dividing the remainder.
 *
 * WHY NOT EQUAL SHARES: a short name beside a long one left part of the row
 * unused — "Work" took its 50 dp of a 114 dp half and the other 64 dp could not
 * rescue the neighbour, so the long name elided while 64 dp sat blank (review
 * round 2, R2-m3, the second half of D5). Satisfied labels leave the pool, and
 * the rest share what is left; the loop terminates because at least one label
 * is satisfied per pass or every remaining label takes the equal share.
 */
const allocateLabelWidths = (
	natural: readonly number[],
	room: number,
): number[] => {
	const widths = natural.map(() => 0);
	let open = natural.map((_, index) => index);
	let remaining = Math.max(0, room);
	while (open.length > 0) {
		const share = Math.max(0, remaining / open.length);
		const satisfied = open.filter((index) => (natural[index] ?? 0) <= share);
		if (satisfied.length === 0) {
			for (const index of open) widths[index] = share;
			break;
		}
		for (const index of satisfied) {
			widths[index] = natural[index] ?? 0;
			remaining -= natural[index] ?? 0;
		}
		open = open.filter((index) => !satisfied.includes(index));
	}
	return widths;
};

export type TagLine = {
	/** The labels to paint, in the relay's assignment order. Already fitted. */
	labels: string[];
	/** Tags beyond the visible limit, or 0 when every tag is shown. */
	more: number;
};

/**
 * Slack for float subtraction, in dp. Natural widths are measured WITH the
 * badge chrome and the budget is obtained by subtracting the same constant, so
 * an exactly-fitting name lands a few ulps away from its budget; without this
 * it elides by 1e-15 dp. A hundredth of a dp is below any renderer's pixel.
 */
const FIT_EPSILON_DP = 0.01;

/** The longest HEAD of `text` that fits `budgetDp` with an ellipsis appended:
 *  prose's direction, by code point so a surrogate pair is never split.
 *
 *  The measurement is the SANS face's, because the painted label is a `Badge`
 *  (`text-meta`, Figtree Medium). `textWidthDp` is the mono line's arithmetic and
 *  charged these labels 0.600 em per glyph, which elided them far too early —
 *  the measured `Resear…` with 43.7 dp still spare (review round 1, G). */
const headFit = (text: string, budgetDp: number, scale: number): string => {
	if (sansTextWidthDp(text, scale) <= budgetDp + FIT_EPSILON_DP) return text;
	const ellipsis = "…";
	const ellipsisWidth = sansTextWidthDp(ellipsis, scale);
	let painted = "";
	for (const glyph of text) {
		if (
			sansTextWidthDp(painted + glyph, scale) + ellipsisWidth >
			budgetDp + FIT_EPSILON_DP
		)
			break;
		painted += glyph;
	}
	return painted === "" ? ellipsis : `${painted}${ellipsis}`;
};

/**
 * The row's tag line, fitted to `widthDp`.
 *
 * The relay's order is preserved — nothing here sorts by name or primary — and
 * the line NEVER wraps: one row grows one line at most, and a long name loses
 * its tail behind an ellipsis rather than pushing the `+N` cue off the edge.
 *
 * Before the first layout (`widthDp` 0) the visible names paint whole: the
 * common row fits them, so its first frame is its settled frame, and the row
 * that does not settles within a frame. Fitting is arithmetic over the shipped
 * SANS face's advances (`sansTextWidthDp`), not an `ellipsizeMode` request —
 * react-native-web ignores the direction prop, which is the lesson
 * `list-row-meta.ts` records.
 *
 * A name keeps its HEAD, unlike the model label's tail: a category name is
 * prose, and "Research bl…" still names the category where "…blitz" does not.
 */
export const tagLineFor = (
	tags: readonly TagRef[],
	widthDp: number,
	scale: number,
): TagLine => {
	if (tags.length === 0) return { labels: [], more: 0 };
	const visible = tags.slice(0, TAG_VISIBLE_LIMIT);
	const more = tags.length - visible.length;
	const cue = more > 0 ? `+${more}` : null;

	if (widthDp <= 0) {
		return { labels: visible.map((tag) => tag.name), more };
	}

	const gapCount = visible.length - 1 + (cue === null ? 0 : 1);
	const cueWidth =
		cue === null ? 0 : BADGE_CHROME_DP + sansTextWidthDp(cue, scale);
	const room = Math.max(0, widthDp - cueWidth - gapCount * TAG_GAP_DP);
	const natural = visible.map(
		(tag) => BADGE_CHROME_DP + sansTextWidthDp(tag.name, scale),
	);
	const widths = allocateLabelWidths(natural, room);

	return {
		labels: visible.map((tag, index) =>
			headFit(
				tag.name,
				Math.max(0, (widths[index] ?? 0) - BADGE_CHROME_DP),
				scale,
			),
		),
		more,
	};
};

/** The accessible name of a row's tag line. Every assigned name is announced,
 *  including the ones the compact line could not paint. */
export const tagAnnouncement = (tags: readonly TagRef[]): string =>
	`Tags: ${tags.map((tag) => tag.name).join(", ")}`;

export type TagWrite = { tags: string[]; primary: string | null };

/**
 * Whether a settled answer may be painted: only while the sheet's draft is
 * still exactly the state that request asked for.
 *
 * WHY: the read-back used to paint over a NEWER local press. Press Work, then
 * Research while Work's PUT is slow, and Work's answer ({Work}) unchecked
 * Research until the queued write settled; a third press in that window then
 * derived from the wiped draft and dropped the queued change (review round 2,
 * R2-2). The queue's `hasQueued` is checked too, because an older answer must
 * not paint even when a later press happens to derive the SAME desired state.
 */
export const draftMatchesDesired = (
	draft: {
		readonly tags: readonly TagRef[];
		readonly primary: string | null;
	} | null,
	desired: TagWrite,
): boolean =>
	draft !== null &&
	draft.primary === desired.primary &&
	draft.tags.length === desired.tags.length &&
	draft.tags.every((tag, index) => tag.id === desired.tags[index]);

/**
 * One toggle, as the FULL desired state the route takes.
 *
 * The primary rule this slice fixes: keep the current primary while it is still
 * selected; otherwise the first selected tag takes it, and clearing leaves
 * `null`. There is no primary picker — the desktop owns that choice — so a
 * toggle must never leave a primary pointing at a tag that is no longer there
 * (the relay would prune it and the next frame would look like a lost choice).
 *
 * Order is the assignment order: an added tag lands at the end, exactly as the
 * relay records it, and a removed one closes its gap without reordering the rest.
 */
export const desiredTagWrite = (
	current: readonly TagRef[],
	primary: string | null,
	toggledId: string,
): TagWrite => {
	const ids = current.map((tag) => tag.id);
	const selected = ids.includes(toggledId);
	const tags = selected
		? ids.filter((id) => id !== toggledId)
		: [...ids, toggledId];
	const nextPrimary =
		primary !== null && tags.includes(primary) ? primary : (tags[0] ?? null);
	return { tags, primary: nextPrimary };
};

/** `Remove all tags`: the route's exact clearing body. */
export const clearedTags = (): TagWrite => ({ tags: [], primary: null });

/**
 * The catalogue with every ASSIGNED tag present, as a selectable entry.
 *
 * The registry read and the list frame are two answers that can disagree: a
 * category deleted from the desktop still sits on a conversation until the
 * relay prunes it, and a stale `GET /api/tags` must never hide an assignment —
 * a checkbox list missing the row's own tag leaves that tag impossible to
 * unselect individually. So the row's tags are merged in, in assignment order,
 * with no count (the catalogue's `conversations` is the desktop's total, and a
 * zero here would be a claim this screen cannot make). Selectable, not just
 * listed: the point is that it can be unchecked.
 */
export const catalogueWithAssigned = (
	catalogue: readonly TagCatalogueEntry[],
	assigned: readonly TagRef[],
): TagCatalogueEntry[] => {
	const known = new Set(catalogue.map((tag) => tag.id));
	const missing = assigned
		.filter((tag) => !known.has(tag.id))
		.map((tag, index) => ({
			id: tag.id,
			name: tag.name,
			order: catalogue.length + index,
			conversations: 0,
		}));
	return [...catalogue, ...missing];
};

/**
 * Whether this relay offers the assignment routes.
 *
 * The capability OBJECT is optional on the frame and never defaulted (its own
 * schema note): absence is an older relay whose routes do not exist, and a
 * default `available: true` would advertise a control that 404s. So the gate is
 * strictly `=== true`, in one function, and both the menu entry and the sheet's
 * write path read it rather than repeating the comparison.
 */
export const canAssignSessionTags = (
	capabilities: Capabilities | undefined,
): boolean => capabilities?.session_tags?.available === true;

/**
 * The primary id after a read-back, defensively: the response's `primary` is a
 * filter over its own `tags`, and a relay that ever sent an id outside that set
 * must not make this screen highlight or address a tag that is not selected.
 */
export const settledPrimary = (
	tags: readonly TagRef[],
	primary: string | null,
): string | null => {
	if (primary === null) return tags[0]?.id ?? null;
	return tags.some((tag) => tag.id === primary)
		? primary
		: (tags[0]?.id ?? null);
};
