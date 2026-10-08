import { describe, expect, it } from "vitest";

import type { PendingAsk, SessionProjection } from "@/contracts";
import {
	ARRIVAL_SKEW_MS,
	type AsksAutoOpen,
	createAsksAutoOpen,
	createAsksOpenLedger,
	decideAutoOpen,
	type Engagement,
	isFreshFrame,
	OPEN_WINDOW_MS,
	type QueueEntry,
	readerEngaged,
	readQueue,
} from "@/features/session/asks-open-policy";

/**
 * The open-by-default policy, as the contract's four states and the guards that
 * keep it from being rude.
 *
 * Every test below drives `createAsksAutoOpen` — the SAME controller the session
 * screen's hook drives — with the frames and the ledger the screen would hold, so
 * what is asserted is the screen's decision rather than a second copy of its
 * loop. The old behaviour was "the sheet opens only when the bar is pressed", i.e.
 * the controller would never say `true`; each OPEN case is therefore a test the
 * old code fails, and each CLOSED case pins that the new code did not buy the open
 * state with an insistence the contract forbids.
 */

const SESSION = "6714def86197";
const OTHER = "9ed9e2f534cd";

/** The instant every view in this file begins, in the unit an ask's `created_at`
 *  uses (epoch ms). Fixed rather than `Date.now()` so the arrival tests can step
 *  time across the skew tolerance and the window to the millisecond. */
const T0 = 1_790_000_000_000;
/** An ask created a minute BEFORE the view began: pending on open. */
const BEFORE = T0 - 60_000;

function ask(patch: Partial<PendingAsk> = {}): PendingAsk {
	return {
		ask_id: "a1",
		created_at: BEFORE,
		expires_at: T0 + 900_000,
		timeout_s: 900,
		urgent: false,
		status: "open",
		delivered: false,
		questions: [
			{
				id: "q1",
				question: "ship it?",
				options: [],
				multi: false,
				secret: false,
				persist: false,
			},
		],
		...patch,
	};
}

/** A projection carrying only what the policy reads; the rest of the wire is
 *  irrelevant to it, so the cast says which part is a stand-in. */
function projectionWith(
	patch: Partial<Pick<SessionProjection, "asks" | "asks_open">>,
): SessionProjection {
	return { session_id: SESSION, ...patch } as SessionProjection;
}

/** A fresh frame: the first of this connection, stream open. */
function fresh(patch: Parameters<typeof projectionWith>[0]): QueueEntry {
	return {
		projection: projectionWith(patch),
		connected: true,
		awaitingSnapshot: false,
	};
}

/** What the store holds between `beginStream` and the first frame of a new
 *  connection: the LAST visit's projection, kept by "stale beats blank". */
function leftover(patch: Parameters<typeof projectionWith>[0]): QueueEntry {
	return {
		projection: projectionWith(patch),
		connected: true,
		awaitingSnapshot: true,
	};
}

const QUIET: Engagement = {
	focused: false,
	draft: "",
	attachments: 0,
	dictating: false,
	otherSheetOpen: false,
	approvalOpen: false,
};

/** One screen mount's view of a conversation, against a ledger the test owns. */
function mount(ledger = createAsksOpenLedger()) {
	let clock = T0;
	const controller: AsksAutoOpen = createAsksAutoOpen(ledger, () => clock);
	/** One render's observation. */
	const see = (
		entry: QueueEntry,
		over: Partial<{
			sessionId: string;
			draftKnown: boolean;
			screenFocused: boolean;
			engagement: Partial<Engagement>;
		}> = {},
	): boolean =>
		controller.observe({
			sessionId: over.sessionId ?? SESSION,
			entry,
			draftKnown: over.draftKnown ?? true,
			screenFocused: over.screenFocused ?? true,
			engagement: { ...QUIET, ...over.engagement },
		});
	return {
		ledger,
		controller,
		see,
		/**
		 * The screen mounted. A view BEGINS at its first observation, and in
		 * production that is the mount effect, which runs before any frame can
		 * resolve (the store holds a leftover or nothing). A test that wants time
		 * to pass between "opened" and "the first resolved frame" must begin
		 * first - advancing the clock before the first observation would start
		 * the view late and make every ask look older than it was.
		 */
		begin(sessionId = SESSION): void {
			see(leftover({}), { sessionId });
		},
		/** Move this mount's clock forward (the view began at `T0`). */
		advance(ms: number): void {
			clock += ms;
		},
	};
}

const PENDING = { asks: [ask()], asks_open: 1 };
const ADDRESSED = {
	asks: [
		ask({ ask_id: "a1", status: "answered", delivered: true }),
		ask({ ask_id: "a2", status: "declined", delivered: true }),
		ask({ ask_id: "a3", status: "dismissed" }),
		ask({ ask_id: "a4", status: "expired" }),
		ask({ ask_id: "a5", status: "late", delivered: true }),
	],
	asks_open: 0,
};

/* ----------------------------------------------------------------- the 4 states */

describe("state 1 — no asks on open: closed (unchanged)", () => {
	it("stays closed for a published, empty queue", () => {
		const view = mount();
		expect(view.see(fresh({ asks: [], asks_open: 0 }))).toBe(false);
	});

	it("stays closed for a runtime that publishes the tally and no rows, at zero", () => {
		const view = mount();
		expect(view.see(fresh({ asks_open: 0 }))).toBe(false);
	});

	it("stays closed for an older relay that publishes no ask field at all", () => {
		const view = mount();
		expect(view.see(fresh({}))).toBe(false);
	});
});

describe("state 2 — pending asks on open: opens once", () => {
	it("opens for a conversation opened with an open ask", () => {
		const view = mount();
		expect(view.see(fresh(PENDING))).toBe(true);
	});

	it("opens for an ask that is only timed out, because it is still answerable", () => {
		const view = mount();
		expect(
			view.see(fresh({ asks: [ask({ status: "timed_out" })], asks_open: 1 })),
		).toBe(true);
	});

	it("opens ONCE for the view: every later render of the same frame says no", () => {
		const view = mount();
		const frame = fresh(PENDING);
		expect(view.see(frame)).toBe(true);
		expect(view.see(frame)).toBe(false);
		expect(view.see(frame)).toBe(false);
	});

	it("does not re-open when the reader's own close is followed by a re-render", () => {
		const view = mount();
		expect(view.see(fresh(PENDING))).toBe(true);
		view.controller.closed({ sessionId: SESSION, asksRemain: true });
		expect(view.see(fresh(PENDING))).toBe(false);
	});

	it("opens on the first RESOLVED frame, not on the leftover one before it", () => {
		const view = mount();
		// The store still holds last visit's asks until the new connection's seed
		// lands; nothing may be decided from them.
		expect(view.see(leftover(PENDING))).toBe(false);
		expect(view.see(fresh(PENDING))).toBe(true);
	});

	it("opens for a different conversation when the same screen is re-pointed at it", () => {
		const view = mount();
		expect(view.see(fresh(PENDING))).toBe(true);
		expect(view.see(fresh(PENDING), { sessionId: OTHER })).toBe(true);
		expect(view.see(fresh(PENDING), { sessionId: OTHER })).toBe(false);
	});
});

describe("state 3 — all asks addressed on open: closed, and never re-opens", () => {
	it("stays closed when every ask is answered, declined, dismissed, expired or late", () => {
		const view = mount();
		expect(view.see(fresh(ADDRESSED))).toBe(false);
	});

	it("does not open when a NEW ask arrives later in a view that opened addressed", () => {
		const view = mount();
		expect(view.see(fresh(ADDRESSED))).toBe(false);
		expect(view.see(fresh(PENDING))).toBe(false);
	});

	it("does not open when the queue empties and then refills in the same view", () => {
		const view = mount();
		expect(view.see(fresh(PENDING))).toBe(true);
		view.controller.closed({ sessionId: SESSION, asksRemain: false });
		expect(view.see(fresh({ asks: [], asks_open: 0 }))).toBe(false);
		expect(
			view.see(fresh({ asks: [ask({ ask_id: "a9" })], asks_open: 1 })),
		).toBe(false);
	});

	it("does not remember a close taken once the queue was clear", () => {
		const view = mount();
		view.see(fresh(PENDING));
		view.controller.closed({ sessionId: SESSION, asksRemain: false });
		expect(view.ledger.isDismissed(SESSION)).toBe(false);
	});
});

describe("state 4 — dismissed while pending: stays closed", () => {
	it("stays closed on a re-render and on a queue refresh after the close", () => {
		const view = mount();
		expect(view.see(fresh(PENDING))).toBe(true);
		view.controller.closed({ sessionId: SESSION, asksRemain: true });
		expect(view.see(fresh(PENDING))).toBe(false);
		// A refresh that changes the rows (an ask answered elsewhere, one added).
		expect(
			view.see(
				fresh({
					asks: [ask(), ask({ ask_id: "a2", created_at: 2_000 })],
					asks_open: 2,
				}),
			),
		).toBe(false);
	});

	it("stays closed after leaving the screen and coming back to the conversation", () => {
		const first = mount();
		first.see(fresh(PENDING));
		first.controller.closed({ sessionId: SESSION, asksRemain: true });

		// A new mount shares the app's ledger, and sees the previous visit's frame
		// until the new connection seeds.
		const second = mount(first.ledger);
		expect(second.see(leftover(PENDING))).toBe(false);
		expect(second.see(fresh(PENDING))).toBe(false);
	});

	it("stays closed after switching to another conversation and back", () => {
		const first = mount();
		first.see(fresh(PENDING));
		first.controller.closed({ sessionId: SESSION, asksRemain: true });

		// Another conversation is its own view, and opens.
		const elsewhere = mount(first.ledger);
		expect(elsewhere.see(fresh(PENDING), { sessionId: OTHER })).toBe(true);

		const back = mount(first.ledger);
		expect(back.see(fresh(PENDING))).toBe(false);
	});

	it("is per conversation: dismissing one does not silence another", () => {
		const view = mount();
		view.see(fresh(PENDING));
		view.controller.closed({ sessionId: SESSION, asksRemain: true });
		expect(view.ledger.isDismissed(SESSION)).toBe(true);
		expect(view.ledger.isDismissed(OTHER)).toBe(false);
	});

	it("may open again after an app restart, because the ledger is memory only", () => {
		const before = mount();
		before.see(fresh(PENDING));
		before.controller.closed({ sessionId: SESSION, asksRemain: true });

		const afterRestart = mount(createAsksOpenLedger());
		expect(afterRestart.see(fresh(PENDING))).toBe(true);
	});

	it("honours a close taken before the first frame ever decided", () => {
		// The reader opens the sheet from the bar the instant it renders — before
		// the policy's own frame — and closes it. That close is a refusal too.
		const view = mount();
		view.controller.closed({ sessionId: SESSION, asksRemain: true });
		expect(view.see(fresh(PENDING))).toBe(false);
	});
});

/* ------------------------------------------- "on open" means it existed before */

describe("an ask that ARRIVES is not pending on open", () => {
	/** The race the TUI lane found first: a conversation whose queue resolves on
	 *  the same frame that carries the agent's FIRST question. The reader is just
	 *  watching the agent work, so this is an arrival and rule 4 forbids forcing
	 *  the sheet over it. */
	const raisedAfterOpen = (ms: number) => ({
		asks: [ask({ ask_id: "fresh", created_at: T0 + ms })],
		asks_open: 1,
	});

	it("stays closed when the first resolved frame carries only an ask raised after the view began", () => {
		const view = mount();
		view.begin();
		view.advance(8_000);
		expect(view.see(fresh(raisedAfterOpen(7_000)))).toBe(false);
	});

	it("latches that closed: the same ask, re-rendered, never opens it later", () => {
		const view = mount();
		view.begin();
		view.advance(8_000);
		expect(view.see(fresh(raisedAfterOpen(7_000)))).toBe(false);
		expect(view.see(fresh(raisedAfterOpen(7_000)))).toBe(false);
		view.advance(1_000);
		expect(view.see(fresh(raisedAfterOpen(7_000)))).toBe(false);
	});

	it("stays closed for a brand-new conversation whose first frame is unresolved and whose second carries the first question", () => {
		const view = mount();
		expect(view.see(fresh({}))).toBe(false); // the runtime cannot say yet
		view.advance(3_000);
		// Raised six seconds after the view began: beyond the skew tolerance.
		expect(view.see(fresh(raisedAfterOpen(6_000)))).toBe(false);
	});

	it("opens when ONE ask predates the view even though a newer one arrived with it", () => {
		const view = mount();
		view.begin();
		view.advance(2_000);
		expect(
			view.see(
				fresh({
					asks: [
						ask({ ask_id: "new", created_at: T0 + 1_500 }),
						ask({ ask_id: "old", created_at: BEFORE }),
					],
					asks_open: 2,
				}),
			),
		).toBe(true);
	});

	it("opens for an ask created a moment before the view: the skew tolerance leans toward opening", () => {
		const view = mount();
		// `created_at` stamped by a peer whose clock runs a few seconds ahead of
		// this one lands INSIDE the view; within the tolerance it still counts.
		expect(
			view.see(
				fresh({
					asks: [ask({ created_at: T0 + ARRIVAL_SKEW_MS })],
					asks_open: 1,
				}),
			),
		).toBe(true);
	});

	it("reads an ask one millisecond past the tolerance as an arrival", () => {
		const view = mount();
		expect(
			view.see(
				fresh({
					asks: [ask({ created_at: T0 + ARRIVAL_SKEW_MS + 1 })],
					asks_open: 1,
				}),
			),
		).toBe(false);
	});

	it("treats a row with no usable created_at as old, so it is pending rather than an arrival", () => {
		const view = mount();
		expect(
			view.see(
				fresh({
					asks: [ask({ created_at: Number.NaN })],
					asks_open: 1,
				}),
			),
		).toBe(true);
	});

	it("reads each reading by name", () => {
		const queue = (rows: PendingAsk[]) => fresh({ asks: rows, asks_open: 1 });
		expect(readQueue(queue([ask({ created_at: BEFORE })]), T0)).toBe("pending");
		expect(readQueue(queue([ask({ created_at: T0 + 60_000 })]), T0)).toBe(
			"arrived",
		);
		expect(
			readQueue(
				queue([
					ask({ ask_id: "x", created_at: T0 + 60_000 }),
					ask({ ask_id: "y", created_at: BEFORE }),
				]),
				T0,
			),
		).toBe("pending");
	});
});

describe("the wait for a resolved frame is bounded", () => {
	it("opens on a frame that resolves exactly at the bound", () => {
		const view = mount();
		view.begin();
		view.advance(OPEN_WINDOW_MS);
		expect(view.see(fresh(PENDING))).toBe(true);
	});

	it("never opens on a frame that resolves later than the bound", () => {
		const view = mount();
		expect(view.see(fresh({ asks_open: 1 }))).toBe(false); // tally-only: unresolved
		view.advance(OPEN_WINDOW_MS + 1);
		expect(view.see(fresh(PENDING))).toBe(false);
	});

	it("stays shut for every frame after the bound, however many follow", () => {
		const view = mount();
		view.begin();
		view.advance(OPEN_WINDOW_MS + 1);
		expect(view.see(fresh(PENDING))).toBe(false);
		view.advance(1_000);
		expect(view.see(fresh(PENDING))).toBe(false);
	});

	it("bounds every reason a reading can stay unresolved, not only a missing frame", () => {
		for (const over of [
			{ draftKnown: false },
			{ screenFocused: false },
		] as const) {
			const view = mount();
			expect(view.see(fresh(PENDING), over)).toBe(false);
			view.advance(OPEN_WINDOW_MS + 1);
			expect(view.see(fresh(PENDING))).toBe(false);
		}
	});

	it("starts a new window for each view: a re-pointed screen gets its own 45 s", () => {
		const view = mount();
		view.begin();
		view.advance(OPEN_WINDOW_MS + 1);
		expect(view.see(fresh(PENDING))).toBe(false); // the first view is spent
		expect(view.see(fresh(PENDING), { sessionId: OTHER })).toBe(true);
	});
});

describe("leaving the sheet for another conversation", () => {
	it("keeps the destination from re-raising the queue the reader just walked out of", () => {
		const origin = mount();
		origin.see(fresh(PENDING));
		origin.controller.navigated({ to: OTHER });

		// The destination screen is a new mount of a different conversation, and
		// shares only the app's ledger with the origin.
		const destination = mount(origin.ledger);
		expect(destination.see(fresh(PENDING), { sessionId: OTHER })).toBe(false);
	});

	it("records nothing for the conversation that was left", () => {
		const origin = mount();
		origin.see(fresh(PENDING));
		origin.controller.navigated({ to: OTHER });
		expect(origin.ledger.isDismissed(SESSION)).toBe(false);
		expect(origin.ledger.isDismissed(OTHER)).toBe(true);
	});
});

describe("the sheet's open state is keyed by conversation", () => {
	it("reports the sheet open only for the conversation it was opened for", () => {
		const view = mount();
		expect(view.controller.openFor()).toBeNull();
		expect(view.see(fresh(PENDING))).toBe(true);
		expect(view.controller.openFor()).toBe(SESSION);
		expect(view.controller.isOpenFor(SESSION)).toBe(true);
		expect(view.controller.isOpenFor(OTHER)).toBe(false);
		expect(view.controller.isOpenFor("")).toBe(false);
	});

	it("DISMISS A -> ARRIVE AT B (the policy opens it) -> BACK TO A, one controller re-pointed: A's sheet is not showing", () => {
		// The sequence the desktop drawer leaked on, because its open state was one
		// window-wide flag that followed the reader. Here the same controller is
		// pointed at A, then B, then A again, with no new view between. That is a
		// property of the POLICY: expo-router 57 gives each `[id]` navigation in
		// this app its own route key (`AsksAutoOpen.openFor`), so the app does not do
		// this today - the test pins that it would be safe if it did.
		const view = mount();
		expect(view.see(fresh(PENDING), { sessionId: SESSION })).toBe(true);
		view.controller.closed({ sessionId: SESSION, asksRemain: true });
		expect(view.controller.isOpenFor(SESSION)).toBe(false);

		expect(view.see(fresh(PENDING), { sessionId: OTHER })).toBe(true);
		expect(view.controller.isOpenFor(OTHER)).toBe(true);
		expect(view.controller.isOpenFor(SESSION)).toBe(false);

		// Back to A: the policy did not re-open it, so nothing may be showing - not
		// A's sheet, and not B's carried over onto A.
		expect(view.see(fresh(PENDING), { sessionId: SESSION })).toBe(false);
		expect(view.controller.isOpenFor(SESSION)).toBe(false);
		expect(view.controller.isOpenFor(OTHER)).toBe(false);
		expect(view.controller.openFor()).toBeNull();
	});

	it("the same sequence with a screen per conversation (the router pushes a new route): popping B leaves A's still-mounted screen closed", () => {
		// expo-router 57's `navigate` to another `[id]` pushes a fresh route, so A's
		// screen - and its controller - stays mounted under B. They share only the
		// app's ledger.
		const ledger = createAsksOpenLedger();
		const a = mount(ledger);
		const b = mount(ledger);
		expect(a.see(fresh(PENDING), { sessionId: SESSION })).toBe(true);
		a.controller.closed({ sessionId: SESSION, asksRemain: true });

		expect(b.see(fresh(PENDING), { sessionId: OTHER })).toBe(true);
		// B on top: A is mounted but not focused, and frames keep arriving for it.
		expect(
			a.see(fresh(PENDING), { sessionId: SESSION, screenFocused: false }),
		).toBe(false);
		// B popped: A is focused again.
		expect(
			a.see(fresh(PENDING), { sessionId: SESSION, screenFocused: true }),
		).toBe(false);
		expect(a.controller.isOpenFor(SESSION)).toBe(false);
	});

	it("never shows A's open sheet over B, not even for the frame before B has been observed", () => {
		const view = mount();
		expect(view.see(fresh(PENDING), { sessionId: SESSION })).toBe(true);
		// The screen has just been re-pointed at B and has rendered once, but its
		// effect has not run yet: the render reads `isOpenFor(B)`.
		expect(view.controller.isOpenFor(OTHER)).toBe(false);
	});

	it("shuts a sheet left open on A when the screen is re-pointed, and does not resurrect it un-decided on the way back", () => {
		const view = mount();
		expect(view.see(fresh(PENDING), { sessionId: SESSION })).toBe(true);
		// Never dismissed: the reader was taken to B with A's sheet still up. B is
		// held back by a draft, so it does not open.
		expect(
			view.see(fresh(PENDING), {
				sessionId: OTHER,
				engagement: { draft: "typing" },
			}),
		).toBe(false);
		expect(view.controller.openFor()).toBeNull();

		// Back on A, where the reader has since left a draft: A is a new view, and
		// the policy declines for the same reason it would on a fresh mount. A flag
		// left true would have shown the sheet over that draft.
		expect(
			view.see(fresh(PENDING), {
				sessionId: SESSION,
				engagement: { draft: "typing" },
			}),
		).toBe(false);
		expect(view.controller.isOpenFor(SESSION)).toBe(false);
	});

	it("opens again for a re-pointed view that was never dismissed, because a view is a visit", () => {
		const view = mount();
		expect(view.see(fresh(PENDING), { sessionId: SESSION })).toBe(true);
		expect(view.see(fresh(PENDING), { sessionId: OTHER })).toBe(true);
		expect(view.see(fresh(PENDING), { sessionId: SESSION })).toBe(true);
		expect(view.controller.isOpenFor(SESSION)).toBe(true);
	});

	it("hides the sheet and dismisses the destination when the reader leaves for another conversation", () => {
		const view = mount();
		view.see(fresh(PENDING));
		view.controller.navigated({ to: OTHER });
		expect(view.controller.isOpenFor(SESSION)).toBe(false);
		expect(view.controller.openFor()).toBeNull();
		expect(view.ledger.isDismissed(OTHER)).toBe(true);
	});

	it("opens for the conversation the reader pressed the bar on, and closes with it", () => {
		const view = mount();
		view.controller.opened({ sessionId: SESSION });
		expect(view.controller.isOpenFor(SESSION)).toBe(true);
		view.controller.closed({ sessionId: SESSION, asksRemain: true });
		expect(view.controller.isOpenFor(SESSION)).toBe(false);
	});

	it("notifies subscribers only when the open state actually changes", () => {
		const view = mount();
		const seen: Array<string | null> = [];
		const off = view.controller.subscribe(() =>
			seen.push(view.controller.openFor()),
		);
		view.see(fresh(PENDING)); // opens
		view.see(fresh(PENDING)); // decided: nothing
		view.controller.closed({ sessionId: SESSION, asksRemain: true }); // shuts
		view.controller.closed({ sessionId: SESSION, asksRemain: true }); // already shut
		off();
		view.controller.opened({ sessionId: SESSION }); // unsubscribed: nothing
		expect(seen).toEqual([SESSION, null]);
	});

	it("lets a subscriber unsubscribe from inside its own notification without skipping the others", () => {
		const view = mount();
		const calls: string[] = [];
		const offFirst = view.controller.subscribe(() => {
			calls.push("first");
			offFirst();
		});
		view.controller.subscribe(() => calls.push("second"));
		view.controller.opened({ sessionId: SESSION });
		view.controller.closed({ sessionId: SESSION, asksRemain: false });
		expect(calls).toEqual(["first", "second", "second"]);
	});
});

describe("the reader got to the door first", () => {
	it("opened() settles the view so a still-waiting policy cannot open what is already open", () => {
		const view = mount();
		expect(view.see(fresh({ asks_open: 1 }))).toBe(false); // waiting
		view.controller.opened({ sessionId: SESSION });
		expect(view.see(fresh(PENDING))).toBe(false);
	});

	it("opened() records no dismissal: closing the hand-opened sheet is closed()'s to record", () => {
		const view = mount();
		view.controller.opened({ sessionId: SESSION });
		expect(view.ledger.isDismissed(SESSION)).toBe(false);
		view.controller.closed({ sessionId: SESSION, asksRemain: true });
		expect(view.ledger.isDismissed(SESSION)).toBe(true);
	});
});

/* ---------------------------------------------------------------- rule 5: guards */

describe("an unresolved queue opens nothing", () => {
	it("ignores a TALLY-ONLY frame: a count with no rows is not pending asks", () => {
		const view = mount();
		expect(view.see(fresh({ asks_open: 3 }))).toBe(false);
	});

	it("keeps the view undecided on a tally-only frame, so the rows can still open it", () => {
		const view = mount();
		expect(view.see(fresh({ asks_open: 1 }))).toBe(false);
		expect(view.see(fresh(PENDING))).toBe(true);
	});

	it("ignores a frame from before the connection's first snapshot", () => {
		const view = mount();
		expect(view.see(leftover(PENDING))).toBe(false);
	});

	it("ignores a frame once the stream has ended (stale beats blank)", () => {
		const view = mount();
		expect(
			view.see({
				projection: projectionWith(PENDING),
				connected: false,
				awaitingSnapshot: false,
			}),
		).toBe(false);
	});

	it("ignores a conversation with no projection yet", () => {
		const view = mount();
		expect(
			view.see({ projection: null, connected: true, awaitingSnapshot: true }),
		).toBe(false);
	});

	it("ignores the route's empty-id fallback", () => {
		const view = mount();
		expect(view.see(fresh(PENDING), { sessionId: "" })).toBe(false);
	});

	it("waits until the session screen is the focused route, then decides once", () => {
		// The stack keeps this screen mounted under the agent drill-down; a frame
		// landing while another screen is on top must not raise a window-level
		// modal over that screen.
		const view = mount();
		expect(view.see(fresh(PENDING), { screenFocused: false })).toBe(false);
		expect(view.see(fresh(PENDING), { screenFocused: false })).toBe(false);
		expect(view.see(fresh(PENDING), { screenFocused: true })).toBe(true);
		expect(view.see(fresh(PENDING), { screenFocused: true })).toBe(false);
	});

	it("waits for the composer's draft restore before it decides", () => {
		const view = mount();
		expect(view.see(fresh(PENDING), { draftKnown: false })).toBe(false);
		expect(view.see(fresh(PENDING), { draftKnown: true })).toBe(true);
	});
});

describe("no focus theft", () => {
	it("does not open while the composer field holds the caret", () => {
		const view = mount();
		expect(view.see(fresh(PENDING), { engagement: { focused: true } })).toBe(
			false,
		);
	});

	it("does not open over a non-empty draft, restored or typed", () => {
		const view = mount();
		expect(
			view.see(fresh(PENDING), { engagement: { draft: "half a sentence" } }),
		).toBe(false);
	});

	it("treats a whitespace-only draft as empty", () => {
		const view = mount();
		expect(view.see(fresh(PENDING), { engagement: { draft: "  \n " } })).toBe(
			true,
		);
	});

	it("does not open over an attached image, a live dictation, another open sheet or a pending approval", () => {
		for (const engagement of [
			{ attachments: 1 },
			{ dictating: true },
			{ otherSheetOpen: true },
			{ approvalOpen: true },
		]) {
			const view = mount();
			expect(view.see(fresh(PENDING), { engagement })).toBe(false);
		}
	});

	it("does not pop up later when the reader stops typing: the blocked open is spent", () => {
		const view = mount();
		expect(view.see(fresh(PENDING), { engagement: { focused: true } })).toBe(
			false,
		);
		expect(view.see(fresh(PENDING), { engagement: { focused: false } })).toBe(
			false,
		);
	});
});

/* ------------------------------------------------------------- the pure pieces */

describe("decideAutoOpen", () => {
	const base = {
		decided: false,
		expired: false,
		reading: "pending",
		dismissed: false,
		engaged: false,
	} as const;

	it("opens exactly when resolved, pending, not dismissed and not engaged", () => {
		expect(decideAutoOpen(base)).toEqual({ open: true, decided: true });
	});

	it("never opens once decided, whatever else is true", () => {
		expect(decideAutoOpen({ ...base, decided: true })).toEqual({
			open: false,
			decided: true,
		});
	});

	it("leaves the latch open on an unresolved reading, so a later frame can decide", () => {
		expect(decideAutoOpen({ ...base, reading: "unresolved" })).toEqual({
			open: false,
			decided: false,
		});
	});

	it("closes an unresolved view for good once the window or a dismissal has spoken", () => {
		for (const patch of [{ expired: true }, { dismissed: true }] as const) {
			expect(
				decideAutoOpen({ ...base, reading: "unresolved", ...patch }),
			).toEqual({ open: false, decided: true });
		}
	});

	it("settles closed on empty, arrived, a dismissal, an expired window and engagement", () => {
		for (const patch of [
			{ reading: "empty" },
			{ reading: "arrived" },
			{ dismissed: true },
			{ expired: true },
			{ engaged: true },
		] as const) {
			expect(decideAutoOpen({ ...base, ...patch })).toEqual({
				open: false,
				decided: true,
			});
		}
	});
});

describe("readQueue and isFreshFrame", () => {
	it("reads rows as the truth when they are published, empty or not", () => {
		expect(readQueue(fresh({ asks: [], asks_open: 4 }), T0)).toBe("empty");
		expect(readQueue(fresh(PENDING), T0)).toBe("pending");
		expect(readQueue(fresh(ADDRESSED), T0)).toBe("empty");
	});

	it("reads an absent list as unresolved unless the tally says zero", () => {
		expect(readQueue(fresh({}), T0)).toBe("unresolved");
		expect(readQueue(fresh({ asks_open: 2 }), T0)).toBe("unresolved");
		expect(readQueue(fresh({ asks_open: 0 }), T0)).toBe("empty");
	});

	it("calls a frame fresh only when it is the connection's own", () => {
		expect(isFreshFrame(fresh({}))).toBe(true);
		expect(isFreshFrame(leftover({}))).toBe(false);
		expect(
			isFreshFrame({
				projection: null,
				connected: true,
				awaitingSnapshot: false,
			}),
		).toBe(false);
		expect(
			isFreshFrame({
				projection: projectionWith({}),
				connected: false,
				awaitingSnapshot: false,
			}),
		).toBe(false);
	});
});

describe("readerEngaged", () => {
	it("is false for a quiet composer and true for each single signal", () => {
		expect(readerEngaged(QUIET)).toBe(false);
		expect(readerEngaged({ ...QUIET, focused: true })).toBe(true);
		expect(readerEngaged({ ...QUIET, draft: "x" })).toBe(true);
		expect(readerEngaged({ ...QUIET, attachments: 2 })).toBe(true);
		expect(readerEngaged({ ...QUIET, dictating: true })).toBe(true);
		expect(readerEngaged({ ...QUIET, otherSheetOpen: true })).toBe(true);
		expect(readerEngaged({ ...QUIET, approvalOpen: true })).toBe(true);
	});
});
