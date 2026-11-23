/**
 * The in-memory draft store for a half-typed ask answer.
 *
 * The rules these cases pin are the operator's answers on a-5712 and the ADR
 * boundary they amended: a draft survives a close (in memory, keyed by
 * conversation + ask), a SECRET question's answer is never kept at all, and a
 * draft is dropped the moment its ask is settled or is no longer outstanding.
 */
import { afterEach, describe, expect, it } from "vitest";

import type { AskQuestion } from "@/contracts";
import {
	type AskDraftRecord,
	askDraftKey,
	dropAskDraft,
	forgetAskDrafts,
	readAskDraft,
	retainAskDrafts,
	secretQuestionIds,
	writeAskDraft,
} from "@/features/session/ask-drafts";
import { EMPTY_OTHER } from "@/features/session/asks";

const KEY = askDraftKey("session-1", "ask-1");

const draft = (text = "typed answer"): AskDraftRecord => ({
	answers: { q1: [] },
	others: { q1: { open: true, text } },
	skipped: [],
});

/** The typed text the store holds for `key` (the single question these cases
 *  use), read through the record rather than a guessed index. */
const keptText = (key: string): string | null => {
	const kept = readAskDraft(key);
	if (kept === null) return null;
	return Object.values(kept.others)[0]?.text ?? null;
};

const question = (over: Partial<AskQuestion> = {}): AskQuestion =>
	({ id: "q1", question: "Where?", ...over }) as AskQuestion;

afterEach(() => forgetAskDrafts());

describe("askDraftKey", () => {
	it("keeps two asks of the same conversation apart", () => {
		expect(askDraftKey("s", "a1")).not.toBe(askDraftKey("s", "a2"));
	});

	it("keeps the same ask id apart across conversations", () => {
		expect(askDraftKey("s1", "a")).not.toBe(askDraftKey("s2", "a"));
	});
});

describe("writeAskDraft / readAskDraft", () => {
	it("keeps the typed text so a reopen can restore it", () => {
		writeAskDraft(KEY, draft("keep me"), new Set());
		expect(keptText(KEY)).toBe("keep me");
	});

	it("is empty for an ask nobody typed into", () => {
		expect(readAskDraft(askDraftKey("s", "never"))).toBeNull();
	});

	it("copies the record, so a later edit of the caller's object cannot mutate it", () => {
		const record = draft("first");
		writeAskDraft(KEY, record, new Set());
		const other = Object.values(record.others)[0];
		if (other) other.text = "second";
		expect(keptText(KEY)).toBe("first");
	});
});

describe("secret questions", () => {
	it("NEVER keeps a secret question's typed answer", () => {
		const secret = secretQuestionIds([question({ secret: true })]);
		writeAskDraft(
			KEY,
			{
				answers: { q1: [] },
				others: { q1: { open: true, text: "hunter2" } },
				skipped: [],
			},
			secret,
		);
		const kept = readAskDraft(KEY);
		expect(kept?.others.q1).toBeUndefined();
		expect(kept?.answers.q1).toBeUndefined();
	});

	it("still keeps the other questions of the same ask", () => {
		writeAskDraft(
			KEY,
			{
				answers: { q1: ["safe"], q2: ["secret"] },
				others: {},
				skipped: [],
			},
			secretQuestionIds([question({ id: "q2", secret: true })]),
		);
		expect(readAskDraft(KEY)?.answers).toEqual({ q1: ["safe"] });
	});

	it("reads an unmarked question as not secret", () => {
		expect(secretQuestionIds([question(), question({ id: "q2" })]).size).toBe(
			0,
		);
	});
});

describe("settling and the outstanding set", () => {
	it("drops a draft whose ask is no longer outstanding", () => {
		writeAskDraft(KEY, draft(), new Set());
		writeAskDraft(askDraftKey("s", "still-open"), draft(), new Set());
		retainAskDrafts(new Set([askDraftKey("s", "still-open")]));
		expect(readAskDraft(KEY)).toBeNull();
		expect(readAskDraft(askDraftKey("s", "still-open"))).not.toBeNull();
	});

	it("drops one ask's draft without touching another's", () => {
		const other = askDraftKey("s", "other");
		writeAskDraft(KEY, draft("a"), new Set());
		writeAskDraft(other, draft("b"), new Set());
		dropAskDraft(KEY);
		expect(readAskDraft(KEY)).toBeNull();
		expect(keptText(other)).toBe("b");
	});

	it("keeps the skipped set, which is an answer in its own right", () => {
		writeAskDraft(KEY, { ...draft(), skipped: ["q1"] }, new Set());
		expect(readAskDraft(KEY)?.skipped).toEqual(["q1"]);
	});

	it("has no EMPTY_OTHER mark left by a cleared door", () => {
		writeAskDraft(
			KEY,
			{ answers: {}, others: { q2: EMPTY_OTHER }, skipped: [] },
			new Set(),
		);
		expect(readAskDraft(KEY)?.others.q2?.open).toBe(false);
	});
});
