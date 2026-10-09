import { describe, expect, it } from "vitest";

import type { AskQuestion, PendingAsk, SessionSummary } from "@/contracts";
import {
	answeredBySurface,
	answeredPairs,
	askResponseBody,
	askStateLine,
	asksPopulationSignature,
	asksReadFailureLine,
	askToneInk,
	blockingPending,
	composedAnswer,
	dockAsk,
	durationLabel,
	EMPTY_OTHER,
	hasOtherDoor,
	headAsk,
	isAnswerable,
	isOutstanding,
	orderedForDisplay,
	outstandingAsks,
	outstandingQuestions,
	questionIsAnswered,
	questionProgress,
	questionsWaitingLabel,
	READ_FAILED,
	REFRESH_FAILED_ROWS_DRAWN,
	RUNTIME_PREDATES_ASKS,
	readFailureNotice,
	refusalText,
	remainingMs,
	unansweredQuestions,
} from "@/features/session/asks";
import { type RelayResponseFacts, relayErrorFromResponse } from "@/relay";

/**
 * The ask vocabulary, and the decisions that are easy to get subtly wrong:
 * which ask is the HEAD (the OLDEST open one, never the list's first row — the
 * wire leads with the newest, and a bar that jumped to each arrival would move
 * under a thumb), whether the legacy mirrored card is still a blocking gate
 * (design §4's client rule N3: once `asks` is present, `kind === "ask"` is
 * not), the unit split the manager of this round fixed (the bar counts
 * QUESTIONS, the badge counts ASKS), and the `Other` door: where it stands,
 * what its text does on a single- vs a multi-select question, and that an empty
 * door is not an answer.
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

	it("names a withdrawal as the agent's own retraction, never a failure", () => {
		/* The agent retracted the question and nothing will be sent for it
		   (design §12; the web lane's settled register carries the identical
		   sentence, word for word). */
		expect(askStateLine(ask({ status: "withdrawn" }), 1)).toEqual({
			text: "Withdrawn — the agent no longer needs an answer",
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

	it("keeps a withdrawn ask out of the outstanding set — and off the bar", () => {
		/* Design §12: a withdrawn ask "is not answerable from any surface (its
		   box hides everywhere — `withdrawn` is not outstanding)". Not the bar,
		   not its count, not the dock — and the sheet's answer controls gate on
		   the same predicate (`isAnswerable`), so they hide with it. */
		const rows = [ask({ ask_id: "w", status: "withdrawn" })];
		expect(outstandingAsks(rows)).toEqual([]);
		expect(outstandingQuestions(rows)).toBe(0);
		expect(dockAsk(rows)).toBeNull();
	});

	it("treats a timed-out ask as answerable and an answered one as not", () => {
		expect(isAnswerable("timed_out")).toBe(true);
		expect(isAnswerable("answered")).toBe(false);
		expect(isOutstanding("open")).toBe(true);
		expect(isOutstanding("late")).toBe(false);
		/* The retracted state in the same breath — this ONE predicate is what
		   hides its answer controls (§12). */
		expect(isAnswerable("withdrawn")).toBe(false);
		expect(isOutstanding("withdrawn")).toBe(false);
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

describe("the Other door (design §5.0)", () => {
	/** One option question carrying only what the door reads. */
	function question(patch: Partial<AskQuestion> = {}): AskQuestion {
		return {
			id: "q1",
			question: "which?",
			options: [
				{ label: "safe", description: "keeps the data" },
				{ label: "fast", description: "ships sooner" },
			],
			multi: false,
			secret: false,
			persist: false,
			...patch,
		};
	}

	it("stands on every non-secret option question, in both select modes", () => {
		expect(hasOtherDoor(question())).toBe(true);
		expect(hasOtherDoor(question({ multi: true }))).toBe(true);
	});

	it("is absent on a free-text-only question — its input is its only control", () => {
		expect(hasOtherDoor(question({ options: [] }))).toBe(false);
	});

	it("is absent on a secret question — the masked field is its free-form entry", () => {
		expect(hasOtherDoor(question({ secret: true, options: [] }))).toBe(false);
		/* Secret questions carry no options today; the gate is on `secret` so a
		 * future shape cannot smuggle the door in beside a credential. */
		expect(hasOtherDoor(question({ secret: true }))).toBe(false);
	});

	describe("the composed answer", () => {
		it("single-select: an open Other excludes the options — its text alone", () => {
			expect(
				composedAnswer(question(), ["safe"], {
					open: true,
					text: "  something else  ",
				}),
			).toEqual(["something else"]);
		});

		it("single-select: an empty open Other is not an answer", () => {
			expect(
				composedAnswer(question(), ["safe"], { open: true, text: "   " }),
			).toEqual([]);
		});

		it("single-select: a closed Other leaves the option's label", () => {
			expect(composedAnswer(question(), ["safe"], EMPTY_OTHER)).toEqual([
				"safe",
			]);
		});

		it("multi-select: Other is additive and last — the order the card draws", () => {
			expect(
				composedAnswer(question({ multi: true }), ["safe", "fast"], {
					open: true,
					text: "cheap",
				}),
			).toEqual(["safe", "fast", "cheap"]);
		});

		it("multi-select: an empty open Other contributes nothing; the ticks stay", () => {
			expect(
				composedAnswer(question({ multi: true }), ["safe"], {
					open: true,
					text: " ",
				}),
			).toEqual(["safe"]);
		});

		it("multi-select: a closed Other keeps its text out of the answer", () => {
			expect(
				composedAnswer(question({ multi: true }), ["safe"], {
					open: false,
					text: "cheap",
				}),
			).toEqual(["safe"]);
		});

		it("free-text-only: the cell is the answer, door or none", () => {
			expect(
				composedAnswer(question({ options: [] }), ["typed"], EMPTY_OTHER),
			).toEqual(["typed"]);
		});
	});

	describe("the Answer gate", () => {
		it("opens on a typed Other and stays shut on an empty one", () => {
			expect(
				questionIsAnswered(question(), [], { open: true, text: "x" }),
			).toBe(true);
			expect(
				questionIsAnswered(question(), [], { open: true, text: "  " }),
			).toBe(false);
		});

		it("keeps reading a plain option tick as answered", () => {
			expect(questionIsAnswered(question(), ["safe"], EMPTY_OTHER)).toBe(true);
		});

		it("holds a multi-select open while the door is open and empty — the desktop's rule", () => {
			/* R1-1/Q4: ticks beside an open, empty `Other` used to complete the
			 * question, so the submit sent them and silently dropped the door the
			 * reader had just opened. The desktop card refuses exactly this state
			 * (`askQuestionIsAnswered`, UI #892), and the app takes that rule —
			 * THIS cell is what fails if it is ever removed (the reviewer inserted
			 * the rule and the whole suite stayed green: R1-4). */
			const multi = question({ multi: true });
			expect(
				questionIsAnswered(multi, ["safe", "fast"], {
					open: true,
					text: "   ",
				}),
			).toBe(false);
			/* The other direction, so the rule cannot over-apply: one typed
			 * character completes the question, and an untick that keeps its text
			 * (a closed door) sends the ticks alone as before. */
			expect(
				questionIsAnswered(multi, ["safe", "fast"], {
					open: true,
					text: "cheap",
				}),
			).toBe(true);
			expect(
				questionIsAnswered(multi, ["safe", "fast"], {
					open: false,
					text: "cheap",
				}),
			).toBe(true);
		});
	});

	it("walks the card's own sequence: option → Other → type → option → Other", () => {
		/* The transitions the sheet performs, read through the ONE composition —
		 * including the two the desktop card's regressions named: an option press
		 * closes the door but KEEPS its text, and coming back restores it. */
		const q = question();
		/* 1. An option press: the label is the answer. */
		expect(composedAnswer(q, ["safe"], EMPTY_OTHER)).toEqual(["safe"]);
		/* 2. Pressing Other opens it; empty and open is NOT an answer. */
		expect(questionIsAnswered(q, ["safe"], { open: true, text: "" })).toBe(
			false,
		);
		/* 3. Typing: the text alone — the exclusion. */
		expect(
			composedAnswer(q, ["safe"], { open: true, text: "neither" }),
		).toEqual(["neither"]);
		/* 4. An option press closes the door, its text kept for a mis-click. */
		const closed = { open: false, text: "neither" };
		expect(composedAnswer(q, ["fast"], closed)).toEqual(["fast"]);
		/* 5. Coming back restores the typed text. */
		expect(composedAnswer(q, ["fast"], { ...closed, open: true })).toEqual([
			"neither",
		]);
	});

	describe("the whole-ask body (ask_respond)", () => {
		it("carries the typed Other text as a plain string — alone, or last on a multi", () => {
			const body = askResponseBody(
				[question({ id: "q1" }), question({ id: "q2", multi: true })],
				{
					answers: { q1: ["safe"], q2: ["fast"] },
					others: {
						q1: { open: true, text: "another plan" },
						q2: { open: true, text: "and cheap" },
					},
					skipped: [],
				},
			);
			expect(body).toEqual({
				q1: ["another plan"],
				q2: ["fast", "and cheap"],
			});
		});

		it("keeps every question id present, a skip as the empty list", () => {
			const body = askResponseBody(
				[question({ id: "q1" }), question({ id: "q2" })],
				{ answers: { q1: ["safe"] }, others: {}, skipped: ["q2"] },
			);
			expect(body).toEqual({ q1: ["safe"], q2: [] });
		});

		it("trims what travels", () => {
			const body = askResponseBody([question({ id: "q1" })], {
				answers: {},
				others: { q1: { open: true, text: "  spaced  " } },
				skipped: [],
			});
			expect(body.q1).toEqual(["spaced"]);
		});

		it("dedupes an `Other` text equal to a ticked label — once on the wire, first kept", () => {
			/* R1-3: `["fast","fast"]` used to travel and render twice. The
			 * desktop dedupes before the wire (`askAnswerMap`, UI #892) and this
			 * takes the same rule where the whole-ask body is built. */
			const body = askResponseBody([question({ id: "q2", multi: true })], {
				answers: { q2: ["safe", "fast"] },
				others: { q2: { open: true, text: "safe" } },
				skipped: [],
			});
			expect(body).toEqual({ q2: ["safe", "fast"] });
		});

		it("composes the ticks for an open-empty door — the gate is what refuses, not the composition", () => {
			/* R1-4's request-body twin of the gate cell: the composition still holds
			 * the ticks (the empty door contributes nothing), while
			 * `questionIsAnswered` — not this function — is what stops the submit
			 * carrying them silently past the door the reader opened. Pinned beside
			 * the gate cell so a future change cannot flip either half alone. */
			const multi = askResponseBody([question({ id: "q2", multi: true })], {
				answers: { q2: ["safe", "fast"] },
				others: { q2: { open: true, text: "   " } },
				skipped: [],
			});
			expect(multi).toEqual({ q2: ["safe", "fast"] });
			const single = askResponseBody([question({ id: "q1" })], {
				answers: {},
				others: { q1: { open: true, text: "" } },
				skipped: [],
			});
			expect(single).toEqual({ q1: [] });
		});
	});
});

describe("answeredPairs", () => {
	/** One option question carrying only what the frame reads. */
	function question(patch: Partial<AskQuestion> = {}): AskQuestion {
		return {
			id: "q1",
			question: "which?",
			options: [
				{ label: "safe", description: "keeps the data" },
				{ label: "fast", description: "ships sooner" },
			],
			multi: false,
			secret: false,
			persist: false,
			...patch,
		};
	}

	it("keeps each value as written — a list per question, no description attached", () => {
		/* The desktop's answer frame "keeps what was written" (UI #892) and draws
		 * each value on its own line; the old ` — description` suffix is gone (see
		 * the function's note). */
		expect(answeredPairs([question()], { q1: ["safe"] })).toEqual([
			{ question: "which?", values: [{ text: "safe", other: false }] },
		]);
	});

	it("tags a value the list did not offer — the desktop's muted `Other`", () => {
		expect(
			answeredPairs([question()], { q1: ["safe", "the canary cluster"] }),
		).toEqual([
			{
				question: "which?",
				values: [
					{ text: "safe", other: false },
					{ text: "the canary cluster", other: true },
				],
			},
		]);
	});

	it("never attaches an option's description to typed text that equals a label", () => {
		/* `safe` here may be a tick OR the reader's own words: the wire carries
		 * plain strings and cannot say which, so NO value may carry its option's
		 * description. The check U1 asked for is enforced by the absence of any
		 * attachment at all, pinned by exact equality rather than a substring
		 * read. */
		expect(answeredPairs([question()], { q1: ["safe"] })).toEqual([
			{ question: "which?", values: [{ text: "safe", other: false }] },
		]);
	});

	it("tags nothing on a secret question or a question with no list", () => {
		expect(
			answeredPairs([question({ secret: true })], { q1: ["DEPLOY_KEY"] }),
		).toEqual([
			{ question: "which?", values: [{ text: "DEPLOY_KEY", other: false }] },
		]);
		expect(
			answeredPairs([question({ options: [] })], { q1: ["anything"] }),
		).toEqual([
			{ question: "which?", values: [{ text: "anything", other: false }] },
		]);
	});

	it("keeps the frame's shape for a question with no answer — an empty list", () => {
		expect(answeredPairs([question()], {})).toEqual([
			{ question: "which?", values: [] },
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

/** A response as the classifier reads it — the same shape `errors.test.ts` uses. */
function facts(
	status: number,
	headers: Record<string, string> = {},
	defaultText = "",
): RelayResponseFacts & { text: string } {
	const lower = new Map(
		Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
	);
	return {
		status,
		header: (name: string) => lower.get(name.toLowerCase()) ?? null,
		text: defaultText,
	};
}

/**
 * The line the sheet shows when the aggregate read fails.
 *
 * A 404 is deliberately overloaded on the wire: the relay answers it for "this
 * route does not exist" (the route is additive, so the daemon is simply older),
 * and the edge in front of it answers it for "this hostname is not a tunnel".
 * Reading the status alone turns a dead tunnel into "update local-operator",
 * which is a false statement about where the problem is — so the two cases are
 * asserted together, and the un-reachable one must NOT wear the older-daemon
 * sentence.
 */
describe("the sheet's line for a failed aggregate read", () => {
	it("calls the relay's own 404 an older daemon — the one answer a reader can act on", () => {
		const older = relayErrorFromResponse(
			facts(
				404,
				{ "content-type": "application/json" },
				'{"error":"not found"}',
			),
		);
		expect(older.kind).toBe("rejected");
		expect(asksReadFailureLine(older)).toBe(RUNTIME_PREDATES_ASKS);
	});

	it("never reads a dead tunnel's 404 as an old daemon — the host was not reached", () => {
		const deadTunnel = relayErrorFromResponse(
			facts(404, { "content-type": "text/plain" }, "Unknown tunnel"),
		);
		expect(deadTunnel.kind).toBe("unknown-tunnel");
		expect(asksReadFailureLine(deadTunnel)).not.toBe(RUNTIME_PREDATES_ASKS);
		expect(asksReadFailureLine(deadTunnel)).toBe(READ_FAILED);
	});

	it("keeps the relay's own sentence for a refusal it did answer with", () => {
		const refused = relayErrorFromResponse(
			facts(
				503,
				{ "content-type": "application/json" },
				'{"detail":"Tunnel authorization unavailable","reason":"authorization_refused"}',
			),
		);
		expect(asksReadFailureLine(refused)).toBe(refused.displayableMessage);
		expect(refusalText(refused)).toBe(refused.displayableMessage);
	});

	it("reads a failure with no relay sentence, and a non-relay one, as unreachable", () => {
		expect(asksReadFailureLine(new TypeError("boom"))).toBe(READ_FAILED);
	});
});

describe("the failure line over drawn rows (round 3, U12)", () => {
	it("scopes the failure to the list and says answering still works while rows are drawn", () => {
		expect(readFailureNotice(READ_FAILED, 1)).toBe(REFRESH_FAILED_ROWS_DRAWN);
		expect(REFRESH_FAILED_ROWS_DRAWN).toContain("list");
		expect(REFRESH_FAILED_ROWS_DRAWN).toContain("still answer");
	});

	it("keeps the read's own sentence when nothing is drawn: there is no form to reassure about", () => {
		expect(readFailureNotice(RUNTIME_PREDATES_ASKS, 0)).toBe(
			RUNTIME_PREDATES_ASKS,
		);
	});

	it("says nothing when the read did not fail", () => {
		expect(readFailureNotice("", 3)).toBe("");
	});
});
