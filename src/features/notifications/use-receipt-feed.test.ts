import { describe, expect, it, vi } from "vitest";
import { unionTokens } from "@/features/notifications/use-notifications";
import {
	createReceiptFeed,
	VIEWABILITY_CONFIG,
} from "@/features/notifications/use-receipt-feed";

/**
 * The read-receipt feed, driven as the SCREEN drives it.
 *
 * WHY THIS FILE EXISTS. Round 1 shipped with the tracker's only feed callback
 * defined and attached to nothing: `receipts.render` had no call site that any
 * list could reach, so `due()` always answered `[]` and the evidenced read path
 * was dead on both platforms while an unevidenced mount read was the only write
 * that reached the relay (code review B1, QA Q1). The unit tests could not see
 * it because they tested the tracker directly; nothing tested the WIRING.
 *
 * So these cases start at the seam that failed — a list's viewability answer —
 * and assert what reaches `send`:
 *
 *   - a row becoming visible, then a real touch, then the dwell → exactly one
 *     receipt, for that exact id AND revision;
 *   - no touch → nothing, ever (the fail-closed direction);
 *   - a touch that predates the render → nothing;
 *   - a backgrounded app, an unfocused screen, or a dialog → nothing;
 *   - a new revision is a new row, not swept up by the old touch;
 *   - a row that left the screen restarts its dwell when it comes back;
 *   - the evidence's `visible_since_ms` is the ROW's render time, not the clock
 *     at send time (code review m2).
 *
 * A DOM render is still not in this repo's harness; what is proved here is the
 * wiring contract the list hands to the platform (see the source invariant in
 * `notifications-screen-wiring.test.ts` for the other half — that the screen
 * actually passes this feed to the list).
 */

const ROW = { id: "n_audit", revision: 2 };
const T0 = 1_000_000;

function feedWith(send = vi.fn(async () => ({ ok: true, changed: [ROW.id] }))) {
	const feed = createReceiptFeed({ send });
	feed.setAppActive(true);
	feed.setFocused(true);
	return { feed, send };
}

/** What a FlatList hands `onViewableItemsChanged`. The clock is explicit so the
 *  dwell can be tested without sleeping. */
const at = (row: { id: string; revision: number }, nowMs = T0) => ({
	info: { viewableItems: [{ item: row }] },
	nowMs,
});
const gone = (nowMs = T0) => ({ info: { viewableItems: [] }, nowMs });

describe("the read-receipt feed", () => {
	it("sends exactly one receipt for a visible row, a real touch and the dwell", async () => {
		const { feed, send } = feedWith();
		feed.viewable(at(ROW).info, at(ROW).nowMs);
		feed.noteInput("touch", T0 + 50);
		expect(await feed.tick(T0 + 500)).toEqual([]); // inside the dwell
		expect(await feed.tick(T0 + 1_100)).toEqual([ROW]);
		expect(send).toHaveBeenCalledTimes(1);
		const [tokens, evidence] = send.mock.calls[0] as unknown as [
			{ id: string; revision: number }[],
			{ input_at_ms: number; visible_since_ms: number; surface: string },
		];
		expect(tokens).toEqual([ROW]);
		/* The evidence names the reader's gesture, not the send. */
		expect(evidence.input_at_ms).toBe(T0 + 50);
		expect(evidence.visible_since_ms).toBe(T0 + 50 - 50); // the render, not now
		expect(evidence.surface).toBe("native");
		/* A second tick does not re-send what the relay already accepted. */
		expect(await feed.tick(T0 + 5_000)).toEqual([]);
		expect(send).toHaveBeenCalledTimes(1);
	});

	it("sends nothing, ever, without a gesture after the render", async () => {
		const { feed, send } = feedWith();
		feed.viewable(at(ROW).info, at(ROW).nowMs);
		for (const at of [T0 + 600, T0 + 2_000, T0 + 60_000]) {
			expect(await feed.tick(at)).toEqual([]);
		}
		expect(send).not.toHaveBeenCalled();
	});

	it("refuses a gesture that predates the row's render", async () => {
		const { feed, send } = feedWith();
		feed.noteInput("press", T0 - 10);
		feed.viewable(at(ROW).info, at(ROW).nowMs); // rendered after the touch
		expect(await feed.tick(T0 + 2_000)).toEqual([]);
		expect(send).not.toHaveBeenCalled();
	});

	it("sends nothing while the app is backgrounded, the screen is unfocused or a dialog covers it", async () => {
		for (const context of ["backgrounded", "unfocused", "covered"] as const) {
			const { feed, send } = feedWith();
			feed.viewable(at(ROW).info, at(ROW).nowMs);
			feed.noteInput("touch", T0 + 10);
			if (context === "backgrounded") feed.setAppActive(false);
			if (context === "unfocused") feed.setFocused(false);
			if (context === "covered") feed.setCovered(true);
			expect(await feed.tick(T0 + 2_000)).toEqual([]);
			expect(send).not.toHaveBeenCalled();
		}
	});

	it("treats a new revision as a new row", async () => {
		const { feed, send } = feedWith();
		feed.viewable(at(ROW).info, at(ROW).nowMs);
		feed.noteInput("touch", T0 + 50);
		await feed.tick(T0 + 1_100);
		expect(send).toHaveBeenCalledTimes(1);
		/* The update arrives after the reader's touch. */
		feed.viewable(at({ id: ROW.id, revision: 3 }, T0 + 1_500).info, T0 + 1_500);
		expect(await feed.tick(T0 + 2_000)).toEqual([]);
		feed.noteInput("scroll", T0 + 2_500);
		expect(await feed.tick(T0 + 3_600)).toEqual([
			{ id: "n_audit", revision: 3 },
		]);
	});

	it("restarts the dwell when a row leaves the screen and comes back", async () => {
		const { feed } = feedWith();
		feed.viewable(at(ROW).info, at(ROW).nowMs);
		feed.noteInput("touch", T0 + 50);
		feed.viewable(gone(T0 + 400).info, T0 + 400); // scrolled away before the dwell elapsed
		feed.viewable(at(ROW, T0 + 900).info, T0 + 900); // and back, at T0+900
		expect(await feed.tick(T0 + 1_100)).toEqual([]); // 200 ms of the second stay
		feed.noteInput("touch", T0 + 1_200);
		expect(await feed.tick(T0 + 2_400)).toEqual([ROW]);
	});

	it("keeps a refused row eligible and never marks it settled", async () => {
		const send = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, changed: [] })
			.mockResolvedValueOnce({ ok: true, changed: [ROW.id] });
		const { feed } = feedWith(send);
		feed.viewable(at(ROW).info, at(ROW).nowMs);
		feed.noteInput("touch", T0 + 10);
		/* `tick` answers with what it SENT: the first ask is sent and refused, so
		 *  it reports the token and the row stays eligible. */
		expect(await feed.tick(T0 + 1_100)).toEqual([ROW]); // asked, nothing accepted
		expect(await feed.tick(T0 + 1_600)).toEqual([ROW]); // asked again, accepted
		expect(send).toHaveBeenCalledTimes(2);
		expect(await feed.tick(T0 + 9_000)).toEqual([]);
	});

	it("asks the platform for the same 50 % visibility rule the doctrine states", () => {
		expect(VIEWABILITY_CONFIG).toEqual({ itemVisiblePercentThreshold: 50 });
	});
});

describe("the observed-token union behind Mark all read", () => {
	it("keeps every page's tokens, deduped, with the last revision stated", () => {
		/* Round 1 kept only the last page's `observed`, so Mark all read reached
		 * 10 of the 60 rows on screen and reported no skips (code review M1). */
		const page1 = [
			{ id: "a", revision: 1 },
			{ id: "b", revision: 1 },
		];
		const page2 = [
			{ id: "b", revision: 2 },
			{ id: "c", revision: 1 },
		];
		expect(unionTokens(page1, page2)).toEqual([
			{ id: "a", revision: 1 },
			{ id: "b", revision: 2 },
			{ id: "c", revision: 1 },
		]);
		expect(unionTokens(undefined, page2)).toEqual(page2);
		expect(unionTokens(page1, undefined)).toEqual(page1);
	});

	it("survives a relay that omits the field entirely", () => {
		expect(unionTokens(undefined, undefined)).toEqual([]);
	});
});

describe("a refused answer is final, and asks are never marked", () => {
	const ASK = { id: "ask:session-1:q1", revision: 1 };

	it("does not answer twice when the server refuses the write (M1 loop)", async () => {
		/* QA round 2 Q4, measured on the real relay: a pinned open ask sat in view,
		 * the relay answered `live_ask`, nothing settled, and the same body went out
		 * 20 times in 10 s. A refusal IS the answer. */
		const send = vi.fn(async () => ({
			ok: true,
			changed: [],
			skipped: [{ id: "n_pinned", reason: "stale_revision" }],
		}));
		const feed = createReceiptFeed({ send });
		feed.setAppActive(true);
		feed.setFocused(true);
		feed.viewable(
			{ viewableItems: [{ item: { id: "n_pinned", revision: 1 } }] },
			T0,
		);
		feed.noteInput("touch", T0 + 10);
		expect(await feed.tick(T0 + 1_100)).toEqual([
			{ id: "n_pinned", revision: 1 },
		]);
		/* Ten more seconds of ticks with nothing moving: no second write. */
		for (let i = 1; i <= 20; i += 1) {
			expect(await feed.tick(T0 + 1_100 + i * 500)).toEqual([]);
		}
		expect(send).toHaveBeenCalledTimes(1);
	});

	it("CONTROL: an accepted answer also settles, so the loop test is about refusals", async () => {
		const send = vi.fn(async () => ({ ok: true, changed: ["n_pinned"] }));
		const feed = createReceiptFeed({ send });
		feed.setAppActive(true);
		feed.setFocused(true);
		feed.viewable(
			{ viewableItems: [{ item: { id: "n_pinned", revision: 1 } }] },
			T0,
		);
		feed.noteInput("touch", T0 + 10);
		expect(await feed.tick(T0 + 1_100)).toEqual([
			{ id: "n_pinned", revision: 1 },
		]);
		expect(await feed.tick(T0 + 5_000)).toEqual([]);
		expect(send).toHaveBeenCalledTimes(1);
	});

	it("never builds a receipt for an ask, even a pinned one filling the screen", async () => {
		const send = vi.fn(async () => ({ ok: true, changed: [] }));
		const feed = createReceiptFeed({ send });
		feed.setAppActive(true);
		feed.setFocused(true);
		feed.viewable({ viewableItems: [{ item: ASK }] });
		feed.noteInput("touch", T0 + 10);
		expect(await feed.tick(T0 + 2_000)).toEqual([]);
		expect(send).not.toHaveBeenCalled();
	});

	it("still sends for an update that shares the screen with an ask", async () => {
		const send = vi.fn(async () => ({ ok: true, changed: ["n_audit"] }));
		const feed = createReceiptFeed({ send });
		feed.setAppActive(true);
		feed.setFocused(true);
		feed.viewable(
			{
				viewableItems: [
					{ item: ASK },
					{ item: { id: "n_audit", revision: 2 } },
				],
			},
			T0,
		);
		feed.noteInput("touch", T0 + 10);
		expect(await feed.tick(T0 + 1_100)).toEqual([
			{ id: "n_audit", revision: 2 },
		]);
		expect(send).toHaveBeenCalledTimes(1);
	});

	it("retries after a transport failure, which is not an answer", async () => {
		const send = vi
			.fn()
			.mockResolvedValueOnce({ ok: false, changed: [] })
			.mockResolvedValueOnce({ ok: true, changed: ["n_pinned"] });
		const feed = createReceiptFeed({ send });
		feed.setAppActive(true);
		feed.setFocused(true);
		feed.viewable(
			{ viewableItems: [{ item: { id: "n_pinned", revision: 1 } }] },
			T0,
		);
		feed.noteInput("touch", T0 + 10);
		expect(await feed.tick(T0 + 1_100)).toEqual([]); // the write never landed
		expect(await feed.tick(T0 + 1_600)).toEqual([
			{ id: "n_pinned", revision: 1 },
		]);
		expect(await feed.tick(T0 + 9_000)).toEqual([]);
	});
});
