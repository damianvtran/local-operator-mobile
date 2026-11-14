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
 *   - RUNNING rows key on their BIRTH. The desktop keys a running row by
 *     `last_user_at` (the person's last message, so a response landing in a
 *     running chat never re-sorts it) and falls back to `created_at`. The
 *     phone's relay list (`/api/sessions`, `daemon.py` `_merge_summaries`) does
 *     not publish `last_user_at`, so this is the desktop's own fallback, always.
 *     The client half is ready: `runningOrderMs` is the one place to read the
 *     field once the relay sends it and the contract declares it.
 *   - `groupBy` has no `agent` arrangement: the phone's row carries no binding
 *     (agent/team), so "Agent and team" would put every row in "Ungrouped".
 *   - `showEnded` is the phone's own: the desktop has no ended filter, but the
 *     phone draws the relay's `ended` receipt on rows, and a reader on a small
 *     screen asked for a way to put finished conversations away. Default ON, so
 *     a fresh install matches the desktop.
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

/** `section` draws Pinned/Running/Today/This week/Older; `flat` one list. */
export type SidebarGroupBy = "section" | "flat";
export const SIDEBAR_GROUPINGS: readonly SidebarGroupBy[] = ["section", "flat"];

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
	hidden: [],
};

/** The device-store key. Versioned in the value, like the theme's. */
export const SIDEBAR_VIEW_KEY = "lo-mobile-sidebar-view";
const VERSION = 1;

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
		hidden,
	};
}

export const serializeSidebarView = (view: SidebarView): string =>
	JSON.stringify({ v: VERSION, ...view });

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
 * `runningOrderMs`: the person's last message (`last_user_at`) — which this
 * relay does not publish (see the module header) — else the row's birth,
 * which does not move, so a response streaming into a running conversation
 * never reshuffles the Running section under the reader's thumb.
 *
 * `created_at` ONLY — not `rowTimeMs(…, "created")`, whose older-relay fallback
 * is `mtime`, the very clock a streamed reply moves (review round 1, M3). A
 * relay without the field gives `null`, so the row sorts last in its lane by
 * arrival, as the desktop's chain ends in `null` too.
 */
export function runningOrderMs(session: SessionSummary): number | null {
	const born = session.created_at;
	return typeof born === "number" && Number.isFinite(born) && born > 0
		? born * 1000
		: null;
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

/** One drawn group: a section, or `all` for the flat list (no heading). */
export type SidebarGroup = {
	key: SidebarSectionKey | "all";
	rows: SessionSummary[];
	/** `all` only: how many pinned rows lead `rows`. The flat list has no
	 *  Pinned heading, so without a mark its pins read as a mis-sorted head of a
	 *  "Most recent" list (design review round 1, D1); the drawer draws a divider
	 *  after this many rows. Absent on a section — its heading says it. */
	pinnedLead?: number;
};

/**
 * The drawer's whole list under `view`: groups in draw order, empty ones
 * omitted (an empty section contributes no heading, the desktop's rule).
 *
 * Pinned rows keep the relay's order and lead — a pin is the reader's own
 * "keep this at the top", and the desktop never clock-sorts its Pinned
 * section. Under `flat` they lead the single list rather than vanish, the
 * desktop's "a grouping changes the arrangement, never which conversations are
 * drawn" (`chat-sidebar.tsx`, operator's view-settings audit 2026-09-27).
 */
export function arrangeSidebar(
	sessions: readonly SessionSummary[],
	view: SidebarView,
	now: number,
): SidebarGroup[] {
	const shown = sessions.filter((session) => !isHiddenAsEnded(session, view));
	const pinned = shown.filter((session) => session.pinned);
	const rest = arrangeRows(
		shown.filter((session) => !session.pinned),
		view.orderBy,
		view.basis,
	);
	if (view.groupBy === "flat") {
		const rows = [...pinned, ...rest];
		return rows.length === 0
			? []
			: [{ key: "all", rows, pinnedLead: pinned.length }];
	}
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
 */
export function isCustomSidebarView(view: SidebarView): boolean {
	return (
		view.orderBy !== DEFAULT_SIDEBAR_VIEW.orderBy ||
		view.groupBy !== DEFAULT_SIDEBAR_VIEW.groupBy ||
		view.basis !== DEFAULT_SIDEBAR_VIEW.basis ||
		view.showEnded !== DEFAULT_SIDEBAR_VIEW.showEnded ||
		view.hidden.length > 0
	);
}

/**
 * How many sections the view is actually withholding: the time grouping's
 * `hidden`, and zero under `In one list`, which draws every row whatever is
 * hidden (`arrangeSidebar`). The drawer's quiet "N sections hidden" line — the
 * desktop's `ui.chat.sidebar_view.hidden` — reads this, so it never claims a
 * section is hidden while its rows are on screen (D2).
 */
export function hiddenSectionCount(view: SidebarView): number {
	return view.groupBy === "section" ? view.hidden.length : 0;
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
