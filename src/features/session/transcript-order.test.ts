import { describe, expect, it } from "vitest";
import type {
	HistoryResponse,
	SessionProjection,
	TranscriptEntry,
} from "@/contracts";
import { adoptPageOrder, HistoryWindow } from "./history-window";
import { mergeTranscript, rowIdentity } from "./runtime";
import { condensePlan } from "./turn-condensing";

/*
 * TestFlight 1411 (operator report, 2026-11-20): "not all messages load on
 * mobile and sometimes they load out of order … sometimes final responses are
 * being tucked into condensed messages". His screenshot showed consecutive user
 * bubbles with none of the agent's replies between them, where the desktop
 * showed a reply after each.
 *
 * Two causes, pinned here:
 *
 *  A. ORDER / LOSS. Core's live fold paints a phone steer when it is SENT and
 *     the journal writes it when it is DELIVERED (rows later). The reader kept
 *     the live position forever, and when the steer's send-time slot fell below
 *     the frame's window edge the opening read — which paged OLDER from the
 *     frame instead of reading the newest durable page — never fetched it.
 *  B. FOLDING. `condensePlan` hid every handover message of a tool turn except
 *     the last, hid a steer with the work it steered, and grew a latched turn
 *     over a continuation by swallowing the answer the reader had already seen.
 */

const row = (
	over: Partial<TranscriptEntry> & Pick<TranscriptEntry, "id" | "kind">,
): TranscriptEntry => ({
	text: over.id,
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
const user = (id: string) => row({ id, kind: "user" });
const steer = (id: string) => row({ id, kind: "steer" });
const tool = (id: string) =>
	row({ id, kind: "tool", tool_name: "bash", text: "", elapsed_s: 2 });
/** Mid-turn narration: the model's words AND declared calls, which is what the
 *  relay sends when a message says something and calls tools in one step. The
 *  words stay on screen; only the calls fold (2026-11-21 operator report). */
const narration = (id: string) =>
	row({ id, kind: "assistant", calls_tools: true } as Partial<TranscriptEntry> &
		Pick<TranscriptEntry, "id" | "kind">);
/** A handover: text, no calls — what the reader is owed. */
const reply = (id: string) => row({ id, kind: "assistant" });

/** Prompts, steers, replies and the next prompt — what the reader must see. */
const READER_FACING = /^[usr]\d|^next$/;
/** Tool rows — the work the bar stands for; narration is the model's words. */
const TOOL_ROW = /^t\d/;
const NARRATION_ROW = /^n\d/;

const visibleIds = (entries: TranscriptEntry[], live = false) =>
	condensePlan({ entries, expanded: new Set(), latch: new Map(), live })
		.items.filter((item) => item.kind === "entry")
		.map((item) => item.id);

describe("B: a condensed turn never hides the reader's messages or the agent's answers", () => {
	// The screenshot's shape on the live wire: one prompt, then steers sent
	// while the agent worked, each answered before the next work began.
	const steered = [
		user("u1"),
		narration("n1"),
		tool("t1"),
		steer("s2"),
		narration("n2"),
		tool("t2"),
		reply("r1"),
		steer("s3"),
		narration("n3"),
		tool("t3"),
		reply("r2"),
		steer("s4"),
		narration("n4"),
		tool("t4"),
		reply("r3"),
	];

	it("keeps user, reply, user, reply … visible and in order once the turn settles", () => {
		const shown = visibleIds([...steered, user("next")]);
		expect(shown.filter((id) => READER_FACING.test(id))).toEqual([
			"u1",
			"s2",
			"r1",
			"s3",
			"r2",
			"s4",
			"r3",
			"next",
		]);
		// The work still condenses: every tool row is behind the bar, and the
		// narration that declared the calls stays with the words it said.
		expect(shown.some((id) => TOOL_ROW.test(id))).toBe(false);
		expect(shown.filter((id) => NARRATION_ROW.test(id))).toEqual([
			"n1",
			"n2",
			"n3",
			"n4",
		]);
	});

	it("keeps the same rows visible on the durable wire, where steers read as `user`", () => {
		const durable = steered.map((entry) =>
			entry.kind === "steer" ? { ...entry, kind: "user" as const } : entry,
		);
		const shown = visibleIds([...durable, user("next")]);
		expect(shown.filter((id) => READER_FACING.test(id))).toEqual([
			"u1",
			"s2",
			"r1",
			"s3",
			"r2",
			"s4",
			"r3",
			"next",
		]);
	});

	it("does not swallow an answer already on screen when a continuation extends the latch", () => {
		const first = [user("u1"), narration("n1"), tool("t1"), reply("r1")];
		const idle = condensePlan({
			entries: first,
			expanded: new Set(),
			latch: new Map(),
			live: false,
		});
		expect(idle.items.map((item) => item.id)).toContain("r1");
		// A wake/hub reply resumes the same turn with more work and a new answer.
		const continued = [...first, narration("n2"), tool("t2"), reply("r2")];
		const settled = condensePlan({
			entries: continued,
			expanded: new Set(),
			latch: idle.latch,
			live: false,
		});
		const shown = settled.items
			.filter((item) => item.kind === "entry")
			.map((item) => item.id);
		expect(shown).toEqual(["u1", "n1", "r1", "n2", "r2"]);
		expect(settled.turns[0]?.hiddenIds).toEqual(["t1", "t2"]);
	});
});

/* ------------------------------------------------------------------ A */

/** A journal of `count` rows: an opening prompt, then tool/assistant work. */
const journalOf = (count: number): TranscriptEntry[] =>
	Array.from({ length: count }, (_, at) =>
		at === 0
			? user("j000")
			: at % 3 === 0
				? reply(`j${String(at).padStart(3, "0")}`)
				: tool(`j${String(at).padStart(3, "0")}`),
	);
/** The live fold's order: the steer at journal index `from` painted `by` rows
 *  earlier (send time), everything else in journal order. */
const liveOrder = (journal: TranscriptEntry[], from: number, by: number) => {
	const live = [...journal];
	const [moved] = live.splice(from, 1);
	if (moved !== undefined) live.splice(from - by, 0, moved);
	return live;
};
/** Core's capped frame: the opener pinned, then the newest 79 rows. */
const cappedFrame = (live: TranscriptEntry[]): SessionProjection =>
	({
		session_id: "s",
		transcript: [live[0], ...live.slice(-79)],
		transcript_head_pinned: true,
	}) as unknown as SessionProjection;
const durablePager =
	(journal: TranscriptEntry[], asked: Array<string | undefined>) =>
	async (before?: string): Promise<HistoryResponse> => {
		asked.push(before);
		const end =
			before === undefined
				? journal.length
				: journal.findIndex((entry) => entry.id === before);
		const start = Math.max(0, end - 80);
		return { entries: journal.slice(start, end), has_more: start > 0 };
	};

describe("A: the reader shows every journal row, in journal order", () => {
	it("fetches a steer the live frame placed below its own window edge", async () => {
		const journal = journalOf(120);
		// Journal index 45 is inside the newest 79 rows (41..119); its send-time
		// slot, 7 rows earlier, is outside the frame's tail.
		journal[45] = steer("s045");
		const live = liveOrder(journal, 45, 7);
		const frame = cappedFrame(live);
		expect(frame.transcript.map((entry) => entry.id)).not.toContain("s045");

		const asked: Array<string | undefined> = [];
		const reader = new HistoryWindow(durablePager(journal, asked), () => {});
		reader.accept(frame);
		await reader.load(true);
		// The opening read is the NEWEST durable page, not the older one.
		expect(asked[0]).toBeUndefined();
		expect(reader.visibleRows.map((entry) => entry.id)).toContain("s045");
		await reader.load();
		expect(reader.visibleRows.map(rowIdentity)).toEqual(
			journal.map(rowIdentity),
		);
	});

	// PR #356 R1: Reload history re-seeded from the frame and then paged OLDER
	// from its oldest row, skipping the newest durable page exactly as the
	// opening read used to, so the steer was gone for the life of the screen.
	it("Reload history reads the newest page and keeps every row in journal order", async () => {
		const journal = journalOf(120);
		journal[45] = steer("s045");
		const frame = cappedFrame(liveOrder(journal, 45, 7));
		const asked: Array<string | undefined> = [];
		const reader = new HistoryWindow(durablePager(journal, asked), () => {});
		reader.activate();
		reader.accept(frame);
		await reader.reload();
		expect(asked).toEqual([undefined]);
		expect(reader.visibleRows.map((entry) => entry.id)).toContain("s045");
		await reader.load();
		expect(reader.visibleRows.map(rowIdentity)).toEqual(
			journal.map(rowIdentity),
		);
	});

	it("re-seats a steer the live frame painted early into its delivered position", async () => {
		const journal = journalOf(120);
		journal[60] = steer("s060");
		const live = liveOrder(journal, 60, 5);
		const reader = new HistoryWindow(durablePager(journal, []), () => {});
		reader.accept(cappedFrame(live));
		const before = reader.visibleRows.map((entry) => entry.id);
		expect(before.indexOf("s060")).toBeLessThan(before.indexOf("j055"));
		await reader.load(true);
		await reader.load();
		expect(reader.visibleRows.map(rowIdentity)).toEqual(
			journal.map(rowIdentity),
		);
		// A later live frame in send-time order does not move it back.
		reader.accept(cappedFrame([...live, tool("j120")]));
		const after = reader.visibleRows.map((entry) => entry.id);
		expect(after.indexOf("s060")).toBe(after.indexOf("j059") + 1);
		expect(after.at(-1)).toBe("j120");
	});
});

/*
 * A HELD ROW THE FRAME HAS MOVED never pulls the rows after it upward.
 *
 * Live frames are full repaints, and the merge places a frame row the reader
 * does not hold after the shared rows that precede it in the frame. Placing it
 * after only the LAST such row broke whenever a held row sat in a different
 * relative order in the frame than on screen: the new rows landed between the
 * moved row and the rows it had been shown before. Two real shapes:
 *  - Core moving a delivered steer from its send-time slot to its journal
 *    position (the follow-up core fix the job b653d62f56e1 probe measured):
 *    the frame becomes `… t1 t2 s1 a1`, the screen still shows `s1 t1 t2`.
 *  - Today, after `adoptPageOrder` seats a steer in journal order, the next
 *    live frame is still in send-time order and puts `s1` before `t1 t2`.
 */
describe("A: a held row the frame moved never pulls new rows above held ones", () => {
	const reader = () =>
		new HistoryWindow(
			async () => ({ entries: [], has_more: false }),
			() => {},
		);
	const live = (...rows: TranscriptEntry[]) =>
		({ transcript: rows }) as unknown as SessionProjection;
	const U = user("u1");
	const A0 = reply("a0");
	const S = steer("s1");
	const T1 = tool("t1");
	const T2 = tool("t2");
	const A1 = reply("a1");
	const A2 = reply("a2");
	/** The send-time frames the screen saw before delivery: the steer painted
	 *  at the tail, then the work that ran after it was sent. */
	const sentThenWorked = () => {
		const window = reader();
		window.accept(live(U, A0, S));
		window.accept(live(U, A0, S, T1));
		window.accept(live(U, A0, S, T1, T2));
		return window;
	};

	it("core-move shape: rows after the moved steer land after the rows held below it", () => {
		const merged = mergeTranscript(live(U, A0, T1, T2, S, A1, A2), [
			U,
			A0,
			S,
			T1,
			T2,
		]);
		expect(merged.rows.map((entry) => entry.id)).toEqual([
			"u1",
			"a0",
			"s1",
			"t1",
			"t2",
			"a1",
			"a2",
		]);
	});

	it("today's shape (upgrade in place) is unchanged", () => {
		const window = sentThenWorked();
		window.accept(live(U, A0, S, T1, T2));
		window.accept(live(U, A0, S, T1, T2, A1));
		window.accept(live(U, A0, S, T1, T2, A1, A2));
		expect(window.visibleRows.map((entry) => entry.id)).toEqual([
			"u1",
			"a0",
			"s1",
			"t1",
			"t2",
			"a1",
			"a2",
		]);
	});

	it("after adoptPageOrder seats the steer, a send-time frame puts the new row below it", () => {
		const merged = mergeTranscript(live(U, A0, S, T1, T2, A1), [
			U,
			A0,
			T1,
			T2,
			S,
		]);
		expect(merged.rows.map((entry) => entry.id)).toEqual([
			"u1",
			"a0",
			"t1",
			"t2",
			"s1",
			"a1",
		]);
	});

	it("after adoptPageOrder seats the steer, the production reader keeps it above the next reply", async () => {
		// Journal order: the steer is written when DELIVERED, after t1 t2.
		const journal = [U, A0, T1, T2, S];
		const window = new HistoryWindow(durablePager(journal, []), () => {});
		window.accept(live(U, A0, S, T1, T2));
		await window.load(true);
		expect(window.visibleRows.map((entry) => entry.id)).toEqual([
			"u1",
			"a0",
			"t1",
			"t2",
			"s1",
		]);
		window.accept(live(U, A0, S, T1, T2, A1));
		expect(window.visibleRows.map((entry) => entry.id)).toEqual([
			"u1",
			"a0",
			"t1",
			"t2",
			"s1",
			"a1",
		]);
	});

	it("probe (job b653d62f56e1) through HistoryWindow: core moves the steer at delivery", () => {
		const window = sentThenWorked();
		window.accept(live(U, A0, T1, T2, S));
		window.accept(live(U, A0, T1, T2, S, A1));
		window.accept(live(U, A0, T1, T2, S, A1, A2));
		const shown = window.visibleRows.map((entry) => entry.id);
		// Held rows never reorder, nothing is dropped or duplicated, and the
		// replies follow every row already on screen.
		expect(shown).toEqual(["u1", "a0", "s1", "t1", "t2", "a1", "a2"]);
		expect(new Set(shown).size).toBe(shown.length);
	});
});

describe("adoptPageOrder", () => {
	it("reassigns only the slots the page's rows occupy", () => {
		const held = [
			tool("a"),
			steer("s"),
			row({ id: "rz-1", kind: "reasoning" }),
			tool("b"),
			tool("c"),
		];
		const page = [tool("a"), tool("b"), steer("s")];
		expect(adoptPageOrder(held, page).map((entry) => entry.id)).toEqual([
			"a",
			"b",
			"rz-1",
			"s",
			"c",
		]);
	});

	it("returns the same array when the page agrees with the screen", () => {
		const held = [tool("a"), tool("b"), tool("c")];
		expect(adoptPageOrder(held, [tool("b"), tool("c")])).toBe(held);
	});

	it("matches repeated ids by occurrence, never dropping or duplicating a copy", () => {
		const held = [
			row({ id: "m", kind: "assistant", text: "first" }),
			tool("x"),
			row({ id: "m", kind: "assistant", text: "second" }),
		];
		const out = adoptPageOrder(held, [
			tool("x"),
			...held.filter((e) => e.id === "m"),
		]);
		expect(out.map((entry) => entry.text)).toEqual(["", "first", "second"]);
		expect(out).toHaveLength(3);
	});

	// PR #356 R2 (reviewer's reproduction): one `m` in older history, another
	// in the newest page. Counting held copies from the start paired m(OLD)
	// with the page's `m`, pulling p1 above `b` into older history.
	it("pairs a newest page's repeated id with the newest held copy", () => {
		const mOld = row({ id: "m", kind: "assistant", text: "old" });
		const mNew = row({ id: "m", kind: "assistant", text: "new" });
		const held = [
			tool("a"),
			mOld,
			tool("b"),
			tool("p1"),
			tool("p2"),
			mNew,
			tool("p3"),
		];
		const page = [tool("p1"), tool("p2"), mNew, tool("p3")];
		expect(adoptPageOrder(held, page)).toBe(held);
		// An older page pairs from the start: same input, the oldest edge.
		const older = [mOld, tool("b")];
		const heldOlder = [tool("b"), mOld, tool("p1"), mNew];
		expect(
			adoptPageOrder(heldOlder, older, "oldest").map((entry) => entry.text),
		).toEqual(["old", "", "", "new"]);
	});
});
