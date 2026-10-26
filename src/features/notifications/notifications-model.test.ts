import { describe, expect, it } from "vitest";

import type { NotificationItem, NotificationsResponse } from "@/contracts";
import {
	canDismiss,
	countLabel,
	hasUnread,
	inboxEmpty,
	inboxRows,
	inboxSections,
	inboxUnreadCount,
	markAllTarget,
	notificationsEnabled,
	selectionTargets,
	toggleSelection,
} from "@/features/notifications/notifications-model";

function item(overrides: Partial<NotificationItem> = {}): NotificationItem {
	return {
		id: "n_1",
		source: "notify",
		priority: "normal",
		title: "An update",
		excerpt: "",
		created_at: 1_700_000_000_000,
		updated_at: 1_700_000_000_000,
		seq: 1,
		revision: 1,
		read: false,
		read_via: null,
		dismissed: false,
		repeat_count: 1,
		session: { id: "s1", title: "Session one", agent_id: "aida", live: true },
		projects: [],
		ask: null,
		actions: { dismiss: true, answer: false, read: true },
		...overrides,
	};
}

function response(
	partial: Partial<NotificationsResponse> = {},
): NotificationsResponse {
	return {
		items: [],
		waiting: [],
		next_cursor: null,
		unread_count: 0,
		waiting_count: 0,
		high_water: 0,
		...partial,
	};
}

describe("the inbox's shape", () => {
	it("puts the open asks first and groups the rest by when they moved", () => {
		const now = Date.UTC(2026, 9, 25, 12, 0, 0);
		const sections = inboxSections(
			response({
				waiting: [item({ id: "ask:1", source: "ask" })],
				items: [
					item({ id: "n_today", updated_at: now - 60_000 }),
					item({ id: "n_yesterday", updated_at: now - 26 * 3_600_000 }),
					item({ id: "n_week", updated_at: now - 3 * 86_400_000 }),
					item({ id: "n_old", updated_at: now - 40 * 86_400_000 }),
				],
			}),
			now,
		);
		expect(sections.map((section) => section.id)).toEqual([
			"waiting",
			"today",
			"yesterday",
			"week",
			"earlier",
		]);
	});

	it("omits a section with no rows rather than drawing an empty heading", () => {
		const now = Date.UTC(2026, 9, 25, 12, 0, 0);
		const sections = inboxSections(
			response({ items: [item({ updated_at: now - 60_000 })] }),
			now,
		);
		expect(sections).toHaveLength(1);
		expect(sections[0]?.id).toBe("today");
	});

	it("reads the badge from the relay's count, never from the rows it holds", () => {
		/* The page is a prefix of the mailbox: 40 outstanding, 2 on this page. A
		 * badge counting the page would understate the whole point of the screen. */
		expect(
			inboxUnreadCount(
				response({ items: [item(), item({ id: "n_2" })], unread_count: 40 }),
			),
		).toBe(40);
	});

	it("caps the numeral at 99+", () => {
		expect(countLabel(1)).toBe("1");
		expect(countLabel(99)).toBe("99");
		expect(countLabel(180)).toBe("99+");
	});

	it("says empty only about THIS answer, which is all a page can claim", () => {
		expect(inboxEmpty(response())).toBe(true);
		expect(inboxEmpty(response({ unread_count: 12, high_water: 88 }))).toBe(
			true,
		);
		expect(hasUnread(response({ unread_count: 0 }))).toBe(false);
	});

	it("orders rows as the list draws them: waiting first, then updates", () => {
		const rows = inboxRows(
			response({
				waiting: [item({ id: "ask:1", source: "ask" })],
				items: [item({ id: "n_2" })],
			}),
		);
		expect(rows.map((row) => row.id)).toEqual(["ask:1", "n_2"]);
	});
});

describe("selection and the token it sends", () => {
	it("keys a selection by id AND revision, so a moved row drops out", () => {
		const row = item({ id: "n_7", revision: 3 });
		const picked = toggleSelection(new Set<string>(), row);
		/* The row is updated underneath the selection: same id, new revision. */
		const moved = item({ id: "n_7", revision: 4 });
		expect(selectionTargets(picked, [row])).toEqual([
			{ id: "n_7", revision: 3 },
		]);
		expect(selectionTargets(picked, [moved])).toEqual([]);
	});

	it("toggles off on a second tap", () => {
		const row = item({ id: "n_7", revision: 3 });
		const picked = toggleSelection(new Set<string>(), row);
		expect(toggleSelection(picked, row).size).toBe(0);
	});

	it("never offers a dismiss or a selection on an open ask", () => {
		const ask = item({
			id: "ask:1",
			source: "ask",
			ask: {
				status: "open",
				deadline_at: 0,
				question_count: 1,
				dismissible: true,
			},
		});
		expect(canDismiss(ask)).toBe(false);
		/* AND IT IS NOT SELECTABLE EITHER (design review round 2 D9). It cannot be
		 * dismissed and it is not read — it is answered — so a checkbox on it would
		 * offer an action the model drops, while inflating the count the reader is
		 * shown against the count the doors can act on. */
		const picked = toggleSelection(new Set<string>(), ask);
		expect(picked.size).toBe(0);
		expect(selectionTargets(picked, [ask])).toEqual([]);
	});

	it("mark-all names the answer's high-water, not a count of rows", () => {
		/* An answer holding two rows while 40 are outstanding must carry 2's
		 * window: the number is the relay's watermark, so a bulk gesture can only
		 * reach events the screen actually enumerated. */
		expect(
			markAllTarget(response({ unread_count: 40, high_water: 88 })),
		).toEqual({ through_seq: 88 });
		expect(markAllTarget(response())).toBeNull();
	});
});

describe("the relay's capability gate", () => {
	it("reads a versioned flag, and treats every absence as no", () => {
		expect(notificationsEnabled({})).toBe(false);
		expect(notificationsEnabled({ features: {} })).toBe(false);
		expect(notificationsEnabled({ features: { notifications: 0 } })).toBe(
			false,
		);
		expect(notificationsEnabled({ features: { notifications: 1 } })).toBe(true);
		expect(notificationsEnabled({ features: { notifications: "2" } })).toBe(
			true,
		);
	});
});
