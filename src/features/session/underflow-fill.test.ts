import { describe, expect, it } from "vitest";

import type {
	HistoryResponse,
	SessionProjection,
	TranscriptEntry,
} from "@/contracts";
import { HEAL_BUDGET, HistoryWindow } from "@/features/session/history-window";
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
import { fixtureBody } from "@/testing/fixture-relay";

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

	// Core #4521: a compacted render opens at its marker with a short kept
	// window and no pin. Without this the 14-row seed read as the whole
	// conversation and every turn before the compaction stayed unreachable.
	it("is ready for a short frame that says older rows exist", () => {
		expect(
			olderFillReady({ ...capped, frameRows: 14, frameHasOlder: true }),
		).toBe(true);
	});

	it.each<[string, Partial<OlderFillEvidence>]>([
		[
			"for a short frame from Core older than the field",
			{ frameRows: 14, frameHasOlder: undefined },
		],
		[
			"for a short frame whose older rows are already exhausted",
			{ frameRows: 14, frameHasOlder: true, hasMore: false },
		],
		[
			"for a short frame that says older rows exist before the read lands",
			{ frameRows: 14, frameHasOlder: true, read: "unknown" },
		],
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

/**
 * Core #4521 (operator report 2026-11-24: scrolling up a compacted
 * conversation showed no condensed agent turns and no final answers between
 * historical user messages). A compacted render opens at its marker with a
 * short kept window and no pin, and now says `transcript_has_older`. The
 * production reader and the fill decision together must page back from the
 * render's own oldest row — the marker, never skipped or detached as an
 * opener — and an older Core that omits the field must keep today's reading.
 */
describe("a short compacted seed, through the production reader", () => {
	const turn = (n: number): TranscriptEntry[] => [
		entry(`req-${n}`, { kind: "user", text: `req ${n}` }),
		entry(`final-${n}`, { text: `final ${n}` }),
	];
	const marker = entry("cmp-2", {
		kind: "notice",
		text: "summary c2",
		custom_type: "compaction",
	});
	const before = [100, 101, 102, 103, 104, 105].flatMap(turn);
	const kept = [marker, ...[120, 121, 122].flatMap(turn)];
	const journal = [...before, ...kept];
	const projectionOf = (
		transcript: TranscriptEntry[],
		over: Partial<SessionProjection>,
	): SessionProjection => ({
		...(fixtureBody(
			"sse/sse-projection-checkpoints-empty.json",
		) as SessionProjection),
		transcript,
		...over,
	});
	const open = (seed: TranscriptEntry[]) => {
		const asked: Array<string | undefined> = [];
		const reader = new HistoryWindow(
			async (cursor): Promise<HistoryResponse> => {
				asked.push(cursor);
				// Newest page: the kept window, as the frame seeded it. Older
				// pages: four rows ending just before the cursor.
				const end =
					cursor === undefined
						? journal.length
						: journal.findIndex((row) => row.id === cursor);
				const start =
					cursor === undefined
						? journal.length - seed.length
						: Math.max(0, end - 4);
				return { entries: journal.slice(start, end), has_more: start > 0 };
			},
			() => undefined,
		);
		return { reader, asked };
	};
	const evidence = (
		reader: HistoryWindow,
		frame: SessionProjection,
	): OlderFillEvidence => ({
		read: reader.read,
		loading: reader.loading,
		hasMore: reader.hasMore,
		olderState: reader.olderState,
		frameRows: frame.transcript.length,
		frameHeadPinned: frame.transcript_head_pinned,
		frameHasOlder: frame.transcript_has_older,
	});

	it("pages back from the marker until the earlier turns are held", async () => {
		const frame = projectionOf(kept, { transcript_has_older: true });
		const { reader, asked } = open(kept);
		reader.accept(frame);
		await reader.load(true);
		expect(olderFillReady(evidence(reader, frame))).toBe(true);
		let pages = 0;
		while (
			olderFillReady(evidence(reader, frame)) &&
			pages < UNDERFLOW_FILL_PAGES
		) {
			await reader.load();
			pages += 1;
		}
		expect(reader.error).toBeNull();
		// Paged from the render's own oldest row: the marker is the cursor.
		expect(asked[1]).toBe("cmp-2");
		const ids = reader.visibleRows.map((row) => row.id);
		expect(ids).toEqual(journal.map((row) => row.id));
		expect(ids).toContain("final-105");
		expect(pages).toBe(3);
		expect(reader.olderState).toBe("end");
	});

	it("never detaches the head row as a pinned opener", async () => {
		// The marker trimmed by a cap: a user prompt heads the kept window.
		const seed = kept.slice(1);
		const frame = projectionOf(seed, { transcript_has_older: true });
		const { reader, asked } = open(seed);
		reader.accept(frame);
		await reader.load(true);
		expect(reader.visibleRows[0]?.id).toBe("req-120");
		await reader.load();
		expect(asked[1]).toBe("req-120");
	});

	it("keeps an older Core's short seed as the whole conversation", async () => {
		const frame = projectionOf(kept, {});
		const { reader, asked } = open(kept);
		reader.accept(frame);
		await reader.load(true);
		expect(frame.transcript_has_older).toBeUndefined();
		expect(olderFillReady(evidence(reader, frame))).toBe(false);
		expect(asked).toEqual([undefined]);
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
