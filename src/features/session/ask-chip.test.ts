import { describe, expect, it } from "vitest";

import type { AskQuestion, PendingAsk } from "@/contracts";
import {
	type AskChipReceipt,
	askChipFacts,
	askChipOpen,
	askChipSignature,
	askChipWord,
	askIdSegments,
	isAskId,
} from "@/features/session/ask-chip";

const question = (text: string): AskQuestion => ({
	id: "q1",
	question: text,
	options: [],
	multi: false,
	secret: false,
	persist: false,
});

const ask = (over: Partial<PendingAsk> = {}): PendingAsk => ({
	ask_id: "a-745e",
	created_at: 1,
	expires_at: 0,
	timeout_s: 0,
	urgent: false,
	status: "open",
	delivered: false,
	questions: [question("Which layout?")],
	...over,
});

const receipt = (over: Partial<AskChipReceipt> = {}): AskChipReceipt => ({
	kind: "ask_response",
	details: { ask_id: "a-745e", status: "answered" },
	...over,
});

describe("askIdSegments", () => {
	it("passes prose with no id through as one run", () => {
		expect(askIdSegments("the old one is gone")).toEqual([
			{ kind: "text", text: "the old one is gone" },
		]);
	});

	it("lifts an exact id out of a sentence, punctuation outside", () => {
		expect(askIdSegments("the ask (a-745e) waits.")).toEqual([
			{ kind: "text", text: "the ask (" },
			{ kind: "ask", id: "a-745e" },
			{ kind: "text", text: ") waits." },
		]);
	});

	it("matches an id that is the whole span (a backticked id)", () => {
		expect(askIdSegments("a-745e")).toEqual([{ kind: "ask", id: "a-745e" }]);
		expect(isAskId("a-745e")).toBe(true);
	});

	it("finds every id in one run", () => {
		expect(askIdSegments("a-745e and a-e53b")).toEqual([
			{ kind: "ask", id: "a-745e" },
			{ kind: "text", text: " and " },
			{ kind: "ask", id: "a-e53b" },
		]);
	});

	it("refuses a longer hex run, a longer token and upper case", () => {
		for (const text of ["a-745e6", "xa-745e", "sha-745e", "a-745E"])
			expect(askIdSegments(text).every((part) => part.kind === "text")).toBe(
				true,
			);
	});

	it("lifts the id out of an id prefixed by punctuation", () => {
		expect(askIdSegments("ask:a-745e")).toEqual([
			{ kind: "text", text: "ask:" },
			{ kind: "ask", id: "a-745e" },
		]);
	});

	it("returns nothing for an empty run", () => {
		expect(askIdSegments("")).toEqual([]);
	});
});

describe("askChipWord", () => {
	it("names every state the runtime can settle an ask into", () => {
		for (const status of [
			"open",
			"answered",
			"declined",
			"timed_out",
			"late",
			"dismissed",
			"withdrawn",
			"expired",
		])
			expect(askChipWord(status)).toEqual({
				kind: "key",
				key: `mobile.asks.chip.${status}`,
			});
	});

	it("passes an unknown state through in its own words rather than as a known one", () => {
		expect(askChipWord("awaiting_review")).toEqual({
			kind: "literal",
			text: "awaiting review",
		});
		expect(askChipWord("")).toBeNull();
	});

	it("draws only an open ask's dot in the accent", () => {
		expect(askChipOpen("open")).toBe(true);
		expect(askChipOpen("answered")).toBe(false);
	});
});

describe("askChipFacts", () => {
	it("takes the live frame first, with its question squashed to one line", () => {
		const facts = askChipFacts(
			{ frame: [ask({ questions: [question("  Which\n layout? ")] })] },
			"sid",
		);
		expect(facts.get("a-745e")).toEqual({
			status: "open",
			question: "Which layout?",
		});
	});

	it("reads a settled receipt the frame no longer carries", () => {
		const facts = askChipFacts({ transcript: [receipt()] }, "sid");
		expect(facts.get("a-745e")?.status).toBe("answered");
	});

	it("reads a timeout receipt as timed_out even when the wire omits the status", () => {
		const facts = askChipFacts(
			{
				transcript: [
					receipt({ kind: "ask_timeout", details: { ask_id: "a-745e" } }),
				],
			},
			"sid",
		);
		expect(facts.get("a-745e")?.status).toBe("timed_out");
	});

	it("prefers the live frame over a receipt, so a settled-elsewhere ask is not still open", () => {
		const facts = askChipFacts(
			{
				frame: [ask({ status: "answered" })],
				transcript: [
					receipt({ details: { ask_id: "a-745e", status: "open" } }),
				],
			},
			"sid",
		);
		expect(facts.get("a-745e")?.status).toBe("answered");
	});

	it("keeps the queue read to THIS session, because ids repeat across sessions", () => {
		const facts = askChipFacts(
			{
				settled: [
					ask({ ask_id: "a-745e", session_id: "other", status: "withdrawn" }),
					ask({ ask_id: "a-e53b", session_id: "sid", status: "withdrawn" }),
				],
			},
			"sid",
		);
		expect(facts.has("a-745e")).toBe(false);
		expect(facts.get("a-e53b")?.status).toBe("withdrawn");
	});

	it("answers nothing before any source has landed", () => {
		expect(askChipFacts({}, "sid").size).toBe(0);
		expect(askChipFacts({ frame: null, settled: null }, "sid").size).toBe(0);
	});
});

describe("askChipSignature", () => {
	it("is the same for the same states, in a different insertion order", () => {
		const a = askChipFacts({ frame: [ask({ ask_id: "a-1111" })] }, "sid");
		a.set("a-2222", { status: "declined", question: "" });
		const b = askChipFacts({ frame: [ask({ ask_id: "a-1111" })] }, "sid");
		b.set("a-2222", { status: "declined", question: "" });
		expect(askChipSignature(a)).toBe(askChipSignature(b));
	});

	it("changes when one id's state changes", () => {
		const before = askChipFacts({ frame: [ask()] }, "sid");
		const after = askChipFacts({ frame: [ask({ status: "answered" })] }, "sid");
		expect(askChipSignature(before)).not.toBe(askChipSignature(after));
	});
});
