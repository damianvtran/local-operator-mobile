import { describe, expect, it } from "vitest";

import type { TranscriptEntry } from "@/contracts";
import {
	entryRegister,
	GROUP_GUIDE_START_CLASS,
	GROUP_INSET_CLASS,
	groupDepth,
	isBlankAssistantEntry,
	SPACING_TIER_CLASS,
	spacingTiersOf,
} from "@/features/session/components/trace-rail";
import { groupContainment } from "@/features/session/group-containment";
import {
	condensePlan,
	foldPlan,
	type TranscriptItem,
} from "@/features/session/turn-condensing";
import { foldBarId, turnBarId } from "@/ui/a11y";

/**
 * Operator report, iOS build 836: "when you expand action groups the spacing
 * seems to be uneven and it's hard to tell what's part of the group". Two
 * defects, pinned here at the plan level (the render half is in
 * `components/group-containment-render.test.tsx`):
 *
 *   1. UNEVEN: the live projection carries one blank assistant row per tool
 *      batch, and each one rendered as 24 pt of empty prose rhythm between two
 *      tool rows.
 *   2. CONTAINMENT: an opened bar's rows came back on the bar's own rail.
 */

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
const tool = (id: string, name = "todo", over: Partial<TranscriptEntry> = {}) =>
	row({ id, kind: "tool", tool_call_id: id, tool_name: name, ...over });
const prose = (id: string, text: string) =>
	row({ id, kind: "assistant", text });
/** A tool-only model message as the relay's LIVE fold projects it
 *  (`MessageStartEvent` arm): an assistant row with no text. */
const blank = (id: string) => prose(id, "");
const asItems = (entries: TranscriptEntry[]): TranscriptItem[] =>
	entries.map((entry) => ({ kind: "entry", id: entry.id, entry }));

/** The operator's screenshot, as the wire carried it: a completed turn whose
 *  three actions came in two batches (task + todo add, then todo block), each
 *  batch opened by a blank assistant row, then the closing answer. A second
 *  turn after it makes the first one condensable. */
const screenshotTurn = (): TranscriptEntry[] => [
	user("u1"),
	blank("a1"),
	tool("t1", "task"),
	tool("t2", "todo"),
	blank("a2"),
	tool("t3", "todo"),
	prose("a3", "Delegated; the todo is blocked on review."),
	user("u2"),
	prose("a4", "next"),
];

const plan = (entries: TranscriptEntry[], expanded: ReadonlySet<string>) => {
	const turns = condensePlan({
		entries,
		expanded,
		latch: new Map(),
		live: false,
	});
	const folded = foldPlan({ items: turns.items, expanded, live: false });
	return { turns, folded };
};

describe("blank assistant rows take no space (root cause of the uneven gaps)", () => {
	it("classifies only an assistant row with nothing to paint as blank", () => {
		expect(isBlankAssistantEntry(blank("a"))).toBe(true);
		expect(isBlankAssistantEntry(prose("a", "  \n "))).toBe(true);
		expect(isBlankAssistantEntry(prose("a", "on it"))).toBe(false);
		expect(
			isBlankAssistantEntry(
				row({
					id: "a",
					kind: "assistant",
					images: [{ index: 0, mime_type: "image/png" }],
				} as Partial<TranscriptEntry> & Pick<TranscriptEntry, "id" | "kind">),
			),
		).toBe(false);
		// A blank TOOL or notice is not this rule's business.
		expect(isBlankAssistantEntry(tool("t"))).toBe(false);
		expect(entryRegister(blank("a"))).toBe("none");
		expect(entryRegister(prose("a", "x"))).toBe("prose");
	});

	it("keeps tool rows on one even rhythm across a blank batch boundary", () => {
		const tiers = spacingTiersOf(
			asItems([tool("t1"), tool("t2"), blank("a2"), tool("t3")]),
		);
		// Before: a2 = block (8 pt) and t3 = block (8 pt) around a py-1 box.
		expect(tiers.get("a2")).toBe("trace");
		expect(tiers.get("t3")).toBe("trace");
		expect(SPACING_TIER_CLASS.trace).toBe("");
		expect(tiers.get("t2")).toBe("trace");
	});

	it("still separates real prose from trace rows by a block step", () => {
		const tiers = spacingTiersOf(
			asItems([tool("t1"), blank("a1"), prose("a2", "hello"), tool("t2")]),
		);
		expect(tiers.get("a2")).toBe("block");
		expect(tiers.get("t2")).toBe("block");
	});

	it("does not let a leading blank row steal the first item's tier", () => {
		const tiers = spacingTiersOf(asItems([blank("a0"), user("u1")]));
		expect(tiers.get("u1")).toBe("first");
	});
});

describe("groupContainment", () => {
	it("marks nothing while every bar is closed — collapse restores the layout", () => {
		const { turns, folded } = plan(screenshotTurn(), new Set());
		expect(folded.items.some((item) => item.kind === "bar")).toBe(true);
		expect(groupContainment(folded.items, turns.turns, folded.folds).size).toBe(
			0,
		);
	});

	it("contains exactly the rows an opened turn bar stood for", () => {
		const { turns, folded } = plan(screenshotTurn(), new Set(["u1"]));
		const depth = groupContainment(folded.items, turns.turns, folded.folds);
		const ids = folded.items.map((item) => item.id);
		expect(ids).toContain(turnBarId("u1"));
		// The blank batch-opening rows split the three actions into runs too
		// short to fold, so the turn re-emits them flat — the screenshot's
		// shape. Every row the bar stood for is a member, blank rows included
		// (they draw only the guide, which keeps the line unbroken).
		const members = ids.filter((id) => depth.has(id));
		expect(members).toEqual(["a1", "t1", "t2", "a2", "t3"]);
		for (const id of members) expect(depth.get(id)).toBe(1);
	});

	it("nests an opened fold inside an opened turn one level deeper", () => {
		// One batch of three calls: a run long enough to fold inside the turn.
		const entries = [
			user("u1"),
			tool("t1", "read"),
			tool("t2", "read"),
			tool("t3", "read"),
			prose("a3", "Read all three."),
			user("u2"),
			prose("a4", "next"),
		];
		const fold = plan(entries, new Set(["u1"])).folded.folds[0];
		expect(fold).toBeDefined();
		const key = fold?.key ?? "";
		const { turns, folded } = plan(entries, new Set(["u1", key]));
		const depth = groupContainment(folded.items, turns.turns, folded.folds);
		expect(depth.get(foldBarId(key))).toBe(1);
		for (const id of ["t1", "t2", "t3"]) expect(depth.get(id)).toBe(2);
		expect(depth.has("a3")).toBe(false);
		expect(depth.has(turnBarId("u1"))).toBe(false);
	});

	it("contains an opened fold's rows outside any turn bar at depth 1", () => {
		// The newest, still-live turn never condenses, but its runs still fold.
		const entries = [user("u1"), tool("t1"), tool("t2"), tool("t3")];
		const items = asItems(entries);
		const closed = foldPlan({ items, expanded: new Set(), live: true });
		const key = closed.folds[0]?.key ?? "";
		expect(groupContainment(closed.items, [], closed.folds).size).toBe(0);
		const open = foldPlan({ items, expanded: new Set([key]), live: true });
		const depth = groupContainment(open.items, [], open.folds);
		expect([...depth.entries()]).toEqual([
			["t1", 1],
			["t2", 1],
			["t3", 1],
		]);
	});

	it("maps depth to one 24 pt step and one guide per level, capped", () => {
		expect(GROUP_INSET_CLASS[groupDepth(undefined)]).toBe("");
		expect(GROUP_INSET_CLASS[groupDepth(1)]).toBe("ps-6");
		expect(GROUP_INSET_CLASS[groupDepth(2)]).toBe("ps-12");
		expect(groupDepth(9)).toBe(3);
		expect(GROUP_GUIDE_START_CLASS.slice(0, 2)).toEqual([
			"start-5",
			"start-11",
		]);
	});
});
