/**
 * When the asks sheet opens BY ITSELF — this app's copy of the shared open-policy
 * contract.
 *
 * WHY THIS EXISTS. The sheet used to open only from the bar above the composer -
 * the screen's own comment said so, citing design §5.0's rule that the surface is
 * never automatic on arrival. The bar is one line and easy to miss, so a
 * first-time reader of a conversation with a question waiting had nothing
 * telling them it was there. The operator's ruling (2026-10-07) is that a
 * conversation with PENDING asks opens its primary asks surface by default, on
 * EVERY surface, with the same semantics — so someone moving between the TUI, the
 * desktop, the phone web and this app meets one behaviour, not four.
 *
 * That rule is narrowed, not repealed: an ask that arrives while the reader is
 * already here still must not displace what they are doing (rule 4's last
 * sentence). What changes is the moment a conversation is OPENED.
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
 *      does not force it open; the bar covers that.
 *      REFINED (round 1 U4, final wording round 2): a dismissal
 *      records the ASK IDS waved off (the pending set at close
 *      time) and is FORGOTTEN once NONE of those ids is still
 *      outstanding - answered, declined, withdrawn or expired -
 *      so a LATER batch gets the same discoverability as the
 *      first. While any waved-off ask remains it holds, across
 *      re-renders and switches.                              `AsksOpenLedger`, the latch
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
 * (Found in the TUI lane first and mirrored here, so the surfaces agree. The TUI's
 * module is `local_operator/tui/ask_open_policy.py` on the local-operator
 * `feat/asks-open-by-default` branch; it is UNMERGED as of this change, so that
 * path does not exist on that repository's `main` yet - read it on the branch
 * until it lands.)
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
import { dockAsk, outstandingAsks } from "@/features/session/asks";
import type { ProjectionEntry } from "@/state";

/* ---------------------------------------------------------- the queue reading */

/**
 * How long after a view begins it may still choose to open (rules 2 and 5). The
 * value is the TUI lane's `OPEN_WINDOW_S`, carried over so every surface draws
 * the line in the same place; that module derives it as the engage seam's own
 * bound — 30 s to bring a cold runtime up plus 15 s to be acknowledged — so a
 * queue that only exists once its runtime is engaged is still "on open", while a
 * frame that resolves well into the view is not. This surface has not re-derived
 * it. Compared with `>`: a frame landing exactly on the bound still opens.
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
 *                                  A DELIBERATE DIFFERENCE FROM THE TUI: an EMPTY
 *                                  list beside a tally `> 0` (`asks: []`,
 *                                  `asks_open: 4`) reads `empty` here, where the
 *                                  TUI's clause ("N > 0 with no rows leaves the
 *                                  question open") would keep waiting. The bar
 *                                  draws from the rows and would draw nothing, so
 *                                  "the sheet opens iff the bar would be drawn"
 *                                  settles it: an empty list is a settled-closed
 *                                  view here, never an open sheet over an empty
 *                                  bar. The error is on the safe side (this surface
 *                                  can only under-open, never open on a bare count)
 *                                  and the relay cannot produce the shape today
 *                                  (`[]` is only ever published with the real fold).
 *                                  Pinned by a test, not left as an accident.
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

/** The ids a frame lists as outstanding - the set a dismissal is reconciled
 *  against (`AsksOpenLedger.reconcile`) and the set a close records
 *  (`closed.pending`). The same filter the bar draws from, so "outstanding" means
 *  one thing on every path. */
export const outstandingAskIds = (
	rows: PendingAsk[] | undefined | null,
): Set<string> => new Set(outstandingAsks(rows).map((row) => row.ask_id));

/**
 * Whether a frame names EVERY ask it counts as outstanding - the precondition
 * for reconciling a dismissal against its rows (`AsksOpenLedger.reconcile`).
 *
 * `reconcile` forgets a dismissal once none of the dismissed ids is outstanding
 * in the rows it is handed, so it is only sound when those rows are the whole
 * queue. The wire's text budget can DROP a row that is still outstanding; the
 * frame then names fewer asks than its `asks_open` tally counts. Reconciling
 * against such a frame would forget the dismissal of a clipped-but-live ask, and
 * the next fresh view would auto-open the sheet over a refusal the reader
 * already gave - the over-open direction this policy exists to avoid.
 *
 * WHY THE TALLY AND NOT `asks_truncated`: that flag is STICKY (set the first time
 * the budget drops any row and never cleared), so a queue that was clipped once
 * and has since shrunk back under the budget still carries it. Gating on it would
 * hold a dismissal forever on a perfectly complete frame. A dropped outstanding
 * row, by contrast, ALWAYS shows as tally > named, and a complete frame never
 * does. (This is also why the app deliberately does not read the flag; see the
 * note on `asks_truncated` in `contracts/schemas.ts`.)
 *
 * WHY HOLD AND NOT FORGET: an incomplete frame cannot say whether the dismissed
 * ids are still outstanding, and the two mistakes are not symmetric. Holding
 * wrongly leaves a dead entry behind (it is memory only, and the next complete
 * frame clears it); forgetting wrongly pops a sheet the reader refused.
 *
 * An absent `asks_open` is an older relay that publishes rows without the tally
 * (the presence of the field is the capability proxy, ADR 0005 s1); there is
 * nothing to compare against, so the rows are taken as the truth, as before.
 *
 * HONEST RESIDUE: if a queue ever exceeds the projection's own row cap
 * (`PROJECTION_CAP`, defined by the relay in the Local Operator repository and
 * not mirrored here) the named set is clipped even when the tally is exact on
 * the wire. The guard then reads tally > named and HOLDS, which is the safe
 * direction; the dismissal is cleared by a later frame once the queue is back
 * under the cap. This function does not change the cap and cannot tell that case
 * from a budget drop - it does not need to.
 */
export const namesEveryOutstandingAsk = (
	rows: PendingAsk[],
	asksOpen: number | undefined,
): boolean =>
	typeof asksOpen !== "number" || asksOpen <= outstandingAskIds(rows).size;

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
	/**
	 * Record a dismissal: the reader waved off THESE asks (the pending set at the
	 * moment they closed). An empty set records nothing - nothing was refused.
	 *
	 * WHY IDS AND NOT A BARE FLAG (round 2, U10). A dismissal means "not THESE
	 * questions". Keyed by conversation alone, the only way to tell the reader's
	 * questions from a later batch was to WATCH the queue go empty, and a batch
	 * that emptied and refilled while the phone was elsewhere left the entry in
	 * place - the conversation stayed quiet for good after one swipe. With the ids
	 * recorded the question answers itself from any fresh frame (see `reconcile`).
	 * The contract is the shared one: the TUI and the web lanes record the same
	 * thing, so the same words mean the same behaviour on every surface.
	 */
	dismiss(sessionId: string, askIds: Iterable<string>): void;
	/**
	 * Reconcile a dismissal with a RESOLVED reading of the queue: forget it once
	 * NONE of the dismissed ids is still outstanding (`outstanding` is the ids the
	 * frame lists as open or timed-out-and-answerable). While any waved-off ask
	 * remains the entry holds - the same batch is never re-nagged, however the
	 * queue around it changes. Subsumes the earlier "forget when seen empty" rule:
	 * an empty queue has none of them outstanding.
	 */
	reconcile(sessionId: string, outstanding: ReadonlySet<string>): void;
	/**
	 * Drop a conversation's dismissal outright: the reader closed with nothing
	 * left to ask, or the frame is a resolved tally of zero. Nothing to compare ids
	 * against, and nothing could still be outstanding.
	 */
	forget(sessionId: string): void;
}

export const createAsksOpenLedger = (): AsksOpenLedger => {
	const dismissed = new Map<string, Set<string>>();
	return {
		isDismissed: (sessionId) => dismissed.has(sessionId),
		// An empty id is the screen's "no route param" fallback, not a conversation.
		dismiss: (sessionId, askIds) => {
			if (sessionId === "") return;
			const ids = new Set(askIds);
			if (ids.size === 0) return;
			// MERGED, not replaced: a second close in the same sitting (hand-opened
			// after a dismissal) waves off what it saw too, and the first batch must
			// not become re-openable because the second named different ids.
			const held = dismissed.get(sessionId);
			if (held === undefined) dismissed.set(sessionId, ids);
			else for (const id of ids) held.add(id);
		},
		reconcile: (sessionId, outstanding) => {
			const held = dismissed.get(sessionId);
			if (held === undefined) return;
			for (const id of held) if (outstanding.has(id)) return;
			dismissed.delete(sessionId);
		},
		forget: (sessionId) => {
			dismissed.delete(sessionId);
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
 * the ledger carries the one thing that must survive that (rule 4).
 *
 * `sessionId` rides on every call rather than being fixed at construction
 * because nothing here may depend on a screen never being re-pointed at another
 * conversation. Whether this app CAN be is the router's to say, read in
 * expo-router 57.0.24 rather than assumed (`openFor` carries the details);
 * either way the controller notices an id change itself and starts a fresh view.
 */
export interface AsksAutoOpen {
	/**
	 * Feed one observation. True exactly when the sheet should open now - and when
	 * it does, the sheet IS open for this conversation (`isOpenFor`).
	 */
	observe(frame: QueueObservation): boolean;
	/**
	 * Which conversation the sheet is open FOR, or `null`.
	 *
	 * THE OPEN STATE IS KEYED BY CONVERSATION, NOT HELD AS A FLAG. That makes rule 4
	 * hold even if one mounted screen were ever pointed at another conversation and
	 * back: a bare boolean would show A's sheet again after "dismiss A, be taken to
	 * B (the policy opens it), return to A" - the leak the desktop UI found on its
	 * window-wide drawer flag. Keyed, the answer for A is simply "no" the moment the
	 * params change, before any effect has run, so there would be no frame of the
	 * sheet over the wrong conversation either.
	 *
	 * WHETHER THIS APP CAN BE RE-POINTED IN PLACE is the router's answer, READ in
	 * expo-router 57.0.24 rather than assumed, and it is "not by any navigation
	 * call in this repo": a `navigate`/`push` to another `[id]` gets a NEW route key
	 * (`layouts/StackClient.js`; the same-key arms there are an equal-id NAVIGATE,
	 * i.e. the SAME conversation), `replace` goes to the base `StackRouter.js`,
	 * which mints one (`createRouteFromAction`), and scenes are React-keyed by
	 * `route.key` on web and native (`native-stack/views/NativeStackView(.native).js`).
	 * Only `setParams` keeps a key and swaps params, and nothing in `src/` or `app/`
	 * calls it. So this keying is defence in depth that removes a dependency on
	 * those internals - NOT the repair of a leak this app is known to have, and the
	 * A-B-A tests below pin the policy, not a reproduced defect.
	 */
	openFor(): string | null;
	/** `openFor() === sessionId`, for a non-empty id. The screen's `visible`. */
	isOpenFor(sessionId: string): boolean;
	/** Subscribe to changes of `openFor` (the `useSyncExternalStore` shape). Called
	 *  only when the value actually changes, so an effect that observes on every
	 *  frame cannot loop. */
	subscribe(listener: () => void): () => void;
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
	 * `pending` is the ask ids THIS conversation still has outstanding at the
	 * moment of the close: those are the asks waved off, and the dismissal is
	 * remembered against exactly them (`AsksOpenLedger.dismiss`). Closing a sheet
	 * whose questions are all answered (`pending` empty) dismisses nothing.
	 */
	closed(input: { sessionId: string; pending: readonly string[] }): void;
	/**
	 * The reader left the sheet FOR another conversation, through the "Open
	 * conversation" control on one of its rows.
	 *
	 * That conversation's screen begins its own view, and without this it would
	 * raise the very queue the reader just walked out of, over the conversation
	 * they chose to read - the trap rule 5 forbids. They have already been shown
	 * its asks (the row they pressed is one of them), so there is nothing left to
	 * discover; it is recorded like a refusal, keyed to the DESTINATION and to the
	 * asks the sheet listed for it (`pending`: the ids the reader was just shown).
	 * Nothing is recorded for the conversation they left: navigating away refused
	 * nothing.
	 */
	navigated(input: { to: string; pending: readonly string[] }): void;
	/**
	 * Who opened the sheet that is open now: the policy (`"policy"`, an auto-open)
	 * or the reader through the bar (`"reader"`), or `null` when none is open.
	 *
	 * WHY IT IS KEPT. Two things differ between the doors and neither can be
	 * recovered later. (1) An auto-open arrives with NOTHING the reader asked for,
	 * so it pre-expands the head question (`expandTargetFor`) - a reader who pressed
	 * the bar already knows what they are opening and keeps the collapsed list.
	 * (2) A sheet the reader opened has an opener whose focus the platform returns
	 * on close; an auto-open has none, and focus drops to the document body
	 * (UX round 1, U3), so only a policy-opened close restores it by hand.
	 */
	openOrigin(): OpenOrigin | null;
	/**
	 * The first read of the sheet's own list FAILED while the sheet is up for this
	 * conversation. When it was opened by the policy AND NOTHING IS DRAWN
	 * (`drawn === 0`: no seed rows), close it back to the bar: an unprompted modal
	 * whose whole body is an error line (and no way to retry but to close and
	 * reopen) is worse than the one-line bar it covered. Returns whether it closed.
	 *
	 * ROWS DRAWN KEEP THE SHEET (round 2, U9/M1). The policy only opens over rows
	 * the projection frame already holds, and the sheet draws those from its first
	 * frame, so the form is interactive for as long as the opening read takes - up
	 * to the 8 s read bound. Closing then took the sheet from under a reader who was
	 * mid-answer, with their selection (measured: a 4 s failing read, an option
	 * picked at ~2 s, the sheet gone at ~5 s), and on a fast failure it flashed
	 * shut ~24 ms after opening. The failure only concerns the AGGREGATE list (other
	 * conversations' asks); the drawn rows are the session's own and still
	 * answerable, so the error line goes beneath them instead. This option over
	 * "skip the close once the reader has interacted" because it needs no
	 * interaction tracking across the nested answer form, and it removes the flash
	 * too (that option would still close a form nobody had touched yet).
	 *
	 * NOTHING IS REMEMBERED. The reader refused nothing - the app failed - so the
	 * ledger is untouched, and the view's decision stays spent (it already was: the
	 * open that raised the sheet latched it), so the failed read cannot re-raise the
	 * sheet on the next frame. A sheet the READER opened is left alone: they asked
	 * for it, the error line is the honest answer, and closing it under them would
	 * hide the very thing they pressed for.
	 */
	readFailed(input: { sessionId: string; drawn: number }): boolean;
}

/** The door a sheet was opened through (see `AsksAutoOpen.openOrigin`). */
export type OpenOrigin = "policy" | "reader";

/**
 * The ask a freshly opened sheet should show EXPANDED, or `null` for the
 * collapsed list the reader's own open has always started from.
 *
 * WHY. Design round 1 (D1) and UX round 1 (U1) found the same thing from two
 * sides: an auto-opened sheet is a scrimmed modal over the bar, and the bar was
 * the only place that NAMED the question - so the sheet that arrived by itself
 * said LESS than the line it covered (a title, a disclaimer and a `Queued - the
 * agent is continuing` row, with the question one unlabelled tap away). The
 * point of opening it is that the reader meets the question, so the HEAD ask -
 * the one the bar names (`dockAsk`), which the sheet already lists first - opens
 * expanded, with its options and Answer/Decline.
 *
 * Read from the projection's own rows rather than the sheet's aggregate read: it
 * is in hand at the moment of the open, so the question is on the first painted
 * frame instead of after a round trip. The ask ids are the same set (the sheet's
 * rows are the same asks with the session columns added); an id the aggregate does
 * not return simply expands nothing.
 */
export const expandTargetFor = (
	origin: OpenOrigin | null,
	asks: PendingAsk[] | undefined | null,
): string | null => {
	if (origin !== "policy") return null;
	const head = dockAsk(asks);
	return head === null || head.ask_id === "" ? null : head.ask_id;
};

/**
 * The sheet's expansion choice, as a pure reducer (round 2, Q5/M2).
 *
 * `undefined` = the reader has not chosen in THIS opening, so the opening's own
 * pre-expanded ask (`initialOpenAsk`) applies from the first render; a string or
 * `null` is the reader's (or the walk's) own pick.
 *
 * WHY `closed` EXISTS. The sheet component stays mounted while it is hidden, so a
 * choice left over from one opening was still in state when the next began: a
 * policy open (which writes the head ask in) followed by a bar press painted one
 * stale EXPANDED frame (292 -> 86 px, measured) before the opening effect
 * collapsed it. Forgetting the choice whenever the sheet goes away makes the next
 * opening start from `initialOpenAsk` alone - which is `null` for a bar press -
 * on its very first render. Pure and exported because the component cannot be
 * rendered in this repository's Node test environment.
 */
export type ExpansionChoice = string | null | undefined;
export type ExpansionAction =
	| { type: "opening"; initial: string | null }
	| { type: "pick"; ask: string | null }
	| { type: "toggle"; ask: string }
	| { type: "closed" };

export const reduceExpansion = (
	choice: ExpansionChoice,
	action: ExpansionAction,
): ExpansionChoice => {
	switch (action.type) {
		case "opening":
			return action.initial;
		case "pick":
			return action.ask;
		case "toggle":
			return choice === action.ask ? null : action.ask;
		case "closed":
			return undefined;
	}
};

/** The ask drawn expanded: the reader's choice, else the opening's own. */
export const shownExpansion = (
	choice: ExpansionChoice,
	initial: string | null,
): string | null => (choice === undefined ? initial : choice);

/**
 * The rows the sheet draws: the frame's own SEED until the aggregate has been
 * read SUCCESSFULLY, then the aggregate.
 *
 * It is the first SUCCESS, not the first read: a failed opening read leaves the
 * aggregate empty, and swapping the seed for that empty list would make the very
 * question a reader is answering vanish when the error line appears (round 2, U9
 * - the failure keeps the sheet up, so the rows it is up for must stay). A seed
 * is passed for a policy open only, so a reader-opened sheet is unaffected.
 */
export const drawnRows = (
	seed: readonly PendingAsk[] | null,
	aggregate: readonly PendingAsk[],
	aggregateRead: boolean,
): readonly PendingAsk[] =>
	!aggregateRead && seed !== null ? seed : aggregate;

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
	/** The conversation the sheet is open for (see `AsksAutoOpen.openFor`). */
	let openForId: string | null = null;
	let origin: OpenOrigin | null = null;
	const listeners = new Set<() => void>();

	const setOpenFor = (
		next: string | null,
		by: OpenOrigin | null = null,
	): void => {
		// The origin moves with the open state in the SAME step, before any listener
		// runs, so a render that reads `isOpenFor` and `openOrigin` after a
		// notification sees one consistent pair.
		origin = next === null ? null : by;
		if (openForId === next) return;
		openForId = next;
		// A copy: a listener may unsubscribe (or subscribe) from inside its own call.
		for (const listener of [...listeners]) listener();
	};

	const enter = (sessionId: string): void => {
		if (sessionId === viewOf) return;
		viewOf = sessionId;
		openedAt = now();
		decided = false;
		// A new view starts with the sheet shut. Without this a sheet left open for
		// the conversation the screen was just re-pointed AWAY from would be shown
		// again, un-decided, when the screen is re-pointed back - over a queue the
		// policy would not have opened (answered elsewhere meanwhile, or a draft now
		// in the composer).
		setOpenFor(null);
	};

	return {
		openFor: () => openForId,
		isOpenFor: (sessionId) => sessionId !== "" && openForId === sessionId,
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		observe({ sessionId, entry, draftKnown, screenFocused, engagement }) {
			if (sessionId === "") return false;
			enter(sessionId);
			// A dismissal is reconciled with every RESOLVED frame (rule 4, round 2 U10):
			// forgotten once none of the asks the reader waved off is still
			// outstanding. It runs BEFORE the decided latch on purpose: the usual shape
			// is a view that has already decided (the reader closed the sheet) and then
			// watches the asks get answered, and that is exactly the frame that must
			// clear the entry - and a fresh view that meets only a LATER batch (the
			// waved-off asks answered while the phone was elsewhere) must find the
			// entry already gone when `decideAutoOpen` reads it. The guard is one Map
			// lookup, so a streaming session repainting many times a second still pays
			// only that while nothing is dismissed. Only a fresh frame counts: a
			// leftover from the last visit says nothing about which asks are still
			// outstanding. A frame with rows is compared id by id; a tally of zero with
			// no rows is an empty queue (`readQueue` -> `empty`); any other bare tally
			// cannot name ids, so it decides nothing.
			if (ledger.isDismissed(sessionId) && isFreshFrame(entry)) {
				const rows = entry.projection?.asks;
				if (Array.isArray(rows)) {
					// Only a COMPLETE frame may forget a dismissal; an incomplete one
					// holds (see `namesEveryOutstandingAsk`).
					if (namesEveryOutstandingAsk(rows, entry.projection?.asks_open)) {
						ledger.reconcile(sessionId, outstandingAskIds(rows));
					}
				} else if (readQueue(entry, openedAt) === "empty") {
					ledger.forget(sessionId);
				}
			}
			// Once a view has decided, every later frame costs one boolean: frames
			// land on every state change, and a streaming session repaints many
			// times a second. `decideAutoOpen` repeats the rule for the table.
			if (decided) return false;
			// An unread draft, or a screen that is not on top, is "unresolved"
			// for the same reason a stale frame is: a fact the policy depends on
			// has not arrived, so it says nothing.
			const meaningful = draftKnown && screenFocused && isFreshFrame(entry);
			const verdict = decideAutoOpen({
				decided,
				expired: now() - openedAt > OPEN_WINDOW_MS,
				reading:
					draftKnown && screenFocused
						? readQueue(entry, openedAt)
						: "unresolved",
				// A dismissal is only a verdict on a frame that MEANS something. The
				// store hands a returning view the last visit's projection first
				// (`connected:false` / `awaitingSnapshot`), and `decideAutoOpen` tests
				// `dismissed` before `reading`: read unconditionally, that stale frame
				// latched `decided` closed while the entry still stood, so the fresh
				// frame - which reconciles the entry away when the queue was refilled
				// while the phone was elsewhere - arrived to a view that had already
				// spent its one decision (round 3, U11/Q1). Gated on the same
				// conditions that make a reading meaningful, a stale frame leaves the
				// decision unspent and the fresh one makes it.
				dismissed: meaningful && ledger.isDismissed(sessionId),
				engaged: readerEngaged(engagement),
			});
			decided = verdict.decided;
			if (verdict.open) setOpenFor(sessionId, "policy");
			return verdict.open;
		},
		opened({ sessionId }) {
			if (sessionId === "") return;
			enter(sessionId);
			decided = true;
			setOpenFor(sessionId, "reader");
		},
		navigated({ to, pending }) {
			ledger.dismiss(to, pending);
			// The sheet the reader is leaving is hidden; the destination is a screen
			// of its own, with its own controller.
			setOpenFor(null);
		},
		closed({ sessionId, pending }) {
			if (sessionId === "") return;
			enter(sessionId);
			// A reader who has closed the sheet has seen the queue: whatever the
			// latch said before, nothing later in this view opens it for them.
			decided = true;
			// A close with the queue already clear refused nothing - and if an EARLIER
			// close left an entry (the reader dismissed, then opened the sheet by hand,
			// answered the rest and closed), nothing it named can still be outstanding,
			// so it is forgotten here as `observe` would on the next frame, without
			// waiting for one.
			if (pending.length > 0) ledger.dismiss(sessionId, pending);
			else ledger.forget(sessionId);
			// After `enter`, `openForId` is this conversation's or null, so this only
			// ever shuts the sheet the reader just closed.
			if (openForId === sessionId) setOpenFor(null);
		},
		openOrigin: () => origin,
		readFailed({ sessionId, drawn }) {
			if (
				sessionId === "" ||
				openForId !== sessionId ||
				origin !== "policy" ||
				drawn > 0
			) {
				return false;
			}
			setOpenFor(null);
			return true;
		},
	};
};
