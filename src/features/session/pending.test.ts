import { describe, expect, it } from "vitest";

import type { PendingRequest } from "@/contracts";
import {
	isDestructiveDetail,
	PENDING_BOUNDARY_COPY,
	pendingView,
} from "@/features/session/pending";

/**
 * The pending card's rules, all three of which are findings from the shipped
 * client's own audit: the terminal boundary (R10), the remember label's scope
 * (R12), and the multi-question identity.
 */

const pending = (overrides: Partial<PendingRequest> = {}): PendingRequest => ({
	request_id: "req-1",
	kind: "approval",
	title: "bash",
	detail: "run: sleep 20",
	options: [],
	secret: false,
	question_index: 0,
	question_total: 1,
	recommended: null,
	persist: false,
	...overrides,
});

const view = (
	overrides: Partial<PendingRequest> = {},
	sessionKind = "daemon",
	ended = false,
) =>
	pendingView({
		pending: pending(overrides),
		sessionKind,
		ended,
		pendingCount: 1,
		computerLabel: "Studio desktop",
		cwd: "~/work",
	});

describe("the ended boundary", () => {
	it("offers no control for a session that has ended, and says which boundary it is", () => {
		// The relay's own capture of an ended frame carries `pending: null`, so this
		// is the defensive half of the rule — but the failure it prevents is a card
		// that offers an answer to a session that can no longer accept one, and the
		// sentence must name the END rather than the terminal, because that is the
		// cause the reader has to work with.
		const ended = view({}, "daemon", true);
		expect(ended.terminalOnly).toBe(true);
		expect(ended.boundarySentence).toBe(PENDING_BOUNDARY_COPY.ended);
		expect(ended.boundarySentence).not.toBe(PENDING_BOUNDARY_COPY.terminal);
		// A live session still gets its controls and no boundary sentence at all.
		const live = view();
		expect(live.terminalOnly).toBe(false);
		expect(live.boundarySentence).toBeNull();
	});
});

describe("the terminal boundary (R10)", () => {
	it("offers no control for a session owned by the reader's terminal", () => {
		// The approval is answered at the terminal it was raised in. A button that
		// cannot work is worse than no button: the reader presses it and concludes the
		// app is broken rather than that the decision is theirs to make elsewhere.
		expect(view({}, "tui").terminalOnly).toBe(true);
	});

	it("lets the phone answer a supervised session", () => {
		expect(view({}, "daemon").terminalOnly).toBe(false);
		expect(view({}, "exec").terminalOnly).toBe(false);
	});
});

describe("the remember label names its scope (R12)", () => {
	it("names the tool and the session, not 'this choice'", () => {
		expect(view().rememberLabel).toBe("Always allow `bash` in this session");
	});

	it("falls back to a readable word when the request carries no tool name", () => {
		expect(view({ title: "" }).rememberLabel).toBe(
			"Always allow `this tool` in this session",
		);
	});
});

describe("a multi-question ask is identifiable and re-keyable", () => {
	it("labels the question and carries a numeric anchor for the flow", () => {
		const first = view({ kind: "ask", question_index: 0, question_total: 2 });
		expect(first.questionLabel).toBe("Question 1 of 2");
		// Built from the numbers, because `05-approval-answer` addresses this id and a
		// testID recovered from display copy is one copy edit from vanishing.
		expect(first.questionTestID).toBe("ask-question-1-of-2");

		const second = view({ kind: "ask", question_index: 1, question_total: 2 });
		expect(second.questionLabel).toBe("Question 2 of 2");
		expect(second.questionTestID).toBe("ask-question-2-of-2");
	});

	it("says nothing about questions when there is only one", () => {
		expect(view({ kind: "ask" }).questionLabel).toBeNull();
		expect(view({ kind: "ask" }).questionTestID).toBeNull();
	});
});

describe("the card's counts and shapes", () => {
	it("badges only when more than one decision is waiting", () => {
		expect(
			pendingView({
				pending: pending(),
				sessionKind: "daemon",
				ended: false,
				pendingCount: 3,
				computerLabel: "c",
				cwd: "~/w",
			}).badge,
		).toBe("1 of 3");
		expect(view().badge).toBeNull();
	});

	it("reads a free-text ask as free text, and keeps the wire's option order", () => {
		const free = view({ kind: "ask" });
		expect(free.freeText).toBe(true);

		const picker = view({
			kind: "ask",
			recommended: 1,
			options: [
				{ label: "Use the stored key", description: "Reads the store." },
				{ label: "Paste a new key", description: "Used once." },
			],
		});
		expect(picker.freeText).toBe(false);
		// The recommended index is into the options AS CARRIED: re-sorting and keeping
		// the index would mark the wrong one.
		expect(picker.options.map((option) => option.recommended)).toEqual([
			false,
			true,
		]);
		expect(picker.options.map((option) => option.testID)).toEqual([
			"ask-option-0",
			"ask-option-1",
		]);
	});
});

describe("the destructive sentence", () => {
	it("flags the fixture's force-push, which is the case the flow pins", () => {
		// The harness's own approval example: `git push --force-with-lease`.
		expect(
			isDestructiveDetail(
				"run: git push --force-with-lease origin docs/relay-map",
			),
		).toBe(true);
	});

	it("leaves an ordinary command as merely running somewhere", () => {
		expect(isDestructiveDetail("run: sleep 20")).toBe(false);
	});

	it("names the destination rather than implying it", () => {
		expect(view().runsOnComputer).toBe(true);
		expect(view().riskLabel).toBe("Runs on ~/work");
		expect(view({ detail: "run: rm -rf build" }).riskLabel).toBe(
			"Destructive — runs on ~/work",
		);
	});

	it("falls back to the computer's name when the session reports no directory", () => {
		const noCwd = pendingView({
			pending: pending({ detail: "run: rm -rf build" }),
			sessionKind: "daemon",
			ended: false,
			pendingCount: 1,
			computerLabel: "Studio desktop",
			cwd: "",
		});
		expect(noCwd.riskLabel).toBe("Destructive — runs on Studio desktop");
	});

	it("never marks a QUESTION as an execution", () => {
		const ask = view({ kind: "ask", detail: "run: rm -rf build" });
		expect(ask.runsOnComputer).toBe(false);
		expect(ask.destructive).toBe(false);
	});
});
