import { describe, expect, it } from "vitest";

import type { PendingAsk, SessionSummary } from "@/contracts";
import {
	answeredBySurface,
	answeredPairs,
	askStateLine,
	asksPopulationSignature,
	askToneInk,
	blockingPending,
	dockAsk,
	durationLabel,
	headAsk,
	isAnswerable,
	isOutstanding,
	orderedForDisplay,
	outstandingAsks,
	outstandingQuestions,
	questionProgress,
	questionsWaitingLabel,
	remainingMs,
	unansweredQuestions,
} from "@/features/session/asks";

/**
 * The ask vocabulary, and the decisions that are easy to get subtly wrong:
 * which ask is the HEAD (the OLDEST open one, never the list's first row — the
 * wire leads with the newest, and a bar that jumped to each arrival would move
 * under a thumb), whether the legacy mirrored card is still a blocking gate
 * (design §4's client rule N3: once `asks` is present, `kind === "ask"` is
 * not), and the unit split the manager of this round fixed (the bar counts
 * QUESTIONS, the badge counts ASKS).
 */

function ask(patch: Partial<PendingAsk> = {}): PendingAsk {
	return {
		ask_id: "a1",
		created_at: 1_000,
		expires_at: 1_000_000,
		timeout_s: 900,
		urgent: false,
		status: "open",
		delivered: false,
		questions: [
			{
				id: "q1",
				question: "ship it?",
				options: [],
				multi: false,
				secret: false,
				persist: false,
			},
		],
		...patch,
	};
}

/** A list row carrying only what the population signature reads — the rest is
 *  pinned so the object is a real `SessionSummary`. */
function summary(
	patch: Partial<SessionSummary> & { session_id: string },
): SessionSummary {
	return {
		section: "active",
		pinned: false,
		conversation_name: "",
		cwd: "",
		model_label: "",
		streaming: false,
		needs_attention: false,
		unseen: false,
		pending_kind: "",
		leaving: "",
		updating: "",
		subagents_running: null,
		subagents_queued: null,
		todos_open: 0,
		mtime: 0,
		completion_kind: "",
		...patch,
	};
}

describe("askStateLine", () => {
	it("states the open ask as queued, with a locally rendered countdown", () => {
		const line = askStateLine(ask({ expires_at: 1000 + 42 * 60 * 1000 }), 1000);
		expect(line.text).toBe("Queued — the agent is continuing; expires in 42 m");
		expect(line.tone).toBe("wait");
	});

	it("says delivering until the runtime has delivered the response rows", () => {
		expect(
			askStateLine(ask({ status: "answered", delivered: false }), 1).text,
		).toBe("Answered — delivering");
		expect(
			askStateLine(ask({ status: "answered", delivered: true }), 1).text,
		).toBe("Answered — the agent was told");
	});

	it("keeps the timed-out state honest: moved on AND still answerable", () => {
		const line = askStateLine(ask({ status: "timed_out" }), 1);
		expect(line.text).toBe(
			"Timed out — the agent moved on; you can still answer",
		);
		expect(line.tone).toBe("attention");
	});

	it("names a dismissal as no reply at all, and an expiry as unfixable", () => {
		expect(askStateLine(ask({ status: "dismissed" }), 1)).toEqual({
			text: "Dismissed — no reply was sent",
			tone: "gone",
		});
		expect(askStateLine(ask({ status: "expired" }), 1)).toEqual({
			text: "Expired — this ask is too old to answer; ask the agent again",
			tone: "gone",
		});
	});

	it("keeps a late answer a receipt the reader should notice", () => {
		expect(askStateLine(ask({ status: "late" }), 1).text).toBe(
			"Answered late — the agent was told",
		);
	});

	it("does not claim a deadline that has passed locally is still counting", () => {
		const line = askStateLine(ask({ expires_at: 500 }), 1000);
		expect(line.text).toBe("Queued — the agent is continuing; deadline passed");
		expect(line.tone).toBe("attention");
	});

	it("passes an unknown status through as its own word rather than mapping it", () => {
		const line = askStateLine(ask({ status: "escalated_to_human" }), 1);
		expect(line.text).toBe("escalated to human");
		expect(line.tone).toBe("wait");
	});

	it("inks each tone from one table, so no surface picks its own colour", () => {
		expect(askToneInk("attention")).toBe("text-warning");
		expect(askToneInk("settled")).toBe("text-success");
		expect(askToneInk("gone")).toBe("text-ink-dim");
		expect(askToneInk("wait")).toBe("text-ink-muted");
	});
});

describe("durationLabel", () => {
	it("spaces its units, and never reads as more precise than it is", () => {
		expect(durationLabel(42 * 60 * 1000)).toBe("42 m");
		expect(durationLabel(89 * 60 * 1000)).toBe("89 m");
		expect(durationLabel(90 * 60 * 1000)).toBe("1 h");
		expect(durationLabel(47 * 3600 * 1000)).toBe("47 h");
		expect(durationLabel(48 * 3600 * 1000)).toBe("2 d");
	});

	it("floors a deadline inside the next second to a bound, never an empty string", () => {
		expect(durationLabel(500)).toBe("<1 m");
		expect(durationLabel(0)).toBe("");
	});
});

describe("remainingMs", () => {
	it("is negative once past and works in milliseconds on both sides", () => {
		expect(remainingMs(ask({ expires_at: 1_500 }), 1000)).toBe(500);
		expect(remainingMs(ask({ expires_at: 999 }), 1000)).toBe(-1);
	});
});

describe("orderedForDisplay", () => {
	it("lifts the ask the bar names — the head when one is open", () => {
		const older = ask({ ask_id: "old", created_at: 100 });
		const newer = ask({ ask_id: "new", created_at: 900 });
		expect(orderedForDisplay([newer, older]).map((row) => row.ask_id)).toEqual([
			"old",
			"new",
		]);
	});

	it("lifts the answerable TIMEOUT when nothing is open — the same row the bar names", () => {
		const open = ask({ ask_id: "open" });
		const settled = ask({ ask_id: "settled", status: "answered" });
		const timeout = ask({ ask_id: "timeout", status: "timed_out" });
		expect(
			orderedForDisplay([settled, timeout, open]).map((row) => row.ask_id),
		).toEqual(["open", "settled", "timeout"]);
	});

	it("leaves the wire's order alone when there is nothing outstanding", () => {
		const rows = [
			ask({ ask_id: "x", status: "answered" }),
			ask({ ask_id: "y", status: "declined" }),
		];
		expect(orderedForDisplay(rows).map((row) => row.ask_id)).toEqual([
			"x",
			"y",
		]);
	});
});

describe("headAsk / dockAsk", () => {
	it("is the OLDEST open ask, not the wire list's first row", () => {
		const newer = ask({ ask_id: "new", created_at: 900 });
		const older = ask({ ask_id: "old", created_at: 100 });
		expect(headAsk([newer, older])?.ask_id).toBe("old");
	});

	it("breaks a same-millisecond tie by ask_id — the web dock's rule", () => {
		/* Ported from `lib/asks.ts:225` at the pin: two asks can share a
		 *  millisecond, and a scan-order tie would let the bar name a different
		 *  ask than the web dock names for the same queue (agent review
		 *  round 1, m1). */
		const a = ask({ ask_id: "a", created_at: 500 });
		const b = ask({ ask_id: "b", created_at: 500 });
		expect(headAsk([a, b])?.ask_id).toBe("a");
		expect(headAsk([b, a])?.ask_id).toBe("a");
	});

	it("ignores a timed-out ask for the HEAD but offers it as the dock fallback", () => {
		const timeout = ask({ ask_id: "t", status: "timed_out" });
		expect(headAsk([timeout])).toBeNull();
		expect(dockAsk([timeout])?.ask_id).toBe("t");
	});
});

describe("outstanding / answerable", () => {
	it("counts the asks still needing an answer, and only those", () => {
		const rows = [
			ask({ ask_id: "a", status: "open" }),
			ask({ ask_id: "b", status: "timed_out" }),
			ask({ ask_id: "c", status: "answered" }),
			ask({ ask_id: "d", status: "expired" }),
			ask({ ask_id: "e", status: "dismissed" }),
		];
		expect(outstandingAsks(rows).map((row) => row.ask_id)).toEqual(["a", "b"]);
	});

	it("treats a timed-out ask as answerable and an answered one as not", () => {
		expect(isAnswerable("timed_out")).toBe(true);
		expect(isAnswerable("answered")).toBe(false);
		expect(isOutstanding("open")).toBe(true);
		expect(isOutstanding("late")).toBe(false);
	});

	it("has no opinion of its own when the field is absent — absence is not empty", () => {
		expect(outstandingAsks(undefined)).toEqual([]);
		expect(outstandingAsks(null)).toEqual([]);
	});
});

describe("the bar's question count (the unit split)", () => {
	it("counts QUESTIONS of the outstanding set, including timers still answerable", () => {
		const single = ask();
		const rows = [
			ask({
				ask_id: "a",
				questions: [...single.questions, ...single.questions],
			}),
			ask({ ask_id: "b", status: "timed_out" }),
			ask({ ask_id: "c", status: "answered" }),
		];
		expect(outstandingQuestions(rows)).toBe(3);
	});

	it("labels its unit, singular and plural, so it cannot be read as asks", () => {
		expect(questionsWaitingLabel(1)).toBe("1 question waiting");
		expect(questionsWaitingLabel(3)).toBe("3 questions waiting");
	});
});

describe("questionProgress", () => {
	it("counts answers already landed — the form's progress arithmetic", () => {
		const row = ask({
			questions: [
				{
					id: "q1",
					question: "one",
					options: [],
					multi: false,
					secret: false,
					persist: false,
				},
				{
					id: "q2",
					question: "two",
					options: [],
					multi: false,
					secret: false,
					persist: false,
				},
				{
					id: "q3",
					question: "three",
					options: [],
					multi: false,
					secret: false,
					persist: false,
				},
			],
			answers: { q1: ["yes"] },
		});
		expect(questionProgress(row)).toEqual({ index: 1, total: 3 });
	});
});

describe("unansweredQuestions", () => {
	it("drops settled answers AND the legacy path's drafts", () => {
		const row = ask({
			questions: [
				{
					id: "q1",
					question: "one",
					options: [],
					multi: false,
					secret: false,
					persist: false,
				},
				{
					id: "q2",
					question: "two",
					options: [],
					multi: false,
					secret: false,
					persist: false,
				},
			],
			answers: { q1: ["yes"] },
			draft_question_ids: ["q2"],
		});
		expect(unansweredQuestions(row)).toEqual([]);
	});
});

describe("answeredPairs", () => {
	it("renders one line per question, option label plus its consequence", () => {
		const pairs = answeredPairs(
			[
				{
					id: "q1",
					question: "which?",
					options: [{ label: "safe", description: "keeps the data" }],
					multi: false,
					secret: false,
					persist: false,
				},
			],
			{ q1: ["safe"] },
		);
		expect(pairs).toEqual([
			{ question: "which?", answer: "safe — keeps the data" },
		]);
	});
});

describe("blockingPending (N3)", () => {
	it("ignores a mirrored ask once the asks field is present", () => {
		expect(blockingPending({ kind: "ask" }, [ask()])).toBeNull();
	});

	it("keeps an approval, and keeps the mirror when the runtime cannot publish asks", () => {
		expect(blockingPending({ kind: "approval" }, [ask()])).toEqual({
			kind: "approval",
		});
		expect(blockingPending({ kind: "ask" }, undefined)).toEqual({
			kind: "ask",
		});
	});
});

describe("answeredBySurface", () => {
	it("names the surface that beat this one to the answer", () => {
		expect(
			answeredBySurface(ask({ answered_by: { surface: "terminal" } })),
		).toBe("terminal");
		expect(answeredBySurface(ask({}))).toBe("");
	});
});

describe("asksPopulationSignature", () => {
	it("moves on counts, not on row order — a re-rank is not new information", () => {
		const a = summary({ session_id: "s1", asks_open: 2 });
		const b = summary({ session_id: "s2", asks_open: 1 });
		expect(asksPopulationSignature([a, b])).toBe(
			asksPopulationSignature([b, a]),
		);
	});

	it("moves when a count changes", () => {
		expect(
			asksPopulationSignature([summary({ session_id: "s1", asks_open: 1 })]),
		).not.toBe(
			asksPopulationSignature([summary({ session_id: "s1", asks_open: 2 })]),
		);
	});

	it("reads absence as nothing — never as a zero", () => {
		/* The capability proxy (§4): a row that does not publish the field
		 *  contributes NOTHING, so an older relay's frame cannot look like a
		 *  settlement and fire a re-read. */
		expect(asksPopulationSignature([summary({ session_id: "s1" })])).toBe("");
		expect(
			asksPopulationSignature([summary({ session_id: "s1", asks_open: 0 })]),
		).toBe("");
		expect(asksPopulationSignature(undefined)).toBe("");
	});
});
