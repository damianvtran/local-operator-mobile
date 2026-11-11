/**
 * Transcript condensing polish (Slice 2): the Tier A fold, idle completed-turn
 * condensing, semantic tool names/summaries, Team Bridge receipt attribution,
 * the shared 16 pt / 40 pt rail and the vertical spacing tiers.
 *
 * Every positive case sits beside its negative control, so a pass cannot come
 * from a predicate that is simply always true (or always false).
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { TranscriptEntry } from "@/contracts";
import {
	SPACING_TIER_CLASS,
	spacingTierBetween,
	TRACE_BAR_PAD_CLASS,
	TRACE_COLUMN_GAP_CLASS,
	TRACE_EXPANDED_INDENT_CLASS,
	TRACE_GLYPH_BOX_CLASS,
	TRACE_ROW_OUTER_CLASS,
} from "@/features/session/components/trace-rail";
import {
	buildFoldRun,
	FOLD_MIN_ACTIONS,
	foldBarAccessibleName,
	foldSettledUnits,
} from "@/features/session/fold-model";
import {
	bridgeReceiptLabel,
	bridgeReceiptMeta,
	displayToolName,
	toLines,
	toolRowSummary,
} from "@/features/session/projection";
import {
	barAccessibleName,
	barPhrases,
	condensePlan,
	foldPlan,
	groupPlan,
	type LatchedTurn,
	type QuietGroup,
	type TranscriptItem,
} from "@/features/session/turn-condensing";

const row = (
	over: Partial<TranscriptEntry> & Pick<TranscriptEntry, "id" | "kind">,
): TranscriptEntry => ({
	text: "",
	tool_call_id: "",
	tool_name: "",
	tool_state: "done",
	summary: "",
	intent: "",
	diff_added: 0,
	diff_removed: 0,
	elapsed_s: 0,
	error: "",
	details: {},
	images: [],
	final: true,
	text_complete: true,
	...over,
});
const user = (id: string) => row({ id, kind: "user", text: "do the thing" });
const answer = (id: string) => row({ id, kind: "assistant", text: "done" });
const tool = (id: string, name = "bash", over: Partial<TranscriptEntry> = {}) =>
	row({
		id,
		kind: "tool",
		tool_name: name,
		tool_call_id: `call-${id}`,
		elapsed_s: 1,
		...over,
	});
/** A Tailwind spacing class's numeric step (`px-4` → 4, i.e. 16 pt). */
const SPACING_STEP = /-(\d+)$/;
const NO_LATCH: ReadonlyMap<string, LatchedTurn> = new Map();
const NONE: ReadonlySet<string> = new Set();
const entryItems = (entries: TranscriptEntry[]): TranscriptItem[] =>
	entries.map((entry) => ({ kind: "entry", id: entry.id, entry }));

describe("idle completed-turn condensing (Tier B)", () => {
	const turn = [user("u1"), tool("t1"), tool("t2"), answer("a1")];

	it("condenses the settled LAST turn once the session is idle", () => {
		const plan = condensePlan({
			entries: turn,
			expanded: NONE,
			latch: NO_LATCH,
			live: false,
		});
		expect(plan.turns[0]?.condensed).toBe(true);
		expect(plan.items.map((item) => item.kind)).toEqual([
			"entry",
			"bar",
			"entry",
		]);
		// The opening prompt clamps while its turn is collapsed.
		expect(plan.items[0]).toMatchObject({ id: "u1", condensed: true });
	});

	it("never touches the last turn while it is live (negative control)", () => {
		const plan = condensePlan({
			entries: turn,
			expanded: NONE,
			latch: NO_LATCH,
			live: true,
		});
		expect(plan.turns[0]?.condensed).toBe(false);
		expect(plan.items.some((item) => item.kind === "bar")).toBe(false);
		expect(plan.items[0]).not.toHaveProperty("condensed");
	});

	it("keeps an idle-condensed turn condensed when the next turn starts live", () => {
		const idle = condensePlan({
			entries: turn,
			expanded: NONE,
			latch: NO_LATCH,
			live: false,
		});
		const next = condensePlan({
			entries: [
				...turn,
				user("u2"),
				tool("t3", "bash", { tool_state: "running" }),
			],
			expanded: NONE,
			latch: idle.latch,
			live: true,
		});
		expect(next.turns[0]?.condensed).toBe(true);
		expect(next.turns[1]?.condensed).toBe(false);
		// The second turn's prompt is a turn boundary for the spacing tiers.
		expect(next.items.find((item) => item.id === "u2")).toMatchObject({
			opensTurn: true,
		});
	});

	it("un-clamps the prompt when the reader opens the bar", () => {
		const plan = condensePlan({
			entries: turn,
			expanded: new Set(["u1"]),
			latch: NO_LATCH,
			live: false,
		});
		expect(plan.items[0]).not.toHaveProperty("condensed");
		expect(plan.items.map((item) => item.id)).toContain("t1");
	});

	it("does not condense a turn whose closing answer is missing", () => {
		const plan = condensePlan({
			entries: [user("u1"), tool("t1")],
			expanded: NONE,
			latch: NO_LATCH,
			live: false,
		});
		expect(plan.turns[0]?.condensed).toBe(false);
	});
});

describe("Tier A fold runs", () => {
	it(`folds ${FOLD_MIN_ACTIONS} tool calls, and not ${FOLD_MIN_ACTIONS - 1}`, () => {
		expect(buildFoldRun([tool("a"), tool("b")])).toBeNull();
		const run = buildFoldRun([tool("a"), tool("b", "read"), tool("c", "grep")]);
		expect(run?.key).toBe("fold:call:call-a");
		expect(run?.actions).toHaveLength(3);
		if (run === null) throw new Error("expected a fold");
		expect(foldSettledUnits(run.countSegments, run.receiptEntries)).toEqual([
			"2 files",
			"1 shell",
		]);
	});

	it("surfaces a failure and names it for a screen reader", () => {
		const run = buildFoldRun([
			tool("a"),
			tool("b", "bash", { tool_state: "failed" }),
			tool("c"),
		]);
		const clean = buildFoldRun([tool("a"), tool("b"), tool("c")]);
		if (run === null || clean === null) throw new Error("expected folds");
		expect(run.failedCount).toBe(1);
		expect(foldBarAccessibleName(run)).toContain("Includes a failed action");
		expect(clean.failedCount).toBe(0);
		expect(foldBarAccessibleName(clean)).not.toContain("failed");
	});

	it("names the running call on a live fold", () => {
		const run = buildFoldRun([
			tool("a"),
			tool("b"),
			tool("c", "mcp__github__search_issues", { tool_state: "running" }),
		]);
		expect(run?.running).toBe(true);
		expect(run?.liveAction?.displayName).toBe("search_issues");
	});

	it("breaks a run on a media card and on prose, keeping chronology", () => {
		const items = entryItems([
			user("u1"),
			tool("a"),
			tool("b"),
			tool("img", "generate_image"),
			tool("c"),
			tool("d"),
			tool("e"),
			answer("x"),
		]);
		const plan = foldPlan({ items, expanded: NONE, live: true });
		expect(plan.items.map((item) => item.kind)).toEqual([
			"entry", // prompt
			"entry", // a — 2 calls before the card do not fold
			"entry", // b
			"entry", // the image card stays visible
			"fold", // c, d, e
			"entry", // answer
		]);
		expect(plan.folds[0]?.hiddenIds).toEqual(["c", "d", "e"]);
	});

	it("never folds no_reply (the quiet close is not work)", () => {
		const items = entryItems([tool("a"), tool("b"), tool("q", "no_reply")]);
		expect(foldPlan({ items, expanded: NONE }).folds).toHaveLength(0);
	});

	it("re-emits the folded rows after its bar when the reader opens it", () => {
		const items = entryItems([tool("a"), tool("b"), tool("c")]);
		const closed = foldPlan({ items, expanded: NONE });
		const key = closed.folds[0]?.key ?? "";
		const open = foldPlan({ items, expanded: new Set([key]) });
		expect(open.items.map((item) => item.id)).toEqual([
			`fold-bar-${key}`,
			"a",
			"b",
			"c",
		]);
	});

	it("keys the fold canonically across live-to-durable replacement", () => {
		const live = buildFoldRun([
			tool("tc-1", "bash", { tool_call_id: "1" }),
			tool("tc-2", "bash", { tool_call_id: "2" }),
			tool("tc-3", "bash", { tool_call_id: "3" }),
		]);
		const durable = buildFoldRun([
			tool("m:1", "bash", { tool_call_id: "1" }),
			tool("m:2", "bash", { tool_call_id: "2" }),
			tool("m:3", "bash", { tool_call_id: "3" }),
		]);
		expect(live?.key).toBe(durable?.key);
		expect(live?.rowIds).not.toEqual(durable?.rowIds);
	});
});

describe("semantic tool names and summaries", () => {
	it("strips the mcp__<server>__ prefix, and leaves plain names alone", () => {
		expect(displayToolName("mcp__linear__list_issues")).toBe("list_issues");
		expect(displayToolName("bash")).toBe("bash");
	});

	it("replaces a Python-repr summary with the call's own intent", () => {
		const summary = toolRowSummary({
			tool_name: "jobs",
			summary: "i='Checking the build', op='peek'",
			intent: "",
			details: {},
		});
		expect(summary).not.toContain("i='");
		expect(summary).toContain("Checking the build");
		// Negative control: an ordinary summary passes through untouched.
		expect(
			toolRowSummary({
				tool_name: "bash",
				summary: "git status",
				intent: "",
				details: {},
			}),
		).toBe("git status");
	});

	it("formats nested args as JSON, never [object Object]", () => {
		const lines = toLines({ query: { q: "x" }, tags: [{ a: 1 }], n: 2 });
		expect(lines.join("\n")).not.toContain("[object Object]");
		expect(lines).toEqual(['query: {"q":"x"}', 'tags: [{"a":1}]', "n: 2"]);
	});
});

describe("Team Bridge receipt attribution", () => {
	const receipt = (bridge: object) =>
		row({
			id: "b1",
			kind: "notice",
			custom_type: "team_bridge_message",
			text: "hello",
			details: { bridge_receipt: bridge } as TranscriptEntry["details"],
		});

	it("names the sender and the channel", () => {
		const entry = receipt({
			v: 1,
			sender: { name: "Ada" },
			conversation: { kind: "channel", label: "release" },
			attachment_count: 2,
		});
		expect(bridgeReceiptLabel(entry)).toBe("Ada");
		expect(bridgeReceiptMeta(entry)).toBe("#release · 2 attachments");
	});

	it("says DM for a direct message, and falls back without a v1 receipt", () => {
		expect(
			bridgeReceiptMeta(receipt({ v: 1, conversation: { kind: "dm" } })),
		).toBe("DM");
		const unversioned = receipt({ v: 2, sender: { name: "Ada" } });
		expect(bridgeReceiptLabel(unversioned)).toBe("Team Bridge");
		expect(bridgeReceiptMeta(unversioned)).toBe("");
	});

	it("strips bidi controls from the sender name", () => {
		const entry = receipt({ v: 1, sender: { name: "A\u202Eda" } });
		expect(bridgeReceiptLabel(entry)).toBe("Ada");
	});
});

describe("the shared rail and spacing tiers", () => {
	it("puts the glyph at 16 pt and the text at 40 pt", () => {
		const pt = (cls: string): number => {
			const step = SPACING_STEP.exec(cls.split(" ")[0] ?? "");
			return step ? Number(step[1]) * 4 : Number.NaN;
		};
		const glyphX = pt(TRACE_ROW_OUTER_CLASS) + pt(TRACE_BAR_PAD_CLASS);
		const textX =
			glyphX + pt(TRACE_GLYPH_BOX_CLASS) + pt(TRACE_COLUMN_GAP_CLASS);
		expect(glyphX).toBe(16);
		expect(textX).toBe(40);
		// An expanded panel's `ps-6` inside the `px-4` row lands on that rail too.
		expect(pt(TRACE_ROW_OUTER_CLASS) + pt(TRACE_EXPANDED_INDENT_CLASS)).toBe(
			40,
		);
	});

	it("separates turns by 16 pt, registers by 8 pt, and trace lines by nothing", () => {
		expect(spacingTierBetween(null, "user", false)).toBe("first");
		expect(spacingTierBetween("prose", "user", true)).toBe("turn");
		expect(spacingTierBetween("user", "trace", false)).toBe("block");
		expect(spacingTierBetween("trace", "prose", false)).toBe("block");
		expect(spacingTierBetween("trace", "trace", false)).toBe("trace");
		// A mid-turn steer is a register change, never a turn boundary.
		expect(spacingTierBetween("trace", "user", false)).toBe("block");
		expect(SPACING_TIER_CLASS).toEqual({
			first: "",
			turn: "pt-4",
			block: "pt-2",
			trace: "",
		});
	});
});

/* ------------------------------------------------- round 1 remediation (PR 223) */

const peerRow = (id: string, over: Partial<TranscriptEntry> = {}) =>
	row({
		id,
		kind: "peer_message",
		text: "a peer note",
		details: { sender: { conversation_name: "reviewer" } },
		...over,
	});
const NO_GROUPS: ReadonlyMap<string, QuietGroup> = new Map();
/** The list's three passes, in its order, over one frame. */
const pipeline = (
	entries: TranscriptEntry[],
	options: {
		live: boolean;
		expanded?: ReadonlySet<string>;
		latch?: ReadonlyMap<string, LatchedTurn>;
		sessionId?: string;
	},
) => {
	const expanded = options.expanded ?? NONE;
	const plan = condensePlan({
		entries,
		expanded,
		latch: options.latch ?? NO_LATCH,
		live: options.live,
	});
	const grouped = groupPlan({
		items: plan.items,
		expanded,
		latch: NO_GROUPS,
		...(options.sessionId !== undefined
			? { sessionId: options.sessionId }
			: {}),
	});
	const folded = foldPlan({
		items: grouped.items,
		expanded,
		live: options.live,
	});
	return { plan, grouped, folded };
};

/** R1-2: the list's `groupPlan` call carries `sessionId` and re-plans on it. */
const GROUP_PLAN_SESSION_WIRING =
	/groupPlan\(\{[\s\S]{0,1200}?\bsessionId,\s*\}\),\s*\[plan, expanded, sessionId\]/;

describe("certified peer cycles reach the list (R1-2)", () => {
	const cycle = (sessionId: string): TranscriptEntry[] => [
		user("u1"),
		peerRow("p1", {
			details: {
				sender: { conversation_name: "reviewer" },
				peer_cycle: {
					version: 1,
					session_id: sessionId,
					first_id: "p1",
					last_id: "s1",
					quiet_call_id: "q1",
					member_ids: ["p1", "s1"],
				},
			} as TranscriptEntry["details"],
		}),
		tool("s1", "send"),
	];
	const groupKeys = (entries: TranscriptEntry[], sessionId?: string) =>
		pipeline(entries, {
			live: true,
			...(sessionId !== undefined ? { sessionId } : {}),
		}).grouped.groups.map((group) => group.key);

	it("groups a single-receipt cycle stamped for THIS session", () => {
		expect(groupKeys(cycle("sess-1"), "sess-1")).toEqual(["qg:p1"]);
	});

	it("never groups it for another session, a subagent's composite id, or no id", () => {
		expect(groupKeys(cycle("sess-1"), "sess-2")).toEqual([]);
		expect(groupKeys(cycle("sess-1"), "sess-1:child-7")).toEqual([]);
		expect(groupKeys(cycle("sess-1"))).toEqual([]);
	});

	it("is wired: the list hands groupPlan its sessionId and re-plans on it", () => {
		const source = readFileSync(
			new URL("./components/transcript-list.tsx", import.meta.url),
			"utf8",
		);
		expect(source).toMatch(GROUP_PLAN_SESSION_WIRING);
	});
});

describe("an opened quiet group shows its rows (R1-3 / U1-2)", () => {
	const entries = [
		user("u1"),
		peerRow("p1"),
		tool("r1", "read"),
		tool("r2", "read"),
		tool("r3", "read"),
		peerRow("p2"),
		row({
			id: "a1",
			kind: "assistant",
			text: "Reading the reply",
			final: false,
			text_complete: false,
		}),
	];
	const kinds = (expanded: ReadonlySet<string>) =>
		pipeline(entries, { live: true, expanded }).folded.items.map(
			(item) => `${item.kind}:${item.id}`,
		);

	it("closed: one group bar (control — the group exists)", () => {
		expect(kinds(NONE)).toEqual([
			"entry:u1",
			"group:quiet-group-qg:p1",
			"entry:a1",
		]);
	});

	it("open: the member rows directly, with no FoldBar over the same rows", () => {
		const open = kinds(new Set(["qg:p1"]));
		expect(open.filter((id) => id.startsWith("fold:"))).toEqual([]);
		expect(open).toEqual([
			"entry:u1",
			"group:quiet-group-qg:p1",
			"entry:p1",
			"entry:r1",
			"entry:r2",
			"entry:r3",
			"entry:p2",
			"entry:a1",
		]);
	});

	it("still folds the same three reads when no open group discloses them", () => {
		const bare = [
			user("u1"),
			tool("r1", "read"),
			tool("r2", "read"),
			tool("r3", "read"),
		];
		expect(
			pipeline(bare, { live: true }).folded.items.some(
				(item) => item.kind === "fold",
			),
		).toBe(true);
	});
});

describe("the fold latch across a `!live` frame (R1-4)", () => {
	it("keeps the ids it painted, pruning only rows the frame no longer holds", () => {
		const items = entryItems([user("u1"), tool("t1"), tool("t2"), tool("t3")]);
		const live = foldPlan({ items, expanded: NONE, live: true });
		expect(live.latchedFoldIds.size).toBe(3);
		const dip = foldPlan({
			items,
			expanded: NONE,
			live: false,
			latchedFoldIds: live.latchedFoldIds,
		});
		expect([...dip.latchedFoldIds].sort()).toEqual(
			[...live.latchedFoldIds].sort(),
		);
		const slid = foldPlan({
			items: entryItems([user("u1"), tool("t2"), tool("t3")]),
			expanded: NONE,
			live: false,
			latchedFoldIds: dip.latchedFoldIds,
		});
		expect([...slid.latchedFoldIds].sort()).toEqual([
			"call:call-t2",
			"call:call-t3",
		]);
	});

	it("keeps painting the latch-held fold through the `!live` dip itself (R2-2)", () => {
		const items = entryItems([user("u1"), tool("t1"), tool("t2"), tool("t3")]);
		const live = foldPlan({ items, expanded: NONE, live: true });
		// Two actions are below the fold threshold: only the latch can hold them.
		const slidItems = entryItems([user("u1"), tool("t2"), tool("t3")]);
		const liveSlid = foldPlan({
			items: slidItems,
			expanded: NONE,
			live: true,
			latchedFoldIds: live.latchedFoldIds,
		});
		expect(liveSlid.items.some((item) => item.kind === "fold")).toBe(true);
		const dip = foldPlan({
			items: slidItems,
			expanded: NONE,
			live: false,
			latchedFoldIds: liveSlid.latchedFoldIds,
		});
		expect(dip.items.some((item) => item.kind === "fold")).toBe(true);
		// Without a latch the same two rows stay flat: the fold is the latch's.
		const bare = foldPlan({ items: slidItems, expanded: NONE, live: false });
		expect(bare.items.some((item) => item.kind === "fold")).toBe(false);
	});
});

describe("a condensed newest turn takes in its continuation (U1-1)", () => {
	const hub = (id: string) =>
		row({
			id,
			kind: "subagent_message",
			text: "auditor: done",
			details: { direction: "to_parent", body: "done" },
		});
	const first = [user("u1"), tool("t1"), answer("a1")];
	const continued = [
		...first,
		hub("h1"),
		tool("t2", "read"),
		tool("t3", "bash", { elapsed_s: 2 }),
		answer("a2"),
	];
	const bars = (items: TranscriptItem[]) =>
		items.filter((item) => item.kind === "bar");

	it("an idle-condensed turn re-condenses into ONE bar matching a fresh reload", () => {
		const f1 = condensePlan({
			entries: first,
			expanded: NONE,
			latch: NO_LATCH,
			live: false,
		});
		expect(f1.latch.get("u1")?.facts.steps).toBe(1);
		// The continuation runs: the earlier span stays collapsed, new rows stream below.
		const f2 = condensePlan({
			entries: continued,
			expanded: NONE,
			latch: f1.latch,
			live: true,
		});
		expect(bars(f2.items)).toHaveLength(1);
		expect(f2.items.map((item) => item.id)).toEqual(
			expect.arrayContaining(["h1", "t2", "t3", "a2"]),
		);
		// Idle again: one bar over the whole turn, as a reload computes it.
		const f3 = condensePlan({
			entries: continued,
			expanded: NONE,
			latch: f2.latch,
			live: false,
		});
		const reload = condensePlan({
			entries: continued,
			expanded: NONE,
			latch: NO_LATCH,
			live: false,
		});
		expect(bars(f3.items)).toHaveLength(1);
		expect(f3.latch.get("u1")?.facts).toEqual(reload.latch.get("u1")?.facts);
		expect(f3.latch.get("u1")?.facts.steps).toBe(3);
		expect(f3.items.map((item) => item.id)).toEqual(
			reload.items.map((item) => item.id),
		);
		expect(f3.turns[0]?.hiddenIds).toEqual(reload.turns[0]?.hiddenIds);
		// …and it stays that way once a newer turn exists.
		const next = [...continued, user("u2")];
		const f4 = condensePlan({
			entries: next,
			expanded: NONE,
			latch: f3.latch,
			live: true,
		});
		expect(f4.latch.get("u1")?.facts.steps).toBe(3);
	});

	it("a one-frame `!live` dip never leaves later work raw or under a stale count", () => {
		const mid = [user("u1"), tool("t1"), answer("a1")];
		const dip = condensePlan({
			entries: mid,
			expanded: NONE,
			latch: NO_LATCH,
			live: false,
		});
		const resumed = [...mid, tool("t2"), tool("t3")];
		const live = condensePlan({
			entries: resumed,
			expanded: NONE,
			latch: dip.latch,
			live: true,
		});
		// Live: the bar only hides what it counted; the running work is visible.
		expect(live.items.map((item) => item.id)).toEqual(
			expect.arrayContaining(["t2", "t3"]),
		);
		const settled = [...resumed, answer("a2")];
		const idle = condensePlan({
			entries: settled,
			expanded: NONE,
			latch: live.latch,
			live: false,
		});
		const reload = condensePlan({
			entries: settled,
			expanded: NONE,
			latch: NO_LATCH,
			live: false,
		});
		expect(idle.latch.get("u1")?.facts).toEqual(reload.latch.get("u1")?.facts);
		expect(idle.items.map((item) => item.id)).toEqual(
			reload.items.map((item) => item.id),
		);
	});

	it("never moves the latch on an EARLIER closing (a transport-cap regression)", () => {
		const f1 = condensePlan({
			entries: continued,
			expanded: NONE,
			latch: NO_LATCH,
			live: false,
		});
		// The closing answer arrives as a capped prefix: the scan stops calling it one.
		const capped = continued.map((entry) =>
			entry.id === "a2" ? { ...entry, text_complete: false } : entry,
		);
		const f2 = condensePlan({
			entries: capped,
			expanded: NONE,
			latch: f1.latch,
			live: false,
		});
		expect(f2.latch.get("u1")).toBe(f1.latch.get("u1"));
	});
});

describe("the turn bar's painted words (U1-3)", () => {
	it("paints no outcome word — the numbers, or `Turn condensed`", () => {
		expect(barPhrases({ steps: 4, durationS: 4, failed: 1 })).toEqual([
			"Took 4s",
			"4 actions",
		]);
		expect(barPhrases({ steps: 2, durationS: 0, steered: true })).toEqual([
			"Steered",
			"2 actions",
		]);
		expect(barPhrases({ steps: 0, durationS: 0 })).toEqual(["Turn condensed"]);
	});

	it("still says `completed` to a screen reader", () => {
		expect(
			barAccessibleName({ steps: 4, durationS: 4, failed: 1 }, "Fix it"),
		).toBe(
			'Turn "Fix it": completed, Took 4s, 4 actions, Includes a failed action',
		);
	});
});
