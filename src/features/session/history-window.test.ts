import { describe, expect, it, vi } from "vitest";
import type {
	HistoryResponse,
	SessionProjection,
	TranscriptEntry,
} from "@/contracts";
import { HistoryWindow } from "./history-window";
import { mergeTranscript, rowIdentity } from "./runtime";

const row = (id: string, text = id): TranscriptEntry => ({
	id,
	kind: "user",
	text,
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
});
const frame = (...transcript: TranscriptEntry[]) =>
	({ transcript }) as SessionProjection;
const ids = (rows: TranscriptEntry[]) => rows.map(rowIdentity);
const sequence = (count: number) =>
	Array.from({ length: count }, (_, at) =>
		row(`q${String(at).padStart(5, "0")}`),
	);
const deferred = <T>() => {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
};
const pager = (journal: TranscriptEntry[], limit = 17) =>
	vi.fn(async (before?: string): Promise<HistoryResponse> => {
		const end =
			before === undefined
				? journal.length
				: journal.findIndex((entry) => entry.id === before);
		const start = Math.max(0, end - limit);
		return { entries: journal.slice(start, end), has_more: start > 0 };
	});

describe("screen-owned retained history", () => {
	it("negative control reproduces Q1: old single-page merge misses 1119 of 1200 retained rows", () => {
		const journal = sequence(1200);
		const old = mergeTranscript(
			frame(row("q00000"), ...journal.slice(-79)),
			journal.slice(-80),
		);
		expect(old.rows).toHaveLength(81);
		expect(
			journal.filter((entry) => !ids(old.rows).includes(entry.id)),
		).toHaveLength(1119);
	});

	it("pages all 1200 rows without using the detached opener as cursor", async () => {
		const journal = sequence(1200);
		const fetch = pager(journal);
		const window = new HistoryWindow(fetch, () => {});
		window.accept(frame(row("q00000"), ...journal.slice(-79)));
		await window.load();
		expect(window.cursor).toBe("q01183");
		expect(window.visibleRows[0]?.id).toBe("q01183");
		expect(window.visibleRows.some((entry) => entry.id === "q00000")).toBe(
			false,
		);
		while (window.hasMore && !window.error) await window.load();
		expect(window.error).toBeNull();
		expect(ids(window.rows)).toEqual(ids(journal));
		expect(new Set(ids(window.rows)).size).toBe(1200);
		expect(ids(window.visibleRows)).toEqual(ids(journal));
		expect(fetch).toHaveBeenCalledTimes(71);
	});

	it("keeps detached opener out of the displayed page when HTTP arrives before the live frame", async () => {
		const journal = sequence(1200);
		const window = new HistoryWindow(pager(journal, 80), () => {});
		await window.load();
		window.accept(frame(row("q00000"), ...journal.slice(-79)));
		expect(window.visibleRows[0]?.id).toBe("q01120");
		expect(window.visibleRows).toHaveLength(80);
		while (window.hasMore && !window.error) await window.load();
		expect(ids(window.visibleRows)).toEqual(ids(journal));
	});

	it("Q2 retains every accepted live row through more than 80 capped appends", async () => {
		const journal = sequence(1500);
		const window = new HistoryWindow(
			pager(journal.slice(0, 1200), 80),
			() => {},
		);
		window.accept(frame(row("q00000"), ...journal.slice(1121, 1200)));
		await window.load();
		for (let end = 1201; end <= 1500; end++)
			window.accept(frame(row("q00000"), ...journal.slice(end - 79, end)));
		while (window.hasMore && !window.error) await window.load();
		expect(ids(window.rows)).toEqual(ids(journal));
	});

	it("reports the separate reconnect gap when more than a capped window was never received", async () => {
		const journal = sequence(1500);
		const window = new HistoryWindow(
			pager(journal.slice(0, 1200), 80),
			() => {},
		);
		window.accept(frame(row("q00000"), ...journal.slice(1121, 1200)));
		await window.load();
		window.accept(frame(row("q00000"), ...journal.slice(1421, 1500)));
		expect(window.hasGap).toBe(true);
		while (window.hasMore && !window.error) await window.load();
		// No protocol claim of gap-free reconnect: missed events are not accepted
		// live rows and the oldest-cursor pager cannot recover this newer hole.
		expect(
			journal.filter((entry) => !ids(window.rows).includes(entry.id)),
		).toHaveLength(221);
	});

	it("does not erase live arrivals when initial history completes later", async () => {
		const read = deferred<HistoryResponse>();
		const window = new HistoryWindow(
			() => read.promise,
			() => {},
		);
		const request = window.load();
		window.accept(frame(row("a", "newer live body"), row("b")));
		read.resolve({ entries: [row("a", "old durable body")], has_more: false });
		await request;
		expect(ids(window.rows)).toEqual(["a", "b"]);
		expect(window.rows[0]?.text).toBe("newer live body");
	});

	it("uses authoritative fetched bodies unless a live update arrived during the older read", async () => {
		const read = deferred<HistoryResponse>();
		const fetch = vi
			.fn()
			.mockResolvedValueOnce({ entries: [row("b", "old")], has_more: true })
			.mockImplementationOnce(() => read.promise);
		const window = new HistoryWindow(fetch, () => {});
		window.accept(frame(row("b", "stale live")));
		await window.load();
		expect(window.rows[0]?.text).toBe("old");
		const request = window.load();
		window.accept(frame(row("b", "new live"), row("c")));
		read.resolve({ entries: [row("a"), row("b", "durable")], has_more: false });
		await request;
		expect(ids(window.rows)).toEqual(["a", "b", "c"]);
		expect(window.rows[1]?.text).toBe("new live");
	});

	it("matches durable and live tool aliases once, without timestamp ordering", async () => {
		const live = {
			...row("tc-call"),
			kind: "tool",
			tool_call_id: "call",
		} as TranscriptEntry;
		const durable = { ...live, id: "message:call", text: "authoritative" };
		const window = new HistoryWindow(
			async () => ({
				entries: [row("same-time-user"), durable],
				has_more: false,
			}),
			() => {},
		);
		window.accept(frame(live));
		await window.load();
		expect(ids(window.rows)).toEqual(["same-time-user", "tool-call:call"]);
		expect(window.rows[1]?.text).toBe("authoritative");
	});

	it("repositions preserved compaction turns at their journal position", async () => {
		const journal = sequence(497);
		const render = [
			row("q00000"),
			...journal.slice(100, 105),
			...journal.slice(-80),
		];
		const window = new HistoryWindow(pager(journal, 21), () => {});
		window.accept(frame(...render));
		while (window.hasMore && !window.error) await window.load();
		expect(ids(window.rows)).toEqual(ids(journal));
		expect(window.error).toBeNull();
	});

	it("deduplicates concurrent and overlapping page requests", async () => {
		const read = deferred<HistoryResponse>();
		const fetch = vi
			.fn()
			.mockResolvedValueOnce({ entries: [row("c"), row("d")], has_more: true })
			.mockImplementationOnce(() => read.promise);
		const window = new HistoryWindow(fetch, () => {});
		await window.load();
		const first = window.load();
		expect(window.load()).toBe(first);
		read.resolve({ entries: [row("a"), row("b"), row("c")], has_more: false });
		await first;
		expect(ids(window.rows)).toEqual(["a", "b", "c", "d"]);
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it.each([
		{ entries: [], has_more: true },
		{ entries: [row("b")], has_more: true },
	])(
		"stops non-advancing responses and allows an explicit retry",
		async (bad) => {
			const fetch = vi
				.fn()
				.mockResolvedValueOnce({ entries: [row("b")], has_more: true })
				.mockResolvedValueOnce(bad)
				.mockResolvedValueOnce({ entries: [row("a")], has_more: false });
			const window = new HistoryWindow(fetch, () => {});
			await window.load();
			await window.load();
			expect(window.error).toBe("stalled");
			expect(window.hasMore).toBe(true);
			expect(window.cursor).toBe("b");
			await window.load();
			expect(ids(window.rows)).toEqual(["a", "b"]);
			expect(window.error).toBeNull();
		},
	);

	it("rejects multi-page cursor cycles without a row cap", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce({ entries: [row("c")], has_more: true })
			.mockResolvedValueOnce({ entries: [row("b")], has_more: true })
			.mockResolvedValueOnce({ entries: [row("c")], has_more: true });
		const window = new HistoryWindow(fetch, () => {});
		await window.load();
		await window.load();
		await window.load();
		expect(window.error).toBe("stalled");
		expect(window.cursor).toBe("b");
	});

	it("unavailable is not a successful empty beginning, and retry preserves held rows", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce({ entries: [row("b")], has_more: true })
			.mockResolvedValueOnce({
				entries: [],
				has_more: false,
				unavailable: "unsupported archive",
			})
			.mockResolvedValueOnce({ entries: [row("a")], has_more: false });
		const window = new HistoryWindow(fetch, () => {});
		await window.load();
		await window.load();
		expect(window.read).toBe("failed");
		expect(window.hasMore).toBe(true);
		expect(ids(window.rows)).toEqual(["b"]);
		await window.load();
		expect(ids(window.rows)).toEqual(["a", "b"]);
	});

	it("transport/auth errors remain retryable without dropping earlier pages", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce({ entries: [row("b")], has_more: true })
			.mockRejectedValueOnce(new Error("401"))
			.mockResolvedValueOnce({ entries: [row("a")], has_more: false });
		const window = new HistoryWindow(fetch, () => {});
		await window.load();
		await window.load();
		expect(window.error).toBe("failed");
		expect(window.cursor).toBe("b");
		await window.load();
		expect(ids(window.rows)).toEqual(["a", "b"]);
	});

	it("retired scope rejects pending callbacks; reopen owns a new incarnation", async () => {
		const read = deferred<HistoryResponse>();
		const notify = vi.fn();
		const old = new HistoryWindow(() => read.promise, notify);
		const pending = old.load();
		old.retire();
		const next = new HistoryWindow(
			async () => ({ entries: [row("new-account-session")], has_more: false }),
			() => {},
		);
		await next.load();
		read.resolve({ entries: [row("private-old")], has_more: false });
		await pending;
		expect(old.rows).toEqual([]);
		expect(ids(next.rows)).toEqual(["new-account-session"]);
		expect(notify).toHaveBeenCalledTimes(1);
	});

	it("StrictMode activation fences an old request without blocking its replacement", async () => {
		const read = deferred<HistoryResponse>();
		const fetch = vi
			.fn()
			.mockImplementationOnce(() => read.promise)
			.mockResolvedValueOnce({
				entries: [row("replacement")],
				has_more: false,
			});
		const window = new HistoryWindow(fetch, () => {});
		const old = window.load();
		await Promise.resolve();
		window.retire();
		window.activate();
		await window.load();
		read.resolve({ entries: [row("stale")], has_more: false });
		await old;
		expect(ids(window.rows)).toEqual(["replacement"]);
	});

	it("refresh retains fetched history and its oldest durable cursor", async () => {
		const fetch = pager(sequence(100), 20);
		const window = new HistoryWindow(fetch, () => {});
		await window.load();
		await window.load();
		const before = ids(window.rows);
		const cursor = window.cursor;
		await window.load(true);
		expect(ids(window.rows)).toEqual(before);
		expect(window.cursor).toBe(cursor);
	});

	it("accepts the protocol's empty terminal cursor page and never infers deletion from absent live rows", async () => {
		const window = new HistoryWindow(
			async () => ({ entries: [], has_more: false }),
			() => {},
		);
		window.accept(frame(row("retained-live")));
		await window.load();
		window.accept(frame());
		expect(window.hasMore).toBe(false);
		expect(ids(window.rows)).toEqual(["retained-live"]);
	});
});
