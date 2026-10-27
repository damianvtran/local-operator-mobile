import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { createNotificationsStore } from "./notifications.ts";

/**
 * The mock relay's inbox store, exercised as the WRITE path a real relay
 * implements — because the cursor, the token rules and the refusals are exactly
 * what the phone's screen is written against, and a canned answer would let a
 * broken client pass.
 *
 * The seed is the synthetic corpus the contract tests validate, so these cases
 * and the app's boundary parse the same bytes.
 */

const seed = JSON.parse(
	readFileSync(
		new URL(
			"../../fixtures/relay/synthetic/notifications-populated.json",
			import.meta.url,
		),
		"utf8",
	),
);

function store() {
	return createNotificationsStore({ seed, details: {} });
}

describe("the inbox read", () => {
	it("serves the unread pile with the pinned asks separate from the updates", () => {
		const page = store().page("unread", 50) as {
			items: { id: string }[];
			waiting: { id: string }[];
			unread_count: number;
			waiting_unread_count: number;
			waiting_count: number;
			next_cursor: string | null;
		};
		expect(page.items.map((row) => row.id)).not.toContain("n_read");
		expect(page.waiting.map((row) => row.id)).toEqual(["ask:3f2a9c1b:a1"]);
		/* THE SPLIT THE CORE PUBLISHES (`items.counts`): `unread_count` is the
		 *  notify half only, the open ask is counted in `waiting_unread_count`, and
		 *  the badge sums the two. A mock that folded the ask into `unread_count`
		 *  passed a screen whose badge then double-counted it (D16/NC7). */
		expect(page.unread_count).toBe(4);
		expect(page.waiting_unread_count).toBe(1);
		expect(page.unread_count + page.waiting_unread_count).toBe(5);
		expect(page.waiting_count).toBe(1);
		expect(page.next_cursor).toBeNull();
	});

	it("serves the read history under `all` and the dismissed pile under `dismissed`", () => {
		const live = store();
		const all = live.page("all", 50) as { items: { id: string }[] };
		expect(all.items.map((row) => row.id)).toContain("n_read");
		const dismissed = live.page("dismissed", 50) as { items: unknown[] };
		expect(dismissed.items).toHaveLength(0);
	});

	it("404s an id it does not hold, in the relay's own shape", () => {
		const outcome = store().detail("n_nope");
		expect(outcome.ok).toBe(false);
		if (!outcome.ok) {
			expect(outcome.status).toBe(404);
			expect((outcome.body as { code?: string }).code).toBe(
				"notification_not_found",
			);
		}
	});
});

describe("the writes", () => {
	it("dismisses a row for real: the next read no longer holds it", () => {
		const live = store();
		const outcome = live.patch({
			op: "dismiss",
			ids: [{ id: "n_audit", revision: 2 }],
		});
		expect(
			outcome.ok && (outcome.body as { changed: string[] }).changed,
		).toEqual(["n_audit"]);
		const unread = live.page("unread", 50) as { items: { id: string }[] };
		expect(unread.items.map((row) => row.id)).not.toContain("n_audit");
		const dismissed = live.page("dismissed", 50) as { items: { id: string }[] };
		expect(dismissed.items.map((row) => row.id)).toEqual(["n_audit"]);
	});

	it("refuses a write that names a revision the row has moved past", () => {
		const outcome = store().patch({
			op: "read",
			ids: [{ id: "n_audit", revision: 1 }],
		});
		expect(outcome.ok).toBe(true);
		if (outcome.ok) {
			const body = outcome.body as {
				changed: string[];
				skipped: { id: string; reason: string }[];
			};
			expect(body.changed).toEqual([]);
			expect(body.skipped).toEqual([
				{ id: "n_audit", reason: "stale_revision" },
			]);
		}
	});

	it("refuses to dismiss an open ask, and says why", () => {
		const outcome = store().patch({
			op: "dismiss",
			ids: [{ id: "ask:3f2a9c1b:a1", revision: 1 }],
		});
		if (outcome.ok) {
			const body = outcome.body as {
				skipped: { id: string; reason: string }[];
			};
			expect(body.skipped).toEqual([
				{ id: "ask:3f2a9c1b:a1", reason: "live_ask" },
			]);
		} else {
			throw new Error("the store refused the whole write");
		}
	});

	it("bounds a mark-all to the through_seq the screen enumerated", () => {
		const live = store();
		/* The body the APP sends: `all` + the boundary + the tokens the answer
		 * observed. The old test sent `all` + `through_seq` alone — a body the app
		 * never sends and the live relay 422s — which is why the mark-all that
		 * reached only the last page passed the suite (code review m1). */
		const page = live.page("all", 50) as unknown as {
			observed: { id: string; revision: number }[];
		};
		const before = page.observed.filter((token) =>
			["n_deploy", "n_read"].includes(token.id),
		);
		const outcome = live.patch({
			op: "read",
			all: true,
			through_seq: 6,
			observed: before,
		});
		if (!outcome.ok) throw new Error("mark-all refused");
		const body = outcome.body as { changed: string[] };
		/* seq 5 (n_deploy), 6 (n_read — already read, so it is still "changed" by
		 * the write), and nothing above 6: the fraud item (8), the PR (7) and the
		 * ask (10) are all outside the window. */
		expect(body.changed.sort()).toEqual(["n_deploy", "n_read"]);
		const unread = live.page("unread", 50) as { items: { id: string }[] };
		expect(unread.items.map((row) => row.id)).toContain("n_fraud");
		expect(unread.items.map((row) => row.id)).not.toContain("n_deploy");
	});

	it("marks read through an evidenced in-view receipt, and only with fresh evidence", () => {
		const live = store();
		const row = live.page("unread", 50) as {
			items: { id: string; updated_at: number; revision: number }[];
		};
		const target = row.items.find((item) => item.id === "n_fraud");
		if (target === undefined) throw new Error("no fraud row in the seed");
		const stale = live.seen({
			items: [{ id: target.id, revision: target.revision }],
			evidence: {
				surface: "native",
				input_kind: "touch",
				/* Both stamps are epoch MILLISECONDS on the wire: the row's own
				 * clock is ms, so the edge is compared to it directly (the ×1000
				 * that used to be here outlived the fixtures' unit move). */
				input_at_ms: target.updated_at - 1,
				visible_since_ms: target.updated_at,
			},
		});
		if (!stale.ok) throw new Error("receipt refused");
		expect((stale.body as { skipped: unknown[] }).skipped).toHaveLength(1);

		const fresh = live.seen({
			items: [{ id: target.id, revision: target.revision }],
			evidence: {
				surface: "native",
				input_kind: "touch",
				input_at_ms: target.updated_at + 1,
				visible_since_ms: target.updated_at,
			},
		});
		if (!fresh.ok) throw new Error("receipt refused");
		expect((fresh.body as { changed: string[] }).changed).toEqual([target.id]);
		const unread = live.page("unread", 50) as { items: { id: string }[] };
		expect(unread.items.map((row) => row.id)).not.toContain(target.id);
	});
});

describe("the bulk write needs its tokens", () => {
	it("refuses a bulk target with no observed tokens, in the relay's words", () => {
		/* The live route's answer, measured at local-operator a7d149e705. */
		for (const body of [
			{ op: "read", all: true, through_seq: 6 },
			{ op: "dismiss", session_id: "s_0001", through_seq: 6 },
		]) {
			const outcome = store().patch(body);
			expect(outcome.ok).toBe(false);
			if (!outcome.ok) {
				expect(outcome.status).toBe(422);
				expect((outcome.body as { error?: string }).error).toBe(
					"bulk writes require 0..500 observed tokens",
				);
			}
		}
	});

	it("accepts a bulk target that echoes what the answer observed", () => {
		const live = store();
		const outcome = live.patch({
			op: "read",
			all: true,
			through_seq: 10,
			observed: [{ id: "n_fraud", revision: 1 }],
		});
		if (!outcome.ok) throw new Error("a token-bound bulk write was refused");
		expect((outcome.body as { changed: string[] }).changed).toEqual([
			"n_fraud",
		]);
	});
});

describe("the fixture that makes the rail's grouped placement renderable (m-4)", () => {
	/**
	 * The rail's count placement has two states, and every fixture's count was ≤ 7
	 * while `countLabel` caps at `99+` — so no captured cell could leave the
	 * symmetric layout (code review round 10, m-4). `mesh-move-hold` now serves a
	 * busy inbox, and these assertions keep it busy: the count AND the rows behind
	 * it, so the frame's badge is not a number the list contradicts.
	 */
	it("serves S15/move-progress an inbox wide enough to read 99+", async () => {
		const { buildScenarios } = await import("./scenarios.ts");
		const { loadFixtures } = await import("./fixtures.ts");
		const world = buildScenarios(loadFixtures())["mesh-move-hold"]?.world() as {
			notifications?: { items?: unknown[]; counts?: Record<string, number> };
		};
		const inbox = world.notifications;
		expect(inbox).toBeDefined();
		const unread = inbox?.counts?.unread_count ?? 0;
		// The rail's cap is 99+ (`notifications-model.ts` `countLabel`), so 100 is the
		// first count that reads as three characters.
		expect(inbox?.counts?.unread_count).toBeGreaterThanOrEqual(100);
		// The rows agree with the count: one unread row per unread update.
		expect(inbox?.items).toHaveLength(unread);
		const ids = new Set(
			(inbox?.items ?? []).map((row) => (row as { id: string }).id),
		);
		expect(ids.size).toBe(unread);
	});
});
