import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { TranscriptEntry } from "@/contracts";
import {
	barAccessibleName,
	barPhrases,
	type CondensePlan,
	condensePlan,
	groupAccessibleName,
	groupPhrases,
	groupPlan,
	HEADLINE_MAX_CHARS,
	type LatchedTurn,
	parseExpandHook,
	type QuietGroup,
	quietGroupOfSpan,
	quietGroupsOf,
	type TranscriptItem,
	type TurnBarFacts,
	type TurnView,
	transcriptTurns,
	turnHeadline,
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

/** One inbound peer receipt, with an optional named sender. */
const peer = (id: string, sender?: string) =>
	row({
		id,
		kind: "peer_message",
		text: "a peer note",
		details:
			sender === undefined ? {} : { sender: { conversation_name: sender } },
	});

/** The quiet-turn tool's own row, as the wire would carry it if the relay's
 *  fold did not hide the pair (`local-operator` S1 hides it on this route;
 *  the shared fixture still pins its exclusion from the action count). */
const quietTool = (id: string) =>
	row({ id, kind: "tool", tool_name: "no_reply" });

const failedTool = (id: string) =>
	row({ id, kind: "tool", tool_name: "read", tool_state: "failed" });

/** One wire row as the list's item. */
const itemOf = (entry: TranscriptEntry): TranscriptItem => ({
	kind: "entry",
	id: entry.id,
	entry,
});

const itemsOf = (entries: readonly TranscriptEntry[]): TranscriptItem[] =>
	entries.map(itemOf);

/** One group's facts, complete unless a case says otherwise. */
const groupOf = (over: Partial<QuietGroup>): QuietGroup => ({
	key: "qg:p1",
	count: 2,
	senders: [],
	actions: 0,
	failed: 0,
	open: true,
	rowIds: ["p1", "p2"],
	...over,
});

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
		expect(plan.items.every((item) => item.kind === "entry")).toBe(true);
	});

	it("does not condense a turn whose closing answer is unfinished, capped, or empty", () => {
		const settle = (closing: TranscriptEntry) =>
			planOf([user("u1"), tool("t1"), closing, user("u2")]);
		// Still streaming.
		expect(settle(streaming("a1", "half")).turns[0]?.condensed).toBe(false);
		// Settled but the representation is a transport-cap prefix.
		expect(
			settle(
				row({ id: "a1", kind: "assistant", text: "cut", text_complete: false }),
			).turns[0]?.condensed,
		).toBe(false);
		// Settled and complete but with no text: an empty answer is not an answer.
		expect(
			settle(row({ id: "a1", kind: "assistant", text: "" })).turns[0]
				?.condensed,
		).toBe(false);
		// A turn that ends on a notice (the death markers) has no closing answer.
		expect(
			settle(notice("n1", "Stopped with an error")).turns[0]?.condensed,
		).toBe(false);
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
		const settledFrames = [user("u1"), tool("t1", 2), answer("a1"), user("u2")];
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

	it("stays condensed when the window has slid past the span AND the closing answer", () => {
		const settled = [
			user("u1"),
			tool("t1", 2),
			answer("a1"),
			user("u2"),
			tool("t2"),
		];
		const first = condensePlan({
			entries: settled,
			expanded: new Set(),
			latch: new Map(),
		});
		expect(first.turns[0]?.condensed).toBe(true);

		// The relay's window has slid on: the closing row, the span and everything
		// between the pinned opener and the newest rows are gone, and THIS frame's
		// own scan can no longer find a closing answer for u1 (it ends on a tool
		// row). The latch — not the frame — is what keeps the bar.
		const slid = [user("u1"), tool("t9", 4), user("u3")];
		const after = condensePlan({
			entries: slid,
			expanded: new Set(),
			latch: first.latch,
		});
		const turn = after.turns.find((view) => view.key === "u1");
		expect(turn?.condensed).toBe(true);
		expect(turn?.bar).toEqual({ steps: 1, durationS: 2 });
		expect(turn?.hiddenIds).toEqual(["t1"]);
		// The rows the collapse does not stand for render normally, bar first.
		expect(after.items.map((item) => item.id)).toEqual([
			"u1",
			"turn-bar-u1",
			"t9",
			"u3",
		]);
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
			row({
				id: "a1",
				kind: "assistant",
				text: "scanning shard",
				text_complete: false,
			}),
			user("u2", "Now add the backoff"),
			tool("t2", 4),
			answer("a2", "adding jitter\nbackoff written"),
		],
		// Turn 3 starts: turn 2 may condense; everything earlier is unchanged.
		[
			user("u1", "Refactor the retry envelope"),
			tool("t1", 900),
			row({
				id: "a1",
				kind: "assistant",
				text: "scanning shard",
				text_complete: false,
			}),
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

/* ------------------------------------------- the relay's real frame shape ---- */

/**
 * THE CAP-SHAPED DRIVE — the wire the app actually receives is a WINDOW, and
 * the latch has to own the render.
 *
 * Every drive above feeds append-only, contiguous lists: no frame ever drops a
 * row. The relay's projection does — `mobile/projection.py::_cap_tail` serves
 * `[first_user_row, ...newest 79]` past `PROJECTION_TRANSCRIPT_LIMIT` (80), so a
 * long session's frames are not the transcript: the pinned turn's key survives
 * every frame while the rows its collapse stands for — and eventually the
 * closing answer itself — slide out of the window. That sequence is what this
 * drive reproduces, and it is the one that broke the module before the latch
 * froze the span: f8 condensed → f9 re-opened (the closing row had slid out, so
 * the frame's `hiddenIds` was empty) → f15 re-condensed around a different
 * 78-row chunk of the window, with the bar still reading the old numbers.
 *
 * Asserted, per frame, for the fixture's latched turns (`u00`, `u12`):
 *
 *   1. `condensed` stays true, the bar item stays in the list, and the bar's
 *      facts stay byte-equal — the bar cannot leave, and its words are frozen;
 *   2. the span the collapse stands for is frozen with the latch: the latch's
 *      `hiddenIds` and the view's are the same list on every later frame, even
 *      one that no longer carries those rows;
 *   3. the rows hidden on screen are exactly the union of the frozen spans of
 *      the latched turns this frame still carries (∩ the frame) — a bar never
 *      swallows rows that were not its own, and a row it stands for does not
 *      re-appear while it is present. (The one allowed reveal: when a MIDDLE
 *      turn's opener leaves the window, the wire has dropped the only row that
 *      could say whose rows those were — no bar is left to stand for them — and
 *      the head-cut rule is "leave visible".)
 *   4. the pinning rule holds under the same slide: no turn is ever FIRST
 *      condensed while it is the active (last) one, and no row goes
 *      visible → hidden except into a collapse that formed in that same step —
 *      a completing turn must not pop the view, and `a13`'s arrival at f15
 *      must leave every pre-existing row where it was.
 */

const CAP_LIMIT = 80;

/** Mirrors `ProjectionFold._cap_tail` (`local-operator/mobile/projection.py`):
 *  past the cap, the first user row is pinned at the head and the rest is the
 *  newest `LIMIT - 1` rows (dropping the oldest of the tail, never the newest). */
const capTail = (entries: readonly TranscriptEntry[]): TranscriptEntry[] => {
	if (entries.length <= CAP_LIMIT) return entries.slice();
	const tail = entries.slice(-CAP_LIMIT);
	const firstUser = entries.find((entry) => entry.kind === "user");
	if (firstUser !== undefined && !tail.includes(firstUser)) {
		return [firstUser, ...tail.slice(1)];
	}
	return tail;
};

describe("the cap-shaped drive: a latched turn's render is a function of the latch", () => {
	/* The fixture: 13 turns of 40 rows (user + 38 tools + answer = 520 rows), then
	 * the 14th turn's rows arriving in the batches a live stream produces. */
	const live: TranscriptEntry[] = [];
	for (let turn = 0; turn < 13; turn += 1) {
		const at = String(turn).padStart(2, "0");
		live.push(user(`u${at}`, `prompt ${turn}`));
		for (let i = 0; i < 38; i += 1) {
			live.push(tool(`t${at}-${String(i).padStart(2, "0")}`));
		}
		live.push(answer(`a${at}`, `done ${turn}`));
	}
	const frames: TranscriptEntry[][] = [];
	const snap = () => frames.push(capTail(live));
	snap(); // f0 — the session as seeded (already past the cap)
	live.push(user("u13", "prompt 13"));
	snap(); // f1 — a newer turn opens: turn u12 may condense
	for (let i = 0; i < 130; i += 1) {
		live.push(tool(`t13-${String(i).padStart(3, "0")}`));
		if (i % 10 === 9) snap(); // f2..f14 — the window slides under the newer turn
	}
	live.push(answer("a13", "done 13"));
	snap(); // f15 — the closing answer arrives into a window that has slid
	live.push(user("u14", "prompt 14"));
	snap(); // f16
	for (let i = 0; i < 10; i += 1) live.push(tool(`t14-${i}`));
	snap(); // f17

	let latch: ReadonlyMap<string, LatchedTurn> = new Map();
	const passes = frames.map((entries, frame) => {
		const plan = condensePlan({ entries, expanded: new Set(), latch });
		latch = plan.latch;
		return { plan, frame, frameIds: entries.map((entry) => entry.id) };
	});
	const firstCondensed = new Map<string, number>();
	for (const { plan, frame } of passes) {
		for (const turn of plan.turns) {
			if (turn.condensed && !firstCondensed.has(turn.key)) {
				firstCondensed.set(turn.key, frame);
			}
		}
	}
	const renderedIds = (plan: CondensePlan): Set<string> =>
		new Set(
			plan.items.filter((item) => item.kind === "entry").map((item) => item.id),
		);

	/** The ids between two rows OF A GIVEN FRAME — derived from the fixture, so
	 *  the expectations below never consult the module. */
	const spanBetween = (
		frame: number,
		openId: string,
		closeId: string,
	): string[] => {
		const entries = frames[frame] ?? [];
		const open = entries.findIndex((entry) => entry.id === openId);
		const close = entries.findIndex((entry) => entry.id === closeId);
		return entries.slice(open + 1, close).map((entry) => entry.id);
	};
	/** The fixture's latched turns and the span each froze with: `u00` condensed
	 *  on f0 around the rows between itself and `a11` (the frame's last completed
	 *  answer); `u12` on f1 around the rows between itself and `a12`. */
	const frozenSpans = new Map<string, string[]>([
		["u00", spanBetween(0, "u00", "a11")],
		["u12", spanBetween(1, "u12", "a12")],
	]);

	it("is the wire the relay sends: every frame caps at 80 with the opener pinned", () => {
		expect(frozenSpans.get("u00")).toHaveLength(38);
		expect(frozenSpans.get("u12")).toHaveLength(38);
		for (const [index, entries] of frames.entries()) {
			expect(entries, `f${index}`).toHaveLength(CAP_LIMIT);
			expect(entries[0]?.id, `f${index}: opener not pinned`).toBe("u00");
		}
		// The middle really is missing: the frame's second row is not the second
		// row of the transcript (`t00-00`) — it is whatever the tail window starts on.
		expect(frames[0]?.[1]?.id).not.toBe("t00-00");
	});

	it("keeps a condensed turn condensed, with its bar and words, across every later frame", () => {
		const firstU00 = passes.find(({ plan }) =>
			plan.turns.some((turn) => turn.key === "u00" && turn.condensed),
		);
		const firstU12 = passes.find(({ plan }) =>
			plan.turns.some((turn) => turn.key === "u12" && turn.condensed),
		);
		const factsU00 =
			firstU00?.plan.turns.find((turn) => turn.key === "u00")?.bar ?? null;
		const factsU12 =
			firstU12?.plan.turns.find((turn) => turn.key === "u12")?.bar ?? null;
		expect(factsU00).toEqual({ steps: 38, durationS: 38 });
		expect(factsU12).toEqual({ steps: 38, durationS: 38 });

		for (const { frame, plan } of passes) {
			const turn = plan.turns.find((view) => view.key === "u00");
			expect(
				turn,
				`f${frame}: u00 is pinned and must never leave the frame`,
			).toBeDefined();
			if (turn === undefined) continue;
			expect(turn.condensed, `f${frame}: u00 re-opened`).toBe(true);
			expect(turn.bar, `f${frame}: u00 lost its bar`).toEqual(factsU00);
			const bar = plan.items.find(
				(item) => item.kind === "bar" && item.turnKey === "u00",
			);
			expect(bar, `f${frame}: u00's bar item left the list`).toBeDefined();
			if (bar !== undefined && bar.kind === "bar") {
				expect(bar.facts, `f${frame}: u00's bar words moved`).toEqual(factsU00);
			}
		}
		for (const { frame, plan } of passes) {
			const turn = plan.turns.find((view) => view.key === "u12");
			if (turn === undefined || frame < 1) continue; // absent, or not yet condensed
			expect(turn.condensed, `f${frame}: u12 re-opened`).toBe(true);
			expect(turn.bar, `f${frame}: u12 lost its bar`).toEqual(factsU12);
			const bar = plan.items.find(
				(item) => item.kind === "bar" && item.turnKey === "u12",
			);
			expect(bar, `f${frame}: u12's bar item left the list`).toBeDefined();
		}
	});

	it("freezes the span with the latch: hiddenIds is the collapse's own list on every later frame", () => {
		for (const { plan, frame } of passes) {
			for (const [key, span] of frozenSpans) {
				const first = firstCondensed.get(key);
				if (first === undefined || frame < first) continue;
				expect(
					plan.latch.get(key)?.hiddenIds,
					`f${frame}: ${key}'s latch span`,
				).toEqual(span);
				const turn = plan.turns.find((view) => view.key === key);
				if (turn !== undefined) {
					expect(turn.hiddenIds, `f${frame}: ${key}'s view span`).toEqual(span);
				}
			}
		}
	});

	it("hides on screen exactly the frozen spans it still carries — and nothing else", () => {
		for (const { plan, frame, frameIds } of passes) {
			const rendered = renderedIds(plan);
			const hidden = frameIds.filter((id) => !rendered.has(id)).sort();
			const expected = new Set<string>();
			for (const turn of plan.turns) {
				const span = frozenSpans.get(turn.key);
				const first = firstCondensed.get(turn.key);
				if (span === undefined || first === undefined || frame < first)
					continue;
				for (const id of span) if (frameIds.includes(id)) expected.add(id);
			}
			expect(hidden, `f${frame}: hidden rows on screen`).toEqual(
				[...expected].sort(),
			);
		}
	});

	it("never moves a visible row behind a bar except into a collapse forming that step", () => {
		for (let i = 1; i < passes.length; i += 1) {
			const before = passes[i - 1];
			const after = passes[i];
			if (before === undefined || after === undefined) continue;
			const renderedBefore = renderedIds(before.plan);
			const renderedAfter = renderedIds(after.plan);
			const newlyHidden = after.frameIds.filter(
				(id) => renderedBefore.has(id) && !renderedAfter.has(id),
			);
			// A row may go behind a bar only as part of a collapse formed at this
			// very step — the turn's own first condensation. (u12's arrival as a
			// newer turn at f1 is the only such event besides u00's at f0.)
			const freshHere = new Set<string>();
			for (const [key, first] of firstCondensed) {
				if (first !== after.frame) continue;
				const turn = after.plan.turns.find((view) => view.key === key);
				for (const id of turn?.hiddenIds ?? []) freshHere.add(id);
			}
			const unexplained = newlyHidden.filter((id) => !freshHere.has(id));
			expect(
				unexplained,
				`f${before.frame}->f${after.frame}: rows hidden without a fresh collapse`,
			).toEqual([]);
		}
	});

	it("still never condenses the active turn first, while rows are being dropped", () => {
		for (const [key, frame] of firstCondensed) {
			const turns = passes[frame]?.plan.turns ?? [];
			expect(
				turns[turns.length - 1]?.key,
				`f${frame}: ${key} first condensed while active`,
			).not.toBe(key);
		}
		// And the active turn renders open on every frame it was never latched on
		// (the documented invariant-2 exception is a turn the latch already holds).
		for (const { plan, frame } of passes) {
			const last = plan.turns[plan.turns.length - 1];
			if (last === undefined) continue;
			const latchedBefore =
				(firstCondensed.get(last.key) ?? Number.POSITIVE_INFINITY) < frame;
			if (latchedBefore) continue;
			expect(last.condensed, `f${frame}: active turn condensed`).toBe(false);
		}
	});
});

/* --------------------------------------------------------------- the group */

describe("quietGroupsOf — the derivation", () => {
	it("folds consecutive receipts and counts only the work between them", () => {
		const items = itemsOf([
			peer("p1", "ingest-rail"),
			tool("t1", 3),
			quietTool("q1"),
			peer("p2", "hermes"),
			failedTool("t2"),
			quietTool("q2"),
		]);
		expect(quietGroupsOf(items)).toEqual([
			{
				key: "qg:p1",
				count: 2,
				senders: [
					{ label: "ingest-rail", count: 1 },
					{ label: "hermes", count: 1 },
				],
				actions: 2,
				failed: 1,
				open: true,
				rowIds: ["p1", "t1", "q1", "p2", "t2", "q2"],
			},
		]);
	});

	it("one receipt is not a group", () => {
		expect(
			quietGroupsOf(itemsOf([peer("p1"), tool("t1"), quietTool("q1")])),
		).toEqual([]);
	});

	it("ends a run at a steer, a notice or a compaction statement", () => {
		const split = (middle: TranscriptEntry) =>
			quietGroupsOf(
				itemsOf([peer("p1"), peer("p2"), middle, peer("p3"), peer("p4")]),
			).map((group) => group.key);
		expect(
			split(row({ id: "s1", kind: "steer", text: "also the ledger" })),
		).toEqual(["qg:p1", "qg:p3"]);
		expect(split(notice("n1", "Interrupted"))).toEqual(["qg:p1", "qg:p3"]);
		expect(
			split(row({ id: "c1", kind: "compaction", text: "Context compacted" })),
		).toEqual(["qg:p1", "qg:p3"]);
		// Visible assistant text splits; a textless assistant row sits inside.
		expect(split(answer("a1", "on it"))).toEqual(["qg:p1", "qg:p3"]);
		const inside = quietGroupsOf(
			itemsOf([
				peer("p1"),
				row({ id: "a1", kind: "assistant", text: "" }),
				peer("p2"),
			]),
		);
		expect(inside).toHaveLength(1);
		expect(inside[0]?.rowIds).toEqual(["p1", "a1", "p2"]);
	});

	it("summarizes the top two senders, then one `N more` entry", () => {
		const groups = quietGroupsOf(
			itemsOf([
				peer("p1", "alpha"),
				peer("p2", "alpha"),
				peer("p3", "alpha"),
				peer("p4", "beta"),
				peer("p5", "beta"),
				peer("p6", "gamma"),
				peer("p7", "delta"),
			]),
		);
		expect(groups[0]?.senders).toEqual([
			{ label: "alpha", count: 3 },
			{ label: "beta", count: 2 },
			{ label: "2 more", count: 2 },
		]);
	});

	it("refuses a span that is not the whole group", () => {
		const items = itemsOf([
			peer("p1"),
			tool("t1"),
			quietTool("q1"),
			peer("p2"),
		]);
		expect(quietGroupOfSpan(items, { from: 0, to: 3 })).not.toBeNull();
		// A sub-span of a wider stretch, and a slice through one, both refuse:
		// a bar states a whole group, never a fragment of one.
		expect(quietGroupOfSpan(items, { from: 1, to: 2 })).toBeNull();
		expect(quietGroupOfSpan(items, { from: 0, to: 1 })).toBeNull();
	});

	it("keeps an unknown row kind as a boundary, never a hideable passenger", () => {
		// The wire's kind union is open; a row this build does not know must
		// not vanish inside a bar that cannot mention it.
		const groups = quietGroupsOf(
			itemsOf([
				peer("p1"),
				row({ id: "x1", kind: "future_kind", text: "?" }),
				peer("p2"),
			]),
		);
		expect(groups).toEqual([]);
	});
});

describe("groupPlan — the fold the list renders", () => {
	it("folds in the ACTIVE turn — the one turn condensing may never touch", () => {
		const entries = [user("u1"), peer("p1"), peer("p2"), tool("t1")];
		const plan = condensePlan({
			entries,
			expanded: new Set(),
			latch: new Map(),
		});
		expect(plan.turns[0]?.condensed).toBe(false);
		const grouped = groupPlan({
			items: plan.items,
			expanded: new Set(),
			latch: new Map(),
		});
		expect(grouped.items.map((item) => item.id)).toEqual([
			"u1",
			"quiet-group-qg:p1",
		]);
		// The whole stretch is what the bar stands for: the receipts AND the
		// tool row they sit beside.
		expect(grouped.groups[0]).toMatchObject({
			key: "qg:p1",
			hiddenIds: ["p1", "p2", "t1"],
		});
	});

	it("leaves the rows behind a turn's bar to the turn, and folds what stays visible", () => {
		const entries = [
			user("u1"),
			tool("t1"),
			answer("a1"),
			user("u2"),
			peer("p1"),
			peer("p2"),
		];
		const plan = condensePlan({
			entries,
			expanded: new Set(),
			latch: new Map(),
		});
		expect(plan.turns[0]?.condensed).toBe(true);
		const grouped = groupPlan({
			items: plan.items,
			expanded: new Set(),
			latch: new Map(),
		});
		expect(grouped.groups.map((group) => group.key)).toEqual(["qg:p1"]);
		expect(grouped.items.map((item) => item.id)).toEqual([
			"u1",
			"turn-bar-u1",
			"a1",
			"u2",
			"quiet-group-qg:p1",
		]);
	});

	it("puts the member rows back when the reader opens the group", () => {
		const entries = [user("u1"), peer("p1"), peer("p2")];
		const plan = condensePlan({
			entries,
			expanded: new Set(),
			latch: new Map(),
		});
		const grouped = groupPlan({
			items: plan.items,
			expanded: new Set(["qg:p1"]),
			latch: new Map(),
		});
		expect(grouped.items.map((item) => item.id)).toEqual([
			"u1",
			"quiet-group-qg:p1",
			"p1",
			"p2",
		]);
	});

	it("folds the receipts a reader opens behind a turn's bar too", () => {
		const entries = [
			user("u1"),
			peer("p1"),
			peer("p2"),
			answer("a1"),
			user("u2"),
			tool("t1"),
		];
		const plan = condensePlan({
			entries,
			expanded: new Set(["u1"]),
			latch: new Map(),
		});
		const grouped = groupPlan({
			items: plan.items,
			expanded: new Set(["u1"]),
			latch: new Map(),
		});
		// The turn is open, so its receipts are visible rows — and visible
		// receipts fold, wherever they came from.
		expect(grouped.items.map((item) => item.id)).toEqual([
			"u1",
			"turn-bar-u1",
			"quiet-group-qg:p1",
			"a1",
			"u2",
			"t1",
		]);
	});
});

describe("the group latch — facts freeze at the close", () => {
	it("derives twice identically, latch included", () => {
		const items = itemsOf([
			user("u1"),
			peer("p1"),
			peer("p2"),
			answer("a1"),
			user("u2"),
		]);
		const first = groupPlan({ items, expanded: new Set(), latch: new Map() });
		const second = groupPlan({
			items,
			expanded: new Set(),
			latch: first.latch,
		});
		expect(second.items).toEqual(first.items);
		expect(second.groups).toEqual(first.groups);
		expect([...second.latch]).toEqual([...first.latch]);
	});

	it("grows the open tail group in place — same bar, count up, expansion kept", () => {
		const frame = (count: number) =>
			itemsOf([
				user("u1"),
				...Array.from({ length: count }, (_, index) => peer(`p${index + 1}`)),
			]);
		const one = groupPlan({
			items: frame(1),
			expanded: new Set(),
			latch: new Map(),
		});
		expect(one.groups).toEqual([]);
		const two = groupPlan({
			items: frame(2),
			expanded: new Set(),
			latch: one.latch,
		});
		const barId = two.groups[0]?.itemIds[0];
		expect(barId).toBe("quiet-group-qg:p1");
		expect(two.groups[0]?.group.count).toBe(2);
		const three = groupPlan({
			items: frame(3),
			expanded: new Set(["qg:p1"]),
			latch: two.latch,
		});
		// The bar element and its key do not move, the count updates in place,
		// and the reader's expansion survives the append — the same frame the
		// members grow in.
		expect(three.groups[0]?.itemIds[0]).toBe(barId);
		expect(three.groups[0]?.group.count).toBe(3);
		expect(three.groups[0]?.itemIds).toEqual([barId, "p1", "p2", "p3"]);
		// A group that has never closed is never latched.
		expect(three.latch.size).toBe(0);
	});

	it("freezes a closed group's facts — a later frame cannot move them", () => {
		const closed = itemsOf([peer("p1"), tool("t1"), peer("p2"), answer("a1")]);
		const first = groupPlan({
			items: closed,
			expanded: new Set(),
			latch: new Map(),
		});
		expect(first.groups[0]?.group.failed).toBe(0);
		// The transport-cap class: a row inside the group comes back changed.
		const regressed = closed.map((item) =>
			item.kind === "entry" && item.id === "t1" && item.entry.kind === "tool"
				? itemOf({ ...item.entry, tool_state: "failed" })
				: item,
		);
		const after = groupPlan({
			items: regressed,
			expanded: new Set(),
			latch: first.latch,
		});
		expect(after.groups[0]?.group.failed).toBe(0);
		// Without the latch the same frame WOULD count the failure — the proof
		// the freeze is load-bearing.
		const unlatch = groupPlan({
			items: regressed,
			expanded: new Set(),
			latch: new Map(),
		});
		expect(unlatch.groups[0]?.group.failed).toBe(1);
	});

	it("keeps a closed group's identity when the window slides its head away", () => {
		const full = itemsOf([peer("p1"), peer("p2"), answer("a1")]);
		const first = groupPlan({
			items: full,
			expanded: new Set(),
			latch: new Map(),
		});
		expect(first.groups[0]?.key).toBe("qg:p1");
		const slid = groupPlan({
			items: itemsOf([peer("p2"), answer("a1")]),
			expanded: new Set(),
			latch: first.latch,
		});
		// Same bar, frozen facts: the surviving member answers with the latch's
		// key, not a new group minted around a fragment.
		expect(slid.groups[0]?.key).toBe("qg:p1");
		expect(slid.groups[0]?.group.count).toBe(2);
		expect(slid.groups[0]?.hiddenIds).toEqual(["p1", "p2"]);
		expect(slid.items.map((item) => item.id)).toEqual([
			"quiet-group-qg:p1",
			"a1",
		]);
	});
});

describe("the group bar's copy", () => {
	it("states the fold and its count, and names the senders", () => {
		expect(groupPhrases(groupOf({ count: 12 }))).toEqual([
			"Peer messages",
			"12",
		]);
		const withSenders = groupOf({
			count: 12,
			senders: [
				{ label: "alpha", count: 3 },
				{ label: "2 more", count: 2 },
			],
		});
		expect(groupAccessibleName(withSenders)).toBe(
			"Peer messages: 12, from alpha, 2 more",
		);
		expect(groupAccessibleName(groupOf({ count: 2 }))).toBe("Peer messages: 2");
	});
});

/* ----------------------------------------------- the shared parity fixture */

/**
 * THE SHARED QUIET-GROUP PARITY FIXTURE, case by case
 * (`fixtures/quiet-groups.parity.json`, copied from local-operator-ui's S2
 * branch; the file's own header is the contract).
 *
 * WHAT IS COMPARED. Every case's rows are mapped onto this wire's entries and
 * driven through the same entry points the UI's suite drives: `quietGroupOfSpan`
 * for the span cases, `quietGroupsOf` for the rest. The expected value is the
 * fixture's own, mapped onto this client's spelling in exactly TWO ways, both
 * forced by the wire, never by convenience:
 *
 *   1. NO TIMES. The mobile wire carries no timestamps on this route, so the
 *      native group has no time fields and the comparison drops the fixture's
 *      `firstTs`/`lastTs`.
 *   2. THE NATIVE IDENTITY LADDER'S SPELLING. The fixture spells a named
 *      sender with the UI's quoting (`"alpha"`); this app's ladder — the
 *      same label the receipt row itself prints — spells it unquoted. The
 *      mapping strips the UI's quotes; "another session" (and `N more`) pass
 *      through untouched.
 *
 * WHAT IS NAMED, NOT SKIPPED. Cases whose EXPECTED group needs a delivery
 * kind this wire does not carry as a receipt — wake / monitor / job rows (all
 * three arrive as `notice` lines here, not as receipt kinds) — cannot produce
 * that group from the native definition
 * (design §5's native bullet: the consecutive `peer_message` run). Those cases
 * are pinned as their wire-boundary outcome with the reason, so the difference
 * is a recorded boundary rather than silent drift.
 */
interface ParityRow {
	kind: string;
	id: string;
	ts?: number;
	text?: string;
	body?: string;
	sender?: { conversationName?: string };
	customType?: string;
	level?: string;
	toolName?: string;
	phase?: string;
	isError?: boolean;
	complete?: boolean;
	durationS?: number;
}

interface ParityGroup {
	key: string;
	family: string;
	count: number;
	firstTs: number | null;
	lastTs: number | null;
	senders: { label: string; count: number }[];
	actions: number;
	failed: number;
	open: boolean;
	rowIds: string[];
}

interface ParityCase {
	name: string;
	span?: [number, number];
	spanHeadLoaded?: boolean;
	open?: boolean;
	rows: ParityRow[];
	expected: ParityGroup[] | ParityGroup | null;
}

const PARITY = JSON.parse(
	readFileSync(
		new URL("../../../fixtures/quiet-groups.parity.json", import.meta.url),
		"utf8",
	),
) as { cases: ParityCase[] };

/** One fixture row, mapped onto this wire's entry shape — only the fields the
 *  group derivation reads. */
const parityEntry = (fixtureRow: ParityRow): TranscriptEntry => {
	switch (fixtureRow.kind) {
		case "user":
			return user(fixtureRow.id, fixtureRow.text ?? "hi");
		case "peer":
			return peer(fixtureRow.id, fixtureRow.sender?.conversationName);
		case "tool":
			return row({
				id: fixtureRow.id,
				kind: "tool",
				tool_name: fixtureRow.toolName ?? "bash",
				tool_state: fixtureRow.isError === true ? "failed" : "done",
				elapsed_s: fixtureRow.durationS ?? 0,
			});
		case "assistant":
			return answer(fixtureRow.id, fixtureRow.text ?? "text");
		case "notice":
			return notice(fixtureRow.id, fixtureRow.text ?? "notice");
		case "compaction":
			return row({
				id: fixtureRow.id,
				kind: "compaction",
				text: fixtureRow.text ?? "Context compacted",
			});
		case "wake":
			// A wake is a notice LINE on this wire, not a receipt kind — the
			// boundary cases below pin that difference.
			return row({
				id: fixtureRow.id,
				kind: "notice",
				text: fixtureRow.text ?? "wake",
				details: { notice_kind: "wake" },
			});
		case "custom":
			// monitor_prompt / job_result: plain `notice` rows here too (the
			// phone's custom-message fold has no receipt arm for either).
			return row({
				id: fixtureRow.id,
				kind: "notice",
				text: fixtureRow.text ?? "",
			});
		default:
			throw new Error(`unhandled parity row kind: ${fixtureRow.kind}`);
	}
};

/** The native ladder prints an identified sender unquoted; the fixture carries
 *  the UI's `"name"` quoting. */
const unquoted = (label: string): string =>
	label.startsWith('"') && label.endsWith('"') ? label.slice(1, -1) : label;

/** The fixture's expected, mapped onto this client's spelling (see the block
 *  comment): times dropped, the UI's sender quoting stripped. */
const parityExpected = (group: ParityGroup) => {
	// The native trigger set is the receipt kind itself, so a fixture group of
	// another family cannot come from this wire; a case expecting one belongs
	// in the boundary map, and this guard makes a misplacement fail loudly.
	expect(group.family, `${group.key}: family`).toBe("peer");
	return {
		key: group.key,
		count: group.count,
		senders: group.senders.map((sender) => ({
			label: unquoted(sender.label),
			count: sender.count,
		})),
		actions: group.actions,
		failed: group.failed,
		open: group.open,
		rowIds: group.rowIds,
	};
};

/** Case indexes whose EXPECTED fold needs a delivery kind this wire does not
 *  carry as a receipt (wake / monitor / job). The native definition is the
 *  `peer_message` run, so these rows yield no group here; the pin records
 *  that boundary deliberately. */
const WIRE_BOUNDARY: ReadonlyMap<number, string> = new Map([
	[5, "mixed peer+wake: a wake is a `notice` line here, not a receipt kind"],
	[10, "wake-only run: same boundary"],
	[
		11,
		"monitor-only run: a monitor prompt is a `notice` here, not a receipt kind",
	],
	[12, "job-only run: a job result is a `notice` here, not a receipt kind"],
]);

describe("the quiet-group derivation matches the shared parity fixture, case by case", () => {
	it("carries every case with rows and an expectation", () => {
		expect(PARITY.cases.length).toBe(13);
		for (const entry of PARITY.cases) {
			expect(entry.rows.length).toBeGreaterThan(0);
		}
	});

	for (const [index, entry] of PARITY.cases.entries()) {
		const boundary = WIRE_BOUNDARY.get(index);
		it(`case ${index + 1}: ${entry.name}`, () => {
			const items = entry.rows.map((fixtureRow) =>
				itemOf(parityEntry(fixtureRow)),
			);
			const actual =
				entry.span === undefined
					? quietGroupsOf(items)
					: quietGroupOfSpan(
							items,
							{ from: entry.span[0], to: entry.span[1] },
							{ open: entry.open },
						);
			if (boundary !== undefined) {
				// The fixture expects a fold here; this client cannot make it from
				// its own definition — pin the boundary rather than pretend.
				expect(entry.expected, boundary).not.toEqual([]);
				expect(actual, boundary).toEqual([]);
				return;
			}
			if (entry.expected === null) {
				expect(actual).toBeNull();
				return;
			}
			const expected = Array.isArray(entry.expected)
				? entry.expected.map(parityExpected)
				: parityExpected(entry.expected);
			expect(actual).toEqual(expected);
		});
	}
});
