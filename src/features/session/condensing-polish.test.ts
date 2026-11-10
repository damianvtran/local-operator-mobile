/**
 * Transcript condensing polish (Slice 2): the Tier A fold, idle completed-turn
 * condensing, semantic tool names/summaries, Team Bridge receipt attribution,
 * the shared 16 pt / 40 pt rail and the vertical spacing tiers.
 *
 * Every positive case sits beside its negative control, so a pass cannot come
 * from a predicate that is simply always true (or always false).
 */
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
	condensePlan,
	foldPlan,
	type LatchedTurn,
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
