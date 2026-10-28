import { describe, expect, it } from "vitest";

import { parsePayload, sessionListFrameSchema } from "@/contracts";
import { notificationsOrNull } from "@/state";

/**
 * THE INBOX CONTRACT, PINNED TO THE REAL RELAY'S BYTES.
 *
 * Captured from `origin/feat/notifications-banner-relay` at
 * `3cacd0cad0137b1cad3921b124baecb2f075fc09`
 * (`build_app(MobileDaemon(port=0, password=…))`, a real cookie login, synthetic
 * session ids and synthetic `example.invalid` links).
 *
 * WHY THESE REPLACED THE EARLIER SAMPLES. The previous suite pinned answers from
 * `a7d149e705`: an empty list, two write answers, and a `seen` answer the current
 * core no longer returns. It was green while EVERY real detail was rejected at
 * the parse boundary (audit NC1), every clock was read in the wrong unit (NC3),
 * and a `{}` inbox block dropped the whole sessions frame (NC5). A contract test
 * over shapes the relay does not send cannot catch any of that.
 *
 * WHAT THE LIVE BYTES SETTLE, field by field:
 *  - every notification clock is epoch MILLISECONDS (`1792926900000`);
 *  - an item carries its conversation as a NESTED `session`, never a top-level
 *    `session_id`;
 *  - `key` and `anchor_id` are ALWAYS present as strings, `""` meaning absent —
 *    so an empty anchor is "no anchor", not a failed lookup (NC6);
 *  - the detail adds `body_md` and `links`, and its `session` carries `live` +
 *    `cwd` rather than a `live_state` word;
 *  - `asks` are the asks store's stored rows (only `ask_id` guaranteed);
 *  - the list carries `waiting_unread_count` and the `observed` tokens.
 */
const LIVE_LIST: unknown = {
	items: [
		{
			id: "n_piujud5goyp37zvb",
			source: "notify",
			priority: "low",
			title: "Run finished with warnings",
			excerpt: "Two retries exhausted.",
			created_at: 1792927080000,
			updated_at: 1792927080000,
			seq: 4,
			revision: 1,
			read: false,
			read_via: null,
			read_surface: null,
			dismissed: false,
			repeat_count: 1,
			key: "warn",
			anchor_id: "",
			session: {
				id: "feed00000002",
				title: "Campaign watch",
				agent_id: "aida",
				live: false,
				live_state: "",
			},
			projects: [],
			ask: null,
			actions: {
				dismiss: true,
				answer: false,
				read: true,
			},
			runtime_live: false,
			durable: false,
		},
		{
			id: "n_6iy6ac36ehqtsqb7",
			source: "notify",
			priority: "normal",
			title: "Campaign article search finished",
			excerpt: "42 new articles screened; 3 matched the brief.",
			created_at: 1792927020000,
			updated_at: 1792927020000,
			seq: 3,
			revision: 1,
			read: false,
			read_via: null,
			read_surface: null,
			dismissed: false,
			repeat_count: 1,
			key: "campaign",
			anchor_id: "",
			session: {
				id: "feed00000002",
				title: "Campaign watch",
				agent_id: "aida",
				live: false,
				live_state: "",
			},
			projects: [],
			ask: null,
			actions: {
				dismiss: true,
				answer: false,
				read: true,
			},
			runtime_live: false,
			durable: false,
		},
	],
	next_cursor: null,
	unread_count: 2,
	waiting_count: 0,
	waiting_unread_count: 0,
	high_water: 4,
	waiting: [],
	observed: [
		{
			id: "n_piujud5goyp37zvb",
			revision: 1,
		},
		{
			id: "n_6iy6ac36ehqtsqb7",
			revision: 1,
		},
	],
};

const LIVE_DETAIL: unknown = {
	item: {
		id: "n_piujud5goyp37zvb",
		source: "notify",
		priority: "low",
		title: "Run finished with warnings",
		excerpt: "Two retries exhausted.",
		created_at: 1792927080000,
		updated_at: 1792927080000,
		seq: 4,
		revision: 1,
		read: false,
		read_via: null,
		read_surface: null,
		dismissed: false,
		repeat_count: 1,
		key: "warn",
		anchor_id: "",
		session: {
			id: "feed00000002",
			title: "Campaign watch",
			agent_id: "aida",
			live: false,
			live_state: "",
		},
		projects: [],
		ask: null,
		actions: {
			dismiss: true,
			answer: false,
			read: true,
		},
		body_md: "Two retries exhausted.",
		links: [],
		runtime_live: false,
		durable: false,
	},
	history: [],
	session: {
		id: "feed00000002",
		title: "Campaign watch",
		agent_id: "aida",
		live: false,
		live_state: "",
		cwd: "",
	},
	anchor: null,
	projects: [],
	asks: [],
};

const LIVE_PATCH_BULK = {
	unread_count: 0,
	waiting_count: 0,
	waiting_unread_count: 0,
	high_water: 0,
	changed: [],
	skipped: [],
};

const LIVE_PATCH_UNKNOWN_ID = {
	unread_count: 0,
	waiting_count: 0,
	waiting_unread_count: 0,
	high_water: 0,
	changed: [],
	skipped: [{ id: "n_missing", reason: "unknown" }],
};

/** At `3cacd0cad01` the receipt door ACCEPTS a `surface: "native"` claim (it
 *  re-checks the store's revision, anchor, dwell and input edge) and refuses any
 *  other surface with this code — the R6 negative, kept. The app does not call it:
 *  showing a reel row is not evidence (D11), so the only read this client sends is
 *  the explicit PATCH above. Pinned so a future client change that starts
 *  asserting receipts has to read this file first. */
const LIVE_SEEN_REFUSAL = {
	error:
		"read receipts on the relay are for the native surface, which reports touch, press or scroll edges",
	code: "relay_surface_mismatch",
};

/**
 * A REAL CURSOR PAGE, as `items.py::list_page` spells it: `waiting` is ABSENT
 * (the key is added only when there is no cursor), every other field is present.
 * QA round 3 measured exactly this answer and the client rejected it —
 * `waiting Invalid input: expected array, received undefined` — so "Load more"
 * could never append a single row against the live relay (Q7).
 */
const LIVE_CURSOR_PAGE: unknown = (() => {
	/* Built from the same captured first page, with the ONE key the live route
	 * drops on a cursor page removed and a single row kept: the row is real
	 * bytes, so this test cannot pass on a shape the relay never sends. */
	const { waiting: _omitted, ...rest } = LIVE_LIST as Record<string, unknown>;
	const items = (LIVE_LIST as { items: unknown[] }).items;
	return { ...rest, items: [items[0]], next_cursor: null };
})();

/**
 * A REAL DETAIL WHOSE CONVERSATION HAS A PICKER ASK, pinned to the producer's
 * own question mapping: `asks/queue.py::_question_shape` stores each option as
 * the ask tool's mapping, so `options` arrives as OBJECTS. QA round 3 measured
 * both the ask's detail and a notify detail in that conversation failing with
 * `asks.0.questions.0.options.0 expected string, received object` (Q9). One
 * option carries no description, because the producer may omit it.
 */
const LIVE_DETAIL_PICKER_ASK: unknown = {
	...(LIVE_DETAIL as Record<string, unknown>),
	asks: [
		{
			ask_id: "ask_1",
			session_id: "3f2a9c1b",
			status: "open",
			questions: [
				{
					id: "q1",
					question: "Which payment provider should the migration target?",
					options: [
						{ label: "Yes", description: "Send the synthetic report" },
						{ label: "No", description: "Keep it local" },
						{ label: "Ask me later" },
					],
					multi: false,
					recommended: 0,
					secret: false,
					persist: false,
				},
			],
		},
	],
};

describe("the inbox contract against the live relay's answers", () => {
	it("parses the populated list and the ask half of the badge", () => {
		const parsed = parsePayload("notifications", LIVE_LIST);
		expect(parsed.items).toHaveLength(2);
		expect(parsed.items[0]?.created_at).toBeGreaterThan(1_000_000_000_000);
		expect(parsed.waiting).toEqual([]);
		expect(parsed.waiting_unread_count).toBe(0);
		expect(parsed.observed).toHaveLength(2);
	});

	it("reads the conversation where the relay puts it: nested, with BOTH liveness fields", () => {
		const parsed = parsePayload("notifications", LIVE_LIST);
		const row = parsed.items[0];
		expect(typeof row?.session.id).toBe("string");
		/* The relay sends `live` AND `live_state` (3cacd0cad01); the app reads either,
		 * so a shape carrying only one of them must still parse. */
		expect(typeof row?.session.live).toBe("boolean");
		expect(Object.hasOwn(row as object, "session_id")).toBe(false);
	});

	it("parses the REAL detail: body, links, nested session and asks", () => {
		const parsed = parsePayload("notificationDetail", LIVE_DETAIL);
		expect(parsed.item.body_md).toBe("Two retries exhausted.");
		expect(parsed.item.links).toEqual([]);
		expect(parsed.session.live).toBe(false);
		expect(parsed.session.cwd).toBe("");
		expect(parsed.anchor).toBeNull();
		expect(parsed.asks).toEqual([]);
	});

	it("reads a `{}` notifications block as UNKNOWN, never as zero", () => {
		const frame = sessionListFrameSchema.parse({
			sessions: [],
			degraded: [],
			notifications: {},
		});
		expect(notificationsOrNull(frame.notifications)).toBeNull();
	});

	it("reads an ABSENT notifications key as unknown too", () => {
		/* The relay's own rule (remediation #2939): a store it cannot read leaves
		 * the KEY OUT rather than answering zeros. Absent and `{}` are the same
		 * reading — "unknown" — and neither may drop the frame. */
		const frame = sessionListFrameSchema.parse({ sessions: [], degraded: [] });
		expect(notificationsOrNull(frame.notifications)).toBeNull();
	});

	it("keeps the sessions frame when the inbox block is unknown", () => {
		/* The core answers `{}` when its store cannot be read (`_notifications_block`).
		 * That block must not take the conversation list down with it (NC5). */
		const frame = sessionListFrameSchema.parse({
			sessions: [
				{
					session_id: "feed00000001",
					section: "active",
					pinned: false,
					conversation_name: "Aida",
					cwd: "/tmp/synthetic",
					model_label: "test",
					streaming: false,
					unseen: true,
					needs_attention: false,
					ended: false,
					degraded: false,
					mtime: 1792926900,
				},
			],
			degraded: [],
			notifications: {},
		});
		expect(frame.sessions).toHaveLength(1);
		expect(notificationsOrNull(frame.notifications)).toBeNull();
	});

	it("parses the bulk write's answer", () => {
		const parsed = parsePayload("notificationWrite", LIVE_PATCH_BULK);
		expect(parsed.changed).toEqual([]);
		expect(parsed.skipped).toEqual([]);
	});

	it("parses a refused id, with the relay's own reason", () => {
		const parsed = parsePayload("notificationWrite", LIVE_PATCH_UNKNOWN_ID);
		expect(parsed.skipped[0]?.reason).toBe("unknown");
	});

	it("pins the seen door's v1 vocabulary (surface mismatch for a non-native claim)", () => {
		/* The relay ships `relay_seen_unsupported` and no auto-read, so a client
		 * that sends one earns a refusal, not a receipt. The app therefore never
		 * sends it (see the S18 read tests). */
		expect(LIVE_SEEN_REFUSAL.code).toBe("relay_surface_mismatch");
		expect(LIVE_SEEN_REFUSAL.error).toContain("native surface");
	});

	it("parses a REAL cursor page whose `waiting` key is ABSENT (Q7)", () => {
		const parsed = parsePayload("notifications", LIVE_CURSOR_PAGE);
		expect(parsed.waiting).toBeUndefined();
		expect(parsed.items).toHaveLength(1);
		expect(parsed.next_cursor).toBeNull();
	});

	it("keeps `waiting` meaningful when the first page DOES carry it", () => {
		const parsed = parsePayload("notifications", LIVE_LIST);
		expect(Array.isArray(parsed.waiting)).toBe(true);
	});

	it("normalises the producer's option MAPPINGS to one shape (Q9)", () => {
		const parsed = parsePayload("notificationDetail", LIVE_DETAIL_PICKER_ASK);
		const options = parsed.asks[0]?.questions?.[0]?.options ?? [];
		expect(options).toEqual([
			{ label: "Yes", description: "Send the synthetic report" },
			{ label: "No", description: "Keep it local" },
			{ label: "Ask me later" },
		]);
	});

	it("still accepts a bare label string, the older projection's spelling", () => {
		const detail = JSON.parse(JSON.stringify(LIVE_DETAIL_PICKER_ASK)) as {
			asks: Array<{ questions: Array<{ options: unknown[] }> }>;
		};
		detail.asks[0]!.questions[0]!.options = ["Yes", "No"];
		const parsed = parsePayload("notificationDetail", detail);
		expect(parsed.asks[0]?.questions?.[0]?.options).toEqual([
			{ label: "Yes" },
			{ label: "No" },
		]);
	});
});
