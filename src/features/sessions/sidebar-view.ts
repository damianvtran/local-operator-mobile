/**
 * The conversations drawer's VIEW: which clock it reads, how its rows are
 * ordered and grouped, and which rows and sections it draws. Pure data and pure
 * functions — no React, no platform — so every rule below is a unit test away.
 *
 * WHY THIS EXISTS (TestFlight 906, 2026-11-13). The operator's words: "the
 * ordering of the sidebar conversations is not the same as the ordering on the
 * UI where conversations that the user most recently interacted with get
 * reordered to the top". The drawer drew the relay's order, which is CREATION
 * order (`local_operator/mobile/daemon.py` `_rank_row`: tier, wake band,
 * `-created_at`), and binned rows by birth; the desktop arranges the drawn list
 * newest-first by the reader's chosen clock. This module is the desktop's
 * arrangement, ported rule for rule so the two surfaces cannot disagree about
 * the same catalogue:
 *
 *   - `local-operator-ui` `src/renderer/src/features/chat/chat-sidebar-view.ts`
 *     (`pageOrder`, `liftLane`, `orderKeyMs`, `byNewest`, `groupRows`,
 *     `DEFAULT_SIDEBAR_VIEW`, `parseSidebarView`), read at 94d96837486;
 *   - `.../chat/chat-list-sections.ts` (`rowTimeMs`, `runningOrderMs`,
 *     `sectionOf`, `STOPPED_ON_READER_CODES`), same revision;
 *   - `.../chat/chat-sections.ts` (`pinnedRows`: Pinned is a partition drawn
 *     in the catalogue's order, never re-sorted).
 *
 * WHERE IT DELIBERATELY DIFFERS, each for a stated reason:
 *
 *   - RUNNING rows key on the person's LAST MESSAGE, as the desktop does:
 *     `last_user_at` (so a response landing in a running chat never re-sorts
 *     it), falling back to `created_at`. The relay's list (`/api/sessions`,
 *     `daemon.py` `_merge_summaries`) publishes `last_user_at` from
 *     local-operator v0.102.5 (#3923) — epoch seconds, `null` when unknown,
 *     populated on running rows only. Older daemons omit it, so the
 *     `created_at` fallback stays and is what those relays always get.
 *   - `groupBy` has no `agent` arrangement: the phone's row carries no binding
 *     (agent/team), so "Agent and team" would put every row in "Ungrouped".
 *   - `groupBy: "tag"` is the desktop's tag-first arrangement (its issue #1733,
 *     `docs/design/sidebar-tag-first-grouping.md`) with two stated differences.
 *     A PINNED row leads in its own group: the phone's row paints no pin mark,
 *     so a pin tucked inside a tag group would be invisible. And there are no
 *     tag subheaders or folds under the time sections — the phone draws only
 *     the two arrangements its size can hold. Both bucket a row by its PRIMARY
 *     tag (none, or one the relay pruned from `tags`, means Untagged).
 *   - `showEnded` is the phone's own: the desktop has no ended filter, but the
 *     phone draws the relay's `ended` receipt on rows, and a reader on a small
 *     screen asked for a way to put finished conversations away. Default ON, so
 *     a fresh install matches the desktop.
 *   - `showTags` is the phone's own: whether a row paints its tag line. The
 *     desktop's tag switch turns SUBHEADERS on; the phone has none, and its
 *     line takes vertical room on every row, so the switch is about the line.
 *     Assigning tags is unaffected — that stays in the row's long-press menu.
 *   - No manual pin order, section reordering or paging: the phone has no drag
 *     surface for the first two, and its list is virtualised, not paged.
 *
 * PERSISTED LOCALLY, never synced. The desktop keeps its view in its own
 * `localStorage` (`ui-preferences-storage` → `chatSidebarView`), not in the
 * relay's settings, so there is nothing synced to mirror; the phone keeps its
 * copy in the device store under `SIDEBAR_VIEW_KEY`, the theme preference's
 * pattern (`state/theme-preference.ts`).
 */

import type { SessionSummary } from "@/contracts";
import {
	isRemoteRow,
	remoteAttention,
	rowIsRunning,
	rowTimeMs,
	splitSidebarSections,
} from "@/features/sessions/session-projection";

/** Which clock the time sections, the labels and the order read. */
export type SidebarBasis = "active" | "created";
export const SIDEBAR_BASES: readonly SidebarBasis[] = ["active", "created"];

/**
 * `active-first` lifts running rows (the ones stopped on the reader first)
 * above the rest; `recent` is one newest-first order with no lift. Under the
 * time-section grouping the two differ only inside Running, because Running is
 * its own section either way — exactly as on the desktop.
 */
export type SidebarOrderBy = "active-first" | "recent";
export const SIDEBAR_ORDERS: readonly SidebarOrderBy[] = [
	"active-first",
	"recent",
];

/** `section` draws Pinned/Running/Today/This week/Older; `flat` one list;
 *  `tag` draws one group per tag (Pinned leads), Untagged last. */
export type SidebarGroupBy = "section" | "flat" | "tag";
export const SIDEBAR_GROUPINGS: readonly SidebarGroupBy[] = [
	"section",
	"flat",
	"tag",
];

/** Every section the drawer can draw, in the desktop's canonical order. */
export type SidebarSectionKey =
	| "pinned"
	| "running"
	| "today"
	| "week"
	| "older";
export const SIDEBAR_SECTIONS: readonly SidebarSectionKey[] = [
	"pinned",
	"running",
	"today",
	"week",
	"older",
];

/** The whole preference, as persisted. */
export type SidebarView = {
	orderBy: SidebarOrderBy;
	groupBy: SidebarGroupBy;
	basis: SidebarBasis;
	/** Draw rows the relay reports `ended`. A pinned or running row is always
	 *  drawn: hiding it would make pinning, or a live turn, look like a no-op. */
	showEnded: boolean;
	/** Paint each row's tag line, and announce its tags with the row. The
	 *  assignment itself is untouched: long-press > Tags still opens the sheet. */
	showTags: boolean;
	/** Sections switched off. Applies to the `section` grouping only, as on the
	 *  desktop, where `In one list` draws every row whatever is hidden. */
	hidden: SidebarSectionKey[];
};

/** The desktop's `DEFAULT_SIDEBAR_VIEW`, projected onto the phone's axes. */
export const DEFAULT_SIDEBAR_VIEW: SidebarView = {
	orderBy: "active-first",
	groupBy: "section",
	basis: "active",
	showEnded: true,
	showTags: true,
	hidden: [],
};

/** The device-store key. Versioned in the value, like the theme's. */
export const SIDEBAR_VIEW_KEY = "lo-mobile-sidebar-view";
const VERSION = 1;

/**
 * The grouping `view` actually DRAWS on this relay.
 *
 * A stored `tag` meeting a relay without `session_tags.available` (an older
 * daemon, or one whose tag routes are off) draws the time sections for that
 * render, and the stored value is deliberately NOT rewritten: the reader chose
 * Tag, and reconnecting to a capable relay must give it back. Every write keeps
 * spreading the STORED view, never this answer (`serializeSidebarViewOver`).
 * The desktop's `chat-sidebar-view.ts` `drawnGroupBy` is the same rule for its
 * own stored `tag`.
 */
export function drawnGroupBy(
	view: Pick<SidebarView, "groupBy">,
	tagsAvailable: boolean,
): SidebarGroupBy {
	return view.groupBy === "tag" && !tagsAvailable ? "section" : view.groupBy;
}

const oneOf = <T extends string>(
	allowed: readonly T[],
	value: unknown,
	fallback: T,
): T => (allowed.includes(value as T) ? (value as T) : fallback);

/**
 * Read a stored view. Anything unreadable — no value, bad JSON, a field of the
 * wrong type or an unknown word — contributes the DEFAULT for that field
 * rather than discarding the rest: a corrupt preference must never cost the
 * reader the choices that did survive, and must never throw while the drawer
 * renders (the desktop's `parseSidebarView` rule).
 */
export function parseSidebarView(raw: string | null | undefined): SidebarView {
	if (raw === null || raw === undefined || raw === "")
		return DEFAULT_SIDEBAR_VIEW;
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return DEFAULT_SIDEBAR_VIEW;
	}
	if (typeof value !== "object" || value === null || Array.isArray(value))
		return DEFAULT_SIDEBAR_VIEW;
	const record = value as Record<string, unknown>;
	const hidden: SidebarSectionKey[] = [];
	if (Array.isArray(record.hidden)) {
		for (const entry of record.hidden) {
			if (
				SIDEBAR_SECTIONS.includes(entry as SidebarSectionKey) &&
				!hidden.includes(entry as SidebarSectionKey)
			)
				hidden.push(entry as SidebarSectionKey);
		}
	}
	return {
		orderBy: oneOf(
			SIDEBAR_ORDERS,
			record.orderBy,
			DEFAULT_SIDEBAR_VIEW.orderBy,
		),
		groupBy: oneOf(
			SIDEBAR_GROUPINGS,
			record.groupBy,
			DEFAULT_SIDEBAR_VIEW.groupBy,
		),
		basis: oneOf(SIDEBAR_BASES, record.basis, DEFAULT_SIDEBAR_VIEW.basis),
		showEnded:
			typeof record.showEnded === "boolean"
				? record.showEnded
				: DEFAULT_SIDEBAR_VIEW.showEnded,
		showTags:
			typeof record.showTags === "boolean"
				? record.showTags
				: DEFAULT_SIDEBAR_VIEW.showTags,
		hidden,
	};
}

export const serializeSidebarView = (view: SidebarView): string =>
	JSON.stringify({ v: VERSION, ...view });

const SIDEBAR_FIELDS = [
	"orderBy",
	"groupBy",
	"basis",
	"showEnded",
	"showTags",
	"hidden",
] as const satisfies readonly (keyof SidebarView)[];

/**
 * Serialize `next` OVER the stored bytes, writing only the fields the reader
 * changed relative to what was read (`hydrated`), plus any field the record
 * lacks. QA round 1, Q-2: `parseSidebarView` turns a word this build does not
 * know (a newer build's `orderBy: "future-order"`) into the default for
 * DISPLAY, and writing the parsed view whole then stored that default — so a
 * tap on any other field silently reset the newer build's choice. Unknown keys
 * and a newer `v` are carried through for the same reason. The theme's
 * `serializeSelectionOver` (`state/theme-preference.ts`) is the same rule.
 */
export const serializeSidebarViewOver = (
	stored: string | null,
	hydrated: SidebarView,
	next: SidebarView,
): string => {
	let record: Record<string, unknown> = {};
	try {
		const value: unknown = stored === null ? null : JSON.parse(stored);
		if (typeof value === "object" && value !== null && !Array.isArray(value))
			record = value as Record<string, unknown>;
	} catch {
		// Unparseable: nothing to preserve but the reader's view.
	}
	const out: Record<string, unknown> = { ...record };
	for (const field of SIDEBAR_FIELDS) {
		// `hidden` is an array, so compare by value, not identity.
		const changed =
			JSON.stringify(next[field]) !== JSON.stringify(hydrated[field]);
		if (changed || !(field in record)) out[field] = next[field];
	}
	out.v =
		typeof record.v === "number" && record.v > VERSION ? record.v : VERSION;
	return JSON.stringify(out);
};

/** Switch one section on or off, keeping the rest of the view. */
export function toggleSidebarSection(
	view: SidebarView,
	key: SidebarSectionKey,
): SidebarView {
	return {
		...view,
		hidden: view.hidden.includes(key)
			? view.hidden.filter((entry) => entry !== key)
			: [...view.hidden, key],
	};
}

/**
 * A turn that cannot proceed without the reader: an approval or a question.
 * The desktop's `STOPPED_ON_READER_CODES` (`approval`, `answer`), read from
 * the phone's own vocabulary — `needs_attention` on a local row, the gate word
 * (`remoteAttention`) on a remote one — so the lift and the row's mark agree.
 */
export function isStoppedOnReader(session: SessionSummary): boolean {
	if (isRemoteRow(session)) return remoteAttention(session) !== null;
	return session.needs_attention;
}

/**
 * The instant a RUNNING row orders by, in ms, or `null`. The desktop's
 * `runningOrderMs` chain (`chat-list-sections.ts`): the person's last message
 * (`last_user_at`, v0.102.5+) × 1000, else the row's birth, else `null`.
 * Neither clock moves when the assistant replies, so a response streaming into
 * a running conversation never reshuffles the Running section under the
 * reader's thumb; only the person speaking lifts it.
 *
 * A non-finite or `<= 0` `last_user_at` is "no claim" (the desktop's same
 * refusal), never 1970. `created_at` ONLY as the fallback — not
 * `rowTimeMs(…, "created")`, whose older-relay fallback is `mtime`, the very
 * clock a streamed reply moves (review round 1 on #255, M3). A relay with
 * neither gives `null`, so the row sorts last in its lane by arrival.
 */
export function runningOrderMs(session: SessionSummary): number | null {
	const isClaim = (value: unknown): value is number =>
		typeof value === "number" && Number.isFinite(value) && value > 0;
	if (isClaim(session.last_user_at)) return session.last_user_at * 1000;
	return isClaim(session.created_at) ? session.created_at * 1000 : null;
}

/** The lane a row occupies under `active-first`: stopped on the reader, then
 *  the other running rows, then everything else. `recent` is all lane 0. */
function liftLane(session: SessionSummary): number {
	if (isStoppedOnReader(session)) return 0;
	if (rowIsRunning(session)) return 1;
	return 2;
}

/** Newest first; "no clock" after every row that has one. */
function byNewest(a: number | null, b: number | null): number {
	if (a === null && b === null) return 0;
	if (a === null) return 1;
	if (b === null) return -1;
	return b - a;
}

/**
 * The arrangement — the desktop's `pageOrder`, the ONE place the drawn order of
 * an unpinned row is decided. The key is total: lane, then clock (a running
 * row's `runningOrderMs`, every other row's basis clock — the clock its label
 * prints), then ARRIVAL position. A tie keeps the relay's own order, never an
 * id or a title, which also makes the function idempotent.
 */
export function arrangeRows(
	rows: readonly SessionSummary[],
	orderBy: SidebarOrderBy,
	basis: SidebarBasis,
): SessionSummary[] {
	return rows
		.map((session, index) => ({
			session,
			index,
			lane: orderBy === "active-first" ? liftLane(session) : 0,
			at: rowIsRunning(session)
				? runningOrderMs(session)
				: rowTimeMs(session, basis),
		}))
		.sort(
			(a, b) => a.lane - b.lane || byNewest(a.at, b.at) || a.index - b.index,
		)
		.map((entry) => entry.session);
}

/** Whether a row is withheld by `showEnded: false`. Pinned and running rows
 *  never are; a remote row's `ended` always reads `false` (this device holds no
 *  generation record for a peer's conversation). */
export function isHiddenAsEnded(
	session: SessionSummary,
	view: SidebarView,
): boolean {
	return (
		!view.showEnded &&
		session.ended === true &&
		!session.pinned &&
		!rowIsRunning(session)
	);
}

/** One drawn group: a section, `all` for the flat list (no heading), or, under
 *  the tag grouping, one of `tag:<id>` / `untagged`. */
export type SidebarGroup = {
	/** Unique across the drawn list, so `buildItems` can key a heading with it. */
	key: SidebarSectionKey | "all" | "untagged" | `tag:${string}`;
	rows: SessionSummary[];
	/** `all` only: how many pinned rows lead `rows`. The flat list has no
	 *  Pinned heading, so without a mark its pins read as a mis-sorted head of a
	 *  "Most recent" list (design review round 1, D1); the drawer draws a divider
	 *  after this many rows. Absent on a section — its heading says it. */
	pinnedLead?: number;
	/** Tag grouping only: the tag the group holds and how many conversations it
	 *  has. Absent on `untagged` (its heading is a catalogue word, not a name)
	 *  and on every section. */
	tag?: { id: string; name: string; count: number };
};

/** Whether `group` is a time section, so `SIDEBAR_SECTION_LABEL` and its region
 *  testID own its heading. A tag group's key is an id, and `all`/`untagged` are
 *  the list's own words. */
export function isSectionGroup(
	group: SidebarGroup,
): group is SidebarGroup & { key: SidebarSectionKey } {
	return SIDEBAR_SECTIONS.includes(group.key as SidebarSectionKey);
}

/** What `arrangeSidebar` needs to know about the relay, beyond the stored view. */
export type SidebarArrangeOptions = {
	/** `session_tags.available` — what a stored `tag` grouping DRAWS as. */
	tagsAvailable: boolean;
	/** The tag registry's ids in its own `order` (`GET /api/tags`). Omitted while
	 *  the read is in flight or failed: groups then fall back to first-seen order. */
	tagOrder?: readonly string[];
};

/**
 * The bucket a row falls in under the tag grouping: its PRIMARY tag, and only
 * while that id is still assigned. The store's `primary` is a filter over
 * `tags`, but a stale frame can name one the relay pruned, and a row must never
 * be grouped under a tag it no longer carries (the desktop's rule).
 */
function primaryTagOf(
	session: SessionSummary,
): { id: string; name: string } | null {
	if (session.primary === null || session.primary === undefined) return null;
	const tag = (session.tags ?? []).find(
		(entry) => entry.id === session.primary,
	);
	return tag === undefined ? null : { id: tag.id, name: tag.name };
}

/**
 * The tag arrangement: Pinned leads in its own group (relay order, as today),
 * then one group per tag, then Untagged last. Rows inside a group keep the
 * existing order (`arrangeRows` on the non-pinned rows). Empty groups are
 * omitted, the same rule every grouping follows.
 *
 * GROUP ORDER. The registry's own `order` when the catalogue has been read;
 * while that read is in flight or failed, first-seen order over the DRAWN list
 * (so the reader still gets a stable arrangement without waiting on a request).
 * A tag the read did not name goes after the known ones, in first-seen order —
 * a stale catalogue must never hide an assignment.
 */
function arrangeByTag(
	pinned: readonly SessionSummary[],
	rest: readonly SessionSummary[],
	tagOrder: readonly string[] | undefined,
): SidebarGroup[] {
	const buckets = new Map<string, { name: string; rows: SessionSummary[] }>();
	const untagged: SessionSummary[] = [];
	for (const session of rest) {
		const tag = primaryTagOf(session);
		if (tag === null) {
			untagged.push(session);
			continue;
		}
		const bucket = buckets.get(tag.id);
		if (bucket === undefined)
			buckets.set(tag.id, { name: tag.name, rows: [session] });
		else bucket.rows.push(session);
	}
	const ordered: string[] = [];
	const seen = new Set<string>();
	for (const id of tagOrder ?? []) {
		if (buckets.has(id) && !seen.has(id)) {
			seen.add(id);
			ordered.push(id);
		}
	}
	for (const id of buckets.keys()) {
		if (seen.has(id)) continue;
		seen.add(id);
		ordered.push(id);
	}
	const groups: SidebarGroup[] = [];
	if (pinned.length > 0) groups.push({ key: "pinned", rows: [...pinned] });
	for (const id of ordered) {
		const bucket = buckets.get(id);
		if (bucket === undefined) continue;
		groups.push({
			key: `tag:${id}`,
			rows: bucket.rows,
			tag: { id, name: bucket.name, count: bucket.rows.length },
		});
	}
	if (untagged.length > 0) groups.push({ key: "untagged", rows: untagged });
	return groups;
}

/**
 * The drawer's whole list under `view`: groups in draw order, empty ones
 * omitted (an empty section contributes no heading, the desktop's rule).
 *
 * Pinned rows keep the relay's order and lead — a pin is the reader's own
 * "keep this at the top", and the desktop never clock-sorts its Pinned
 * section. Under `flat` they lead the single list rather than vanish, the
 * desktop's "a grouping changes the arrangement, never which conversations are
 * drawn" (`chat-sidebar.tsx`, operator's view-settings audit 2026-09-27).
 *
 * The grouping judged is the DRAWN one (`drawnGroupBy`): a stored `tag` on a
 * relay without tags arranges as time sections, and `hidden` therefore applies
 * exactly then — sections are the only grouping the per-section switches
 * govern.
 */
export function arrangeSidebar(
	sessions: readonly SessionSummary[],
	view: SidebarView,
	now: number,
	options: SidebarArrangeOptions,
): SidebarGroup[] {
	const grouping = drawnGroupBy(view, options.tagsAvailable);
	const shown = sessions.filter((session) => !isHiddenAsEnded(session, view));
	const pinned = shown.filter((session) => session.pinned);
	const rest = arrangeRows(
		shown.filter((session) => !session.pinned),
		view.orderBy,
		view.basis,
	);
	if (grouping === "flat") {
		const rows = [...pinned, ...rest];
		return rows.length === 0
			? []
			: [{ key: "all", rows, pinnedLead: pinned.length }];
	}
	if (grouping === "tag") return arrangeByTag(pinned, rest, options.tagOrder);
	// Bins are a filter over the arranged list, so each section keeps its order.
	const bins = splitSidebarSections(rest, now, view.basis);
	const byKey: Record<SidebarSectionKey, SessionSummary[]> = {
		pinned,
		running: bins.running,
		today: bins.today,
		week: bins.week,
		older: bins.older,
	};
	return SIDEBAR_SECTIONS.filter(
		(key) => !view.hidden.includes(key) && byKey[key].length > 0,
	).map((key) => ({ key, rows: byKey[key] }));
}

/**
 * Whether `view` differs from the default in any field (`hidden` compared as a
 * set). The drawer's trigger fills when it does — the desktop's `viewIsCustom`
 * cue on its View options button — so a reader whose list looks short has a
 * visible reason, wherever the change was made (design review round 1, D2).
 *
 * Judged on the DRAWN grouping: a stored `tag` on a relay without tags draws the
 * default sections, so the trigger must not claim a change the list does not
 * show. A hidden `showTags` is a change whatever the relay advertises — the
 * switch is not drawn there, but the stored choice still withholds lines.
 */
export function isCustomSidebarView(
	view: SidebarView,
	tagsAvailable: boolean,
): boolean {
	return (
		view.orderBy !== DEFAULT_SIDEBAR_VIEW.orderBy ||
		drawnGroupBy(view, tagsAvailable) !== DEFAULT_SIDEBAR_VIEW.groupBy ||
		view.basis !== DEFAULT_SIDEBAR_VIEW.basis ||
		view.showEnded !== DEFAULT_SIDEBAR_VIEW.showEnded ||
		view.showTags !== DEFAULT_SIDEBAR_VIEW.showTags ||
		view.hidden.length > 0
	);
}

/**
 * How many sections the view is actually withholding: the time grouping's
 * `hidden`, and zero under `In one list` or the tag grouping, which draw every
 * row whatever is hidden (`arrangeSidebar`). The drawer's quiet "N sections
 * hidden" line — the desktop's `ui.chat.sidebar_view.hidden` — reads this, so
 * it never claims a section is hidden while its rows are on screen (D2).
 */
export function hiddenSectionCount(
	view: SidebarView,
	tagsAvailable: boolean,
): number {
	return drawnGroupBy(view, tagsAvailable) === "section"
		? view.hidden.length
		: 0;
}

/**
 * The catalogue has rows but the view draws none (every row ended with Show
 * ended off, or every populated section switched off). The pane must not say
 * "No sessions yet" then — that headline is false and points nowhere near the
 * cause (agent review round 1, M1).
 */
export function isEmptiedByView(
	sessions: readonly SessionSummary[],
	groups: readonly SidebarGroup[],
): boolean {
	return sessions.length > 0 && groups.length === 0;
}
