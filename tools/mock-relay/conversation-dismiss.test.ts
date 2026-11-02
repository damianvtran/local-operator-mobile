import { describe, expect, it } from "vitest";

import {
	applyConversationOperation,
	confirmDismissTitle,
	dismissReceiptSentence,
	observeConversationScope,
	type ScopePage,
	type ScopePageRequest,
	type ScopeWriteAnswer,
	type ScopeWriteBody,
	undoReceiptSentence,
} from "../../src/features/notifications/conversation-dismiss.ts";
import { createNotificationsStore } from "./notifications.ts";

/**
 * "Dismiss all from a conversation", run against the mock relay's store — the
 * same paging, token and seq rules the live route applies — with the app's own
 * scope walker and batcher.
 *
 * The volume is the point: 130 updates in one conversation span two 100-row
 * pages, so a client that counted or cleared only the first page would show
 * 100 and apply 100, and these cases would catch the 30 it left behind. A
 * second conversation, an open ask and a row that lands after the count are the
 * three things the action must NOT touch.
 */

const TARGET = "aaaaaaaaaaa1";
const OTHER = "bbbbbbbbbbb2";
const ASK_ID = `ask:${TARGET}:q1`;
const BASE_AT = 1_792_900_000;

function update(index: number, session: string, title: string) {
	return {
		id: `n_${session.slice(0, 1)}${String(index).padStart(3, "0")}`,
		source: "notify",
		priority: "normal",
		title: `Run ${index} finished`,
		excerpt: "Synthetic update.",
		created_at: BASE_AT + index,
		updated_at: BASE_AT + index,
		seq: index + 1,
		revision: 1,
		read: index % 7 === 0,
		read_via: null,
		dismissed: false,
		repeat_count: 1,
		ask: null,
		session: { id: session, title, agent_id: "watch" },
		projects: [],
	};
}

/** 130 updates from TARGET, 40 from OTHER (interleaved in time), one open ask
 *  from TARGET. 171 rows in all. */
function seeded() {
	const items = [];
	for (let index = 0; index < 170; index += 1) {
		items.push(
			index % 17 < 13
				? update(index, TARGET, "Fraud watch")
				: update(index, OTHER, "Campaigns"),
		);
	}
	const ask = {
		...update(500, TARGET, "Fraud watch"),
		id: ASK_ID,
		source: "ask",
		priority: "high",
		ask: { ask_id: "q1", question_count: 1, status: "open" },
		seq: 171,
	};
	return createNotificationsStore({
		seed: { items, waiting: [ask], high_water: 171 },
		details: {},
	});
}

type Store = ReturnType<typeof seeded>;

/** The store as the app's page reader sees it: the route's parameters in, the
 *  route's answer out. */
function reader(store: Store, calls: ScopePageRequest[]) {
	return async (request: ScopePageRequest): Promise<ScopePage> => {
		calls.push(request);
		return store.page(request.state, request.limit, {
			sessionId: request.session_id,
			throughSeq: request.through_seq,
			cursor: request.cursor,
		}) as unknown as ScopePage;
	};
}

function sender(store: Store, bodies: ScopeWriteBody[]) {
	return async (body: ScopeWriteBody): Promise<ScopeWriteAnswer> => {
		bodies.push(body);
		const outcome = store.patch(body);
		if (!outcome.ok) throw new Error("the store refused the whole write");
		return outcome.body as unknown as ScopeWriteAnswer;
	};
}

function liveIds(store: Store, session?: string): string[] {
	const ids: string[] = [];
	let cursor: string | undefined;
	do {
		const page = store.page("all", 100, {
			sessionId: session,
			cursor,
		}) as unknown as ScopePage;
		ids.push(...page.items.map((item) => item.id));
		if (cursor === undefined) {
			ids.push(...(page.waiting ?? []).map((item) => item.id));
		}
		cursor = page.next_cursor ?? undefined;
	} while (cursor !== undefined);
	return ids;
}

function countOf(store: Store, session: string): number {
	return liveIds(store, session).filter((id) => !id.startsWith("ask:")).length;
}

describe("dismiss all from a conversation, over the paged store", () => {
	it("counts every page of the conversation, not the first", async () => {
		const store = seeded();
		const calls: ScopePageRequest[] = [];
		const scope = await observeConversationScope(reader(store, calls), {
			sessionId: TARGET,
			title: "Fraud watch",
		});
		expect(countOf(store, TARGET)).toBe(130);
		expect(scope.tokens).toHaveLength(130);
		expect(scope.openAsks).toBe(1);
		/* Two pages, both under the boundary the first answer stated. */
		expect(calls).toHaveLength(2);
		expect(calls[0]?.through_seq).toBeUndefined();
		expect(calls[1]?.through_seq).toBe(scope.throughSeq);
		expect(calls[1]?.cursor).toBeTruthy();
		expect(confirmDismissTitle(scope.tokens.length, scope.title)).toBe(
			"Dismiss 130 updates from Fraud watch?",
		);
	});

	it("applies exactly the count it showed, and nothing outside the conversation", async () => {
		const store = seeded();
		const otherBefore = countOf(store, OTHER);
		const scope = await observeConversationScope(reader(store, []), {
			sessionId: TARGET,
			title: "Fraud watch",
		});
		const shown = scope.tokens.length;
		const bodies: ScopeWriteBody[] = [];
		const receipt = await applyConversationOperation(
			sender(store, bodies),
			"dismiss",
			scope.tokens,
			scope,
		);
		expect(receipt.changed).toHaveLength(shown);
		expect(receipt.skipped).toEqual([]);
		expect(receipt.pending).toEqual([]);
		/* Every body is the bounded bulk shape the live route requires. */
		for (const body of bodies) {
			expect(body).toMatchObject({
				op: "dismiss",
				session_id: TARGET,
				through_seq: scope.throughSeq,
			});
			expect("observed" in body && body.observed.length).toBeLessThanOrEqual(
				500,
			);
		}
		expect(countOf(store, TARGET)).toBe(0);
		expect(countOf(store, OTHER)).toBe(otherBefore);
		expect(otherBefore).toBe(40);
		/* The open ask stays — and the receipt says so. */
		expect(liveIds(store, TARGET)).toEqual([ASK_ID]);
		expect(dismissReceiptSentence(receipt, scope)).toBe(
			"Dismissed 130 updates from Fraud watch. 1 open ask stays until it's answered.",
		);
	});

	it("counts after the detail's own read, so the open item is not refused as changed", async () => {
		/* Opening the detail marks its item read, and a read re-stamps the row's
		 * seq. The detail therefore walks the scope only AFTER that read settles;
		 * this pins why — the same read taken after the count would push the row
		 * past the frozen boundary and the write would refuse it. */
		const store = seeded();
		const page = store.page("all", 1, {
			sessionId: TARGET,
		}) as unknown as ScopePage;
		const opened = page.items[0];
		if (opened === undefined) throw new Error("no row to open");
		store.patch({
			op: "read",
			ids: [{ id: opened.id, revision: opened.revision }],
		});
		const scope = await observeConversationScope(reader(store, []), {
			sessionId: TARGET,
			title: "Fraud watch",
		});
		const receipt = await applyConversationOperation(
			sender(store, []),
			"dismiss",
			scope.tokens,
			scope,
		);
		expect(receipt.changed.map((token) => token.id)).toContain(opened.id);
		expect(receipt.skipped).toEqual([]);
		expect(receipt.changed).toHaveLength(130);
	});

	it("leaves an update that landed after the count alone", async () => {
		const store = seeded();
		const scope = await observeConversationScope(reader(store, []), {
			sessionId: TARGET,
			title: "Fraud watch",
		});
		store.insert({
			...update(900, TARGET, "Fraud watch"),
			id: "n_late",
			updated_at: BASE_AT + 10_000,
		});
		const receipt = await applyConversationOperation(
			sender(store, []),
			"dismiss",
			scope.tokens,
			scope,
		);
		expect(receipt.changed).toHaveLength(130);
		expect(liveIds(store, TARGET).sort()).toEqual([ASK_ID, "n_late"].sort());
	});

	it("refuses a row that changed after it was counted, and says how many", async () => {
		const store = seeded();
		const scope = await observeConversationScope(reader(store, []), {
			sessionId: TARGET,
			title: "Fraud watch",
		});
		const moved = scope.tokens[5];
		if (moved === undefined) throw new Error("no token to move");
		/* Read elsewhere between the confirmation and the write: the row's seq
		 * passes the frozen boundary, so the bulk write must not apply to it. */
		store.patch({ op: "read", ids: [moved] });
		const receipt = await applyConversationOperation(
			sender(store, []),
			"dismiss",
			scope.tokens,
			scope,
		);
		expect(receipt.changed).toHaveLength(129);
		expect(receipt.skipped).toEqual([
			{ id: moved.id, reason: "stale_revision" },
		]);
		expect(liveIds(store, TARGET)).toContain(moved.id);
		expect(dismissReceiptSentence(receipt, scope)).toBe(
			"Dismissed 129 of 130 updates from Fraud watch. 1 changed after they were counted and were left alone. 1 open ask stays until it's answered.",
		);
	});

	it("batches a scope over 500 tokens and undoes with the original tokens", async () => {
		const items = [];
		for (let index = 0; index < 620; index += 1) {
			items.push(update(index, TARGET, "Fraud watch"));
		}
		const store = createNotificationsStore({
			seed: { items, waiting: [], high_water: 620 },
			details: {},
		});
		const calls: ScopePageRequest[] = [];
		const scope = await observeConversationScope(reader(store, calls), {
			sessionId: TARGET,
			title: "Fraud watch",
		});
		expect(scope.tokens).toHaveLength(620);
		expect(calls).toHaveLength(7);
		const bodies: ScopeWriteBody[] = [];
		const receipt = await applyConversationOperation(
			sender(store, bodies),
			"dismiss",
			scope.tokens,
			scope,
		);
		expect(
			bodies.map((body) => "observed" in body && body.observed.length),
		).toEqual([500, 120]);
		expect(receipt.changed).toHaveLength(620);
		expect(countOf(store, TARGET)).toBe(0);

		const undoBodies: ScopeWriteBody[] = [];
		const undo = await applyConversationOperation(
			sender(store, undoBodies),
			"undismiss",
			receipt.changed,
			scope,
		);
		expect(undoBodies.map((body) => "ids" in body && body.ids.length)).toEqual([
			500, 120,
		]);
		expect(undo.changed).toHaveLength(620);
		expect(undoReceiptSentence(undo, 620)).toBe("Restored 620 updates.");
		expect(countOf(store, TARGET)).toBe(620);
	});

	it("reports a dropped write as unconfirmed rather than as done", async () => {
		const store = seeded();
		const scope = await observeConversationScope(reader(store, []), {
			sessionId: TARGET,
			title: "Fraud watch",
		});
		const receipt = await applyConversationOperation(
			async () => {
				throw new Error("connection dropped");
			},
			"dismiss",
			scope.tokens,
			scope,
		);
		expect(receipt.failed).toBe(true);
		expect(receipt.changed).toEqual([]);
		expect(receipt.pending).toHaveLength(130);
		expect(dismissReceiptSentence(receipt, scope)).toBe(
			"Dismissed 0 of 130 updates from Fraud watch. 130 not confirmed — the connection dropped. 1 open ask stays until it's answered.",
		);
		/* Nothing moved on the store. */
		expect(countOf(store, TARGET)).toBe(130);
	});
});
