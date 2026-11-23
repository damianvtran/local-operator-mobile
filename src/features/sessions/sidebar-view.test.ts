import { describe, expect, it } from "vitest";

import type { SessionSummary, TagRef } from "@/contracts";
import {
	arrangeRows,
	arrangeSidebar,
	DEFAULT_SIDEBAR_VIEW,
	drawnGroupBy,
	hiddenSectionCount,
	isCustomSidebarView,
	isEmptiedByView,
	isHiddenAsEnded,
	parseSidebarView,
	runningOrderMs,
	type SidebarView,
	serializeSidebarView,
	serializeSidebarViewOver,
	toggleSidebarSection,
} from "@/features/sessions/sidebar-view";

/**
 * Parity with the desktop's sidebar arrangement (TestFlight 906).
 *
 * Every expectation below is the desktop's rule, cited where it lives in
 * `local-operator-ui` (read at 94d96837486): `chat-sidebar-view.ts`
 * `pageOrder`/`liftLane`/`byNewest`, `chat-list-sections.ts`
 * `sectionOf`/`rowTimeMs`/`runningOrderMs`, `chat-sections.ts` `pinnedRows`.
 * The fixture is shaped like the operator's screenshot: rows arrive in the
 * relay's CREATION order (`daemon.py` `_rank_row`), and the reader's most
 * recently touched conversation is not the newest-born one.
 */

const NOON = new Date(2026, 10, 13, 12, 0, 0, 0).getTime(); // 2026-11-13 local
/** The relay every arrangement test runs on unless the tag grouping is under
 *  test: no `session_tags`, which is also what a stored `tag` DRAWS as. */
const NO_TAGS = { tagsAvailable: false } as const;
const MIN = 60;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** Epoch seconds `ago` seconds before NOON. */
const at = (ago: number) => NOON / 1000 - ago;

function row(
	id: string,
	overrides: Partial<SessionSummary> = {},
): SessionSummary {
	return {
		session_id: id,
		section: "active",
		pinned: false,
		conversation_name: id,
		cwd: "/synthetic",
		model_label: "",
		streaming: false,
		needs_attention: false,
		unseen: false,
		pending_kind: "",
		leaving: "",
		updating: "",
		subagents_running: null,
		subagents_queued: null,
		todos_open: 0,
		mtime: at(DAY * 30),
		completion_kind: "",
		ended: false,
		degraded: false,
		tags: [],
		primary: null,
		...overrides,
	} as SessionSummary;
}

const ids = (rows: readonly SessionSummary[]) => rows.map((r) => r.session_id);
const drawn = (groups: ReturnType<typeof arrangeSidebar>) =>
	groups.map((g) => [g.key, ids(g.rows)] as const);

/* Relay order = newest BIRTH first. `touched` was born first but used a minute
 * ago; `fresh` was born an hour ago and not touched since. */
const RELAY_ORDER = [
	row("pin-b", { pinned: true, created_at: at(2 * HOUR), mtime: at(5 * DAY) }),
	row("pin-a", { pinned: true, created_at: at(9 * DAY), mtime: at(MIN) }),
	row("run-new", {
		streaming: true,
		created_at: at(10 * MIN),
		mtime: at(10),
	}),
	row("fresh", { created_at: at(HOUR), mtime: at(HOUR) }),
	row("ask-old", {
		needs_attention: true,
		streaming: true,
		created_at: at(3 * DAY),
		mtime: at(2 * MIN),
	}),
	row("run-old", { streaming: true, created_at: at(2 * DAY), mtime: at(5) }),
	row("yesterday", { created_at: at(4 * HOUR + DAY), mtime: at(DAY) }),
	row("touched", { created_at: at(20 * DAY), mtime: at(MIN) }),
	row("nolabel", { created_at: 0, mtime: 0 }),
	row("week-old", { created_at: at(25 * DAY), mtime: at(5 * DAY) }),
];

describe("arrangeSidebar — the desktop's default view", () => {
	it("orders each section by the activity clock, pinned in relay order, running lifted", () => {
		expect(
			drawn(arrangeSidebar(RELAY_ORDER, DEFAULT_SIDEBAR_VIEW, NOON, NO_TAGS)),
		).toEqual([
			// Pinned: the catalogue's order, never clock-sorted (`pinnedRows`).
			["pinned", ["pin-b", "pin-a"]],
			// Running: stopped-on-reader first (`liftLane` 0), then the rest by
			// BIRTH (`runningOrderMs` without `last_user_at`), so a streaming
			// response never reshuffles it.
			["running", ["ask-old", "run-new", "run-old"]],
			// Today: by `mtime`, newest first — the one used a minute ago leads
			// though it was born 20 days ago (the operator's report).
			["today", ["touched", "fresh"]],
			["week", ["yesterday", "week-old"]],
			// A no-claim clock sorts after every row with one and bins Older.
			["older", ["nolabel"]],
		]);
	});

	it("bins This week by the desktop's calendar rule, not a rolling seven days", () => {
		// 6 d 13 h ago is before midnight six days back at noon: Older on the
		// desktop (`sectionOf`), This week under the old rolling rule.
		const edge = row("edge", { mtime: at(6 * DAY + 13 * HOUR) });
		const inside = row("inside", { mtime: at(6 * DAY + 11 * HOUR) });
		expect(
			drawn(
				arrangeSidebar([edge, inside], DEFAULT_SIDEBAR_VIEW, NOON, NO_TAGS),
			),
		).toEqual([
			["week", ["inside"]],
			["older", ["edge"]],
		]);
	});

	it("breaks ties by arrival, so the relay's order survives and the sort is idempotent", () => {
		const a = row("a", { mtime: at(HOUR) });
		const b = row("b", { mtime: at(HOUR) });
		const c = row("c", { mtime: at(HOUR) });
		expect(ids(arrangeRows([b, a, c], "active-first", "active"))).toEqual([
			"b",
			"a",
			"c",
		]);
		const once = arrangeRows(RELAY_ORDER, "active-first", "active");
		expect(ids(arrangeRows(once, "active-first", "active"))).toEqual(ids(once));
	});

	it("keys running remote rows by the peer's gate words, as the local ones", () => {
		const remote = (id: string, extra: Partial<SessionSummary>) =>
			row(id, { locality: "remote", ...extra });
		const rows = [
			remote("busy", {
				live_state: "busy",
				created_at: at(MIN),
				mtime: at(MIN),
			}),
			remote("gate", {
				live_state: "busy",
				pending: "approval",
				created_at: at(DAY),
				mtime: at(DAY),
			}),
		];
		expect(
			drawn(arrangeSidebar(rows, DEFAULT_SIDEBAR_VIEW, NOON, NO_TAGS)),
		).toEqual([["running", ["gate", "busy"]]]);
	});
});

describe("arrangeSidebar — the reader's options", () => {
	const view = (patch: Partial<SidebarView>): SidebarView => ({
		...DEFAULT_SIDEBAR_VIEW,
		...patch,
	});

	it("`In one list` draws pinned first, then the running lift, then newest-first", () => {
		expect(
			drawn(
				arrangeSidebar(RELAY_ORDER, view({ groupBy: "flat" }), NOON, NO_TAGS),
			),
		).toEqual([
			[
				"all",
				[
					"pin-b",
					"pin-a",
					"ask-old",
					"run-new",
					"run-old",
					"touched",
					"fresh",
					"yesterday",
					"week-old",
					"nolabel",
				],
			],
		]);
	});

	it("`Most recent` drops the lift: one order, running rows keyed by birth", () => {
		const flat = arrangeSidebar(
			RELAY_ORDER,
			view({ groupBy: "flat", orderBy: "recent" }),
			NOON,
			NO_TAGS,
		);
		expect(ids(flat[0]?.rows ?? [])).toEqual([
			"pin-b",
			"pin-a",
			"touched",
			"run-new",
			"fresh",
			"yesterday",
			"run-old",
			"ask-old",
			"week-old",
			"nolabel",
		]);
	});

	it("`Created` re-bins and re-orders by birth", () => {
		const groups = arrangeSidebar(
			RELAY_ORDER,
			view({ basis: "created" }),
			NOON,
			NO_TAGS,
		);
		expect(drawn(groups).slice(2)).toEqual([
			["today", ["fresh"]],
			["week", ["yesterday"]],
			["older", ["touched", "week-old", "nolabel"]],
		]);
	});

	it("hiding ended rows never hides a pinned or running one", () => {
		const rows = [
			row("ended-pin", { pinned: true, ended: true }),
			row("ended-run", { ended: true, streaming: true }),
			row("ended", { ended: true, mtime: at(MIN) }),
			row("open", { mtime: at(HOUR) }),
		];
		const hide = view({ showEnded: false });
		expect(isHiddenAsEnded(rows[2] as SessionSummary, hide)).toBe(true);
		expect(drawn(arrangeSidebar(rows, hide, NOON, NO_TAGS))).toEqual([
			["pinned", ["ended-pin"]],
			["running", ["ended-run"]],
			["today", ["open"]],
		]);
		expect(
			drawn(arrangeSidebar(rows, DEFAULT_SIDEBAR_VIEW, NOON, NO_TAGS)),
		).toEqual([
			["pinned", ["ended-pin"]],
			["running", ["ended-run"]],
			["today", ["ended", "open"]],
		]);
	});

	it("a hidden section draws no heading and no rows, under time sections only", () => {
		const hidden = toggleSidebarSection(DEFAULT_SIDEBAR_VIEW, "today");
		expect(hidden.hidden).toEqual(["today"]);
		expect(
			arrangeSidebar(RELAY_ORDER, hidden, NOON, NO_TAGS).map((g) => g.key),
		).toEqual(["pinned", "running", "week", "older"]);
		expect(toggleSidebarSection(hidden, "today").hidden).toEqual([]);
		const flat = arrangeSidebar(
			RELAY_ORDER,
			{ ...hidden, groupBy: "flat" },
			NOON,
			NO_TAGS,
		);
		expect(flat[0]?.rows).toHaveLength(RELAY_ORDER.length);
	});
});

/* The tag grouping (mobile sidebar tag view options, 2026-11-22): the desktop's
 * tag-first arrangement, with the phone's stated differences — Pinned leads in
 * its own group (`sidebar-view.ts`). Every case below runs the REAL arrangement.
 */
describe("arrangeSidebar — the tag grouping", () => {
	const TAGS_ON = { tagsAvailable: true } as const;
	const WORK: TagRef = { id: "work", name: "Work" };
	const RESEARCH: TagRef = { id: "research", name: "Research" };
	const LIFE: TagRef = { id: "life", name: "Life" };
	const tagged = (
		id: string,
		tags: TagRef[],
		primary: string | null,
		overrides: Partial<SessionSummary> = {},
	) => row(id, { tags, primary, ...overrides });
	const tagView: SidebarView = { ...DEFAULT_SIDEBAR_VIEW, groupBy: "tag" };

	it("pinned leads as its own group, then one group per tag, untagged last", () => {
		const rows = [
			tagged("pin", [WORK], "work", { pinned: true, mtime: at(DAY) }),
			tagged("a", [LIFE, WORK], "work", { mtime: at(HOUR) }),
			tagged("b", [RESEARCH], "research", { mtime: at(2 * HOUR) }),
			tagged("c", [WORK], "work", { mtime: at(3 * HOUR) }),
			row("none", { mtime: at(4 * HOUR) }),
		];
		const groups = arrangeSidebar(rows, tagView, NOON, TAGS_ON);
		expect(drawn(groups)).toEqual([
			["pinned", ["pin"]],
			["tag:work", ["a", "c"]],
			["tag:research", ["b"]],
			["untagged", ["none"]],
		]);
		expect(groups.find((group) => group.tag?.id === "work")?.tag).toEqual({
			id: "work",
			name: "Work",
			count: 2,
		});
	});

	it("orders groups by the registry's `order`, not by the rows' arrival", () => {
		const rows = [
			tagged("a", [WORK], "work", { mtime: at(HOUR) }),
			tagged("b", [RESEARCH], "research", { mtime: at(2 * HOUR) }),
		];
		const groups = arrangeSidebar(rows, tagView, NOON, {
			tagsAvailable: true,
			tagOrder: ["research", "work", "life"],
		});
		// `life` has no rows, so it draws no heading either.
		expect(drawn(groups)).toEqual([
			["tag:research", ["b"]],
			["tag:work", ["a"]],
		]);
	});

	it("falls back to first-seen order while the catalogue is unread, unknown tags after known ones", () => {
		const rows = [
			tagged("late", [LIFE], "life", { mtime: at(3 * HOUR) }),
			tagged("first", [LIFE, WORK], "work", { mtime: at(HOUR) }),
			tagged("known", [RESEARCH], "research", { mtime: at(2 * HOUR) }),
		];
		expect(
			drawn(arrangeSidebar(rows, tagView, NOON, { tagsAvailable: true })),
		).toEqual([
			["tag:work", ["first"]],
			["tag:research", ["known"]],
			["tag:life", ["late"]],
		]);
		expect(
			drawn(
				arrangeSidebar(rows, tagView, NOON, {
					tagsAvailable: true,
					tagOrder: ["research"],
				}),
			),
		).toEqual([
			["tag:research", ["known"]],
			["tag:work", ["first"]],
			["tag:life", ["late"]],
		]);
	});

	it("buckets by PRIMARY only: none, or one no longer assigned, is Untagged", () => {
		const rows = [
			tagged("no-primary", [WORK], null, { mtime: at(HOUR) }),
			tagged("pruned", [WORK], "research", { mtime: at(2 * HOUR) }),
			tagged("primary", [RESEARCH, WORK], "research", { mtime: at(3 * HOUR) }),
			row("bare", { mtime: at(4 * HOUR) }),
		];
		expect(drawn(arrangeSidebar(rows, tagView, NOON, TAGS_ON))).toEqual([
			["tag:research", ["primary"]],
			["untagged", ["no-primary", "pruned", "bare"]],
		]);
	});

	it("keeps every row of one group in the existing order and omits empty groups", () => {
		const rows = [
			tagged("older", [WORK], "work", { mtime: at(3 * HOUR) }),
			tagged("newer", [WORK], "work", { mtime: at(MIN) }),
		];
		const groups = arrangeSidebar(rows, tagView, NOON, {
			tagsAvailable: true,
			tagOrder: ["life", "work"],
		});
		expect(drawn(groups)).toEqual([["tag:work", ["newer", "older"]]]);
	});

	it("an untagged-only list is one Untagged group", () => {
		expect(
			drawn(arrangeSidebar([row("a"), row("b")], tagView, NOON, TAGS_ON)),
		).toEqual([["untagged", ["a", "b"]]]);
	});

	it("a list the ended filter empties draws no groups, as every grouping", () => {
		const rows = [
			tagged("a", [WORK], "work", { ended: true, mtime: at(MIN) }),
			tagged("b", [WORK], "work", { ended: true, mtime: at(2 * MIN) }),
		];
		const view: SidebarView = { ...tagView, showEnded: false };
		expect(arrangeSidebar(rows, view, NOON, TAGS_ON)).toEqual([]);
		expect(isEmptiedByView(rows, [])).toBe(true);
	});

	it("hidden sections do not apply: they govern the time grouping only", () => {
		const rows = [tagged("a", [WORK], "work", { mtime: at(MIN) })];
		const view: SidebarView = {
			...toggleSidebarSection(DEFAULT_SIDEBAR_VIEW, "today"),
			groupBy: "tag",
		};
		expect(drawn(arrangeSidebar(rows, view, NOON, TAGS_ON))).toEqual([
			["tag:work", ["a"]],
		]);
		expect(hiddenSectionCount(view, true)).toBe(0);
	});

	it("a stored `tag` on a relay without tags draws the time sections and keeps the value", () => {
		const stored = serializeSidebarView({ ...tagView });
		const view = parseSidebarView(stored);
		expect(view.groupBy).toBe("tag");
		expect(
			drawn(arrangeSidebar(RELAY_ORDER, view, NOON, NO_TAGS)).map(
				([key]) => key,
			),
		).toEqual(["pinned", "running", "today", "week", "older"]);
		// The trigger must not fill for a change the list does not show…
		expect(isCustomSidebarView(view, false)).toBe(false);
		// …and the stored word survives a write of another field.
		const over = serializeSidebarViewOver(stored, view, {
			...view,
			showEnded: false,
		});
		expect(JSON.parse(over).groupBy).toBe("tag");
	});

	it("drawnGroupBy: `tag` draws as tag only where the relay has it", () => {
		const view = { groupBy: "tag" } as const;
		expect(drawnGroupBy(view, true)).toBe("tag");
		expect(drawnGroupBy(view, false)).toBe("section");
		expect(drawnGroupBy({ groupBy: "section" }, false)).toBe("section");
		expect(drawnGroupBy({ groupBy: "flat" }, true)).toBe("flat");
	});

	it("a tag grouping is custom, and hiding the row lines is custom too", () => {
		expect(
			isCustomSidebarView({ ...DEFAULT_SIDEBAR_VIEW, groupBy: "tag" }, true),
		).toBe(true);
		expect(
			isCustomSidebarView({ ...DEFAULT_SIDEBAR_VIEW, showTags: false }, true),
		).toBe(true);
	});
});

describe("parseSidebarView / serializeSidebarView", () => {
	it("round-trips every field", () => {
		const custom: SidebarView = {
			orderBy: "recent",
			groupBy: "tag",
			basis: "created",
			showEnded: false,
			showTags: false,
			hidden: ["week", "pinned"],
		};
		expect(parseSidebarView(serializeSidebarView(custom))).toEqual(custom);
	});

	it("reads nothing, garbage and unknown words as the default, field by field", () => {
		expect(parseSidebarView(null)).toBe(DEFAULT_SIDEBAR_VIEW);
		expect(parseSidebarView("{not json")).toBe(DEFAULT_SIDEBAR_VIEW);
		expect(parseSidebarView("[1]")).toBe(DEFAULT_SIDEBAR_VIEW);
		expect(
			parseSidebarView(
				JSON.stringify({
					orderBy: "alphabetical",
					groupBy: "agent",
					basis: "flat",
					showEnded: "no",
					showTags: "no",
					hidden: ["older", "older", "agents", 3],
				}),
			),
		).toEqual({ ...DEFAULT_SIDEBAR_VIEW, hidden: ["older"] });
	});

	it("reads a stored view from before the tag options as their defaults, keeping the rest", () => {
		// The shipped build stored no `showTags`; the preference must survive.
		const stored = JSON.stringify({
			orderBy: "recent",
			groupBy: "flat",
			basis: "created",
		});
		const view = parseSidebarView(stored);
		expect(view).toEqual({
			...DEFAULT_SIDEBAR_VIEW,
			orderBy: "recent",
			groupBy: "flat",
			basis: "created",
		});
		// A write of another field records the new field's value (its default),
		// because the record has no `showTags` yet.
		expect(
			JSON.parse(
				serializeSidebarViewOver(stored, view, { ...view, showEnded: false }),
			).showTags,
		).toBe(true);
	});
});

/* Review round 1 on PR #255: each case below failed on the round-1 head. */
describe("review round 1 remediation", () => {
	it("M3: a running row never keys on the activity clock, even on a relay without `created_at`", () => {
		// The desktop's `runningOrderMs` chain is last_user_at → created_at → null;
		// falling back to `mtime` would re-sort Running on every streamed reply.
		const old = row("old-relay", { streaming: true, mtime: at(5) });
		delete (old as { created_at?: number }).created_at;
		expect(runningOrderMs(old)).toBeNull();
		expect(
			runningOrderMs(row("born", { streaming: true, created_at: at(HOUR) })),
		).toBe(at(HOUR) * 1000);
		// So a reply landing in `a` does not move it above `b`: both sort as no-clock,
		// arrival order holds.
		const a = row("a", { streaming: true, mtime: at(1) });
		const b = row("b", { streaming: true, mtime: at(HOUR) });
		for (const r of [a, b]) delete (r as { created_at?: number }).created_at;
		expect(
			ids(
				arrangeSidebar([b, a], DEFAULT_SIDEBAR_VIEW, NOON, NO_TAGS)[0]?.rows ??
					[],
			),
		).toEqual(["b", "a"]);
	});

	it("D1: the flat list reports how many pinned rows lead it, so the drawer can mark the run", () => {
		const flat = arrangeSidebar(
			RELAY_ORDER,
			{ ...DEFAULT_SIDEBAR_VIEW, groupBy: "flat" },
			NOON,
			NO_TAGS,
		);
		expect(flat[0]?.pinnedLead).toBe(2);
		const sectioned = arrangeSidebar(
			RELAY_ORDER,
			DEFAULT_SIDEBAR_VIEW,
			NOON,
			NO_TAGS,
		);
		expect(sectioned.every((g) => g.pinnedLead === undefined)).toBe(true);
	});

	it("D2: a view is custom when any field differs from the default, hidden compared as a set", () => {
		expect(isCustomSidebarView(DEFAULT_SIDEBAR_VIEW, false)).toBe(false);
		expect(isCustomSidebarView({ ...DEFAULT_SIDEBAR_VIEW }, false)).toBe(false);
		expect(
			isCustomSidebarView({ ...DEFAULT_SIDEBAR_VIEW, showEnded: false }, false),
		).toBe(true);
		expect(
			isCustomSidebarView({ ...DEFAULT_SIDEBAR_VIEW, basis: "created" }, false),
		).toBe(true);
		expect(
			isCustomSidebarView(
				toggleSidebarSection(DEFAULT_SIDEBAR_VIEW, "older"),
				false,
			),
		).toBe(true);
	});

	it("D2: the hidden-section count is the time grouping's only — `In one list` hides nothing", () => {
		const hidden = toggleSidebarSection(
			toggleSidebarSection(DEFAULT_SIDEBAR_VIEW, "today"),
			"week",
		);
		expect(hiddenSectionCount(DEFAULT_SIDEBAR_VIEW, false)).toBe(0);
		expect(hiddenSectionCount(hidden, false)).toBe(2);
		expect(hiddenSectionCount({ ...hidden, groupBy: "flat" }, false)).toBe(0);
	});

	it("M1: a list emptied by the view is told apart from a catalogue with no sessions", () => {
		const ended = [row("e1", { ended: true }), row("e2", { ended: true })];
		const hideEnded = { ...DEFAULT_SIDEBAR_VIEW, showEnded: false };
		expect(
			isEmptiedByView(ended, arrangeSidebar(ended, hideEnded, NOON, NO_TAGS)),
		).toBe(true);
		const today = [row("t", { mtime: at(MIN) })];
		let allHidden = DEFAULT_SIDEBAR_VIEW;
		for (const key of ["today", "week", "older"] as const)
			allHidden = toggleSidebarSection(allHidden, key);
		expect(
			isEmptiedByView(today, arrangeSidebar(today, allHidden, NOON, NO_TAGS)),
		).toBe(true);
		expect(isEmptiedByView([], [])).toBe(false);
		expect(
			isEmptiedByView(
				today,
				arrangeSidebar(today, DEFAULT_SIDEBAR_VIEW, NOON, NO_TAGS),
			),
		).toBe(false);
	});
});

/*
 * `last_user_at` parity (local-operator #3923, v0.102.5). The relay now
 * publishes the person's last message on RUNNING rows, epoch SECONDS (possibly
 * fractional), `null` when unknown; older daemons omit it. The desktop's
 * `runningOrderMs` chain is last_user_at × 1000 → created_at → null
 * (`local-operator-ui` `chat-list-sections.ts`), and the phone must agree.
 */
describe("running rows order by the person's last message (last_user_at)", () => {
	const running = (id: string, overrides: Partial<SessionSummary> = {}) =>
		row(id, { streaming: true, ...overrides });
	const runningIds = (rows: SessionSummary[]) =>
		ids(
			arrangeSidebar(rows, DEFAULT_SIDEBAR_VIEW, NOON, NO_TAGS).find(
				(g) => g.key === "running",
			)?.rows ?? [],
		);

	it("ranks an older-born session the person just spoke in above a newer one", () => {
		// Relay order is newest birth first: `newer` arrives ahead of `older`.
		const newer = running("newer", {
			created_at: at(10 * MIN),
			last_user_at: at(9 * MIN),
		});
		const older = running("older", {
			created_at: at(2 * DAY),
			last_user_at: at(30),
		});
		expect(runningOrderMs(older)).toBe(at(30) * 1000);
		expect(runningIds([newer, older])).toEqual(["older", "newer"]);
	});

	it("does not move a row when the assistant replies — only last_user_at counts", () => {
		// `replying` just streamed a response (fresh mtime) but the person last
		// spoke an hour ago; `asked` got the person's message five minutes ago.
		const replying = running("replying", {
			created_at: at(3 * HOUR),
			last_user_at: at(HOUR),
			mtime: at(1),
		});
		const asked = running("asked", {
			created_at: at(4 * HOUR),
			last_user_at: at(5 * MIN),
			mtime: at(4 * MIN),
		});
		expect(runningOrderMs(replying)).toBe(at(HOUR) * 1000);
		expect(runningIds([replying, asked])).toEqual(["asked", "replying"]);
	});

	it("reads fractional seconds without rounding them away", () => {
		const a = running("a", {
			created_at: at(DAY),
			last_user_at: 1_762_500_000.75,
		});
		const b = running("b", {
			created_at: at(DAY),
			last_user_at: 1_762_500_000.25,
		});
		expect(runningOrderMs(a)).toBe(1_762_500_000_750);
		expect(runningIds([b, a])).toEqual(["a", "b"]);
	});

	it("falls back to created_at when last_user_at is null, absent or no claim", () => {
		const born = at(2 * HOUR);
		expect(
			runningOrderMs(running("null", { created_at: born, last_user_at: null })),
		).toBe(born * 1000);
		expect(runningOrderMs(running("absent", { created_at: born }))).toBe(
			born * 1000,
		);
		expect(
			runningOrderMs(running("zero", { created_at: born, last_user_at: 0 })),
		).toBe(born * 1000);
		// A null row keys on its birth, so a newer-born null row still ranks above
		// an older one whose person spoke before that birth.
		const nullNew = running("null-new", {
			created_at: at(10 * MIN),
			last_user_at: null,
		});
		const spokeEarlier = running("spoke-earlier", {
			created_at: at(DAY),
			last_user_at: at(HOUR),
		});
		expect(runningIds([spokeEarlier, nullNew])).toEqual([
			"null-new",
			"spoke-earlier",
		]);
	});
});
