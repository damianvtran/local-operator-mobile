import { describe, expect, it } from "vitest";

import type { CheckpointEntry, CheckpointManifest } from "@/contracts";
import {
	checkpointVocabulary,
	layoutRailMarks,
	marksBeyondWindow,
	railMarks,
	railState,
} from "@/features/session/checkpoint-rail";

/**
 * The rail's pure half, pinned without a renderer.
 *
 * The two facts a frame cannot hold on its own live here: that a mark's place
 * is derived from `seq` over the WHOLE manifest range (never the loaded
 * window, never the frame count), and that the state set keeps empty /
 * building / failed apart — `error` may not draw as "no checkpoints", and a
 * `ready` manifest with no ticks may not draw as a failure.
 */

const tick = (
	over: Partial<CheckpointEntry> & { id: string; seq: number },
): CheckpointEntry => ({
	kind: "user",
	turn: 1,
	ts: 1_700_000_000,
	text: over.id,
	outcome: null,
	naming: null,
	...over,
});

const manifest = (
	over: Partial<CheckpointManifest> = {},
): CheckpointManifest => ({
	session_id: "s",
	index: { state: "ready", built_at: 1 },
	checkpoints: [],
	...over,
});

describe("checkpointVocabulary", () => {
	it("a user turn is a user mark, whatever else it carries", () => {
		expect(checkpointVocabulary(tick({ id: "u", seq: 3 }))).toBe("user");
	});

	it("every outcome word draws its own word", () => {
		const at = (outcome: CheckpointEntry["outcome"]) =>
			checkpointVocabulary(
				tick({ id: "c", seq: 5, kind: "completion", outcome }),
			);
		expect(at("complete")).toBe("complete");
		expect(at("error")).toBe("error");
		expect(at("interrupted")).toBe("interrupted");
		expect(at("open")).toBe("open");
	});

	it("a completion with NO outcome word is `plain`, never `complete`", () => {
		/* The honesty case: a marker that carried no kind must not borrow the
		 * tick for a verdict the wire never sent. */
		expect(
			checkpointVocabulary(tick({ id: "c", seq: 5, kind: "completion" })),
		).toBe("plain");
	});
});

describe("railMarks", () => {
	it("places ticks by seq across the whole range, first at 0 and last at 1", () => {
		const marks = railMarks([
			tick({ id: "a", seq: 3 }),
			tick({ id: "b", seq: 5, kind: "completion", outcome: "complete" }),
			tick({ id: "c", seq: 8 }),
			tick({ id: "d", seq: 10, kind: "completion", outcome: "open" }),
		]);
		expect(marks.map((mark) => mark.fraction)).toEqual([0, 2 / 7, 5 / 7, 1]);
		expect(marks.map((mark) => mark.id)).toEqual(["a", "b", "c", "d"]);
	});

	it("a single tick sits at the centre — a range of one has no ends", () => {
		expect(railMarks([tick({ id: "only", seq: 42 })])[0]?.fraction).toBe(0.5);
	});

	it("an empty manifest has no marks at all", () => {
		expect(railMarks([])).toEqual([]);
	});
});

describe("layoutRailMarks", () => {
	it("keeps the inset at both ends and spaces by fraction between", () => {
		const marks = railMarks([
			tick({ id: "a", seq: 0 }),
			tick({ id: "b", seq: 1 }),
			tick({ id: "c", seq: 2 }),
		]);
		const placed = layoutRailMarks(marks, 300);
		expect(placed.map((entry) => entry.yPt)).toEqual([10, 150, 290]);
	});

	it("a mark with room to breathe draws its glyph; a crowded one draws the dash", () => {
		/* Two marks a full track apart hold glyphs; four marks packed where
		 * neighbours sit ~2 pt apart cannot — the density resolution. */
		const sparse = layoutRailMarks(
			railMarks([tick({ id: "a", seq: 0 }), tick({ id: "b", seq: 1 })]),
			300,
		);
		expect(sparse.map((entry) => entry.form)).toEqual(["glyph", "glyph"]);

		const dense = layoutRailMarks(
			railMarks(
				Array.from({ length: 100 }, (_, index) =>
					tick({ id: `t${index}`, seq: index }),
				),
			),
			300,
		);
		expect(dense.every((entry) => entry.form === "compact")).toBe(true);
		/* Positions stay faithful — monotone, never nudged off their seq. */
		const ys = dense.map((entry) => entry.yPt);
		expect(ys).toEqual([...ys].sort((a, b) => a - b));
	});

	it("no track measured yet places nothing anywhere", () => {
		const placed = layoutRailMarks(
			railMarks([tick({ id: "a", seq: 0 }), tick({ id: "b", seq: 100 })]),
			0,
		);
		/* Both marks collapse onto the inset line rather than leaving NaN. */
		expect(placed.map((entry) => entry.yPt)).toEqual([10, 10]);
	});
});

describe("railState", () => {
	it("no answer yet is `waiting`; a failed read with no manifest is `unavailable`", () => {
		expect(railState(null, false)).toEqual({ kind: "waiting" });
		expect(railState(null, true)).toEqual({ kind: "unavailable" });
	});

	it("ready with no ticks is `empty` — a claim, not a failure", () => {
		expect(railState(manifest(), false)).toEqual({ kind: "empty" });
	});

	it("ready with ticks is marks, not building", () => {
		const state = railState(
			manifest({
				checkpoints: [
					tick({ id: "a", seq: 0 }),
					tick({ id: "b", seq: 1, kind: "completion", outcome: "complete" }),
				],
			}),
			false,
		);
		expect(state.kind).toBe("marks");
		if (state.kind !== "marks") return;
		expect(state.building).toBe(false);
		expect(state.marks).toHaveLength(2);
	});

	it("building (and `stale`, its deliberate twin) paints the previous scan and keeps polling", () => {
		for (const state of ["building", "stale"] as const) {
			const answer = railState(
				manifest({
					index: { state, built_at: 1 },
					checkpoints: [tick({ id: "prev", seq: 0 })],
				}),
				false,
			);
			expect(answer.kind).toBe("marks");
			if (answer.kind !== "marks") return;
			expect(answer.building).toBe(true);
			expect(answer.marks.map((mark) => mark.id)).toEqual(["prev"]);
		}
	});

	it("a cold `building` with nothing previous still reads as building, not empty", () => {
		const answer = railState(
			manifest({ index: { state: "building", built_at: null } }),
			false,
		);
		expect(answer).toEqual({ kind: "marks", marks: [], building: true });
	});

	it("the relay's own `error` keeps its previous ticks and is NEVER `empty`", () => {
		const answer = railState(
			manifest({
				index: { state: "error", built_at: null },
				checkpoints: [tick({ id: "prev", seq: 0 })],
			}),
			false,
		);
		expect(answer.kind).toBe("error");
		if (answer.kind !== "error") return;
		expect(answer.marks.map((mark) => mark.id)).toEqual(["prev"]);
	});

	it("`unsupported` — a peer conversation, unreachable on this route — claims nothing", () => {
		expect(
			railState(
				manifest({ index: { state: "unsupported", built_at: null } }),
				false,
			),
		).toEqual({ kind: "unavailable" });
	});
});

describe("marksBeyondWindow", () => {
	it("is false when every mark is for a loaded row (and vacuously on none)", () => {
		const marks = railMarks([
			tick({ id: "a", seq: 0 }),
			tick({ id: "b", seq: 1 }),
		]);
		expect(marksBeyondWindow(marks, new Set(["a", "b"]))).toBe(false);
		expect(marksBeyondWindow([], new Set())).toBe(false);
	});

	it("is true when ANY mark is for a row this device does not hold", () => {
		const marks = railMarks([
			tick({ id: "old", seq: 0 }),
			tick({ id: "new", seq: 99 }),
		]);
		expect(marksBeyondWindow(marks, new Set(["new"]))).toBe(true);
	});
});
