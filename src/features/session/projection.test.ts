import { describe, expect, it } from "vitest";

import type { SessionProjection, TranscriptEntry } from "@/contracts";
import {
	classifyEntry,
	diffCounts,
	diffLineTone,
	hasToolDetails,
	middleTruncate,
	projectSubagents,
	projectTodos,
	streamingRowId,
	toLines,
	toolDetailBlocks,
	toolElapsed,
	toolGlyph,
	transcriptRowTestID,
	workingLine,
} from "@/features/session/projection";

/**
 * The transcript's projection: the derivation each row's treatment depends on.
 *
 * The wire's shapes are the reason this file exists. `TranscriptEntryDetails`
 * carries `args` as a string OR an object, `diff` as a string OR an array — and
 * calling `.split()` on the object is a shipped crash (a `TypeError` unmounts the
 * tree, read on a phone as "tap the row and the screen goes blank"). `null` and
 * `0` mean different things for `activity_started_s` and `elapsed_s`, and both
 * differences are product decisions rather than formatting.
 */

const entry = (overrides: Partial<TranscriptEntry> = {}): TranscriptEntry => ({
	id: "entry-1",
	kind: "tool",
	text: "",
	tool_call_id: "call-1",
	tool_name: "bash",
	tool_state: "done",
	summary: "ls",
	intent: "",
	diff_added: 0,
	diff_removed: 0,
	elapsed_s: 0,
	error: "",
	details: {},
	images: [],
	final: true,
	text_complete: true,
	...overrides,
});

const projection = (
	overrides: Partial<SessionProjection> = {},
): SessionProjection => ({
	session_id: "s1",
	pid: 1,
	kind: "daemon",
	conversation_name: "a session",
	cwd: "~/work",
	model_label: "Opus",
	model_selector: "anthropic/opus",
	effort: "high",
	effort_ladder: ["low", "high"],
	streaming: false,
	activity: "",
	activity_started_s: null,
	stop_reason: "",
	cut_off: false,
	queued_count: 0,
	ended: false,
	degraded: false,
	transcript: [],
	todos: [],
	subagents: [],
	pending: null,
	pending_count: 0,
	usage: {},
	cumulative_parent_cost: null,
	child_costs: {},
	subagent_cost: null,
	subagent_cost_knowledge: null,
	cost_knowledge: "",
	context_tokens: null,
	context_window: null,
	context_is_estimate: null,
	version: 1,
	...overrides,
});

describe("a tool row's one line", () => {
	it("draws state from the kit's eight characters, not from an icon font", () => {
		expect(toolGlyph("done")).toEqual({
			glyph: "✓",
			inkClass: "text-success",
			pulsing: false,
		});
		expect(toolGlyph("failed").inkClass).toBe("text-danger");
		// `interrupted` is a state the reader must notice, and `ink-dim` is the one
		// role that says "ignore me" — so the web client's choice is deliberately not
		// kept.
		expect(toolGlyph("interrupted")).toEqual({
			glyph: "–",
			inkClass: "text-warning",
			pulsing: false,
		});
		// Only a RUNNING call moves; a queued one is announced but nothing happens.
		expect(toolGlyph("running").pulsing).toBe(true);
		expect(toolGlyph("queued").pulsing).toBe(false);
		expect(toolGlyph("queued").glyph).toBe("⋯");
	});

	it("suppresses the diff counts when there is nothing to count", () => {
		expect(diffCounts(entry({ diff_added: 0, diff_removed: 0 }))).toBeNull();
		expect(diffCounts(entry({ diff_added: 18, diff_removed: 0 }))).toEqual({
			added: 18,
			removed: 0,
		});
	});

	it("treats `0` elapsed as unmeasured rather than instantaneous", () => {
		expect(toolElapsed(entry({ elapsed_s: 0 }))).toBeNull();
		expect(toolElapsed(entry({ elapsed_s: 0.4 }))).toBe("0s");
		expect(toolElapsed(entry({ elapsed_s: 64 }))).toBe("1m 04s");
	});

	it("normalises all three arg shapes, because the object shape has crashed a client", () => {
		expect(toLines("a\nb")).toEqual(["a", "b"]);
		expect(toLines(["+one", "-two"])).toEqual(["+one", "-two"]);
		expect(toLines({ path: "src/a.ts", count: 3 })).toEqual([
			"path: src/a.ts",
			"count: 3",
		]);
		expect(toLines(null)).toEqual([]);
		expect(toLines(undefined)).toEqual([]);
	});

	it("drops the args block for the tools whose args ARE the diff", () => {
		const write = entry({
			tool_name: "write",
			details: { args: { path: "a.ts", content: "…" }, diff: ["+a", "-b"] },
		});
		const blocks = toolDetailBlocks(write);
		expect(blocks.showArgs).toBe(false);
		expect(blocks.args).toEqual([]);
		expect(blocks.diff).toEqual(["+a", "-b"]);

		// A read keeps its args, because they are not repeated anywhere.
		expect(
			toolDetailBlocks(
				entry({ tool_name: "read", details: { args: "path: a" } }),
			).args,
		).toEqual(["path: a"]);
	});

	it("only offers a disclosure when there is something behind it", () => {
		expect(hasToolDetails(entry({ details: {} }))).toBe(false);
		expect(hasToolDetails(entry({ details: { output: "hi" } }))).toBe(true);
		expect(hasToolDetails(entry({ details: {}, intent: "look" }))).toBe(true);
		expect(hasToolDetails(entry({ details: {}, error: "boom" }))).toBe(true);
	});

	it("does not tint a diff's file headers as added or removed lines", () => {
		expect(diffLineTone("+++ b/a.ts")).toBe("plain");
		expect(diffLineTone("--- a/a.ts")).toBe("plain");
		expect(diffLineTone("@@ -1,3 +1,4 @@")).toBe("hunk");
		expect(diffLineTone("+added")).toBe("added");
		expect(diffLineTone("-removed")).toBe("removed");
	});
});

describe("row identity", () => {
	it("classifies the wire's kinds and keeps an unknown one visible", () => {
		expect(classifyEntry(entry({ kind: "user" }))).toBe("user");
		expect(classifyEntry(entry({ kind: "peer_message" }))).toBe("peer");
		// The wire's `EntryKind` is open. A row that vanished would shorten the
		// conversation with no trace, so an unknown kind is a generic row instead.
		expect(classifyEntry(entry({ kind: "brand_new_kind" }))).toBe("generic");
	});

	it("anchors each row by its own id", () => {
		expect(transcriptRowTestID(entry({ id: "abc" }))).toBe(
			"transcript-row-abc",
		);
	});

	it("marks only the tail row, and only while streaming", () => {
		const rows = [entry({ id: "a" }), entry({ id: "b" })];
		expect(
			streamingRowId(projection({ transcript: rows, streaming: true })),
		).toBe("b");
		// Settled: the anchor must disappear, which is the assertion flow 04 makes.
		expect(
			streamingRowId(projection({ transcript: rows, streaming: false })),
		).toBeNull();
		expect(
			streamingRowId(projection({ transcript: [], streaming: true })),
		).toBeNull();
	});
});

describe("the working line", () => {
	it("exists only when the runtime named an activity", () => {
		expect(workingLine(projection())).toBeNull();
		expect(workingLine(projection({ activity: "thinking" }))).toEqual({
			activity: "thinking",
			startedS: null,
		});
	});

	it("carries a known zero through as a known zero", () => {
		// `0` is the phase edge the server watched begin and must render `0s`; `null`
		// is a phase with no honest instant and must render no digits at all.
		expect(
			workingLine(projection({ activity: "thinking", activity_started_s: 0 }))
				?.startedS,
		).toBe(0);
		expect(
			workingLine(
				projection({ activity: "thinking", activity_started_s: null }),
			)?.startedS,
		).toBeNull();
	});
});

describe("the todos panel's list", () => {
	it("counts, orders open work first, and keeps the implicit phase headerless", () => {
		const todos = projectTodos([
			{
				name: "Todos",
				items: [
					{ text: "done thing", status: "done", reason: "" },
					{ text: "open thing", status: "pending", reason: "" },
					{ text: "stuck thing", status: "blocked", reason: "no credentials" },
				],
			},
			{
				name: "Ship it",
				items: [{ text: "later", status: "dropped", reason: "" }],
			},
		]);
		expect(todos.total).toBe(4);
		expect(todos.done).toBe(1);
		expect(todos.phases[0]?.headerless).toBe(true);
		expect(todos.phases[1]?.headerless).toBe(false);
		expect(todos.phases[0]?.rows.map((row) => row.status)).toEqual([
			"pending",
			"blocked",
			"done",
		]);
		expect(todos.phases[1]?.rows[0]?.struck).toBe(true);
	});

	it("is empty when there is nothing to show", () => {
		expect(projectTodos([]).empty).toBe(true);
	});
});

describe("the subagent roster", () => {
	const row = (overrides: Partial<import("@/contracts").SubagentRow> = {}) =>
		({
			job_id: "job-1",
			label: "audit the relay",
			agent: "reviewer",
			status: "running",
			progress: "",
			elapsed_s: 12,
			model_label: "Opus",
			result_text: "",
			error_text: "",
			parent_job_id: null,
			session_id: null,
			prompt: "",
			launch_message_id: "",
			effort: "high",
			ancestors: [],
			ancestor_ids: [],
			child_ids: [],
			peer_ids: [],
			transcript: [],
			todos: [],
			activity: "",
			...overrides,
		}) satisfies import("@/contracts").SubagentRow;

	it("counts running, queued and failed separately", () => {
		const roster = projectSubagents([
			row(),
			row({ job_id: "job-2", status: "queued" }),
			row({ job_id: "job-3", status: "failed" }),
			row({ job_id: "job-4", status: "completed" }),
		]);
		expect(roster.running).toBe(1);
		expect(roster.queued).toBe(1);
		expect(roster.failed).toBe(1);
		expect(roster.total).toBe(4);
	});

	it("withholds a clock rather than inventing `0s`, and keeps the wire's order", () => {
		const roster = projectSubagents([
			row({ job_id: "a", elapsed_s: null }),
			row({ job_id: "b", elapsed_s: 90 }),
		]);
		// A roster with no age for a child shows NO clock: `null` contributes nothing.
		expect(roster.rows[0]?.elapsed).toBeNull();
		expect(roster.rows[1]?.elapsed).toBe("1m 30s");
		expect(roster.rows.map((view) => view.jobId)).toEqual(["a", "b"]);
	});

	it("carries the nesting depth from the child's own ancestry, and its anchor", () => {
		const nested = projectSubagents([
			row({ job_id: "child", ancestors: ["root", "mid"] }),
		]);
		expect(nested.rows[0]?.depth).toBe(2);
		expect(nested.rows[0]?.testID).toBe("subagent-chip-child");
		expect(nested.rows[0]?.metadata).toBe("reviewer · high");
	});
});

describe("the header's name", () => {
	it("keeps both ends, which are the distinguishing parts", () => {
		expect(middleTruncate("refactor the relay client", 40)).toBe(
			"refactor the relay client",
		);
		// Both ENDS survive, which is the point on a phone: a session name and a job id
		// are distinguishable at their extremes, not in the middle.
		expect(
			middleTruncate("refactor the relay client and the harness", 20),
		).toBe("refactor t…e harness");
	});
});
