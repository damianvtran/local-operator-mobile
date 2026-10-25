import { describe, expect, it } from "vitest";

import { parsePayload } from "@/contracts";

/**
 * The inbox contract, checked against the LIVE relay's own answers.
 *
 * The samples below are the bytes `~/workspace/repos/lo-notifications-l1`'s
 * `build_app(MobileDaemon(port=0, password=…))` returned at commit
 * `a7d149e705` ("feat(notifications): deliver high-priority item banners and
 * serve the inbox on the relay"), captured through a real cookie login — the
 * same gate a phone passes. They are inline rather than in `fixtures/relay/`
 * because that corpus is classified and pinned per file, and these four
 * answers are read by this one test only.
 *
 * WHY IT EXISTS. The phone was built against the contract before the route
 * shipped, and the live route turned out to say two things the contract did
 * not: a BULK write must echo the `observed` tokens (0..500) or it is refused
 * with `bulk writes require 0..500 observed tokens`, and the counts include
 * `waiting_unread_count`. A schema that quietly rejected either would have
 * made the phone fail at the parse boundary on its first real connection, so
 * these samples pin the live shape rather than the document's.
 */
const LIVE_LIST_EMPTY = {
	items: [],
	next_cursor: null,
	unread_count: 0,
	waiting_count: 0,
	waiting_unread_count: 0,
	high_water: 0,
	waiting: [],
	observed: [],
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

const LIVE_SEEN_UNKNOWN_ID = {
	unread_count: 0,
	waiting_count: 0,
	waiting_unread_count: 0,
	high_water: 0,
	changed: [],
	skipped: [{ id: "n_missing", reason: "unknown" }],
};

describe("the inbox contract against the live relay's answers", () => {
	it("parses the list answer, including the fields the contract omitted", () => {
		const parsed = parsePayload("notifications", LIVE_LIST_EMPTY);
		expect(parsed.waiting_unread_count).toBe(0);
		expect(parsed.observed).toEqual([]);
		expect(parsed.next_cursor).toBeNull();
	});

	it("parses the bulk write's answer", () => {
		const parsed = parsePayload("notificationWrite", LIVE_PATCH_BULK);
		expect(parsed.changed).toEqual([]);
		expect(parsed.skipped).toEqual([]);
	});

	it("parses a refused id, with the relay's own reason", () => {
		/* `unknown`, `stale_revision` and `live_ask` are the reasons the screen
		 * has copy for; a reason it does not know still travels, because the
		 * sentence is the relay's. */
		for (const sample of [LIVE_PATCH_UNKNOWN_ID, LIVE_SEEN_UNKNOWN_ID]) {
			const parsed = parsePayload("notificationWrite", sample);
			expect(parsed.skipped[0]?.reason).toBe("unknown");
		}
	});

	it("still refuses an answer that is missing a field it relies on", () => {
		/* A negative control: the schema is loose about NEW fields, not about the
		 * ones the screen reads. */
		const broken = { ...LIVE_LIST_EMPTY } as Record<string, unknown>;
		delete broken.unread_count;
		expect(() => parsePayload("notifications", broken)).toThrow();
	});
});
