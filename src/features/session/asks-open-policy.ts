/**
 * When the asks sheet opens BY ITSELF — this app's copy of the shared open-policy
 * contract.
 *
 * WHY THIS EXISTS. The sheet used to open only from the bar above the composer
 * (design §5.0: "entered only by the user"). The bar is one line and easy to
 * miss, so a first-time reader of a conversation with a question waiting had
 * nothing telling them it was there. The operator's ruling (2026-10-07) is that a
 * conversation with PENDING asks opens its primary asks surface by default, on
 * EVERY surface, with the same semantics — so someone moving between the TUI, the
 * desktop, the phone web and this app meets one behaviour, not four.
 *
 * §5.0's "never automatic on ask ARRIVAL" is narrowed, not repealed: an ask that
 * arrives while the reader is already here still must not displace what they are
 * doing (rule 4's last sentence). What changes is the moment a conversation is
 * OPENED.
 *
 * THE CONTRACT (six rules; the numbers are the contract's own, so a reviewer can
 * check each against the code that enforces it):
 *
 *   1. No asks pending on open → closed, as before.            `readQueue` → empty
 *   2. Pending asks when the conversation is opened or switched
 *      to → open ONCE for that view of that conversation.      `decideAutoOpen`, the `decided` latch
 *   3. All asks already addressed on open → closed, and never
 *      re-opened once settled.                                 `readQueue` → empty, then the latch
 *   4. A deliberate close while asks remain is RESPECTED for
 *      that conversation: no re-open on a re-render, a queue
 *      refresh, an ask arriving or changing, or leaving and
 *      coming back. Kept by conversation id, in memory, so a
 *      fresh app start may open it again. A genuinely NEW ask
 *      does not force it open; the bar covers that.           `AsksOpenLedger`, the latch
 *   5. Never steals focus from a composer in use, never traps
 *      (the sheet keeps its unconditional Close — `Sheet` is
 *      untouched), and never fires on an UNRESOLVED queue: a
 *      stale, tally-only or not-yet-loaded frame is not
 *      "pending asks".                                         `readerEngaged`, `readQueue` → unresolved
 *   6. An auto-open is not a press of the door. The bar's
 *      `onOpen` is untouched; this module only decides whether
 *      the SCREEN opens the sheet on the reader's behalf.      (no import of the bar)
 *
 * "PENDING ON OPEN" MEANS THE ASK EXISTED BEFORE THE VIEW DID. A conversation
 * whose queue first resolves on the same frame that carries the agent's FIRST
 * question would otherwise read that question as "pending on open" and raise the
 * sheet over a reader who is simply watching the agent work — an ask ARRIVING,
 * which rule 4 forbids from forcing it open. `readQueue` therefore compares each
 * outstanding ask's own `created_at` with the instant the view began, and an
 * ask raised after it is an `arrived` reading, which settles the view closed.
 * (This is the TUI lane's race, found there first and mirrored here so the five
 * surfaces agree: `local_operator/tui/ask_open_policy.py`.)
 *
 * AND THE WAIT FOR A RESOLVED FRAME IS BOUNDED. A frame that resolves later than
 * `OPEN_WINDOW_MS` after the view began can never auto-open: by then it is no
 * longer "on open", and a view that waited ten minutes for a flaky connection
 * would otherwise raise the sheet over whatever the reader is doing then. The
 * bound covers every reason a reading can be unresolved (a leftover frame, a
 * tally with no rows, an unread draft, a screen under another route).
 *
 * NO REACT, NO REACT NATIVE. Everything here is a pure reading of facts the
 * screen already has, plus one in-memory ledger. That is the repository's rule
 * for anything worth asserting (`vitest.config.ts`: tests run in Node, so the
 * logic lives in plain modules and the component renders what they say) — and it
 * means the tests drive the SAME controller the screen's hook drives, not a copy
 * of its loop.
 */

import type { PendingAsk } from "@/contracts";
import { outstandingAsks } from "@/features/session/asks";
import type { ProjectionEntry } from "@/state";

/* ---------------------------------------------------------- the queue reading */

/**
 * How long after a view begins it may still choose to open (rules 2 and 5; the
 * TUI lane's `OPEN_WINDOW_S`, carried over so every surface draws the line in the
 * same place). 45 s is the engage seam's own bound — 30 s to bring a cold runtime
 * up plus 15 s to be acknowledged — so a queue that only exists once its runtime
 * is engaged is still "on open", while a frame that resolves well into the view
 * is not. Compared with `>`: a frame landing exactly on the bound still opens.
 */
export const OPEN_WINDOW_MS = 45_000;

/**
 * How far past the instant a view began an ask's `created_at` may sit and still
 * count as having existed on open (the TUI lane's `ARRIVAL_SKEW_MS`).
 *
 * `created_at` is stamped by the COMPUTER that owns the queue and the view's start
 * is read on the PHONE's clock, and `asks.ts` already records that the phone "may
 * be minutes away from the runtime's clock". The tolerance is deliberately biased
 * toward OPENING: a real arrival in the view's first few seconds read as pending
 * costs a sheet that appears a moment after the conversation did, which is the
 * behaviour being asked for anyway.
 *
 * WHAT A SKEWED PHONE DOES, stated because it is this surface's own exposure. A
 * phone BEHIND the computer by more than this reads an ask raised in the minutes
 * just before the view as an arrival, so the sheet stays shut — exactly the
 * pre-policy behaviour, with the bar still drawn, i.e. the failure lands on the
 * OLD state and never on an unwanted modal. A phone AHEAD reads an arrival in the
 * view's first seconds as old and opens; `OPEN_WINDOW_MS` bounds that exposure.
 * Neither direction is corrected for, because nothing on the projection carries
 * the computer's clock to correct with, and a per-surface constant here would make
 * one conversation behave differently on different surfaces.
 */
export const ARRIVAL_SKEW_MS = 5_000;

/**
 * What one frame tells the policy about a conversation's queue.
 *
 *  - `pending`    — the rows are published and at least one is OUTSTANDING (open,
 *                   or timed out and still answerable) AND existed before the
 *                   view began: exactly the set the bar draws and the
 *                   `asks_open` tally counts, so the sheet opens iff the bar
 *                   would be drawn. A timed-out ask is unaddressed and still
 *                   answerable, which is why it counts.
 *  - `arrived`    — outstanding asks, but every one was raised AFTER the view
 *                   began: they arrived, they were not pending on open.
 *  - `empty`      — the queue is RESOLVED and there is nothing to address.
 *  - `unresolved` — the frame cannot say. Decides nothing, in either direction.
 */
export type QueueReading = "unresolved" | "empty" | "arrived" | "pending";

/** The three entry fields the policy reads, by their store names. A `Pick` so a
 *  test (or a future caller) cannot be forced to invent the rest of the entry. */
export type QueueEntry = Pick<
	ProjectionEntry,
	"projection" | "connected" | "awaitingSnapshot"
>;

/**
 * Whether the held projection came from THIS view's connection.
 *
 * This is the load-bearing input and it is easy to forget: the projection store
 * keeps the LAST good frame per session ("stale beats blank",
 * `projection-store.ts`), so a screen re-entered after a visit renders the
 * previous visit's asks until the new connection's seed replaces them. Deciding
 * on that frame would open a sheet over asks that were answered elsewhere in the
 * meantime, or latch "empty" over asks that have since arrived. The store's own
 * flags say which it is: `awaitingSnapshot` is true from `beginStream` until the
 * first frame of the connection lands, and `connected` is false once the stream
 * has ended — either one means the projection on hand is a leftover.
 */
export const isFreshFrame = (entry: QueueEntry): boolean =>
	entry.projection !== null && entry.connected && !entry.awaitingSnapshot;

/**
 * Read one entry's queue (rule 5's "unresolved" half).
 *
 * Absence is information (ADR 0005 §1: the PRESENCE of `asks` is the capability
 * proxy), so the cases are spelled out rather than defaulted:
 *
 *  - not fresh                   → `unresolved` (see `isFreshFrame`).
 *  - `asks` is a list            → the rows are the truth, empty or not. They are
 *                                  what the bar draws from, so the policy and the
 *                                  bar cannot disagree about "is anything waiting".
 *                                  Outstanding rows are then split by whether ANY
 *                                  predates the view (`pending`) or all were raised
 *                                  after it (`arrived`).
 *  - `asks` absent, tally `0`    → `empty`: the runtime publishes asks and has
 *                                  none. Resolved.
 *  - `asks` absent, tally `> 0`  → `unresolved`: a count with no rows is a
 *                                  TALLY-ONLY frame. There is nothing to show in
 *                                  the bar, and "N asks" is not "pending asks".
 *  - both absent                 → `unresolved`: an older relay, or the feature
 *                                  is dark; there is no queue to open.
 */
export function readQueue(entry: QueueEntry, openedAtMs: number): QueueReading {
	if (!isFreshFrame(entry)) return "unresolved";
	const projection = entry.projection;
	if (projection === null) return "unresolved";
	const asks: PendingAsk[] | undefined = projection.asks;
	if (Array.isArray(asks)) {
		const outstanding = outstandingAsks(asks);
		if (outstanding.length === 0) return "empty";
		const cutoff = openedAtMs + ARRIVAL_SKEW_MS;
		return outstanding.some((row) => existedBefore(row, cutoff))
			? "pending"
			: "arrived";
	}
	return projection.asks_open === 0 ? "empty" : "unresolved";
}

/**
 * Whether one ask existed by `cutoff` (epoch ms, the computer's clock).
 *
 * A `created_at` that is not a usable number reads as OLD, not as an arrival: the
 * safe reading of a fact the wire did not state is the one that matches what a
 * row that has been waiting looks like, and it is the direction the tolerance is
 * already biased in.
 */
const existedBefore = (row: PendingAsk, cutoff: number): boolean => {
	const created = Number(row.created_at);
	return !Number.isFinite(created) || created <= cutoff;
};

/* ------------------------------------------------------------ the reader guard */

/** What the screen can say about whether the reader is in the middle of something. */
export interface Engagement {
	/** The message field holds the caret. Read at decision time, not rendered:
	 *  focus is not React state. */
	focused: boolean;
	/** The draft as held. A draft RESTORED from an earlier visit counts: the
	 *  reader left that sentence unfinished, and a sheet over it is the same
	 *  interruption whether or not their thumb is on the field right now. */
	draft: string;
	/** Images attached and not yet sent. */
	attachments: number;
	/** A dictation is starting, recording or transcribing. */
	dictating: boolean;
	/** Another sheet (models, effort) is already open: the reader asked for it,
	 *  and a second modal on top of it is the same theft by another door. */
	otherSheetOpen: boolean;
	/** A blocking approval card is on screen - the app's "live prompt" (the TUI
	 *  lane's `occupied` names it too). It is the one thing the agent is HELD on,
	 *  and the asks sheet is a modal with a scrim: opening it would hide that card
	 *  behind the very surface the reader never asked for. */
	approvalOpen: boolean;
}

/**
 * Whether the reader is in the middle of something (rule 5's focus half).
 *
 * A modal opening over a field in use dismisses the keyboard and drops the caret
 * on native, and interrupts a live recording; that is the focus theft the
 * contract forbids. A whitespace-only draft is an EMPTY draft — the composer
 * itself trims before it decides anything (`setDraft`, `runSend`).
 */
export const readerEngaged = (engagement: Engagement): boolean =>
	engagement.focused ||
	engagement.draft.trim() !== "" ||
	engagement.attachments > 0 ||
	engagement.dictating ||
	engagement.otherSheetOpen ||
	engagement.approvalOpen;

/* ---------------------------------------------------------------- the ledger */

/**
 * Which conversations the reader has deliberately dismissed this app lifetime
 * (rule 4's memory).
 *
 * IN MEMORY, BY DESIGN. The contract says "a fresh app start may auto-open
 * again", and ADR 0005 §2 already keeps the app from persisting anything about
 * asks: a dismissal is a note about this sitting, not a preference worth a
 * storage key, and persisting one would make the surface quieter for ever than
 * the reader meant. Keyed by conversation id because what the reader's thumb
 * said was "not this conversation", not "not ever" — and by conversation rather
 * than by ask, as the contract specifies, so the same words mean the same thing
 * on every surface.
 *
 * A factory plus one app-wide instance, the shape `projection-store` uses: the
 * instance must outlive a screen mount (that is the whole point — leaving and
 * coming back is the case rule 4 names), and tests make their own.
 */
export interface AsksOpenLedger {
	isDismissed(sessionId: string): boolean;
	dismiss(sessionId: string): void;
}

export const createAsksOpenLedger = (): AsksOpenLedger => {
	const dismissed = new Set<string>();
	return {
		isDismissed: (sessionId) => dismissed.has(sessionId),
		// An empty id is the screen's "no route param" fallback, not a conversation.
		dismiss: (sessionId) => {
			if (sessionId !== "") dismissed.add(sessionId);
		},
	};
};

/** The app's one ledger. Module scope so it survives screen mounts and dies with
 *  the JS context — which is exactly "a fresh app start may auto-open again". */
export const asksOpenLedger: AsksOpenLedger = createAsksOpenLedger();

/* ------------------------------------------------------------------ the verdict */

export interface AutoOpenVerdict {
	/** Open the sheet now, on the reader's behalf. */
	open: boolean;
	/** This view has made its one decision; nothing later reopens the question. */
	decided: boolean;
}

/**
 * The whole policy as one table-testable function.
 *
 * `decided` is the view's latch, and it is what makes "ONCE" (rule 2) and "a new
 * ask does not force it open" (rule 4) one mechanism instead of two: after the
 * first RESOLVED reading — whatever it said — the view never asks again. That
 * includes the closed outcomes. A conversation opened with an empty queue stays
 * un-opened when an ask turns up later; a reader who was typing when the queue
 * resolved is not interrupted a minute later when they put the phone down. The
 * cost is that a blocked auto-open is gone for this view, and that is the point:
 * the bar is the standing affordance, and a sheet that waited for the composer
 * to go quiet would pop up the moment the reader pressed send — "discoverability,
 * not insistence".
 *
 * The order below is the TUI lane's, so the surfaces settle the same way:
 *
 *   1. already decided               → nothing, for good.
 *   2. dismissed, or the window spent → closed, for good. Both are checked BEFORE
 *      the reading, so a conversation the reader refused (or a view that waited
 *      too long) settles at once instead of staying armed on every later frame.
 *   3. `unresolved`                  → keep waiting: the one input that decides
 *      nothing, because it is not a statement about the queue at all.
 *   4. `empty` / `arrived`           → closed, for good (rules 1 and 3).
 *   5. engaged                       → closed, for good (rule 5).
 *   6. `pending`                     → OPEN, once.
 *
 * A dismissal is checked before engagement: it is the reader's explicit word,
 * the guard only a guess about their hands.
 */
export function decideAutoOpen(input: {
	decided: boolean;
	/** The view has outlived `OPEN_WINDOW_MS`: whatever it reads now, it is no
	 *  longer "on open". */
	expired: boolean;
	reading: QueueReading;
	dismissed: boolean;
	engaged: boolean;
}): AutoOpenVerdict {
	if (input.decided) return { open: false, decided: true };
	if (input.dismissed || input.expired) return { open: false, decided: true };
	if (input.reading === "unresolved") return { open: false, decided: false };
	// Rules 1 and 3: nothing to address, or nothing that predates the view. Settle
	// closed, so a later ask is the bar's to announce.
	if (input.reading === "empty" || input.reading === "arrived") {
		return { open: false, decided: true };
	}
	if (input.engaged) return { open: false, decided: true };
	return { open: true, decided: true };
}

/* ------------------------------------------------------------------ the controller */

/** One frame's facts, in the units the screen already holds them in. */
export interface QueueObservation {
	/** The conversation on screen. `""` is the route's "no param" fallback. */
	sessionId: string;
	entry: QueueEntry;
	/** This conversation's persisted draft has been READ. Until it has, "the draft
	 *  is empty" is not a fact: the restore is asynchronous, and deciding in that
	 *  window would open the sheet over a draft about to appear. */
	draftKnown: boolean;
	/** The session screen is the focused route. The sheet is a window-level
	 *  `Modal`, and the stack keeps this screen MOUNTED under the agent drill-down
	 *  (and any route pushed over it): a sheet opened by a frame that lands while
	 *  another screen is on top would appear over that screen. Not focused is
	 *  "unresolved", exactly like an unread draft — the view has not really been
	 *  opened by the reader yet, so it decides nothing and keeps its one decision
	 *  for when it is. */
	screenFocused: boolean;
	engagement: Engagement;
}

/**
 * One mount of the session screen's view of the queue.
 *
 * A VIEW IS A MOUNT OF A CONVERSATION, not the conversation: leaving the screen
 * and coming back makes a new controller (rule 2's "opened/switched-to"), while
 * the ledger carries the one thing that must survive that (rule 4). The route
 * carries no `getId`, so the SAME screen instance can be re-pointed at another
 * conversation by a deep link; the controller notices the id change itself and
 * starts a fresh view, which is why `sessionId` rides on every call rather than
 * being fixed at construction.
 */
export interface AsksAutoOpen {
	/** Feed one observation. True exactly when the sheet should open now. */
	observe(frame: QueueObservation): boolean;
	/**
	 * The reader opened the sheet themselves, through the bar (rule 6: the door
	 * got there first). Settles this view's decision so the policy has nothing
	 * left to add — it never opens what is already open — and deliberately does NOT
	 * touch the ledger: a hand-opened sheet that is later closed with asks
	 * remaining is a refusal like any other, and that is `closed`'s to record.
	 */
	opened(input: { sessionId: string }): void;
	/**
	 * The reader closed the sheet — by the Close control, the scrim or the
	 * platform's back gesture. The policy cannot tell those apart and must not
	 * (rule 5: the reader can always close, by any door).
	 *
	 * `asksRemain` is whether THIS conversation still has outstanding asks: only
	 * then was the close a refusal worth remembering. Closing a sheet whose
	 * questions are all answered dismisses nothing.
	 */
	closed(input: { sessionId: string; asksRemain: boolean }): void;
	/**
	 * The reader left the sheet FOR another conversation, through the "Open
	 * conversation" control on one of its rows.
	 *
	 * That conversation's screen begins its own view, and without this it would
	 * raise the very queue the reader just walked out of, over the conversation
	 * they chose to read - the trap rule 5 forbids. They have already been shown
	 * its asks (the row they pressed is one of them), so there is nothing left to
	 * discover; it is recorded like a refusal, keyed to the DESTINATION. Nothing is
	 * recorded for the conversation they left: navigating away refused nothing.
	 */
	navigated(input: { to: string }): void;
}

/**
 * `now` is the clock the view's start is read on, in epoch milliseconds — the unit
 * an ask's `created_at` uses — and it is a parameter so a test can hold time still
 * and step it across the window and the skew tolerance exactly.
 */
export const createAsksAutoOpen = (
	ledger: AsksOpenLedger = asksOpenLedger,
	now: () => number = Date.now,
): AsksAutoOpen => {
	/** The conversation this view is of, when it began, and whether it has made
	 *  its decision. */
	let viewOf: string | null = null;
	let openedAt = 0;
	let decided = false;

	const enter = (sessionId: string): void => {
		if (sessionId === viewOf) return;
		viewOf = sessionId;
		openedAt = now();
		decided = false;
	};

	return {
		observe({ sessionId, entry, draftKnown, screenFocused, engagement }) {
			if (sessionId === "") return false;
			enter(sessionId);
			// Once a view has decided, every later frame costs one boolean: frames
			// land on every state change, and a streaming session repaints many
			// times a second. `decideAutoOpen` repeats the rule for the table.
			if (decided) return false;
			const verdict = decideAutoOpen({
				decided,
				expired: now() - openedAt > OPEN_WINDOW_MS,
				// An unread draft, or a screen that is not on top, is "unresolved"
				// for the same reason a stale frame is: a fact the policy depends on
				// has not arrived, so it says nothing.
				reading:
					draftKnown && screenFocused
						? readQueue(entry, openedAt)
						: "unresolved",
				dismissed: ledger.isDismissed(sessionId),
				engaged: readerEngaged(engagement),
			});
			decided = verdict.decided;
			return verdict.open;
		},
		opened({ sessionId }) {
			if (sessionId === "") return;
			enter(sessionId);
			decided = true;
		},
		navigated({ to }) {
			ledger.dismiss(to);
		},
		closed({ sessionId, asksRemain }) {
			if (sessionId === "") return;
			enter(sessionId);
			// A reader who has closed the sheet has seen the queue: whatever the
			// latch said before, nothing later in this view opens it for them.
			decided = true;
			if (asksRemain) ledger.dismiss(sessionId);
		},
	};
};
