import { afterEach, describe, expect, it } from "vitest";

import type {
	NotificationDetailResponse,
	NotificationItem,
	NotificationsResponse,
} from "@/contracts";
import {
	canDismiss,
	conversationName,
	countLabel,
	detailMetaLine,
	dismissReceiptShowing,
	hasUnread,
	inboxEmpty,
	inboxRows,
	inboxSections,
	inboxUnreadCount,
	markAllTarget,
	mergePage,
	notificationsEnabled,
	openAskIdFor,
	readLoadedDetail,
	relativeTime,
	rowAccessibilityLabel,
	selectionTargets,
	toggleSelection,
	unionTokens,
} from "@/features/notifications/notifications-model";
import type { ConversationDismissPhase } from "@/features/notifications/use-conversation-dismiss";
import { resetLocaleSource, setLocaleSource } from "@/i18n";

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

describe("the explicit read, then the re-read (QA round 3, Q8)", () => {
	type Detail = {
		item: { id: string; read: boolean; revision: number; source: string };
		session: { id: string; title: string };
	};
	const loaded = (): Detail => ({
		item: { id: "n_1", read: false, revision: 69, source: "notify" },
		session: { id: "s1", title: "QA Alpha" },
	});

	it("re-reads only AFTER the read settles, and returns the moved revision", async () => {
		const order: string[] = [];
		let settle: (() => void) | null = null;
		const answer = readLoadedDetail(loaded(), {
			read: async () => {
				order.push("read:start");
				await new Promise<void>((resolve) => {
					settle = resolve;
				});
				order.push("read:settled");
				return { changed: ["n_1"] };
			},
			reload: async () => {
				order.push("reload");
				return {
					item: { id: "n_1", read: true, revision: 70, source: "notify" },
					session: { id: "s1", title: "QA Alpha" },
				};
			},
		});
		await Promise.resolve();
		/* Nothing has been re-read while the write is in flight — the defect was a
		 * walk that started HERE, naming revision 69 the store had already moved. */
		expect(order).toEqual(["read:start"]);
		expect(settle).not.toBeNull();
		(settle as unknown as () => void)();
		const shown = await answer;
		expect(order).toEqual(["read:start", "read:settled", "reload"]);
		expect(shown.item.revision).toBe(70);
	});

	it("keeps the original when the write changed nothing, and never re-reads", async () => {
		let reloaded = 0;
		const shown = await readLoadedDetail(loaded(), {
			read: async () => ({ changed: [] }),
			reload: async () => {
				reloaded += 1;
				return null;
			},
		});
		expect(reloaded).toBe(0);
		expect(shown.item.read).toBe(false);
		expect(shown.item.revision).toBe(69);
	});

	it("keeps the original when the write itself fails", async () => {
		const shown = await readLoadedDetail(loaded(), {
			read: async () => {
				throw new Error("refused");
			},
			reload: async () => null,
		});
		expect(shown.item.revision).toBe(69);
	});

	it("never reads an ASK — an ask is answered, not read", async () => {
		let reads = 0;
		const ask: Detail = {
			item: { id: "ask:s1:a1", read: false, revision: 1, source: "ask" },
			session: { id: "s1", title: "QA Alpha" },
		};
		const shown = await readLoadedDetail(ask, {
			read: async () => {
				reads += 1;
				return { changed: [] };
			},
			reload: async () => null,
		});
		expect(reads).toBe(0);
		expect(shown).toBe(ask);
	});

	describe("one cursor page merged onto what the screen holds (review round 4, m1)", () => {
		const page = (
			overrides: Partial<NotificationsResponse> = {},
		): NotificationsResponse => ({
			...response(),
			...overrides,
		});

		it("keeps page one's counts, waiting rows and boundary", () => {
			const held = page({
				items: [item({ id: "n_1" })],
				waiting: [item({ id: "ask:aaaaaaaaaaaa:a1", source: "ask" })],
				unread_count: 61,
				waiting_count: 1,
				waiting_unread_count: 1,
				high_water: 61,
				observed: [{ id: "n_1", revision: 1 }],
				next_cursor: "c1",
			});
			const next = page({
				items: [item({ id: "n_2" })],
				waiting: [],
				unread_count: 12,
				waiting_count: 9,
				waiting_unread_count: 9,
				high_water: 99,
				observed: [{ id: "n_2", revision: 1 }],
				next_cursor: null,
			});
			const merged = mergePage(held, next);
			expect(merged.unread_count).toBe(61);
			expect(merged.waiting_count).toBe(1);
			expect(merged.waiting_unread_count).toBe(1);
			expect(merged.waiting).toEqual(held.waiting);
			expect(merged.high_water).toBe(61);
		});

		it("never double-counts and never drops what page one carried", () => {
			const held = page({ items: [item({ id: "n_1" })] });
			const merged = mergePage(held, page({ items: [item({ id: "n_2" })] }));
			expect(merged.items.map((row) => row.id)).toEqual(["n_1", "n_2"]);
			expect(merged.items).toHaveLength(2);
			/* Counts are carried, not summed — a page is not a count. */
			expect(merged.unread_count).toBe(held.unread_count);
		});

		it("unions the observed window, so a bulk write reaches every page", () => {
			const held = page({ observed: [{ id: "n_1", revision: 1 }] });
			const next = page({
				observed: [
					{ id: "n_1", revision: 2 },
					{ id: "n_2", revision: 1 },
				],
			});
			const merged = mergePage(held, next);
			expect(merged.observed).toEqual([
				{ id: "n_1", revision: 2 },
				{ id: "n_2", revision: 1 },
			]);
			expect(unionTokens(undefined, undefined)).toEqual([]);
		});
	});

	describe("a zero clock and a nameless conversation (QA round 4, O1/O2)", () => {
		it("renders no age for a zero stamp, never the whole epoch", () => {
			expect(relativeTime(0, 1_792_926_900_000)).toBe("");
			expect(relativeTime(Number.NaN, 1_792_926_900_000)).toBe("");
			expect(relativeTime(1_792_926_840_000, 1_792_926_900_000)).toBe("1m ago");
		});

		it("names a nameless conversation the way the reel does", () => {
			expect(conversationName("")).toBe("untitled");
			expect(conversationName("   ")).toBe("untitled");
			expect(conversationName(undefined)).toBe("untitled");
			expect(conversationName("QA Alpha")).toBe("QA Alpha");
		});
	});

	describe("the awaited read's own budget (round 5, m6)", () => {
		type Detail = {
			item: { id: string; read: boolean; revision: number; source: string };
			session: { id: string; title: string };
		};
		const loaded = (): Detail => ({
			item: { id: "n_1", read: false, revision: 69, source: "notify" },
			session: { id: "s1", title: "QA Alpha" },
		});

		it("gives up on a hanging write and leaves the item UNREAD", async () => {
			const started = Date.now();
			const shown = await readLoadedDetail(
				loaded(),
				{
					read: (_id, _revision, signal) =>
						new Promise((_resolve, reject) => {
							signal.addEventListener("abort", () =>
								reject(new Error("aborted")),
							);
						}),
					reload: async () => null,
				},
				{ timeoutMs: 40 },
			);
			/* The budget is what ends it: without the signal the promise never settles. */
			expect(Date.now() - started).toBeLessThan(2_000);
			expect(shown.item.read).toBe(false);
			expect(shown.item.revision).toBe(69);
		});

		it("hands the caller a signal it can honour", async () => {
			let seen: AbortSignal | null = null;
			await readLoadedDetail(
				loaded(),
				{
					read: (_id, _revision, signal) => {
						seen = signal;
						return Promise.resolve({ changed: [] });
					},
					reload: async () => null,
				},
				{ timeoutMs: 3_500 },
			);
			expect(seen).not.toBeNull();
			expect((seen as unknown as AbortSignal).aborted).toBe(false);
		});
	});

	describe("the row's spoken sentence (round 5, m7/n4)", () => {
		const item = (
			overrides: Partial<{
				title: string;
				priority: string;
				updated_at: number;
				session: { title: string };
			}> = {},
		) => ({
			title: "Run finished",
			priority: "normal",
			updated_at: 1_792_926_900_000,
			session: { title: "QA Alpha" },
			...overrides,
		});

		it("ends cleanly when there is no clock", () => {
			const said = rowAccessibilityLabel({
				selecting: false,
				selected: false,
				item: item({ updated_at: 0 }),
				nowMs: 1_792_926_900_000,
			});
			expect(said).toBe("Run finished. QA Alpha.");
			expect(said.endsWith(". ")).toBe(false);
		});

		it("names an untitled conversation the way the reel does", () => {
			expect(
				rowAccessibilityLabel({
					selecting: false,
					selected: false,
					item: item({ session: { title: "  " } }),
					nowMs: 1_792_926_900_000,
				}),
			).toContain("untitled.");
		});

		it("keeps the selection sentence when selecting", () => {
			expect(
				rowAccessibilityLabel({
					selecting: true,
					selected: true,
					item: item(),
					nowMs: 1_792_926_900_000,
				}),
			).toBe("Selected: Run finished");
		});
	});
});

/* Review m1 (the C1 class): two fragments put a localized age beside English
 * that stays unkeyed until slice O3-b — the spoken "High priority. …" row label
 * and the detail's "<conversation> · Live · <age>" line. Under a non-en locale
 * the age must render from the English catalogue so neither reads as a
 * mixed-script, mixed-direction sentence. */
const ENGLISH_ONLY = /^[\x20-\x7E\u00B7\u2014\u2019]*$/;
const NOW = 1_792_926_900_000;
const FIVE_MIN_AGO = NOW - 5 * 60_000;

describe("C1-class fragments stay wholly English under a non-en locale", () => {
	afterEach(resetLocaleSource);

	it("negative control: under ur the standalone row age IS localized", () => {
		/* Proves the locale source is live in this test: without it the English
		 * assertions below would pass for the wrong reason. */
		setLocaleSource(() => "ur");
		const age = relativeTime(FIVE_MIN_AGO, NOW);
		expect(age).not.toBe("");
		expect(age).not.toMatch(ENGLISH_ONLY);
	});

	it("speaks the high-priority row label in English while ur is active", () => {
		setLocaleSource(() => "ur");
		const said = rowAccessibilityLabel({
			selecting: false,
			selected: false,
			item: {
				title: "Run finished",
				priority: "high",
				updated_at: FIVE_MIN_AGO,
				session: { title: "Session one" },
			},
			nowMs: NOW,
		});
		expect(said).toBe("High priority. Run finished. Session one. 5m ago");
		expect(said).toMatch(ENGLISH_ONLY);
	});

	it("renders the detail meta line in English while ur is active", () => {
		setLocaleSource(() => "ur");
		const line = detailMetaLine({
			sessionTitle: "Session one",
			live: true,
			updatedAt: FIVE_MIN_AGO,
			nowMs: NOW,
		});
		expect(line).toBe("Session one · Live · 5m ago");
		expect(line).toMatch(ENGLISH_ONLY);
	});

	it("drops an absent age and an untitled name without a dangling separator", () => {
		expect(
			detailMetaLine({
				sessionTitle: "",
				live: false,
				updatedAt: 0,
				nowMs: NOW,
			}),
		).toBe("untitled");
	});
});

/**
 * Whether the list's pinned footer holds the dismiss receipt (#321).
 *
 * The footer pays the bottom safe-area inset only while it has something in it,
 * and `DismissReceipt` returns null on this same predicate, so one rule decides
 * both. The table is exhaustive over the phase union (`satisfies` fails to
 * compile on a new kind).
 */
const RECEIPT_PHASES = {
	idle: { phase: { kind: "idle" }, showing: false },
	counting: { phase: { kind: "counting", title: "Aida" }, showing: true },
	confirming: {
		phase: { kind: "confirming", target: { kind: "tokens", tokens: [] } },
		showing: false,
	},
	applying: {
		phase: { kind: "applying", target: { kind: "tokens", tokens: [] } },
		showing: false,
	},
	done: {
		phase: {
			kind: "done",
			target: { kind: "tokens", tokens: [] },
			receipt: { changed: [], refused: [] } as never,
			sentence: "Dismissed 1 update.",
			complete: true,
		},
		showing: true,
	},
	undoing: {
		phase: {
			kind: "undoing",
			target: { kind: "tokens", tokens: [] },
			receipt: { changed: [], refused: [] } as never,
		},
		showing: false,
	},
	undone: {
		phase: { kind: "undone", sentence: "Restored 1 update.", complete: true },
		showing: true,
	},
	none: {
		phase: { kind: "none", sentence: "Nothing to dismiss." },
		showing: true,
	},
	failed: {
		phase: { kind: "failed", sentence: "Couldn't dismiss." },
		showing: true,
	},
} satisfies {
	[K in ConversationDismissPhase["kind"]]: {
		phase: Extract<ConversationDismissPhase, { kind: K }>;
		showing: boolean;
	};
};

describe("the dismiss receipt's footer slot (#321)", () => {
	it("is occupied exactly while the receipt has something to say", () => {
		for (const [kind, { phase, showing }] of Object.entries(RECEIPT_PHASES)) {
			expect([kind, dismissReceiptShowing(phase)]).toEqual([kind, showing]);
		}
	});
});

/**
 * Answering from the inbox expands THAT ask (Ben, 2026-11-23).
 *
 * The card's "Answer in conversation" opens `AsksSheet` with the item's id as
 * `initialOpenAsk`, and the sheet expands a row whose `ask_id` equals it. The
 * item's id is the relay's COMPOSITE (`ask:<session>:<ask_id>`); the read's rows
 * carry the bare `ask_id`. They are never equal, so the sheet opened collapsed
 * on an ask the reader had just pressed to answer.
 *
 * The detail is shaped like the synthetic list fixture
 * (`fixtures/relay/synthetic/notifications-populated.json:187`): composite id
 * `ask:3f2a9c1b:a1`, and the conversation's asks read carrying `a1`.
 */
describe("an inbox ask opens itself in the ask sheet (Ben, 2026-11-23)", () => {
	const askDetail = (): NotificationDetailResponse => ({
		item: item({
			id: "ask:3f2a9c1b:a1",
			source: "ask",
			ask: {
				status: "open",
				deadline_at: 0,
				question_count: 2,
				dismissible: true,
			},
		}),
		history: [],
		session: {
			id: "s_0003",
			title: "Payments migration",
			agent_id: "aida",
			cwd: "/work/payments",
		},
		anchor: null,
		projects: [],
		asks: [{ ask_id: "a1", session_id: "s_0003", status: "open" }],
	});

	it("hands the sheet an id the conversation's asks read returns", () => {
		const detail = askDetail();
		expect(detail.asks.map((row) => row.ask_id)).toContain(
			openAskIdFor(detail),
		);
	});

	it("takes the last segment of the relay's composite id", () => {
		/* The composite is `ask:<session>:<ask_id>`; the ask id is its tail. */
		expect(openAskIdFor(askDetail())).toBe("a1");
	});

	it("expands nothing for an update, nor for an unreadable id", () => {
		/* An update's card opens the conversation, so the sheet is not asked to
		 * pre-expand an ask it does not have. */
		expect(openAskIdFor({ item: { id: "n_1", source: "notify" } })).toBeNull();
		/* A truncated id names no ask: the sheet then keeps its collapsed walk. */
		expect(
			openAskIdFor({
				item: {
					id: "ask:3f2a9c1b:",
					source: "ask",
				},
			}),
		).toBeNull();
	});
});
