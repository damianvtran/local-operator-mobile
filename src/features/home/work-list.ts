/**
 * The home's work list: what is waiting on the reader, running, or recent on
 * THIS computer, above the composer.
 *
 * No React Native import on purpose, so vitest in Node loads the whole model and
 * the decision that guards it (`work-list.test.ts`).
 *
 * WHERE THE DATA COMES FROM. The rows are the list store's `sessions` — the
 * frame the drawer already paints from; the home makes no request of its own.
 * Ordering is the drawer's: `arrangeRows` under `active-first`, so a row's lane
 * and clock here are the same facts the drawer sorts on and the two surfaces
 * cannot disagree about which conversation is first.
 *
 * WHAT IS LEFT OUT, and why:
 *  - **Remote rows** (a paired computer's conversations). Home is "this
 *    computer"; mixing peers in muddles "what is running on my Mac".
 *  - **Ended rows** that are not running. The drawer hides them by default too
 *    (`isHiddenAsEnded`); a finished conversation is not work.
 *
 * "Needs you" is `needs_attention` on a local row — the per-session gate the
 * drawer paints as `approval` / `question` — NOT the inbox's waiting count,
 * which is per ask and can name sessions that are not in this list.
 */
import type { SessionSummary } from "@/contracts";
import { draftExistsFor, homeSuggestions } from "@/features/home/home-copy";
import {
	isRemoteRow,
	rowIsRunning,
} from "@/features/sessions/session-projection";
import {
	arrangeRows,
	isStoppedOnReader,
	type SidebarBasis,
} from "@/features/sessions/sidebar-view";

export type WorkList = {
	/** Every row waiting on the reader. Never capped: a waiting row hidden behind
	 *  "All conversations" is the one the reader most needs to see. */
	needsYou: SessionSummary[];
	/** A turn is live and nothing is asked of the reader. */
	running: SessionSummary[];
	/** Everything else, newest first on the drawer's clock. */
	recent: SessionSummary[];
	/** Eligible conversations the budget left out (they live in the drawer). */
	rest: number;
};

/**
 * How many rows the list may draw by text scale: running and recent TOGETHER
 * with needs-you. 4 at 100 %, 3 from 1.3×, 2 from 2.0× — the steps keep the hero
 * above the list at the larger type (the prototype's measured bands). Needs-you
 * rows are exempt from the cap but count against it first, so running/recent
 * fill only what is left (possibly nothing).
 */
export const workListBudget = (scale: number): number =>
	scale >= 2 ? 2 : scale >= 1.3 ? 3 : 4;

/** A row's section in the list: the `section` key `SessionRow` is handed. */
export type WorkListSection = "needs-you" | "running" | "recent";

/**
 * How a row spends its lines at a text scale (design D2). The title is the
 * content of a work list, so past `WRAP_TITLE_ABOVE` it wraps to two lines
 * instead of cutting at one; from `DROP_META_FROM` the folder line goes from
 * running and recent rows to pay for it. A needs-you row keeps its folder: the
 * reader has to act on it, and its approval/question word is on that line.
 * The 4/3/2 row budget is untouched; whatever still overflows scrolls.
 */
export const WRAP_TITLE_ABOVE = 1.3;
export const DROP_META_FROM = 1.5;
export const workRowShape = (
	scale: number,
	section: WorkListSection,
): { titleLines: 1 | 2; showFolder: boolean } => ({
	titleLines: scale > WRAP_TITLE_ABOVE ? 2 : 1,
	showFolder: section === "needs-you" || scale < DROP_META_FROM,
});

/** A row this list may show at all. */
const eligible = (session: SessionSummary): boolean =>
	!isRemoteRow(session) && !(session.ended === true && !rowIsRunning(session));

export const workListFor = (
	sessions: readonly SessionSummary[],
	scale: number,
	basis: SidebarBasis = "active",
): WorkList => {
	// A session is listed once, whatever the frame carried.
	const seen = new Set<string>();
	const rows = sessions.filter((session) => {
		if (!eligible(session) || seen.has(session.session_id)) return false;
		seen.add(session.session_id);
		return true;
	});
	const arranged = arrangeRows(rows, "active-first", basis);
	const needsYou = arranged.filter((session) => isStoppedOnReader(session));
	const running = arranged.filter(
		(session) => !isStoppedOnReader(session) && rowIsRunning(session),
	);
	const recent = arranged.filter((session) => !rowIsRunning(session));
	let left = Math.max(0, workListBudget(scale) - needsYou.length);
	const shownRunning = running.slice(0, left);
	left -= shownRunning.length;
	const shownRecent = recent.slice(0, left);
	return {
		needsYou,
		running: shownRunning,
		recent: shownRecent,
		rest:
			running.length -
			shownRunning.length +
			(recent.length - shownRecent.length),
	};
};

/** How many rows the list draws. */
export const workListRowCount = (list: WorkList): number =>
	list.needsYou.length + list.running.length + list.recent.length;

/**
 * The list with running/recent rows beyond `keep` given up (the splash's
 * second yield when the band is short: the mark goes first, then these).
 * Needs-you rows are never given up. Rows drop from the tail — recent first,
 * then running — and are counted into `rest`.
 */
export const trimWorkList = (list: WorkList, keep: number): WorkList => {
	const room = Math.max(0, keep);
	const running = list.running.slice(0, room);
	const recent = list.recent.slice(0, Math.max(0, room - running.length));
	return {
		needsYou: list.needsYou,
		running,
		recent,
		rest:
			list.rest +
			(list.running.length - running.length) +
			(list.recent.length - recent.length),
	};
};

/** How many TRY rows a brand-new account sees. */
export const TRY_ROW_COUNT = 2;

/**
 * What occupies the band's bottom, above the composer.
 *
 * `list` is the work list; `try` is the brand-new account's suggestion rows
 * (the pool, head first — see `home-copy.ts`); `none` leaves the hero alone.
 */
export type WorkListSlot =
	| { kind: "none" }
	| { kind: "list"; list: WorkList }
	| { kind: "try"; rows: readonly string[] };

export type WorkListSlotInput = {
	/** A route is live (the header chip's check). */
	connected: boolean;
	/** A recovery line or a named refusal stands in for the splash. The list
	 *  must never paint behind one: phone access off, an expired sign-in and an
	 *  offline device are all refusals/recoveries, and their rows would be
	 *  stale (`home-recovery.ts`). */
	recovery: boolean;
	draft: string;
	/** The composer holds focus. */
	editing: boolean;
	/** The first send is in flight: the splash is one line. */
	starting: boolean;
	/** The computer sent a frame in this connection (`liveFrameAt != null`). A
	 *  warm-cache paint is not one. */
	frameLive: boolean;
	/** The list shows the last good frame, not a live one. */
	stale: boolean;
	sessions: readonly SessionSummary[];
	scale: number;
	basis?: SidebarBasis;
};

/**
 * The ONE decision for the slot. Every reason to hide is checked before any
 * session is read, so a recovery or refusal state can never show the list
 * however many conversations are waiting. The draft/focus rule is the one that
 * already hid the suggestions: a row's tap must not overwrite typed words and
 * the list steps away while the reader types.
 */
export const workListSlot = (input: WorkListSlotInput): WorkListSlot => {
	if (!input.connected || input.recovery) return { kind: "none" };
	if (!input.frameLive || input.stale) return { kind: "none" };
	if (input.starting || input.editing || draftExistsFor(input.draft))
		return { kind: "none" };
	const list = workListFor(input.sessions, input.scale, input.basis);
	if (workListRowCount(list) + list.rest > 0) return { kind: "list", list };
	// Brand new = this computer has never held a conversation. Only ended or
	// remote rows is a returning reader with nothing to resume, not a new one.
	if (input.sessions.length === 0)
		return { kind: "try", rows: homeSuggestions().slice(0, TRY_ROW_COUNT) };
	return { kind: "none" };
};
