import { describe, expect, it, vi } from "vitest";
import type {
	HistoryResponse,
	SessionProjection,
	TranscriptEntry,
} from "@/contracts";
import { HistoryWindow, journalAddressableRow } from "./history-window";
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
	it("uses only journal-addressable rows, including served tool aliases", () => {
		for (const prefix of [
			"rz-",
			"tc-",
			"nt-",
			"rt-",
			"err-",
			"rej-",
			"cx-",
			"peer-",
			"nonpeer-",
			"prompt:",
		])
			expect(journalAddressableRow(row(`${prefix}synthetic`))).toBe(false);
		expect(
			journalAddressableRow({ ...row("message"), kind: "reasoning" }),
		).toBe(false);
		expect(journalAddressableRow(row("message:call_synthetic"))).toBe(true);
	});

	it("never uses a pinned opener when the entire tail is minted; an unusable seed stays unknown", async () => {
		const fetch = vi.fn(async () => ({
			entries: [row("opener"), row("tc-minted")],
			has_more: false,
		}));
		const reader = new HistoryWindow(fetch, () => {});
		reader.accept({
			...frame(row("opener"), row("tc-live")),
			transcript_head_pinned: true,
		});
		expect(reader.cursor).toBeUndefined();
		await reader.load();
		expect(fetch).toHaveBeenCalledExactlyOnceWith(undefined);
		expect(reader.cursor).toBeUndefined();
		expect(reader.olderState).toBe("unknown");
		expect(reader.hasMore).toBe(true);
		expect(reader.error).toBe("failed");
	});

	it("seeding a cursor does not hide an ordinary live reasoning prefix or move the latest edge", () => {
		const reasoning = {
			...row("rz-live"),
			kind: "reasoning",
		} as TranscriptEntry;
		const reader = new HistoryWindow(
			async () => ({ entries: [], has_more: false }),
			() => {},
		);
		reader.accept(frame(reasoning, row("journal-assistant"), row("tc-live")));
		expect(reader.cursor).toBe("journal-assistant");
		expect(ids(reader.visibleRows)).toEqual([
			"rz-live",
			"journal-assistant",
			"tc-live",
		]);
	});

	it("a byte-capped pinned opener alone cannot declare the retained beginning", async () => {
		const reader = new HistoryWindow(
			async () => ({ entries: [row("opener")], has_more: false }),
			() => {},
		);
		reader.accept({ ...frame(row("opener")), transcript_head_pinned: true });
		await reader.load();
		expect(reader.cursor).toBeUndefined();
		expect(reader.olderState).toBe("unknown");
		expect(reader.error).toBe("failed");
	});

	it("a later journal-addressable live tail can recover an unknown minted-only seed", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce({
				entries: [row("opener"), row("tc-minted")],
				has_more: false,
			})
			.mockResolvedValueOnce({ entries: [row("older")], has_more: false });
		const reader = new HistoryWindow(fetch, () => {});
		reader.accept({
			...frame(row("opener"), row("tc-live")),
			transcript_head_pinned: true,
		});
		await reader.load();
		reader.accept({
			...frame(row("opener"), row("message:call_served")),
			transcript_head_pinned: true,
		});
		await reader.load();
		expect(fetch).toHaveBeenLastCalledWith("message:call_served");
		expect(reader.error).toBeNull();
		expect(reader.olderState).toBe("end");
	});

	it("does not trust a short no-cursor render's false flag; a canonical empty before-page ends paging", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce({ entries: [row("tail")], has_more: false })
			.mockResolvedValueOnce({ entries: [], has_more: false });
		const reader = new HistoryWindow(fetch, () => {});
		await reader.load();
		expect(reader.olderState).toBe("unknown");
		expect(reader.hasMore).toBe(true);
		await reader.load();
		expect(fetch).toHaveBeenLastCalledWith("tail");
		expect(reader.olderState).toBe("end");
		expect(reader.hasMore).toBe(false);
		await reader.load();
		expect(fetch).toHaveBeenCalledTimes(2);
	});

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
		expect(window.cursor).toBe("q01104");
		expect(window.visibleRows[0]?.id).toBe("q01104");
		expect(window.visibleRows.some((entry) => entry.id === "q00000")).toBe(
			false,
		);
		while (window.hasMore && !window.error) await window.load();
		expect(window.error).toBeNull();
		expect(ids(window.rows)).toEqual(ids(journal));
		expect(new Set(ids(window.rows)).size).toBe(1200);
		expect(ids(window.visibleRows)).toEqual(ids(journal));
		expect(fetch).toHaveBeenCalledTimes(66);
		console.log(
			JSON.stringify({
				fixture: "retained-1200",
				legacy_held: 81,
				legacy_missing: 1119,
				rows_after: window.rows.length,
				missing: journal.filter((entry) => !ids(window.rows).includes(entry.id))
					.length,
				canonical_pages: fetch.mock.calls.length,
			}),
		);
	});

	it("keeps detached opener out of the displayed page when HTTP arrives before the live frame", async () => {
		const journal = sequence(1200);
		const window = new HistoryWindow(pager(journal, 80), () => {});
		await window.load();
		window.accept(frame(row("q00000"), ...journal.slice(-79)));
		expect(window.visibleRows[0]?.id).toBe("q01121");
		expect(window.visibleRows).toHaveLength(79);
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

	it("explicit reload recovers Q3's 221 missed rows from the latest durable tail", async () => {
		const journal = sequence(1500);
		let retained = journal.slice(0, 1200);
		const fetch = vi.fn((before?: string) => pager(retained, 80)(before));
		const window = new HistoryWindow(fetch, () => {});
		window.accept(frame(row("q00000"), ...journal.slice(1121, 1200)));
		await window.load();
		window.accept(frame(row("q00000"), ...journal.slice(1421)));
		while (window.hasMore) await window.load();
		expect(
			journal.filter((entry) => !ids(window.rows).includes(entry.id)),
		).toHaveLength(221);
		expect(window.hasGap).toBe(true);
		retained = journal;
		await window.reload();
		expect(fetch).toHaveBeenLastCalledWith("q01421");
		expect(window.cursor).toBe("q01341");
		expect(window.hasGap).toBe(false);
		expect(ids(window.visibleRows)).toEqual(ids(journal.slice(1341)));
		while (window.hasMore && !window.error) await window.load();
		expect(window.error).toBeNull();
		expect(ids(window.visibleRows)).toEqual(ids(journal));
		expect(new Set(ids(window.visibleRows)).size).toBe(1500);
	});

	it.each(["resolve", "reject"] as const)(
		"drops old pending %s after explicit reload",
		async (settlement) => {
			const old = deferred<HistoryResponse>();
			const fetch = vi
				.fn()
				.mockResolvedValueOnce({ entries: [row("old")], has_more: true })
				.mockImplementationOnce(() => old.promise)
				.mockResolvedValueOnce({ entries: [row("fresh")], has_more: true });
			const window = new HistoryWindow(fetch, () => {});
			await window.load();
			const pending = window.load();
			await Promise.resolve();
			await window.reload();
			if (settlement === "resolve")
				old.resolve({ entries: [row("stale")], has_more: false });
			else old.reject(new Error("old failure"));
			await pending;
			expect(ids(window.rows)).toEqual(["fresh"]);
			expect(window.cursor).toBe("fresh");
			expect(window.hasMore).toBe(true);
			expect(window.error).toBeNull();
			expect(window.loading).toBe(false);
		},
	);

	it("an old completion cannot clear the fresh incarnation's pending/loading state", async () => {
		const old = deferred<HistoryResponse>();
		const fresh = deferred<HistoryResponse>();
		const fetch = vi
			.fn()
			.mockImplementationOnce(() => old.promise)
			.mockImplementationOnce(() => fresh.promise);
		const window = new HistoryWindow(fetch, () => {});
		const pending = window.load();
		await Promise.resolve();
		const reset = window.reload();
		await Promise.resolve();
		old.resolve({ entries: [row("stale")], has_more: false });
		await pending;
		expect(window.loading).toBe(true);
		expect(window.load()).toBe(reset);
		expect(window.rows).toEqual([]);
		fresh.resolve({ entries: [row("fresh")], has_more: false });
		await reset;
		expect(ids(window.rows)).toEqual(["fresh"]);
		expect(window.loading).toBe(false);
	});

	it("reports a fresh reload failure truthfully and retries without the old cursor", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce({ entries: [row("old")], has_more: false })
			.mockRejectedValueOnce(new Error("fresh failure"))
			.mockResolvedValueOnce({ entries: [row("fresh")], has_more: false });
		const window = new HistoryWindow(fetch, () => {});
		await window.load();
		await window.reload();
		expect(window.read).toBe("failed");
		expect(window.error).toBe("failed");
		expect(window.rows).toEqual([]);
		expect(window.cursor).toBeUndefined();
		expect(window.hasMore).toBe(true);
		await window.load();
		expect(fetch).toHaveBeenLastCalledWith(undefined);
		expect(ids(window.rows)).toEqual(["fresh"]);
		expect(window.error).toBeNull();
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
			.mockResolvedValueOnce({
				entries: [row("a"), row("b", "old")],
				has_more: true,
			})
			.mockImplementationOnce(() => read.promise);
		const window = new HistoryWindow(fetch, () => {});
		window.accept(frame(row("b", "stale live")));
		await window.load();
		expect(window.rows[1]?.text).toBe("old");
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
