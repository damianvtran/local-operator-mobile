import { describe, expect, it } from "vitest";

import type { TranscriptEntry } from "@/contracts";
import {
	FIND_LIMIT,
	type FindHit,
	findActiveIndex,
	findCountLabel,
	findCursorMove,
	findScopeLines,
	findTruncatedLabel,
	revealTarget,
	searchConversation,
	splitRanges,
} from "@/features/session/find";
import { condensePlan, groupPlan } from "@/features/session/turn-condensing";

/* ------------------------------------------------------------------ fixtures */

/** One wire row, complete unless a case says otherwise — the same shape the
 *  session suite's fixtures carry. */
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

const hit = (id: string): FindHit => ({
	id,
	role: "user",
	snippet: id,
	ranges: [],
	tier: "exact",
});

const user = (id: string, text: string) => row({ id, kind: "user", text });
const steer = (id: string, text: string) => row({ id, kind: "steer", text });
const answer = (id: string, text: string) =>
	row({ id, kind: "assistant", text });
const tool = (id: string, summary = "running the retry sweep") =>
	row({ id, kind: "tool", tool_name: "bash", summary });
const peer = (id: string, body = "peer note") =>
	row({ id, kind: "peer_message", text: body });
const notice = (id: string, text: string) =>
	row({ id, kind: "notice", text, details: { severity: "info" } });
const parent = (id: string, text: string) =>
	row({ id, kind: "parent_message", text });
const subagent = (id: string, text: string) =>
	row({ id, kind: "subagent_message", text });
const reasoning = (id: string, text: string) =>
	row({ id, kind: "reasoning", text, final: false, text_complete: false });

/* ------------------------------------------------------------ the exact tier */

describe("searchConversation — the exact tier", () => {
	it("finds a casefolded literal substring and reports it as exact", () => {
		const entries = [
			user("u1", "Reconcile last night's ledger."),
			answer("a1", "Three records were late; the ledger is behind."),
			user("u2", "Unrelated note."),
		];
		const { hits } = searchConversation(entries, "LEDGER");
		expect(hits.map((hit) => hit.id)).toEqual(["u1", "a1"]);
		expect(hits.every((hit) => hit.tier === "exact")).toBe(true);
		// The whole answer is inside one snippet window, so the range covers
		// the matched word where it appears in the snippet.
		expect(hits[1]?.snippet).toContain("ledger");
		const [start, end] = hits[1]?.ranges[0] ?? [0, 0];
		expect(hits[1]?.snippet.slice(start, end)).toBe("ledger");
	});

	it("maps occurrences through casefold expansions (ß → ss) onto the original characters", () => {
		const entries = [user("u1", "Die Straße bleibt gesperrt.")];
		const { hits } = searchConversation(entries, "strasse");
		expect(hits).toHaveLength(1);
		const [start, end] = hits[0]?.ranges[0] ?? [0, 0];
		// The range must cover the ORIGINAL word — ß included — not a shifted
		// slice: the mapping from folded offsets back to the source is what
		// this pins.
		expect(hits[0]?.snippet.slice(start, end)).toBe("Straße");
	});

	it("reads the message rows and the folded notice family — never tool output or reasoning", () => {
		const entries = [
			user("u1", "ledger reconciliation"),
			steer("s1", "check the ledger again"),
			answer("a1", "the ledger is clean"),
			parent("p1", "the ledger copy arrived from the parent"),
			subagent("sa1", "ledger audit finished"),
			row({ id: "pm1", kind: "peer_message", text: "ledger from the peer" }),
			tool("t1", "ledger sweep command"),
			notice("n1", "the ledger tool was denied"),
			reasoning("r1", "thinking about the ledger"),
			row({ id: "k1", kind: "ask_response", text: "ledger question answered" }),
			row({ id: "k2", kind: "ask_timeout", text: "ledger question timed out" }),
			row({ id: "c1", kind: "compaction", text: "ledger context folded" }),
		];
		const { hits } = searchConversation(entries, "ledger");
		// Genuine messages first, then every injected row in journal order —
		// the folded notice family included, matching the desktop index's own
		// set ("hub, wake, compaction, … has to stay findable").
		expect(hits.map((hit) => hit.id)).toEqual([
			"u1",
			"s1",
			"a1",
			"p1",
			"sa1",
			"pm1",
			"n1",
			"k1",
			"k2",
			"c1",
		]);
	});

	it("labels the folded families honestly and demotes them", () => {
		const entries = [
			user("u1", "ledger reconciliation"),
			notice("n1", "the ledger tool was denied"),
			row({ id: "c1", kind: "compaction", text: "ledger context folded" }),
			row({ id: "k1", kind: "ask_response", text: "ledger receipt" }),
		];
		const { hits } = searchConversation(entries, "ledger");
		// The genuine row outranks newer injected rows even though it is older —
		// the demotion — and each family carries a label that is not a lie.
		expect(hits.map((hit) => `${hit.id}:${hit.role}`)).toEqual([
			"u1:user",
			"n1:notice",
			"c1:compaction",
			"k1:ask",
		]);
	});

	it("folds ẞ the way the desktop's casefold does — `strasse` finds `STRAẞE`", () => {
		const entries = [user("u1", "DIE STRAẞE BLEIBT GESPERRT.")];
		const { hits } = searchConversation(entries, "strasse");
		expect(hits.map((hit) => hit.id)).toEqual(["u1"]);
		expect(hits[0]?.tier).toBe("exact");
		const [start, end] = hits[0]?.ranges[0] ?? [0, 0];
		// The range covers the ORIGINAL characters — ẞ included — not a slice
		// shifted by the one-character-two-unit expansion (QA Q63-3).
		expect(hits[0]?.snippet.slice(start, end)).toBe("STRAẞE");
	});

	it("trims the query to Python's `strip()` — the desktop's own cut (QA Q63-4)", () => {
		const entries = [
			user("u1", "retry the export"),
			user("u2", "retry policy"),
		];
		// \x1c is stripped by the desktop's `str.strip()`; JS `trim()` keeps it,
		// which used to push this query from the exact tier into the soft one.
		const control = searchConversation(entries, "retry\x1c");
		expect(control.hits.map((hit) => hit.id)).toEqual(["u1", "u2"]);
		expect(control.hits.every((hit) => hit.tier === "exact")).toBe(true);
		// U+FEFF is NOT whitespace to Python and stays: there is no literal
		// occurrence left to find, so the hit is soft — as the desktop reads it.
		const bom = searchConversation(entries, "\uFEFFretry");
		expect(bom.hits.map((hit) => hit.id)).toEqual(["u1", "u2"]);
		expect(bom.hits.every((hit) => hit.tier === "soft")).toBe(true);
	});

	it("caps the ranges a hit carries at five, non-overlapping", () => {
		const entries = [user("u1", "aa aa aa aa aa aa aa")];
		const { hits } = searchConversation(entries, "aa");
		expect(hits[0]?.ranges).toHaveLength(5);
	});

	it("returns nothing for an empty or whitespace query", () => {
		const entries = [user("u1", "anything")];
		expect(searchConversation(entries, "").hits).toEqual([]);
		expect(searchConversation(entries, "   ").hits).toEqual([]);
	});
});

/* ------------------------------------------------------------- the soft tier */

describe("searchConversation — the soft tier", () => {
	it("stays off while the exact hits are enough (PRECISE_HITS_ENOUGH)", () => {
		const entries = [
			user("u1", "retry the export"),
			user("u2", "retry policy"), // second exact hit
			user("u3", "retry backoff"), // third exact hit — the floor
			// No literal "retry", and one edit from it ("retrry"): this would be
			// a soft hit if the soft pass ran, so its absence is what proves the
			// pass stayed off.
			user("u4", "retrry note"),
		];
		const { hits } = searchConversation(entries, "retry");
		expect(hits.map((hit) => hit.id)).toEqual(["u1", "u2", "u3"]);
		expect(hits.every((hit) => hit.tier === "exact")).toBe(true);
	});

	it("runs below the floor: one-edit typos and order-independent token-AND, marked related", () => {
		const entries = [
			user("u1", "reconcile the ledger"),
			user("u2", "the classifier needed a fix"), // typo target
			user("u3", "add retry backoff"),
			user("u4", "backoff was added to retry"), // token-AND, order-independent
		];
		// No literal "classifer" anywhere: the soft pass must run, and the hit
		// is THE one message whose word is one edit away.
		const typo = searchConversation(entries, "classifer");
		expect(typo.hits.map((hit) => hit.id)).toEqual(["u2"]);
		expect(typo.hits[0]?.tier).toBe("soft");
		// A soft hit carries no ranges (there is no literal occurrence to mark)
		// and keeps the message head as its window.
		expect(typo.hits[0]?.ranges).toEqual([]);
		expect(typo.hits[0]?.snippet.startsWith("the classifier")).toBe(true);

		// A literal prefix is ALSO a substring, so a partial word lands in the
		// exact tier — the soft tier's prefix arm exists for the token matcher
		// the desktop shares, not because substring search would miss this.
		const prefix = searchConversation(entries, "retr");
		expect(prefix.hits.map((hit) => hit.id)).toEqual(["u3", "u4"]);

		// Order-independent token-AND: "added backoff" is not a literal in any
		// message, but u4 carries both words.
		const tokenAnd = searchConversation(entries, "added backoff");
		expect(tokenAnd.hits.map((hit) => hit.id)).toEqual(["u4"]);
		expect(tokenAnd.hits[0]?.tier).toBe("soft");
	});

	it("never fuzzes a token shorter than four characters", () => {
		const entries = [user("u1", "the add function is fine")];
		// "adt" is one edit from "add" but under the length floor: only the
		// exact/prefix tiers apply to it, so this is a miss.
		expect(searchConversation(entries, "adt").hits).toEqual([]);
		// "add" itself is a literal substring — exact.
		expect(searchConversation(entries, "add").hits[0]?.tier).toBe("exact");
	});

	it("ranks exact before soft and genuine before injected, oldest first inside each class", () => {
		const entries = [
			subagent("sa1", "retry sweep done in the child"), // injected, exact
			user("u1", "retry the export"), // genuine, exact, older
			user("u2", "retry with jitter"), // genuine, exact, newer
		];
		const { hits } = searchConversation(entries, "retry");
		expect(hits.map((hit) => hit.id)).toEqual(["u1", "u2", "sa1"]);

		// With only soft hits on both sides, genuine still outranks injected:
		// "ledgr" is nobody's literal, one edit from "ledger" in both rows.
		const softOnly = [
			subagent("sa2", "the ledger copy"),
			user("u3", "ledger reconciliation"),
		];
		const soft = searchConversation(softOnly, "ledgr");
		expect(soft.hits.map((hit) => hit.id)).toEqual(["u3", "sa2"]);
		expect(soft.hits.every((hit) => hit.tier === "soft")).toBe(true);
	});
});

/* ------------------------------------------------------------- truncation */

describe("searchConversation — truncation", () => {
	it("cuts at the limit and says so", () => {
		const entries = Array.from({ length: 5 }, (_, index) =>
			user(`u${index}`, `ledger pass ${index}`),
		);
		const { hits, truncated } = searchConversation(entries, "ledger", 2);
		expect(hits).toHaveLength(2);
		expect(truncated).toBe(true);
		const full = searchConversation(entries, "ledger");
		expect(full.hits).toHaveLength(5);
		expect(full.truncated).toBe(false);
		expect(full.hits.length).toBeLessThanOrEqual(FIND_LIMIT);
	});
});

/* ------------------------------------------------- the windowed (capped) drive */

describe("searchConversation — the loaded window, honestly", () => {
	/**
	 * The relay's real frame shape: a projection is the conversation's TAIL,
	 * capped (`mobile/projection.py::_cap_tail`), and the cap slides as new
	 * rows arrive. This driver replays that shape — an append that pushes the
	 * oldest carried row out — so the search is exercised against a window
	 * that MOVES, not a contiguous transcript that only grows. The condensing
	 * latch bug was found by exactly this class of frame; a search suite that
	 * only ever searched a whole, still conversation would have missed every
	 * behaviour that depends on the window's edges.
	 */
	const capTail = (rows: TranscriptEntry[], cap: number) =>
		rows.slice(Math.max(0, rows.length - cap));

	it("finds a hit while its message is carried, and misses it honestly after the window slides past it", () => {
		const whole = [
			user("u1", "why did the euro conversion miss?"),
			tool("t1"),
			answer("a1", "the shard clock, not the maths"),
			user("u2", "fix the rounding"),
			answer("a2", "rounding pinned to the ledger's own scale"),
		];
		// While the window still carries u1, the phrase is findable.
		expect(capTail(whole, 5)[0]?.id).toBe("u1");
		expect(
			searchConversation(capTail(whole, 5), "euro").hits.map((h) => h.id),
		).toEqual(["u1"]);
		// Two appends with a cap of four push u1 out: the same query over the
		// same conversation now finds nothing — from this device's frames the
		// message is not there to find, and the scope line is what says so.
		const slid = capTail(
			whole.concat([user("u3", "next task"), answer("a3", "done")]),
			4,
		);
		expect(slid.map((entry) => entry.id)).toEqual(["u2", "a2", "u3", "a3"]);
		expect(searchConversation(slid, "euro").hits).toEqual([]);
		expect(findScopeLines({ messages: 4, older: true })).toEqual([
			"Searched 4 messages on this device.",
			"Older messages aren't searched.",
		]);
	});

	it("keeps a hit findable across a SLIDING window while the message stays carried", () => {
		const whole = [
			user("u1", "why did the euro conversion miss?"),
			tool("t1"),
			answer("a1", "the shard clock, not the maths"),
		];
		const frame1 = capTail(whole, 3);
		expect(searchConversation(frame1, "euro").hits.map((h) => h.id)).toEqual([
			"u1",
		]);
		// Append two rows with a cap of three: the window slides to [a1, u2, a2]
		// and "euro" is gone from what this device holds — a miss for the frame
		// it is asked about, not a claim about the conversation.
		const grown = whole.concat([user("u2", "next task"), answer("a2", "done")]);
		const frame2 = capTail(grown, 3);
		expect(frame2.map((entry) => entry.id)).toEqual(["a1", "u2", "a2"]);
		expect(searchConversation(frame2, "euro").hits).toEqual([]);
	});
});

/* --------------------------------------------------------------- reveal path */

describe("revealTarget — landing on a hit", () => {
	const entries = [
		user("q1", "first question: reconcile the ledger"),
		tool("t1"),
		tool("t2"),
		answer("a1", "the ledger is reconciled"),
		user("q2", "second question: fix jitter"),
		answer("a2", "jitter fixed"),
	];

	/** The subject the list assembles for a reveal: the turn plan's items and
	 *  turns, plus the group pass over them (these fixtures carry no peer runs
	 *  except where a case says so). */
	const subjectOf = (
		plan: ReturnType<typeof condensePlan>,
		groups: ReturnType<typeof groupPlan>["groups"] = [],
	) => ({ items: plan.items, turns: plan.turns, groups });

	it("lands directly on a row the plan renders", () => {
		const plan = condensePlan({
			entries,
			expanded: new Set(),
			latch: new Map(),
		});
		expect(revealTarget(subjectOf(plan), "q2")).toEqual({
			kind: "item",
			index: plan.items.findIndex(
				(item) => item.kind === "entry" && item.id === "q2",
			),
		});
	});

	it("names the condensed turn when the row is inside its collapse — the expand-first walk", () => {
		const plan = condensePlan({
			entries,
			expanded: new Set(),
			latch: new Map(),
		});
		// The first turn condensed (a newer turn exists and its answer is
		// complete), so its tool rows are hidden behind the bar.
		const bar = plan.items.find((item) => item.kind === "bar");
		expect(bar).toBeDefined();
		expect(revealTarget(subjectOf(plan), "t1")).toEqual({
			kind: "turn",
			turnKey: "q1",
		});
		// Opening the turn puts the row back, and the same lookup now lands on
		// the row itself.
		const opened = condensePlan({
			entries,
			expanded: new Set(["q1"]),
			latch: plan.latch,
		});
		const target = revealTarget(subjectOf(opened), "t1");
		expect(target?.kind).toBe("item");
	});

	it("names the quiet group when the row is inside one — and opening it lands on the row", () => {
		// The peers sit OUTSIDE every condensed span (an earlier turn with
		// nothing to hide), so they are visible rows the group pass folds.
		const quiet = [
			user("q1", "first question"),
			answer("a1", "answered"),
			peer("p1"),
			peer("p2"),
			user("q2", "second question"),
			answer("a2", "answered again"),
		];
		const plan = condensePlan({
			entries: quiet,
			expanded: new Set(),
			latch: new Map(),
		});
		const grouped = groupPlan({
			items: plan.items,
			expanded: new Set(),
			latch: new Map(),
		});
		const folded = grouped.groups.find((group) => group.key === "qg:p1");
		expect(folded?.hiddenIds).toEqual(["p1", "p2"]);
		expect(revealTarget(subjectOf(plan, grouped.groups), "p2")).toEqual({
			kind: "group",
			groupKey: "qg:p1",
		});

		const openedPlan = condensePlan({
			entries: quiet,
			expanded: new Set(),
			latch: plan.latch,
		});
		const opened = groupPlan({
			items: openedPlan.items,
			expanded: new Set(["qg:p1"]),
			latch: grouped.latch,
		});
		const target = revealTarget(subjectOf(openedPlan, opened.groups), "p2");
		expect(target?.kind).toBe("item");
	});

	it("is null for an id the plan does not carry", () => {
		const plan = condensePlan({
			entries,
			expanded: new Set(),
			latch: new Map(),
		});
		expect(revealTarget(subjectOf(plan), "not-a-row")).toBeNull();
	});

	it("still lands on a hit whose own turn condensed BEFORE the window slid its rows away", () => {
		// The latch case the condensing suite pins for HEIGHT also pins the
		// find path: a latched turn renders from its frozen span, so a hit in
		// that span must still resolve to the turn once the frame no longer
		// carries the row (the window drops t1/t2, keeps q1/a1).
		const first = condensePlan({
			entries,
			expanded: new Set(),
			latch: new Map(),
		});
		const slid = condensePlan({
			entries: entries.filter(
				(entry) => entry.id !== "t1" && entry.id !== "t2",
			),
			expanded: new Set(),
			latch: first.latch,
		});
		expect(revealTarget(subjectOf(slid), "t1")).toEqual({
			kind: "turn",
			turnKey: "q1",
		});
	});
});

/* --------------------------------------------------------------- segments + copy */

describe("splitRanges", () => {
	it("marks the ranges and drops empty or overlapping ones without throwing", () => {
		expect(splitRanges("abcdef", [[2, 4]])).toEqual([
			{ text: "ab", matched: false },
			{ text: "cd", matched: true },
			{ text: "ef", matched: false },
		]);
		expect(
			splitRanges("abcdef", [
				[2, 4],
				[3, 5],
			]),
		).toEqual([
			{ text: "ab", matched: false },
			{ text: "cd", matched: true },
			// The second range's start clamps forward to the cursor, so the
			// remainder follows as its own marked run — the union is covered,
			// nothing paints twice (the desktop walker's own recovery).
			{ text: "e", matched: true },
			{ text: "f", matched: false },
		]);
		// A range already covered collapses to zero length and is dropped.
		expect(
			splitRanges("abcdef", [
				[2, 4],
				[3, 4],
			]),
		).toEqual([
			{ text: "ab", matched: false },
			{ text: "cd", matched: true },
			{ text: "ef", matched: false },
		]);
		expect(splitRanges("abc", [[3, 3]])).toEqual([
			{ text: "abc", matched: false },
		]);
		// A range past the end clamps rather than throwing.
		expect(splitRanges("abc", [[1, 99]])).toEqual([
			{ text: "a", matched: false },
			{ text: "bc", matched: true },
		]);
	});
});

describe("the copy", () => {
	it("counts tier-aware, like the desktop's own line", () => {
		const hit = (tier: "exact" | "soft") =>
			({ tier }) as Parameters<typeof findCountLabel>[0][number];
		expect(findCountLabel([hit("exact")])).toBe("1 match");
		expect(findCountLabel([hit("exact"), hit("exact")])).toBe("2 matches");
		expect(findCountLabel([hit("soft")])).toBe("1 related match");
		expect(findCountLabel([hit("soft"), hit("soft")])).toBe(
			"2 related matches",
		);
		expect(findCountLabel([hit("exact"), hit("soft"), hit("soft")])).toBe(
			"1 exact · 2 related",
		);
	});

	it("states the cut as a suffix, not a second sentence", () => {
		expect(findTruncatedLabel(1)).toBe("(the first match shown)");
		expect(findTruncatedLabel(100)).toBe("(first 100 shown)");
	});

	it("scope lines: the count is always stated; the older caveat when the gate fires", () => {
		expect(findScopeLines({ messages: 1, older: false })).toEqual([
			"Searched 1 message on this device.",
		]);
		expect(findScopeLines({ messages: 0, older: false })).toEqual([
			"Searched 0 messages on this device.",
		]);
		expect(findScopeLines({ messages: 2, older: true })).toEqual([
			"Searched 2 messages on this device.",
			"Older messages aren't searched.",
		]);
	});
});

describe("findCursorMove", () => {
	it('wraps at both ends and treats -1 as "nothing landed on yet"', () => {
		expect(findCursorMove(-1, 1, 3)).toBe(0);
		expect(findCursorMove(-1, -1, 3)).toBe(2);
		expect(findCursorMove(2, 1, 3)).toBe(0);
		expect(findCursorMove(0, -1, 3)).toBe(2);
		expect(findCursorMove(1, 1, 3)).toBe(2);
		expect(findCursorMove(5, 1, 3)).toBe(0);
		expect(findCursorMove(0, 1, 0)).toBe(-1);
	});
});

describe("findActiveIndex — the landing is an identity, resolved per render", () => {
	it("finds the landed message at its CURRENT rank, however the frames moved", () => {
		// The window slid; the landed message that was rank 2 now leads.
		expect(findActiveIndex([hit("c"), hit("x"), hit("y")], "c")).toBe(0);
		expect(findActiveIndex([hit("x"), hit("c"), hit("y")], "c")).toBe(1);
	});

	it("clears when the landed message left the frames, or was never set", () => {
		expect(findActiveIndex([hit("x"), hit("y")], "c")).toBe(-1);
		expect(findActiveIndex([hit("x")], null)).toBe(-1);
		expect(findActiveIndex([], "c")).toBe(-1);
	});
});
