import { describe, expect, it } from "vitest";

import type { TranscriptEntry } from "@/contracts";
import {
	barAccessibleName,
	barPhrases,
	condensePlan,
	HEADLINE_MAX_CHARS,
	parseExpandHook,
	transcriptTurns,
	turnHeadline,
	type CondensePlan,
	type LatchedTurn,
	type TurnBarFacts,
	type TurnView,
} from "@/features/session/turn-condensing";

/* ------------------------------------------------------------------ helpers */

/** One wire row, complete unless a case says otherwise — the fixtures' own
 *  shape (every row carries the full field set; the app never assumes a
 *  missing key). */
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

const user = (id: string, text = "do the thing") =>
	row({ id, kind: "user", text });

const tool = (id: string, elapsedS = 1) =>
	row({
		id,
		kind: "tool",
		tool_name: "bash",
		tool_state: "done",
		elapsed_s: elapsedS,
	});

const answer = (id: string, text = "done: the retry envelope is refactored") =>
	row({ id, kind: "assistant", text });

/** The answer while it is still being written: same id, growing text, flags
 *  false until the settle flips them (the relay's own update class). */
const streaming = (id: string, text: string) =>
	row({ id, kind: "assistant", text, final: false, text_complete: false });

const notice = (id: string, text: string) =>
	row({ id, kind: "notice", text, details: { severity: "error" } });

/**
 * The geometry a turn occupies, as the facts that decide it: the ids of the
 * items it contributes, in order; the ids it hides; and its bar's exact words
 * and numbers. This suite runs in Node, where nothing measures text — so the
 * invariant is pinned as the smallest fact that DECIDES a height, which is the
 * honest translation of "the geometry is stable" into a test that can fail.
 */
const geometryOf = (turn: TurnView): string =>
	[
		turn.itemIds.join(","),
		turn.hiddenIds.join(","),
		turn.bar === null
			? "no-bar"
			: `${turn.bar.steps}/${turn.bar.durationS}:${barPhrases(turn.bar).join("|")}`,
	].join(" /// ");

/** One pass over the frames, carrying the latch the way the list does. */
function drive(
	frames: readonly (readonly TranscriptEntry[])[],
): { plan: CondensePlan; frame: number }[] {
	let latch: ReadonlyMap<string, LatchedTurn> = new Map();
	return frames.map((entries, frame) => {
		const plan = condensePlan({ entries, expanded: new Set(), latch });
		latch = plan.latch;
		return { plan, frame };
	});
}

/* ------------------------------------------------------------------- turns */

describe("transcriptTurns", () => {
	it("opens a turn at every user row, with steers folded into the open turn", () => {
		const turns = transcriptTurns([
			user("u1"),
			streaming("a1", "working"),
			row({ id: "s1", kind: "steer", text: "also check the ledger" }),
			answer("a2"),
			user("u2"),
		]);
		expect(turns.map((turn) => [turn.key, turn.start, turn.end])).toEqual([
			["u1", 0, 3],
			["u2", 4, 4],
		]);
		expect(turns[0]?.opensWithUserRow).toBe(true);
	});

	it("keeps the rows the tail's head cut off as one segment", () => {
		const turns = transcriptTurns([
			answer("a0", "an answer from before the loaded window"),
			tool("t0"),
			user("u1"),
			answer("a1"),
		]);
		expect(turns.map((turn) => [turn.key, turn.opensWithUserRow])).toEqual([
			["a0", false],
			["u1", true],
		]);
	});

	it("returns nothing for an empty transcript", () => {
		expect(transcriptTurns([])).toEqual([]);
	});
});

/* ------------------------------------------------------------------ decision */

describe("the condense decision", () => {
	const planOf = (
		entries: TranscriptEntry[],
		expanded: ReadonlySet<string> = new Set(),
		latch: ReadonlyMap<string, LatchedTurn> = new Map(),
	) => condensePlan({ entries, expanded, latch });

	it("condenses a completed turn once a newer turn exists — and the bar replaces the work", () => {
		const plan = planOf([
			user("u1"),
			tool("t1", 2),
			tool("t2", 3),
			answer("a1"),
			user("u2"),
			tool("t3"),
		]);
		const [first, second] = plan.turns;
		expect(first?.condensed).toBe(true);
		expect(first?.bar).toEqual({ steps: 2, durationS: 5 });
		expect(first?.hiddenIds).toEqual(["t1", "t2"]);
		expect(second?.condensed).toBe(false);
		// The closing answer and everything after it stay visible; the work —
		// and only the work — is what the bar stands for.
		expect(plan.items.map((item) => item.id)).toEqual([
			"u1",
			"turn-bar-u1",
			"a1",
			"u2",
			"t3",
		]);
	});

	it("never condenses the active (last) turn, however complete it looks", () => {
		const plan = planOf([user("u1"), tool("t1"), answer("a1")]);
		expect(plan.turns[0]?.condensed).toBe(false);
		expect(
			plan.items.every((item) => item.kind === "entry"),
		).toBe(true);
	});

	it("does not condense a turn whose closing answer is unfinished, capped, or empty", () => {
		const settle = (closing: TranscriptEntry) =>
			planOf([user("u1"), tool("t1"), closing, user("u2")]);
		// Still streaming.
		expect(settle(streaming("a1", "half")).turns[0]?.condensed).toBe(false);
		// Settled but the representation is a transport-cap prefix.
		expect(
			settle(row({ id: "a1", kind: "assistant", text: "cut", text_complete: false }))
				.turns[0]?.condensed,
		).toBe(false);
		// Settled and complete but with no text: an empty answer is not an answer.
		expect(
			settle(row({ id: "a1", kind: "assistant", text: "" })).turns[0]
				?.condensed,
		).toBe(false);
		// A turn that ends on a notice (the death markers) has no closing answer.
		expect(settle(notice("n1", "Stopped with an error")).turns[0]?.condensed).toBe(
			false,
		);
	});

	it("does not condense when there is nothing to hide", () => {
		// A single exchange: the bar would have no rows behind it.
		const plan = planOf([user("u1"), answer("a1"), user("u2"), answer("a2")]);
		expect(plan.turns[0]?.condensed).toBe(false);
		expect(plan.items.map((item) => item.id)).toEqual(["u1", "a1", "u2", "a2"]);
	});

	it("keeps a head-cut segment open even when newer turns exist", () => {
		const plan = planOf([
			answer("a0", "older answer"),
			tool("t0"),
			user("u1"),
			tool("t1"),
			answer("a1"),
			user("u2"),
		]);
		const [head, , last] = plan.turns;
		expect(head?.condensed).toBe(false);
		expect(last?.condensed).toBe(false);
		// The whole head segment renders: nothing summarises a turn whose opening
		// the wire did not send.
		expect(plan.items.map((item) => item.id)).toEqual([
			"a0",
			"t0",
			"u1",
			"turn-bar-u1",
			"a1",
			"u2",
		]);
	});

	it("lets the reader open a bar, and restoring it returns the identical geometry", () => {
		const entries = [
			user("u1"),
			tool("t1", 2),
			answer("a1"),
			user("u2"),
			tool("t2"),
		];
		const closed = planOf(entries);
		const opened = planOf(entries, new Set(["u1"]));
		expect(opened.items.map((item) => item.id)).toEqual([
			"u1",
			"turn-bar-u1",
			"t1",
			"a1",
			"u2",
			"t2",
		]);
		// A fresh pass with no expansion — the state the reader returns to by
		// pressing the bar shut — reproduces the same turn exactly.
		expect(geometryOf(closed.turns[0] as TurnView)).toBe(
			geometryOf(planOf(entries).turns[0] as TurnView),
		);
	});
});

/* -------------------------------------------------------------------- latch */

describe("the latch: a condensed turn cannot be un-condensed by a frame", () => {
	it("survives a later frame that regresses the closing answer", () => {
		const settledFrames = [
			user("u1"),
			tool("t1", 2),
			answer("a1"),
			user("u2"),
		];
		const first = condensePlan({
			entries: settledFrames,
			expanded: new Set(),
			latch: new Map(),
		});
		expect(first.turns[0]?.condensed).toBe(true);

		// The transport-cap frame: the answer comes back as a prefix while
		// keeping its id (the caveat `completion-visibility.ts` records).
		const regressed = settledFrames.map((entry) =>
			entry.id === "a1"
				? { ...entry, text: "done: the retry", text_complete: false }
				: entry,
		);
		const after = condensePlan({
			entries: regressed,
			expanded: new Set(),
			latch: first.latch,
		});
		expect(after.turns[0]?.condensed).toBe(true);
		// The latch is what keeps it: without it the same frame would re-open
		// the turn — the proof that the latch is load-bearing.
		const withoutLatch = condensePlan({
			entries: regressed,
			expanded: new Set(),
			latch: new Map(),
		});
		expect(withoutLatch.turns[0]?.condensed).toBe(false);
	});

	it("freezes the bar's words at the condense moment", () => {
		const frames = [
			[user("u1"), tool("t1", 2), tool("t2", 3), answer("a1"), user("u2")],
			[
				user("u1"),
				tool("t1", 900),
				tool("t2", 3),
				answer("a1"),
				user("u2"),
				tool("t3"),
			],
		];
		const [first, second] = drive(frames);
		const before = first?.plan.turns[0] as TurnView;
		const after = second?.plan.turns[0] as TurnView;
		expect(before.bar).toEqual({ steps: 2, durationS: 5 });
		expect(after.bar).toEqual(before.bar);
		expect(barPhrases(after.bar as TurnBarFacts)).toEqual(
			barPhrases(before.bar as TurnBarFacts),
		);
	});
});

/* ------------------------------------------- the invariant this exists for */

/**
 * NO UN-CONDENSE JITTER.
 *
 * The requirement names it as the failure mode: once a turn is condensed it must
 * not expand, collapse, reflow or change height because new events arrived. The
 * sequence below is the update classes a live transcript actually produces —
 * rows appended into the last turn, the last turn's assistant row growing and
 * settling IN PLACE (same id), tool states flipping, and a new user row starting
 * the next turn — and after every frame the test checks, for every turn that has
 * ever condensed, that its geometry (the ids and order of the items it
 * contributes, the ids it hides, and the bar's exact copy) is identical to the
 * geometry it had when it first condensed.
 *
 * It also checks the decision's MONOTONICITY in both directions the requirement
 * names: a turn that was last when it settled does not condense at its own
 * completion (nothing pops the reader's anchor) — the only frame that condenses
 * it is the one where a NEWER turn starts; and no frame ever flips a condensed
 * turn back.
 */
describe("no un-condense jitter: a condensed turn's rendering is a constant of everything that comes later", () => {
	/* The frames. Turn 1 runs a tool and settles; turn 2 starts, streams,
	 * settles; turn 3 starts. The intermediate frames are the update classes a
	 * live transcript actually produces: rows appended into the last turn, the
	 * last turn's assistant row growing and settling IN PLACE (same id), a tool
	 * state flip — and, after turn 1 has condensed, a frame that regresses its
	 * closing answer (the transport-cap class) and moves its hidden clock. */
	const frames: TranscriptEntry[][] = [
		[user("u1", "Refactor the retry envelope")],
		[
			user("u1", "Refactor the retry envelope"),
			streaming("a1", "scanning shard 1"),
		],
		[
			user("u1", "Refactor the retry envelope"),
			row({ id: "t1", kind: "tool", tool_name: "bash", tool_state: "running" }),
			streaming("a1", "scanning shard 1\nshard 2 clean"),
		],
		[
			user("u1", "Refactor the retry envelope"),
			tool("t1", 2),
			streaming("a1", "scanning shard 1\nshard 2 clean"),
		],
		// Turn 1 settles; it is still the last turn — nothing may condense yet.
		[
			user("u1", "Refactor the retry envelope"),
			tool("t1", 2),
			answer("a1", "scanning shard 1\nshard 2 clean\n3 edits applied"),
		],
		// A new turn starts: THIS is the frame that may condense turn 1.
		[
			user("u1", "Refactor the retry envelope"),
			tool("t1", 2),
			answer("a1", "scanning shard 1\nshard 2 clean\n3 edits applied"),
			user("u2", "Now add the backoff"),
		],
		[
			user("u1", "Refactor the retry envelope"),
			tool("t1", 2),
			answer("a1", "scanning shard 1\nshard 2 clean\n3 edits applied"),
			user("u2", "Now add the backoff"),
			streaming("a2", "adding jitter"),
		],
		[
			user("u1", "Refactor the retry envelope"),
			tool("t1", 2),
			answer("a1", "scanning shard 1\nshard 2 clean\n3 edits applied"),
			user("u2", "Now add the backoff"),
			tool("t2", 4),
			answer("a2", "adding jitter\nbackoff written"),
		],
		// The adversarial frame: turn 1's closing answer regresses to a prefix
		// (the transport-cap class) while its hidden row's clock also moves.
		[
			user("u1", "Refactor the retry envelope"),
			tool("t1", 900),
			row({ id: "a1", kind: "assistant", text: "scanning shard", text_complete: false }),
			user("u2", "Now add the backoff"),
			tool("t2", 4),
			answer("a2", "adding jitter\nbackoff written"),
		],
		// Turn 3 starts: turn 2 may condense; everything earlier is unchanged.
		[
			user("u1", "Refactor the retry envelope"),
			tool("t1", 900),
			row({ id: "a1", kind: "assistant", text: "scanning shard", text_complete: false }),
			user("u2", "Now add the backoff"),
			tool("t2", 4),
			answer("a2", "adding jitter\nbackoff written"),
			user("u3", "And a test for it"),
		],
	];

	const passes = drive(frames);

	it("condenses a turn at the frame a newer turn starts — never at its own completion", () => {
		const firstCondensedFrame = new Map<string, number>();
		passes.forEach(({ plan, frame }) => {
			for (const turn of plan.turns) {
				if (turn.condensed && !firstCondensedFrame.has(turn.key)) {
					firstCondensedFrame.set(turn.key, frame);
				}
			}
		});
		// Turn 1 first condenses at frame 5 (u2's arrival), NOT at its settle
		// (frame 4) — the completion itself pops nothing.
		expect(firstCondensedFrame.get("u1")).toBe(5);
		expect(firstCondensedFrame.get("u2")).toBe(9);
		// And never the active turn, at any frame.
		for (const { plan, frame } of passes) {
			const active = plan.turns[plan.turns.length - 1] as TurnView;
			expect(
				active.condensed,
				`frame ${frame}: the active turn was condensed`,
			).toBe(false);
		}
	});

	it("never un-condenses a turn, and never changes its geometry after it condensed", () => {
		// The geometry each turn had when it FIRST condensed...
		const settled = new Map<string, string>();
		// ...and every geometry recorded since, which must all be identical.
		const history = new Map<string, { frame: number; geometry: string }[]>();

		passes.forEach(({ plan, frame }) => {
			for (const turn of plan.turns) {
				const geometry = geometryOf(turn);
				if (!turn.condensed) {
					// Monotonicity: a turn the latch had already condensed must
					// not render un-condensed in any later frame.
					expect(
						settled.has(turn.key),
						`frame ${frame}: ${turn.key} un-condensed`,
					).toBe(false);
					continue;
				}
				if (!settled.has(turn.key)) {
					settled.set(turn.key, geometry);
					history.set(turn.key, []);
				}
				(history.get(turn.key) as { frame: number; geometry: string }[]).push({
					frame,
					geometry,
				});
			}
		});

		// Two turns condensed over the sequence; every frame after each one's
		// first condense carries the SAME geometry — including across the
		// adversarial regression frame.
		expect([...settled.keys()].sort()).toEqual(["u1", "u2"]);
		for (const [key, first] of settled) {
			for (const seen of history.get(key) as {
				frame: number;
				geometry: string;
			}[]) {
				expect(seen.geometry, `${key} changed at frame ${seen.frame}`).toBe(
					first,
				);
			}
		}
	});
});

/* --------------------------------------------------------------- copy, hook */

describe("the bar's copy", () => {
	it("spells the completion, the step count and the tool seconds, omitting zero clauses", () => {
		expect(barPhrases({ steps: 38, durationS: 42 })).toEqual([
			"completed",
			"38 steps",
			"42s",
		]);
		expect(barPhrases({ steps: 1, durationS: 0.4 })).toEqual([
			"completed",
			"1 step",
		]);
		expect(barPhrases({ steps: 0, durationS: 124 })).toEqual([
			"completed",
			"2m 04s",
		]);
	});

	it("names the turn and the completion in the accessible name", () => {
		expect(
			barAccessibleName({ steps: 3, durationS: 65 }, "Refactor the retry"),
		).toBe('Turn "Refactor the retry": completed, 3 steps, 1m 05s');
		expect(barAccessibleName({ steps: 0, durationS: 0 }, "")).toBe(
			"Turn: completed",
		);
	});

	it("takes the headline from the first non-empty line and caps it", () => {
		expect(turnHeadline("\n\n  first line \nsecond")).toBe("first line");
		expect(turnHeadline("")).toBe("");
		const long = "x".repeat(HEADLINE_MAX_CHARS + 10);
		expect(turnHeadline(long)).toHaveLength(HEADLINE_MAX_CHARS);
		expect(turnHeadline(long).endsWith("…")).toBe(true);
	});
});

describe("parseExpandHook", () => {
	it("reads a comma-separated key list, trimming and dropping empties", () => {
		expect([...parseExpandHook("u1, u2 ,,u3")]).toEqual(["u1", "u2", "u3"]);
		expect([...parseExpandHook(null)]).toEqual([]);
		expect([...parseExpandHook("")]).toEqual([]);
	});
});
