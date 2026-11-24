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

import type {
	Capabilities,
	NotificationItem,
	NotificationsResponse,
} from "@/contracts";
import { preferredLocale, renderFor, t } from "@/i18n";
import type { NotificationTarget } from "@/relay";

import type { ConversationDismissPhase } from "./use-conversation-dismiss";

/** The inbox stamps are epoch MILLISECONDS, unlike the session clocks. */
const DAY_MS = 86_400_000;

/** The relay owns this capability flag. An older daemon omits it: hiding both
 *  entry points there avoids offering a route that can only return 404. The
 *  versioned feature bag has the same truth rule as Library's existing gate. */
export function notificationsEnabled(capabilities: Capabilities): boolean {
	const value = capabilities.features?.notifications;
	if (value === undefined || value === null || value === false) return false;
	if (typeof value === "number") return value > 0;
	if (typeof value === "string") return value !== "" && value !== "0";
	return true;
}

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
/* Functions, not constants: `t()` reads the active locale at CALL time, and a
 * module-level constant would freeze whichever language was active when this
 * module was first imported. The bucket words are the shared `mobile.time.bucket`
 * keys so the inbox and the Team Bridge day divider say "Today" identically. */
const waitingTitle = (): string => t("mobile.notifications.section.waiting");

const bucketTitle = (id: Exclude<InboxSectionId, "waiting">): string => {
	switch (id) {
		case "today":
			return t("mobile.time.bucket.today");
		case "yesterday":
			return t("mobile.time.bucket.yesterday");
		case "week":
			return t("mobile.time.bucket.earlier_this_week");
		case "earlier":
			return t("mobile.time.bucket.earlier");
	}
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
	/* `waiting` is absent on a cursor page and under some filters; absent is "no
	 * pinned rows in THIS answer", which is what an omitted section renders. */
	const waiting = response.waiting ?? [];
	const sections: InboxSection[] = [];
	if (waiting.length > 0) {
		sections.push({ id: "waiting", title: waitingTitle(), items: waiting });
	}
	const buckets = new Map<
		Exclude<InboxSectionId, "waiting">,
		NotificationItem[]
	>();
	for (const item of response.items) {
		const bucket = timeBucket(item.updated_at, nowMs);
		const rows = buckets.get(bucket);
		if (rows === undefined) buckets.set(bucket, [item]);
		else rows.push(item);
	}
	/* Rendered in calendar order regardless of arrival, so the list reads like a
	 * timeline rather than like the order the API happened to return. */
	for (const id of ["today", "yesterday", "week", "earlier"] as const) {
		const rows = buckets.get(id);
		if (rows !== undefined && rows.length > 0) {
			sections.push({ id, title: bucketTitle(id), items: rows });
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
	return [...(response.waiting ?? []), ...response.items];
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
	/* AN ASK IS NEVER SELECTED, whoever asks. It cannot be dismissed (the relay
	 *  answers `skipped: live_ask`) and it cannot be read (it is answered), so it
	 *  is not a member of any selection — which also keeps the count the reader is
	 *  shown equal to the count the doors can act on (design review round 2 D9). */
	if (item.source === "ask") return new Set(selection);
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
	return response.items.length === 0 && (response.waiting ?? []).length === 0;
}

/** The phases `DismissReceipt` draws: a count in progress, or what a dismiss
 *  (or its Undo) did. */
export type ReceiptPhase = Extract<
	ConversationDismissPhase,
	{ kind: "counting" | "done" | "undone" | "none" | "failed" }
>;

/** Whether the dismiss receipt draws anything for this phase. The ONE rule:
 *  `DismissReceipt` returns null on it, and the list's pinned footer pays the
 *  bottom safe-area inset only while it holds something, so an idle list keeps
 *  scrolling under the home indicator (#321). */
export function dismissReceiptShowing(
	phase: ConversationDismissPhase,
): phase is ReceiptPhase {
	switch (phase.kind) {
		case "counting":
		case "done":
		case "undone":
		case "none":
		case "failed":
			return true;
		default:
			return false;
	}
}

/** Plural agreement without a string table: the count decides the word, the
 *  caller supplies both forms. */
export function plural(count: number, one: string, many: string): string {
	return `${count} ${count === 1 ? one : many}`;
}

/** The lead sentence over the pinned section: how many things are actually
 *  blocked on the operator. A count of one is a sentence, not "1 asks". */
export function waitingSummary(count: number): string {
	return t("mobile.notifications.section.waiting_count", { count });
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
/** The page failed and the reader may re-issue the same cursor. Deliberately
 *  says "again": the failure is retryable, and the rows already on screen are
 *  not in question. */
export const LOAD_MORE_FAILED =
	"Couldn't load the next page. The rows already shown are still accurate.";
export const LOAD_MORE_RETRY = "Try again";
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
/**
 * The cursor walk's own state: the last failure, or nothing.
 *
 * A transition pair rather than a raw `string | null` in the hook, because the
 * RULES are the behaviour — a refresh clears the failure, a failed page states
 * one, a successful page clears it — and rules stated as functions can be driven
 * by tests without a renderer (code review round 5, m5).
 */
export type PageWalk = { error: string | null };

export const PAGE_WALK_IDLE: PageWalk = { error: null };

/** A page-one answer (refresh, filter switch, silent reload) or a landed page:
 *  whatever the walk said before is no longer true of the list on screen. */
export function pageWalkStarted(): PageWalk {
	return PAGE_WALK_IDLE;
}

/** The page failed; the sentence is what the reader is shown. */
export function pageWalkFailed(sentence: string): PageWalk {
	return { error: sentence };
}

/** Which single control the list footer shows. Exactly one — two buttons that
 *  re-issue the same cursor would be one verb twice, and "Load more" beside a
 *  failure sentence would promise something other than the retry it names
 *  (code review round 5, m3/m5). */
export type FooterControl = "spinner" | "retry" | "loadMore" | "none";

export function footerControl(input: {
	loadingMore: boolean;
	hasCursor: boolean;
	error: string | null;
}): FooterControl {
	if (input.loadingMore) return "spinner";
	if (input.error !== null) return "retry";
	return input.hasCursor ? "loadMore" : "none";
}

/**
 * One cursor page merged onto what the screen already holds.
 *
 * WHAT COMES FROM PAGE ONE, AND WHY. `waiting` is first-page-only by contract,
 * and the store-wide counts describe the window the rows on screen were served
 * under — a later page's numbers would re-label the pile under the reader
 * mid-walk, and ADDING them would double-count rows that were never per-page.
 * `high_water` stays the first answer's boundary (`Math.min`, so a relay that
 * reports a lower watermark after a restart moves in the conservative
 * direction) and the observed window is the UNION, because that is what a bulk
 * write may touch: replacing it page by page made "Mark all read" reach only the
 * last page while its label described the whole pile.
 *
 * Page-one rows are never dropped: the merge is an append, so a page that
 * arrives while a refresh is in flight cannot erase what the reader is looking
 * at. Extracted from the hook so the arithmetic is testable without a renderer
 * (review round 4, m1).
 */
/** The union of two `observed` lists, deduped by id, keeping the LAST revision
 *  the relay stated for each. */
export function unionTokens(
	held: ReadonlyArray<{ id: string; revision: number }> | undefined,
	next: ReadonlyArray<{ id: string; revision: number }> | undefined,
): Array<{ id: string; revision: number }> {
	const merged = new Map<string, { id: string; revision: number }>();
	for (const token of [...(held ?? []), ...(next ?? [])]) {
		merged.set(token.id, { id: token.id, revision: token.revision });
	}
	return [...merged.values()];
}

export function mergePage(
	held: NotificationsResponse,
	page: NotificationsResponse,
): NotificationsResponse {
	return {
		...page,
		unread_count: held.unread_count,
		waiting_count: held.waiting_count,
		waiting_unread_count: held.waiting_unread_count,
		waiting: held.waiting,
		high_water: Math.min(held.high_water, page.high_water),
		observed: unionTokens(held.observed, page.observed),
		items: [...held.items, ...page.items],
	};
}

/**
 * The explicit read of a LOADED detail, then the row read BACK — in that order,
 * always (QA round 3, Q8).
 *
 * The read re-stamps the item and raises the store's `high_water`; a dismissal
 * counted from the pre-read answer froze a boundary BELOW the row on screen, so
 * the reader's own "Dismiss all" skipped the item they had just opened as
 * `stale_revision` (measured: through_seq 232, observed revision 69, the read
 * moved it to 70 → 40 of 41). Sequencing the two is the whole fix; the re-read
 * exists because the write's answer names what CHANGED, not the revision the
 * change produced, and every later write must name a token the relay honours.
 *
 * A failure is silent and keeps the original: the row stays unread (the safe
 * direction) and the next open retries it. Only an UPDATE is read — an ask is
 * answered, never read.
 */
export async function readLoadedDetail<
	Detail extends {
		item: { id: string; read: boolean; revision: number; source: string };
	},
>(
	detail: Detail,
	io: {
		read: (
			id: string,
			revision: number,
			signal: AbortSignal,
		) => Promise<{ changed: string[] }>;
		reload: (id: string, signal: AbortSignal) => Promise<Detail | null>;
	},
	/** The write's own budget. Short because the reader is on this screen waiting
	 *  for it; a timeout is a FAILED read — the item stays unread and the caller's
	 *  walk still runs, so Dismiss-all opens on a fresh boundary (m4). */
	budget: { timeoutMs: number } = { timeoutMs: 3_500 },
): Promise<Detail> {
	if (detail.item.read || detail.item.source !== "notify") return detail;
	const signal = AbortSignal.timeout(budget.timeoutMs);
	const moved = await io
		.read(detail.item.id, detail.item.revision, signal)
		.then(
			(answer) => answer.changed.includes(detail.item.id),
			() => false,
		);
	if (!moved) return detail;
	const refreshed = await io.reload(detail.item.id, signal).catch(() => null);
	return refreshed ?? detail;
}

/**
 * The bare `ask_id` an inbox ASK's detail names, for `AsksSheet.initialOpenAsk`.
 *
 * The detail's item carries the relay's COMPOSITE id (`ask:<session>:<ask_id>`,
 * the format `RelayEndpoints.notification` escapes), while the sheet expands a
 * row whose `ask_id` EQUALS `initialOpenAsk`. Handing it the composite compared
 * two different vocabularies, so the sheet opened collapsed on the ask the
 * reader had just pressed to answer (Ben, 2026-11-23).
 *
 * WHY THE ID AND NOT `detail.asks[0]`: that array is the CONVERSATION's asks
 * INCLUDING settled ones, and the contract states no order, so its first row
 * need not be the ask this card is about — expanding the wrong ask would be
 * worse than expanding none. The item's own id is the only field that names
 * THIS ask; its ask id is the last colon-separated segment.
 *
 * A card that is not an ask expands nothing, and an id the sheet's own read does
 * not return still expands nothing there: the sheet keeps its collapsed walk
 * rather than inventing a row (`AsksSheet` doc, "an id the read does not
 * return").
 */
export function openAskIdFor(detail: {
	item: Pick<NotificationItem, "id" | "source">;
}): string | null {
	if (detail.item.source !== "ask") return null;
	const cut = detail.item.id.lastIndexOf(":");
	const askId = cut < 0 ? "" : detail.item.id.slice(cut + 1);
	return askId === "" ? null : askId;
}

/**
 * A clock as an age, or `""` when there is NO clock.
 *
 * `0` is the wire's "this field carries nothing" (an ask's `expires_at: 0` means
 * no deadline; a row without an update stamp carries `updated_at: 0`). Formatting
 * it as an age produced "20752d ago" — the whole distance from 1970 — so the
 * caller renders no age at all, and the sentence around it drops its separator
 * rather than trailing a `·` into nothing (QA round 4, O2).
 */
/**
 * A conversation's name for copy, with the SAME fallback the reel uses
 * (`state/list-store.ts` `sessionTitle`): a nameless conversation is
 * "untitled". "Dismiss all 30 from " with nothing after it was the alternative
 * (QA round 4, O1).
 */
export function conversationName(title: string | undefined | null): string {
	const name = (title ?? "").trim();
	return name.length > 0 ? name : "untitled";
}

/**
 * One row as a screen reader says it.
 *
 * Every clause is optional and nothing leaves a dangling separator: the age is
 * OMITTED when there is no clock (`relativeTime` answers `""`), so a zero stamp
 * no longer ends the sentence with ". " (code review round 5, n4), and the
 * conversation is named through `conversationName` so an untitled conversation
 * is "untitled" here too (m7).
 */
export function rowAccessibilityLabel(input: {
	selecting: boolean;
	selected: boolean;
	item: {
		title: string;
		priority: string;
		updated_at: number;
		session: { title: string };
	};
	nowMs: number;
}): string {
	const { selecting, selected, item, nowMs } = input;
	if (selecting) {
		return `${selected ? "Selected" : "Not selected"}: ${item.title}`;
	}
	const parts = [
		item.priority === "high" ? "High priority." : "",
		`${item.title}.`,
		`${conversationName(item.session.title)}.`,
		/* ENGLISH, EXPLICITLY (review m1, the C1 class): "High priority." and the
		 * sentence's periods are still unkeyed English until slice O3-b keys this
		 * spoken label, so a reader-locale age would make a `ur` screen reader
		 * read a mixed-script, mixed-direction sentence. Pinned to the English
		 * catalogue until O3-b keys the whole label. */
		relativeTime(item.updated_at, nowMs, "en"),
	].filter((part) => part !== "");
	return parts.join(" ");
}

/**
 * The detail screen's meta line: "<conversation> · Live · <age>".
 *
 * A pure function (rather than inline JSX) so the C1-class rule below has a
 * test: the screen cannot be mounted in this Node suite.
 *
 * ENGLISH, EXPLICITLY (review m1): "Live" and "untitled" are still unkeyed
 * English until slice O3-b keys this line, so the age renders from the English
 * catalogue rather than the reader's locale — a localized age beside an English
 * word read as mixed-script text in `ur`. Every clause stays optional and the
 * `·` separator never dangles (an absent age drops out, as before).
 */
export function detailMetaLine(input: {
	sessionTitle: string | undefined | null;
	live: boolean;
	updatedAt: number;
	nowMs: number;
}): string {
	return [
		conversationName(input.sessionTitle),
		input.live ? "Live" : "",
		relativeTime(input.updatedAt, input.nowMs, "en"),
	]
		.filter((part) => part !== "")
		.join(" · ");
}

/**
 * A notification's compact age ("5m ago").
 *
 * `preference` exists for the C1-class callers only: a fragment whose
 * surrounding words are still unkeyed English passes `"en"` so the age matches
 * them (rendered through `renderFor`). Omitted, the age follows the app
 * language through `t()` — the inbox row's standalone age.
 */
export function relativeTime(
	atMs: number,
	nowMs: number,
	preference?: string,
): string {
	if (!(atMs > 0)) return "";
	/* `t(key, params)` is `renderFor(key, params, preferredLocale())`, so the
	 *  default path is exactly the `t()` the row used before. */
	const render = (
		key: Parameters<typeof renderFor>[0],
		params: Record<string, number> = {},
	): string => renderFor(key, params, preference ?? preferredLocale());
	const delta = Math.max(0, nowMs - atMs);
	const minutes = Math.round(delta / 60_000);
	/* The compact `5m ago` register (no space before the unit) is this narrow
	 * row meta's own; the spaced `5 min ago` family is a separate key set. */
	if (minutes < 1) return render("mobile.time.relative.just_now");
	if (minutes < 60)
		return render("mobile.time.relative.minutes_ago_compact", {
			count: minutes,
		});
	const hours = Math.round(minutes / 60);
	if (hours < 24)
		return render("mobile.time.relative.hours_ago_compact", { count: hours });
	const days = Math.round(hours / 24);
	return days === 1
		? render("mobile.time.relative.yesterday")
		: render("mobile.time.relative.days_ago_compact", { count: days });
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
