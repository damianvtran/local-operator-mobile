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
 * What one frame tells the policy about a conversation's queue.
 *
 *  - `pending`    — the rows are published and at least one is OUTSTANDING (open,
 *                   or timed out and still answerable): exactly the set the bar
 *                   draws and the `asks_open` tally counts, so the sheet opens
 *                   iff the bar would be drawn. A timed-out ask is unaddressed
 *                   and still answerable, which is why it counts.
 *  - `empty`      — the queue is RESOLVED and there is nothing to address.
 *  - `unresolved` — the frame cannot say. Decides nothing, in either direction.
 */
export type QueueReading = "unresolved" | "empty" | "pending";

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
 *  - `asks` absent, tally `0`    → `empty`: the runtime publishes asks and has
 *                                  none. Resolved.
 *  - `asks` absent, tally `> 0`  → `unresolved`: a count with no rows is a
 *                                  TALLY-ONLY frame. There is nothing to show in
 *                                  the bar, and "N asks" is not "pending asks".
 *  - both absent                 → `unresolved`: an older relay, or the feature
 *                                  is dark; there is no queue to open.
 */
export function readQueue(entry: QueueEntry): QueueReading {
	if (!isFreshFrame(entry)) return "unresolved";
	const projection = entry.projection;
	if (projection === null) return "unresolved";
	const asks: PendingAsk[] | undefined = projection.asks;
	if (Array.isArray(asks)) {
		return outstandingAsks(asks).length > 0 ? "pending" : "empty";
	}
	return projection.asks_open === 0 ? "empty" : "unresolved";
}

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
	engagement.otherSheetOpen;

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
 * An `unresolved` reading is the one input that decides nothing and keeps the
 * latch open, because it is not a statement about the queue at all.
 *
 * A dismissal is checked before engagement: it is the reader's explicit word,
 * the guard only a guess about their hands.
 */
export function decideAutoOpen(input: {
	decided: boolean;
	reading: QueueReading;
	dismissed: boolean;
	engaged: boolean;
}): AutoOpenVerdict {
	if (input.decided) return { open: false, decided: true };
	if (input.reading === "unresolved") return { open: false, decided: false };
	// Rules 1 and 3: nothing to address. Settle closed, so a later ask is the
	// bar's to announce.
	if (input.reading === "empty") return { open: false, decided: true };
	if (input.dismissed) return { open: false, decided: true };
	if (input.engaged) return { open: false, decided: true };
	return { open: true, decided: true };
}

/* ------------------------------------------------------------------ the controller */

/** One frame's facts, in the units the screen already holds them in. */
export interface QueueObservation {
	/** The conversation on screen. `""` is the route's "no param" fallback. */
	sessionId: string;
	entry: QueueEntry;
	/** The composer has finished restoring this conversation's draft. Until it
	 *  has, "the draft is empty" is not a fact: the restore is asynchronous, and
	 *  deciding in that window would open the sheet over a draft about to appear. */
	composerReady: boolean;
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
	 * The reader closed the sheet — by the Close control, the scrim or the
	 * platform's back gesture. The policy cannot tell those apart and must not
	 * (rule 5: the reader can always close, by any door).
	 *
	 * `asksRemain` is whether THIS conversation still has outstanding asks: only
	 * then was the close a refusal worth remembering. Closing a sheet whose
	 * questions are all answered dismisses nothing.
	 */
	closed(input: { sessionId: string; asksRemain: boolean }): void;
}

export const createAsksAutoOpen = (
	ledger: AsksOpenLedger = asksOpenLedger,
): AsksAutoOpen => {
	/** The conversation this view is of, and whether it has made its decision. */
	let viewOf: string | null = null;
	let decided = false;

	const enter = (sessionId: string): void => {
		if (sessionId === viewOf) return;
		viewOf = sessionId;
		decided = false;
	};

	return {
		observe({ sessionId, entry, composerReady, engagement }) {
			if (sessionId === "") return false;
			enter(sessionId);
			const verdict = decideAutoOpen({
				decided,
				// Not ready is "unresolved" for the same reason a stale frame is:
				// a fact the policy depends on has not arrived, so it says nothing.
				reading: composerReady ? readQueue(entry) : "unresolved",
				dismissed: ledger.isDismissed(sessionId),
				engaged: readerEngaged(engagement),
			});
			decided = verdict.decided;
			return verdict.open;
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
