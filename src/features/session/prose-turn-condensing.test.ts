import { describe, expect, it } from "vitest";

import type { TranscriptEntry } from "@/contracts";
import {
	barPhrases,
	condensePlan,
	foldPlan,
	type TranscriptItem,
} from "@/features/session/turn-condensing";

/*
 * Assistant prose is never hidden behind a bar that states nothing.
 *
 * The defect: `condensePlan` hid EVERY row between a turn's opening message and
 * its closing row, so a plain turn with two assistant messages (a long reply,
 * then a short follow-up) or a reply followed by a quiet `no_reply` close
 * painted the long reply as one `Turn condensed` bar — no tool row to count, so
 * nothing but the fallback label — and the message read as lost.
 *
 * Widened by the TestFlight 1411 report ("final responses are being tucked into
 * condensed messages"): a turn that did tool work keeps its handover messages
 * on screen too — the bar stands for the tool rows and the finished reasoning,
 * never for anything the agent said (relay `partitionRun` V5). See
 * `turn-condensing.ts`, "THE BAR STANDS FOR WORK".
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

const LONG = "A long plain-prose reply that explains things at length. ".repeat(
	60,
);

const user = (id: string) => row({ id, kind: "user", text: "question" });
const prose = (id: string, text = LONG) => row({ id, kind: "assistant", text });
/** Mid-turn narration: the assistant row that announces its own calls. */
const narration = (id: string, text = LONG) =>
	row({
		id,
		kind: "assistant",
		text,
		calls_tools: true,
	} as Partial<TranscriptEntry> & Pick<TranscriptEntry, "id" | "kind">);
const tool = (id: string, name = "bash", elapsedS = 2) =>
	row({ id, kind: "tool", tool_name: name, elapsed_s: elapsedS });
const quietClose = (id: string) => tool(id, "no_reply", 0);

const settled = (entries: TranscriptEntry[]) =>
	condensePlan({
		entries: [...entries, user("next")],
		expanded: new Set(),
		latch: new Map(),
		live: true,
	});

const entryIds = (items: readonly TranscriptItem[]) =>
	items.filter((item) => item.kind === "entry").map((item) => item.id);
const hasBar = (items: readonly TranscriptItem[]) =>
	items.some((item) => item.kind === "bar");
const first = (plan: ReturnType<typeof settled>) => {
	const turn = plan.turns[0];
	if (turn === undefined) throw new Error("no turn planned");
	return turn;
};

describe("a prose turn keeps its long assistant message on screen", () => {
	it("a long reply followed by a short follow-up is not condensed", () => {
		const plan = settled([
			user("u1"),
			prose("a1"),
			prose("a2", "Anything else?"),
		]);
		const turn = first(plan);
		expect(turn.condensed).toBe(false);
		expect(turn.hiddenIds).toEqual([]);
		expect(hasBar(plan.items)).toBe(false);
		expect(entryIds(plan.items)).toEqual(["u1", "a1", "a2", "next"]);
	});

	it("a long reply followed by a quiet no_reply close stays above the bar", () => {
		const plan = settled([user("u1"), prose("a1"), quietClose("q1")]);
		const turn = first(plan);
		expect(turn.hiddenIds).not.toContain("a1");
		expect(entryIds(plan.items)).toContain("a1");
		expect(entryIds(plan.items).indexOf("a1")).toBeGreaterThan(-1);
	});

	it("narration whose calls the relay dropped is not folded into an empty bar", () => {
		// `calls_tools` with no tool row behind it: the fold hid the call (quiet or
		// hidden send), so the bar would have no count to state.
		const plan = settled([user("u1"), narration("a1"), prose("a2", "Done.")]);
		const turn = first(plan);
		expect(turn.condensed).toBe(false);
		expect(entryIds(plan.items)).toEqual(["u1", "a1", "a2", "next"]);
	});

	it("keeps a relay-cut prefix visible rather than hiding the text it has", () => {
		const cut = row({
			id: "a1",
			kind: "assistant",
			text: LONG.slice(0, 200),
			text_complete: false,
		});
		const plan = settled([user("u1"), cut, prose("a2", "ok")]);
		expect(first(plan).hiddenIds).not.toContain("a1");
		expect(entryIds(plan.items)).toContain("a1");
	});

	it("no condensed turn's bar ever sits where assistant text should be", () => {
		const shapes: TranscriptEntry[][] = [
			[user("u1"), prose("a1"), prose("a2", "ok")],
			[user("u1"), prose("a1"), quietClose("q1")],
			[user("u1"), prose("a1"), quietClose("q1"), prose("a2", "ok")],
			[user("u1"), narration("a1"), prose("a2", "ok")],
			[
				user("u1"),
				prose("a1"),
				row({ id: "s1", kind: "steer", text: "and?" }),
				prose("a2", "ok"),
			],
		];
		for (const entries of shapes) {
			const plan = settled(entries);
			const turn = first(plan);
			const hiddenProse = turn.hiddenIds.filter(
				(id) => entries.find((e) => e.id === id)?.kind === "assistant",
			);
			expect(hiddenProse, JSON.stringify(entries.map((e) => e.id))).toEqual([]);
		}
	});

	it("a continuation that adds tool work does not pull the reader's prose into the bar", () => {
		const early = [user("u1"), prose("a1"), quietClose("q1")];
		const one = condensePlan({
			entries: [...early, user("u2")],
			expanded: new Set(),
			latch: new Map(),
			live: false,
		});
		expect(one.turns.find((t) => t.key === "u1")?.hiddenIds).not.toContain(
			"a1",
		);
		const later = [
			...early,
			tool("t2"),
			tool("t3"),
			prose("a3", "Wake follow-up."),
			user("u2"),
		];
		const two = condensePlan({
			entries: later,
			expanded: new Set(),
			latch: one.latch,
			live: false,
		});
		const turn = two.turns.find((t) => t.key === "u1");
		expect(turn?.hiddenIds).not.toContain("a1");
		expect(turn?.hiddenIds).toEqual(expect.arrayContaining(["t2", "t3"]));
		expect(entryIds(two.items)).toContain("a1");
	});
});

describe("a tool turn condenses its work and keeps its handovers", () => {
	// Opening message, a stretch of tool work, a handover message BETWEEN tool
	// calls (no `calls_tools`: the agent stopped and answered, then the harness
	// continued), more work, then the closing answer. The bar stands for the
	// tool rows and the narration that declared calls; `mid` is an answer the
	// reader is owed and stays on screen, in its place after the bar.
	const toolTurn = [
		user("u1"),
		tool("t1"),
		tool("t2"),
		tool("t3"),
		prose("mid", "Found the cause; continuing with the fix."),
		tool("t4"),
		narration("n1", "Running the tests."),
		prose("a9", "All fixed."),
	];

	it("hides the work, keeps the mid-turn answer and the narration, and states the same counts", () => {
		const turn = first(settled(toolTurn));
		expect(turn.condensed).toBe(true);
		expect(turn.hiddenIds).toEqual(["t1", "t2", "t3", "t4"]);
		expect(turn.bar).toEqual({ steps: 4, durationS: 8 });
		expect(barPhrases(turn.bar ?? { steps: 0, durationS: 0 })).toEqual([
			"Took 8s",
			"4 actions",
		]);
		expect(entryIds(settled(toolTurn).items)).toEqual([
			"u1",
			"mid",
			"n1",
			"a9",
			"next",
		]);
	});

	it("the Tier A fold keeps exactly the tool run and never takes prose", () => {
		const open = condensePlan({
			entries: [...toolTurn, user("next")],
			expanded: new Set(["u1"]),
			latch: new Map(),
			live: false,
		});
		const folded = foldPlan({
			items: open.items,
			expanded: new Set(),
			live: false,
		});
		const folds = folded.items.filter((item) => item.kind === "fold");
		expect(folds.length).toBeGreaterThan(0);
		// Captured on origin/main before the fix: identical output is the contract.
		expect(folds.map((item) => [...item.fold.rowIds])).toEqual([
			["t1", "t2", "t3"],
		]);
		expect(folded.items.map((item) => item.id)).toEqual([
			"u1",
			"turn-bar-u1",
			"fold-bar-fold:t1",
			"mid",
			"t4",
			"n1",
			"a9",
			"next",
		]);
	});
});

/*
 * The `calls_tools` half of "final responses are being tucked into condensed
 * messages". The relay stamps `calls_tools` from `bool(message.tool_calls)`, and
 * a model message can answer AND call tools in one step, so an answer row can
 * arrive declaring calls. Classifying that as narration folded the answer into
 * the bar with the work it introduced: the operator's 2026-11-21 report (build
 * unknown) shows the answer and its table inside the collapsed
 * `Took 5s · 4 actions` group, with tool rows after them.
 */
describe("assistant prose stays outside the bar whatever the row declares", () => {
	const blank = (id: string) =>
		row({
			id,
			kind: "assistant",
			text: "",
			calls_tools: true,
		} as Partial<TranscriptEntry> & Pick<TranscriptEntry, "id" | "kind">);

	it("keeps a text-only answer above the tool rows that follow it", () => {
		// Already true on main since #356; pinned so a later classification change
		// cannot silently fold a plain answer again.
		const entries = [
			user("u1"),
			tool("t1"),
			tool("t2"),
			tool("t3"),
			tool("t4"),
			prose("a1", "Partly. The nightly billing check is clean."),
			prose("a2", "Closing line."),
		];
		const plan = settled(entries);
		const turn = first(plan);
		expect(turn.condensed).toBe(true);
		expect(turn.hiddenIds).toEqual(["t1", "t2", "t3", "t4"]);
		expect(entryIds(plan.items)).toEqual(["u1", "a1", "a2", "next"]);
	});

	it("keeps an answer that also declares calls_tools, with more work after it", () => {
		// The operator's screenshot shape: tools, then the answer stamped
		// `calls_tools`, then the tool rows it requested, then the closing line.
		const entries = [
			user("u1"),
			tool("t1"),
			tool("t2"),
			narration("a1", "Partly. The nightly billing check is clean."),
			tool("t3"),
			tool("t4"),
			prose("a2", "Closing line."),
		];
		const plan = settled(entries);
		const turn = first(plan);
		expect(turn.condensed).toBe(true);
		expect(turn.hiddenIds).toEqual(["t1", "t2", "t3", "t4"]);
		expect(turn.hiddenIds).not.toContain("a1");
		expect(turn.bar).toEqual({ steps: 4, durationS: 8 });
		expect(entryIds(plan.items)).toEqual(["u1", "a1", "a2", "next"]);
	});

	it("keeps several prose messages interleaved between tool calls", () => {
		const entries = [
			user("u1"),
			tool("t1"),
			prose("a1", "First finding."),
			tool("t2"),
			narration("a2", "Second finding, still working."),
			tool("t3"),
			prose("a3", "Closing line."),
		];
		const plan = settled(entries);
		const turn = first(plan);
		expect(turn.condensed).toBe(true);
		expect(turn.hiddenIds).toEqual(["t1", "t2", "t3"]);
		expect(entryIds(plan.items)).toEqual(["u1", "a1", "a2", "a3", "next"]);
	});

	it("still folds an empty-text row that declares calls_tools", () => {
		// A tool-only model message carries no text (the relay appends a blank
		// assistant row per tool batch); the bar stands for its calls.
		const entries = [
			user("u1"),
			tool("t1"),
			blank("e1"),
			tool("t2"),
			tool("t3"),
			prose("a1", "Done."),
		];
		const turn = first(settled(entries));
		expect(turn.condensed).toBe(true);
		expect(turn.hiddenIds).toEqual(["t1", "e1", "t2", "t3"]);
		expect(turn.bar).toEqual({ steps: 3, durationS: 6 });
	});
});
