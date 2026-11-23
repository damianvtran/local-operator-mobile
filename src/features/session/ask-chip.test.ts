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

	it("refuses an id inside a URL, a path or a file name", () => {
		for (const text of [
			"https://x/a-745e",
			"/tmp/a-745e",
			"logs/a-745e",
			"logs\\a-745e",
			"src/a-745e.ts",
			"a-745e.json",
			"a-745e.tar.gz",
			"v1.a-745e",
		]) {
			expect(askIdSegments(text)).toEqual([{ kind: "text", text }]);
		}
	});

	it("still lifts an id whose sentence ends in a full stop", () => {
		expect(askIdSegments("the old one, a-745e. withdrawn")).toEqual([
			{ kind: "text", text: "the old one, " },
			{ kind: "ask", id: "a-745e" },
			{ kind: "text", text: ". withdrawn" },
		]);
	});

	it("lifts the id out of an id prefixed by a non-edge colon", () => {
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

	it("keeps a status that inherits from Object.prototype out of the catalogue", () => {
		/* The runtime may invent a state, so a lookup by string must not find
		 *  `constructor` or `toString` on the way (round 1, Q3). */
		for (const status of [
			"constructor",
			"toString",
			"hasOwnProperty",
			"valueOf",
			"__proto__",
		]) {
			expect(askChipWord(status)?.kind).toBe("literal");
		}
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

	it("does not let a stale sheet read call an ask open the live frame has dropped", () => {
		/* The sheet reads only while visible and keeps its last read, so it can still
		 *  say `open` for an ask the agent has since WITHDRAWN — which leaves the frame
		 *  and writes no receipt. A live frame that lacks the id is the newer reading
		 *  (M1). */
		const facts = askChipFacts(
			{
				frame: [],
				settled: [ask({ ask_id: "a-745e", session_id: "sid", status: "open" })],
			},
			"sid",
		);
		expect(facts.has("a-745e")).toBe(false);
	});

	it("still names a settled or withdrawn ask the frame no longer holds", () => {
		const facts = askChipFacts(
			{
				frame: [ask({ ask_id: "a-1111" })],
				settled: [
					ask({ ask_id: "a-745e", session_id: "sid", status: "withdrawn" }),
					ask({ ask_id: "a-e53b", session_id: "sid", status: "timed_out" }),
				],
			},
			"sid",
		);
		expect(facts.get("a-745e")?.status).toBe("withdrawn");
		expect(facts.get("a-e53b")?.status).toBe("timed_out");
	});

	it("keeps the sheet's open reading when the runtime publishes no frame at all", () => {
		/* `null` is "this runtime has no asks projection", not "the frame is empty":
		 *  the sheet's read is then the only source there is. */
		const facts = askChipFacts(
			{
				settled: [ask({ ask_id: "a-745e", session_id: "sid", status: "open" })],
			},
			"sid",
		);
		expect(facts.get("a-745e")?.status).toBe("open");
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

	it("changes when only the question does, so the spoken question cannot go stale", () => {
		const before = askChipFacts({ frame: [ask()] }, "sid");
		const after = askChipFacts(
			{ frame: [ask({ questions: [question("Which density?")] })] },
			"sid",
		);
		expect(askChipSignature(before)).not.toBe(askChipSignature(after));
	});
});
