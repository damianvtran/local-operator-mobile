import { describe, expect, it } from "vitest";

import type { TranscriptEntry } from "@/contracts";
import { HEAL_BUDGET } from "@/features/session/history-window";
import type { TranscriptItem } from "@/features/session/turn-condensing";
import {
	type OlderFillEvidence,
	olderFillReady,
	shouldFillUnderflow,
	showsConversation,
	UNDERFLOW_FILL_PAGES,
	type UnderflowFacts,
	UnderflowFill,
} from "@/features/session/underflow-fill";

/**
 * Issue #322: a conversation whose live tail (the relay's 80-row frame) is all
 * peer receipts and tool rows opens as ONE collapsed quiet-group row. Older
 * pages load only when the reader scrolls UP into the top band, and a list
 * shorter than its viewport cannot scroll, so the earlier user and assistant
 * turns never appeared. These pin when the list pages older on its own.
 */

const entry = (
	id: string,
	over: Partial<TranscriptEntry> = {},
): TranscriptEntry => ({
	id,
	kind: "assistant",
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
const item = (row: TranscriptEntry): TranscriptItem => ({
	kind: "entry",
	id: row.id,
	entry: row,
});

describe("showsConversation", () => {
	it("is false for a window of only quiet rows", () => {
		const items: TranscriptItem[] = [
			item(entry("pm-1", { kind: "peer_message", text: "handoff" })),
			item(entry("tc-1", { kind: "tool", tool_name: "bash" })),
			item(entry("m-empty", { kind: "assistant", text: "" })),
			item(entry("rs-1", { kind: "reasoning", text: "thinking" })),
		];
		expect(showsConversation(items)).toBe(false);
	});

	it.each([
		["a user message", entry("m-1", { kind: "user", text: "Ship it." })],
		["a steer", entry("m-2", { kind: "steer", text: "also docs" })],
		["an assistant answer", entry("m-3", { kind: "assistant", text: "Done." })],
	])("is true once %s is on screen", (_name, row) => {
		expect(showsConversation([item(row)])).toBe(true);
	});

	it("ignores whitespace-only assistant text", () => {
		expect(
			showsConversation([
				item(entry("m-4", { kind: "assistant", text: "  " })),
			]),
		).toBe(false);
	});
});

describe("olderFillReady", () => {
	const capped: OlderFillEvidence = {
		read: "ok",
		loading: false,
		hasMore: true,
		olderState: "unknown",
		frameRows: 80,
		frameHeadPinned: undefined,
	};

	it("is ready for a capped frame once the newest read has landed", () => {
		expect(olderFillReady(capped)).toBe(true);
	});

	it("is ready after an older page said there is more", () => {
		expect(
			olderFillReady({ ...capped, olderState: "more", frameRows: 3 }),
		).toBe(true);
	});

	it("is ready when the frame says it pinned its opener", () => {
		expect(
			olderFillReady({ ...capped, frameRows: 12, frameHeadPinned: true }),
		).toBe(true);
	});

	it.each<[string, Partial<OlderFillEvidence>]>([
		["before the newest read lands", { read: "unknown" }],
		["after a failed read", { read: "failed" }],
		["while any history read is in flight", { loading: true }],
		["once an older page reached the beginning", { hasMore: false }],
		[
			"for a frame under the cap: it is the whole conversation",
			{ frameRows: 12 },
		],
		["with no frame at all", { frameRows: 0 }],
	])("is not ready %s", (_name, over) => {
		expect(olderFillReady({ ...capped, ...over })).toBe(false);
	});
});

describe("shouldFillUnderflow", () => {
	const short: UnderflowFacts = {
		positioned: true,
		olderReady: true,
		hasError: false,
		contentPt: 120,
		viewportPt: 600,
		conversationShown: false,
		pagesFilled: 0,
	};

	it("fills a short window that shows only quiet rows (the #322 shape)", () => {
		expect(shouldFillUnderflow(short)).toBe(true);
	});

	it("fills a window with no conversation even when its height is unknown", () => {
		expect(shouldFillUnderflow({ ...short, contentPt: null })).toBe(true);
	});

	it("fills a window that cannot scroll even when it shows conversation", () => {
		expect(shouldFillUnderflow({ ...short, conversationShown: true })).toBe(
			true,
		);
		expect(
			shouldFillUnderflow({
				...short,
				conversationShown: true,
				contentPt: 600,
			}),
		).toBe(true);
	});

	it("stops once the screen is filled AND conversation is shown", () => {
		expect(
			shouldFillUnderflow({
				...short,
				conversationShown: true,
				contentPt: 601,
			}),
		).toBe(false);
	});

	it("keeps filling a full screen that still shows only quiet rows", () => {
		expect(shouldFillUnderflow({ ...short, contentPt: 2400 })).toBe(true);
	});

	it("never reads an unknown height as short", () => {
		expect(
			shouldFillUnderflow({
				...short,
				conversationShown: true,
				contentPt: null,
			}),
		).toBe(false);
		expect(
			shouldFillUnderflow({
				...short,
				conversationShown: true,
				viewportPt: 0,
			}),
		).toBe(false);
	});

	it.each<[string, Partial<UnderflowFacts>]>([
		["before the first placement", { positioned: false }],
		["when older history is not ready", { olderReady: false }],
		["after a history error", { hasError: true }],
		["once the page budget is spent", { pagesFilled: UNDERFLOW_FILL_PAGES }],
	])("does not fill %s", (_name, over) => {
		expect(shouldFillUnderflow({ ...short, ...over })).toBe(false);
	});

	it("shares the automatic gap fill's five-page budget", () => {
		expect(UNDERFLOW_FILL_PAGES).toBe(HEAL_BUDGET.pages);
		expect(UNDERFLOW_FILL_PAGES).toBe(5);
	});
});

/** The per-list bookkeeping the hook delegates to: which height belongs to
 *  which rows, one request per arrival, and the budget per opened session. */
describe("UnderflowFill", () => {
	const quiet = [item(entry("pm-1", { kind: "peer_message", text: "hi" }))];
	const talk = [item(entry("m-1", { kind: "user", text: "Ship it." }))];
	const at = (
		items: readonly TranscriptItem[],
		over: Partial<Parameters<UnderflowFill["next"]>[0]> = {},
	) => ({
		sessionId: "s1",
		items,
		positioned: true,
		olderReady: true,
		hasError: false,
		viewportPt: 600,
		...over,
	});

	it("asks once per arrival, then again when the page's rows land", () => {
		const fill = new UnderflowFill();
		expect(fill.next(at(quiet))).toBe(true);
		// The page is in flight and the props have not re-rendered yet: a second
		// look at the SAME rows must not count (or send) a second page.
		expect(fill.next(at(quiet))).toBe(false);
		const grown = [...quiet];
		expect(fill.next(at(grown))).toBe(true);
	});

	it("reads a height only for the rows it was measured with", () => {
		const fill = new UnderflowFill();
		fill.measured(talk, 120);
		expect(fill.next(at(talk))).toBe(true);
		const taller = [...talk];
		// New rows, no measurement yet: unknown is never short.
		expect(fill.next(at(taller))).toBe(false);
		fill.measured(taller, 900);
		expect(fill.next(at(taller))).toBe(false);
	});

	it("stops after the budget and starts a fresh one per session", () => {
		const fill = new UnderflowFill();
		let asked = 0;
		for (let page = 0; page < UNDERFLOW_FILL_PAGES + 3; page += 1) {
			if (fill.next(at([...quiet]))) asked += 1;
		}
		expect(asked).toBe(UNDERFLOW_FILL_PAGES);
		expect(fill.next(at([...quiet], { sessionId: "s2" }))).toBe(true);
	});

	it("does not ask while the reader is not ready", () => {
		const fill = new UnderflowFill();
		expect(fill.next(at(quiet, { olderReady: false }))).toBe(false);
		expect(fill.next(at(quiet, { positioned: false }))).toBe(false);
		expect(fill.next(at(quiet))).toBe(true);
	});
});
