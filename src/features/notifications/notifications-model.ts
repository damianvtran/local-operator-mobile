/**
 * The inbox's pure half: what the list is made of, and what a gesture sends.
 *
 * Everything here is a function of the relay's answer and the reader's actions,
 * with no React and no wire call, because the rules that decide a WRITE are the
 * ones worth testing exhaustively — and the two that matter are both about
 * honesty:
 *
 *  1. **A write names the revision it rendered.** An update published after the
 *     row was drawn must survive a gesture aimed at the row before it (the
 *     contract's R10 applied to items). So a target is `{id, revision}` and
 *     never a bare id, and a mark-all names the answer's own `high_water` — the
 *     furthest event the screen ever held.
 *  2. **A verb exists only where the relay says it does.** An ask is answered,
 *     not dismissed (contract §2.3): the relay refuses a dismiss with
 *     `live_ask`, so the phone does not offer the gesture at all. `actions` is
 *     read as permission, not as a hint.
 *
 * The grouping is the design's (§10, "the relay layout"): open asks pinned in
 * "Waiting on you", then updates by the time they were last touched. The
 * buckets are labels over `updated_at`, computed once per render from the
 * screen's own minute clock, so a frame left open ages the way the schedules
 * screen's due labels do.
 */

import type { NotificationItem, NotificationsResponse } from "@/contracts";
import type { NotificationTarget } from "@/relay";

/** `updated_at` is epoch SECONDS on this wire (the item shape's own unit — the
 *  session clocks are seconds too). */
const MS = 1000;
const DAY_MS = 86_400_000;

export type InboxSectionId =
	| "waiting"
	| "today"
	| "yesterday"
	| "week"
	| "earlier";

export interface InboxSection {
	id: InboxSectionId;
	/** The section header the reader sees. */
	title: string;
	items: NotificationItem[];
}

/** The pinned asks' header. "Waiting on you" is the operator's own word for the
 *  pile (brief, "everything that's pending in one view"), and the section is the
 *  reason the screen opens. */
export const WAITING_TITLE = "Waiting on you";

const BUCKET_TITLES: Record<Exclude<InboxSectionId, "waiting">, string> = {
	today: "Today",
	yesterday: "Yesterday",
	week: "Earlier this week",
	earlier: "Earlier",
};

/**
 * One answer, as the list draws it.
 *
 * The asks come FIRST and unfiltered: they are the items an agent is blocked
 * on, and the server sends them unpaged for that reason. The updates keep the
 * relay's own order within a bucket — this function sorts nothing, because the
 * `seq` order is the store's and re-sorting by a client clock would put a row
 * written a second later above one written earlier.
 *
 * Empty sections are OMITTED rather than rendered with a zero-row heading: a
 * heading over nothing reads as a loading failure.
 */
export function inboxSections(
	response: NotificationsResponse,
	nowMs: number,
): InboxSection[] {
	const sections: InboxSection[] = [];
	if (response.waiting.length > 0) {
		sections.push({
			id: "waiting",
			title: WAITING_TITLE,
			items: response.waiting,
		});
	}
	const buckets = new Map<
		Exclude<InboxSectionId, "waiting">,
		NotificationItem[]
	>();
	for (const item of response.items) {
		const bucket = timeBucket(item.updated_at * MS, nowMs);
		const rows = buckets.get(bucket);
		if (rows === undefined) buckets.set(bucket, [item]);
		else rows.push(item);
	}
	/* Rendered in calendar order regardless of arrival, so the list reads like a
	 * timeline rather than like the order the API happened to return. */
	for (const id of ["today", "yesterday", "week", "earlier"] as const) {
		const rows = buckets.get(id);
		if (rows !== undefined && rows.length > 0) {
			sections.push({ id, title: BUCKET_TITLES[id], items: rows });
		}
	}
	return sections;
}

/** Which bucket an instant belongs to. "Today" is the reader's LOCAL calendar
 *  day, not 24 hours back: an item from 23:00 last night is "Yesterday" at
 *  00:30, which is what a person means by the word. */
export function timeBucket(
	atMs: number,
	nowMs: number,
): Exclude<InboxSectionId, "waiting"> {
	const startOfToday = new Date(nowMs);
	startOfToday.setHours(0, 0, 0, 0);
	const todayStart = startOfToday.getTime();
	if (atMs >= todayStart) return "today";
	if (atMs >= todayStart - DAY_MS) return "yesterday";
	if (atMs >= todayStart - 6 * DAY_MS) return "week";
	return "earlier";
}

/** Every row on screen, section by section — the order the FlatList renders, so
 *  a viewability callback's indices map back to this array. */
export function inboxRows(response: NotificationsResponse): NotificationItem[] {
	return [...response.waiting, ...response.items];
}

/** The number the entry point's badge draws: unread updates plus unread open
 *  asks (design §11). Read from the relay's counts, never recomputed by
 *  filtering the page — the page can be a prefix of the pile, and a badge that
 *  counted a prefix would understate how much is waiting. */
export function inboxUnreadCount(response: NotificationsResponse): number {
	return response.unread_count;
}

/** `99+` past two digits, the same cap every count in the app uses. The badge is
 *  a prompt to open the inbox, not a report of an exact number nobody can act on. */
export function countLabel(count: number): string {
	return count > 99 ? "99+" : String(count);
}

export function badgeAccessibilityLabel(count: number): string {
	const noun = count === 1 ? "notification" : "notifications";
	return `Notifications, ${count} unread ${noun}`;
}

/** The row's identity INCLUDING its revision.
 *
 *  Selection is keyed by this, not by `id`: a row that was updated while it sat
 *  selected is a different claim ("I saw this text"), and keeping the revision in
 *  the key is what makes a stale selection drop out instead of writing against a
 *  row the operator never read. */
export function rowKey(item: NotificationItem): string {
	return `${item.id}@${item.revision}`;
}

export function toggleSelection(
	selection: ReadonlySet<string>,
	item: NotificationItem,
): Set<string> {
	const next = new Set(selection);
	const key = rowKey(item);
	if (next.has(key)) next.delete(key);
	else next.add(key);
	return next;
}

/**
 * The selection, as write targets.
 *
 * `rows` is the page the selection was made from, and an id that is no longer in
 * it is DROPPED: the row moved (a new revision re-keyed it) or left the filter,
 * and either way the write it would have sent names a revision the relay would
 * skip. Dropping it here means the screen's `changed`/`skipped` report describes
 * what was actually asked for.
 */
export function selectionTargets(
	selection: ReadonlySet<string>,
	rows: ReadonlyArray<NotificationItem>,
): NotificationTarget[] {
	const targets: NotificationTarget[] = [];
	for (const item of rows) {
		if (!selection.has(rowKey(item))) continue;
		targets.push({ id: item.id, revision: item.revision });
	}
	return targets;
}

/** A selection of one verb: dismiss is offered only for rows the relay admits,
 *  so a mixed selection's dismiss leaves the asks out of the request entirely
 *  rather than sending them to be refused. */
export function dismissableTargets(
	selection: ReadonlySet<string>,
	rows: ReadonlyArray<NotificationItem>,
): NotificationTarget[] {
	return selectionTargets(selection, rows).filter((target) => {
		const row = rows.find((candidate) => candidate.id === target.id);
		return row !== undefined && canDismiss(row);
	});
}

/** Whether the row admits a reel dismiss. An OPEN ASK never does — it is settled
 *  through the ask's own reasoned door, which tells the agent (contract §2.3) —
 *  and the relay's `actions.dismiss` carries that verdict for everything else. */
export function canDismiss(item: NotificationItem): boolean {
	return item.actions.dismiss && item.ask === null;
}

/** The mark-all write: every row at or below the answer's `high_water`.
 *
 *  NOT a session-wide sweep and not "everything in the store": a mark-all clears
 *  exactly the events this screen was shown, so an item that arrived after the
 *  list loaded is still unread when the next read lands. `high_water` is the
 *  relay's own max seq, which is why the client never invents one. */
export function markAllTarget(response: NotificationsResponse): {
	through_seq: number;
} | null {
	return response.high_water > 0 ? { through_seq: response.high_water } : null;
}

/** Whether anything is unread in this answer — the condition the "Mark all
 *  read" control exists under. */
export function hasUnread(response: NotificationsResponse): boolean {
	return response.unread_count > 0;
}

/** The all-caught-up state's condition: the relay answered, the pile is empty,
 *  and nothing is pinned. Distinguished from "no items YET" by the caller, which
 *  only renders it once a read has landed. */
export function inboxEmpty(response: NotificationsResponse): boolean {
	return response.items.length === 0 && response.waiting.length === 0;
}

/** Plural agreement without a string table: the count decides the word, the
 *  caller supplies both forms. */
export function plural(count: number, one: string, many: string): string {
	return `${count} ${count === 1 ? one : many}`;
}

/** The lead sentence over the pinned section: how many things are actually
 *  blocked on the operator. A count of one is a sentence, not "1 asks". */
export function waitingSummary(count: number): string {
	return count === 1
		? "1 agent is waiting on you"
		: `${count} agents are waiting on you`;
}

/** The selection bar's own line: how many rows the next write will touch. */
export function selectedCountLabel(count: number): string {
	return count === 0
		? "Nothing selected"
		: plural(count, "item selected", "items selected");
}

/** The unread summary under the header. Zero is not rendered (the caller hides
 *  it), so this function never has to say "nothing". */
export function unreadSummary(count: number): string {
	return count === 1 ? "1 unread" : `${count} unread`;
}

/* ------------------------------------------------------------------- copy -- */

export const INBOX_TITLE = "Notifications";
export const ALL_CAUGHT_UP_TITLE = "All caught up";
export const ALL_CAUGHT_UP_BODY =
	"Nothing is waiting on you. New items from your agents land here.";
export const EMPTY_ALL_BODY =
	"Nothing has landed here yet. Updates from your agents arrive in this list.";
export const READ_UNREACHABLE =
	"Couldn't reach your computer. The inbox is unknown, not empty.";
export const READ_FAILED = "Couldn't read the inbox.";
export const MARK_ALL_LABEL = "Mark all read";
export const MARK_ALL_BUSY = "Marking…";
export const SELECT_LABEL = "Select";
export const SELECT_DONE = "Done";
export const MARK_READ_LABEL = "Mark read";
export const MARK_UNREAD_LABEL = "Mark unread";
export const DISMISS_LABEL = "Dismiss";
export const ANSWER_LABEL = "Answer";
export const OPEN_LABEL = "Open conversation";
export const RETRY_LABEL = "Try again";
export const LOAD_MORE_LABEL = "Load more";
export const BACK_LABEL = "Back";
export const FILTER_UNREAD = "Unread";
export const FILTER_ALL = "All";
export const SKIPPED_SENTENCE =
	"That item moved while you were looking. It is still in your inbox.";

/** What a detail view says when the item is gone (dismissed, or its ask was
 *  answered elsewhere): the vanished notice's sentence (design §10). */
export const VANISHED_TITLE = "This item is gone";
export const VANISHED_BODY =
	"It was dismissed, or the ask it named was answered somewhere else.";
export const DETAIL_UNREACHABLE =
	"Couldn't load that notification — opened its conversation instead.";

/** The row's one-line time, in the minute vocabulary the rest of the app uses
 *  (`in 4m`, `2h overdue` on the schedules screen) rather than a timestamp: the
 *  reader is deciding what to clear, not reading a log. */
export function relativeTime(atMs: number, nowMs: number): string {
	const delta = Math.max(0, nowMs - atMs);
	const minutes = Math.round(delta / 60_000);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.round(hours / 24);
	return days === 1 ? "yesterday" : `${days}d ago`;
}

/**
 * One line of the inbox list: a section heading or a row.
 *
 * The screen's list is virtualised (the receipt feed needs the platform's own
 * viewability answers), so the sections are flattened into one array whose
 * indices the viewability callback reports. `row` entries carry the item itself,
 * which is what the feed needs to key a receipt by id AND revision.
 */
export type InboxEntry =
	| { kind: "header"; id: string; title: string }
	| { kind: "row"; id: string; item: NotificationItem };
