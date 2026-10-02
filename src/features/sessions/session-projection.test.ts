import { describe, expect, it } from "vitest";

import type { SessionSummary } from "@/contracts";
import {
	attentionCount,
	attentionWord,
	degradedNote,
	degradedShortNote,
	rowMark,
	splitSections,
	staleNote,
	staleShortNote,
} from "@/features/sessions/session-projection";

/**
 * The list's decisions, where a decision is not observable from a rendered frame.
 *
 * The screen itself is proved end to end against the mock relay (the capture
 * matrix's populated/streaming/degraded/ended states), so nothing here renders a
 * component or asserts markup. What is left is the precedence a reviewer argues
 * with, the grouping rule, and the two sentences that must not say the wrong
 * thing about a list that is old or incomplete.
 */

/** A session with every field defaulted, so each case states only what it means. */
function session(overrides: Partial<SessionSummary> = {}): SessionSummary {
	return {
		session_id: "abc12345678",
		section: "active",
		pinned: false,
		conversation_name: "a conversation",
		cwd: "/home/me/projects/app",
		model_label: "opus",
		streaming: false,
		needs_attention: false,
		unseen: false,
		pending_kind: "",
		leaving: "",
		updating: "",
		subagents_running: 0,
		subagents_queued: 0,
		todos_open: 0,
		mtime: 0,
		completion_kind: "",
		...overrides,
	};
}

describe("rowMark", () => {
	it("picks the mark by the flow's precedence, first match wins", () => {
		// The case the whole ranking exists for is the first row: an approval gate
		// runs INSIDE a turn, so the loudest row in the list arrives carrying both
		// `needs_attention` and `streaming`, and ranking streaming first would swap
		// the danger mark for a neutral one on exactly that row.
		const cases: Array<[Partial<SessionSummary>, string]> = [
			[{ needs_attention: true, streaming: true, unseen: true }, "decision"],
			[{ streaming: true, unseen: true, ended: true }, "running"],
			[{ unseen: true, ended: true, degraded: true }, "new"],
			[{ ended: true, degraded: true }, "ended"],
			[{ degraded: true }, "degraded"],
			[{}, "idle"],
		];
		for (const [flags, expected] of cases) {
			expect(rowMark(session(flags))).toBe(expected);
		}
	});

	it("treats an absent health receipt exactly like false", () => {
		// Both receipts are optional on the wire: an older relay omits them and
		// absence reads as false, so a plain session must not render as ended.
		expect(rowMark(session({ ended: undefined, degraded: undefined }))).toBe(
			"idle",
		);
	});
});

describe("attentionWord", () => {
	it("names an ask a question, and defaults an unlabelled decision to approval", () => {
		expect(attentionWord(session({ pending_kind: "ask" }))).toBe("question");
		// `pending_kind` is "" when a relay reports a decision without saying which;
		// the row still has to carry a word rather than an empty slot.
		expect(attentionWord(session({ pending_kind: "" }))).toBe("approval");
	});
});

describe("attentionCount", () => {
	it("counts blocked sessions, not unseen ones", () => {
		// "new since you looked" and "blocked until you answer" are different facts,
		// and conflating them makes the badge read "2" for two finished turns.
		expect(
			attentionCount([
				session({ needs_attention: true }),
				session({ unseen: true }),
				session({ unseen: true, streaming: true }),
			]),
		).toBe(1);
	});
});

describe("splitSections", () => {
	it("groups without re-sorting, and pinned outranks the section", () => {
		// The relay sorts rows so the phone, the TUI and the desktop agree; a client
		// that re-ordered them would be a fourth opinion. And a pinned CONVERSATION
		// belongs with the pinned ones, or pinning an old session appears to do
		// nothing at all.
		const sections = splitSections([
			session({ session_id: "1", section: "active" }),
			session({ session_id: "2", section: "previous", pinned: true }),
			session({ session_id: "3", section: "active" }),
			session({ session_id: "4", section: "previous" }),
		]);
		expect(sections.pinned.map((s) => s.session_id)).toEqual(["2"]);
		expect(sections.active.map((s) => s.session_id)).toEqual(["1", "3"]);
		expect(sections.previous.map((s) => s.session_id)).toEqual(["4"]);
	});
});

describe("staleNote", () => {
	it("carries the age, and says nothing when there is nothing to be stale about", () => {
		// The cold-start rule: the last known list keeps rendering while the stream
		// reconnects, marked as old. "Stale" alone gives a reader no way to judge
		// whether to wait, and a list no frame has ever reached is not stale — it is
		// empty, which is a different screen.
		expect(
			staleNote({ stale: false, lastFrameAt: 1_000, now: 2_000 }),
		).toBeNull();
		expect(
			staleNote({ stale: true, lastFrameAt: null, now: 2_000 }),
		).toBeNull();
		expect(staleNote({ stale: true, lastFrameAt: 1_000, now: 31_000 })).toBe(
			"Last updated 30s ago.",
		);
		expect(
			staleNote({ stale: true, lastFrameAt: 1_000, now: 1_000 + 5 * 60_000 }),
		).toBe("Last updated 5 min ago.");
	});
});

describe("degradedNote", () => {
	it("says which kind of degradation it is", () => {
		// `sessions` means rows may be MISSING and `attention` means the new markers
		// may be out of date. A reader who sees a short list with no explanation will
		// believe it is complete.
		expect(degradedNote([])).toBeNull();
		expect(degradedNote(["sessions"])).toContain("missing rows");
		expect(degradedNote(["attention"])).toContain("out of date");
		expect(degradedNote(["sessions", "attention"])).toContain("incomplete");
	});
});

/**
 * The two short forms, which exist because of a measured line budget rather than
 * for style: at 320 pt with the platform text at 200 % the degraded banner is
 * capped at two lines (about 52 characters) and the stale line beside it at one
 * (about twelve), and the long sentences run 22 to 80. What must hold is that
 * the SHORT form is complete in its own right — the reader gets the whole
 * sentence, not a truncation of it — and that the two forms of one fact never
 * disagree.
 */
describe("the narrow-configuration short forms", () => {
	/** What one `body-sm` line holds at 200 % in a 232 dp column, measured: the
	 *  24-character refusal detail took two lines, so one holds about twelve. */
	const ONE_LINE_CHARS = 14;

	it("keeps every degraded kind distinguishable, and short", () => {
		expect(degradedShortNote(["sessions"])).toContain("missing");
		expect(degradedShortNote(["attention"])).toContain("stale");
		expect(degradedShortNote(["sessions", "attention"])).toContain(
			"incomplete",
		);
		for (const degraded of [
			["sessions"],
			["attention"],
			["sessions", "attention"],
		]) {
			expect(degradedShortNote(degraded).length).toBeLessThanOrEqual(
				ONE_LINE_CHARS * 2,
			);
		}
	});

	it("carries the age in a form one line can hold", () => {
		// The long form is `Last updated 30s ago.` — 22 characters, which one line
		// truncates to `Last updated …` and so hides the only fact this line carries
		// (review round 1, D3).
		expect(staleShortNote({ stale: false, lastFrameAt: 1_000 })).toBeNull();
		expect(staleShortNote({ stale: true, lastFrameAt: null })).toBeNull();
		expect(
			staleShortNote({ stale: true, lastFrameAt: 1_000, now: 2_000 }),
		).toBe("Just now.");
		expect(
			staleShortNote({ stale: true, lastFrameAt: 1_000, now: 31_000 }),
		).toBe("30s ago.");
		expect(
			staleShortNote({
				stale: true,
				lastFrameAt: 1_000,
				now: 1_000 + 5 * 60_000,
			}),
		).toBe("5 min ago.");
	});

	it("never says a different age from the long form it replaces", () => {
		// One arithmetic behind both: a short form that drifted from the long one
		// would put two ages on the same screen, one in the pill and one beneath it.
		for (const elapsed of [
			0, 4_000, 5_000, 59_000, 60_000, 299_000, 3_600_000,
		]) {
			const input = { stale: true, lastFrameAt: 0, now: elapsed };
			const long = staleNote(input) ?? "";
			const short = staleShortNote(input) ?? "";
			expect(long.length).toBeGreaterThan(short.length);
			const age = short.slice(0, -1);
			expect(long.toLowerCase()).toContain(age.toLowerCase());
		}
	});
});
