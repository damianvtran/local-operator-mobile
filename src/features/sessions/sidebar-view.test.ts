import { describe, expect, it } from "vitest";

import type { SessionSummary } from "@/contracts";
import {
	arrangeRows,
	arrangeSidebar,
	DEFAULT_SIDEBAR_VIEW,
	hiddenSectionCount,
	isCustomSidebarView,
	isEmptiedByView,
	isHiddenAsEnded,
	parseSidebarView,
	runningOrderMs,
	type SidebarView,
	serializeSidebarView,
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
			drawn(arrangeSidebar(RELAY_ORDER, DEFAULT_SIDEBAR_VIEW, NOON)),
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
			drawn(arrangeSidebar([edge, inside], DEFAULT_SIDEBAR_VIEW, NOON)),
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
		expect(drawn(arrangeSidebar(rows, DEFAULT_SIDEBAR_VIEW, NOON))).toEqual([
			["running", ["gate", "busy"]],
		]);
	});
});

describe("arrangeSidebar — the reader's options", () => {
	const view = (patch: Partial<SidebarView>): SidebarView => ({
		...DEFAULT_SIDEBAR_VIEW,
		...patch,
	});

	it("`In one list` draws pinned first, then the running lift, then newest-first", () => {
		expect(
			drawn(arrangeSidebar(RELAY_ORDER, view({ groupBy: "flat" }), NOON)),
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
		expect(drawn(arrangeSidebar(rows, hide, NOON))).toEqual([
			["pinned", ["ended-pin"]],
			["running", ["ended-run"]],
			["today", ["open"]],
		]);
		expect(drawn(arrangeSidebar(rows, DEFAULT_SIDEBAR_VIEW, NOON))).toEqual([
			["pinned", ["ended-pin"]],
			["running", ["ended-run"]],
			["today", ["ended", "open"]],
		]);
	});

	it("a hidden section draws no heading and no rows, under time sections only", () => {
		const hidden = toggleSidebarSection(DEFAULT_SIDEBAR_VIEW, "today");
		expect(hidden.hidden).toEqual(["today"]);
		expect(arrangeSidebar(RELAY_ORDER, hidden, NOON).map((g) => g.key)).toEqual(
			["pinned", "running", "week", "older"],
		);
		expect(toggleSidebarSection(hidden, "today").hidden).toEqual([]);
		const flat = arrangeSidebar(
			RELAY_ORDER,
			{ ...hidden, groupBy: "flat" },
			NOON,
		);
		expect(flat[0]?.rows).toHaveLength(RELAY_ORDER.length);
	});
});

describe("parseSidebarView / serializeSidebarView", () => {
	it("round-trips every field", () => {
		const custom: SidebarView = {
			orderBy: "recent",
			groupBy: "flat",
			basis: "created",
			showEnded: false,
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
					hidden: ["older", "older", "agents", 3],
				}),
			),
		).toEqual({ ...DEFAULT_SIDEBAR_VIEW, hidden: ["older"] });
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
			ids(arrangeSidebar([b, a], DEFAULT_SIDEBAR_VIEW, NOON)[0]?.rows ?? []),
		).toEqual(["b", "a"]);
	});

	it("D1: the flat list reports how many pinned rows lead it, so the drawer can mark the run", () => {
		const flat = arrangeSidebar(
			RELAY_ORDER,
			{ ...DEFAULT_SIDEBAR_VIEW, groupBy: "flat" },
			NOON,
		);
		expect(flat[0]?.pinnedLead).toBe(2);
		const sectioned = arrangeSidebar(RELAY_ORDER, DEFAULT_SIDEBAR_VIEW, NOON);
		expect(sectioned.every((g) => g.pinnedLead === undefined)).toBe(true);
	});

	it("D2: a view is custom when any field differs from the default, hidden compared as a set", () => {
		expect(isCustomSidebarView(DEFAULT_SIDEBAR_VIEW)).toBe(false);
		expect(isCustomSidebarView({ ...DEFAULT_SIDEBAR_VIEW })).toBe(false);
		expect(
			isCustomSidebarView({ ...DEFAULT_SIDEBAR_VIEW, showEnded: false }),
		).toBe(true);
		expect(
			isCustomSidebarView({ ...DEFAULT_SIDEBAR_VIEW, basis: "created" }),
		).toBe(true);
		expect(
			isCustomSidebarView(toggleSidebarSection(DEFAULT_SIDEBAR_VIEW, "older")),
		).toBe(true);
	});

	it("D2: the hidden-section count is the time grouping's only — `In one list` hides nothing", () => {
		const hidden = toggleSidebarSection(
			toggleSidebarSection(DEFAULT_SIDEBAR_VIEW, "today"),
			"week",
		);
		expect(hiddenSectionCount(DEFAULT_SIDEBAR_VIEW)).toBe(0);
		expect(hiddenSectionCount(hidden)).toBe(2);
		expect(hiddenSectionCount({ ...hidden, groupBy: "flat" })).toBe(0);
	});

	it("M1: a list emptied by the view is told apart from a catalogue with no sessions", () => {
		const ended = [row("e1", { ended: true }), row("e2", { ended: true })];
		const hideEnded = { ...DEFAULT_SIDEBAR_VIEW, showEnded: false };
		expect(isEmptiedByView(ended, arrangeSidebar(ended, hideEnded, NOON))).toBe(
			true,
		);
		const today = [row("t", { mtime: at(MIN) })];
		let allHidden = DEFAULT_SIDEBAR_VIEW;
		for (const key of ["today", "week", "older"] as const)
			allHidden = toggleSidebarSection(allHidden, key);
		expect(isEmptiedByView(today, arrangeSidebar(today, allHidden, NOON))).toBe(
			true,
		);
		expect(isEmptiedByView([], [])).toBe(false);
		expect(
			isEmptiedByView(today, arrangeSidebar(today, DEFAULT_SIDEBAR_VIEW, NOON)),
		).toBe(false);
	});
});
