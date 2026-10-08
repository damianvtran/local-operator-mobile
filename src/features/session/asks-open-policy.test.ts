import { describe, expect, it } from "vitest";

import type { PendingAsk, SessionProjection } from "@/contracts";
import {
	type AsksAutoOpen,
	createAsksAutoOpen,
	createAsksOpenLedger,
	decideAutoOpen,
	type Engagement,
	isFreshFrame,
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

function ask(patch: Partial<PendingAsk> = {}): PendingAsk {
	return {
		ask_id: "a1",
		created_at: 1_000,
		expires_at: 1_000_000,
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
};

/** One screen mount's view of a conversation, against a ledger the test owns. */
function mount(ledger = createAsksOpenLedger()) {
	const controller: AsksAutoOpen = createAsksAutoOpen(ledger);
	return {
		ledger,
		controller,
		/** One render's observation. */
		see(
			entry: QueueEntry,
			over: Partial<{
				sessionId: string;
				composerReady: boolean;
				engagement: Partial<Engagement>;
			}> = {},
		): boolean {
			return controller.observe({
				sessionId: over.sessionId ?? SESSION,
				entry,
				composerReady: over.composerReady ?? true,
				engagement: { ...QUIET, ...over.engagement },
			});
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

	it("waits for the composer's draft restore before it decides", () => {
		const view = mount();
		expect(view.see(fresh(PENDING), { composerReady: false })).toBe(false);
		expect(view.see(fresh(PENDING), { composerReady: true })).toBe(true);
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

	it("does not open over an attached image, a live dictation or another open sheet", () => {
		for (const engagement of [
			{ attachments: 1 },
			{ dictating: true },
			{ otherSheetOpen: true },
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

	it("settles closed on empty, on a dismissal and on engagement", () => {
		for (const patch of [
			{ reading: "empty" },
			{ dismissed: true },
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
		expect(readQueue(fresh({ asks: [], asks_open: 4 }))).toBe("empty");
		expect(readQueue(fresh(PENDING))).toBe("pending");
		expect(readQueue(fresh(ADDRESSED))).toBe("empty");
	});

	it("reads an absent list as unresolved unless the tally says zero", () => {
		expect(readQueue(fresh({}))).toBe("unresolved");
		expect(readQueue(fresh({ asks_open: 2 }))).toBe("unresolved");
		expect(readQueue(fresh({ asks_open: 0 }))).toBe("empty");
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
	});
});
