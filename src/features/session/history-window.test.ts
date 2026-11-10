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

	it("a flagless frame cannot reconnect an explicitly detached opener before its durable page", async () => {
		const journal = sequence(300);
		const reader = new HistoryWindow(pager(journal, 80), () => {});
		reader.accept(capped(journal, 300));
		await reader.load();
		const held = ids(reader.visibleRows);
		reader.accept(frame(...journal.slice(221)));
		reader.accept(frame(...journal.slice(221)));
		expect(ids(reader.visibleRows)).toEqual(held);
		expect(ids(reader.visibleRows)).not.toContain(journal[0]?.id);
		while (reader.hasMore && !reader.error) await reader.load();
		expect(reader.error).toBeNull();
		expect(ids(reader.visibleRows)).toEqual(ids(journal));
		expect(reader.olderState).toBe("end");
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

	it("CI S5/find-caveat: a cold no-cursor page with no addressable row keeps its rows instead of rendering empty", async () => {
		// The reopened shape: the frame carries no rows, the page has them, and
		// the relay says more exist. Nothing here can be a cursor, so the read
		// fails — but the rows it returned are the conversation on this device.
		const page = [row("tc-minted-0"), row("tc-minted-1")];
		const fetch = vi.fn(async () => ({ entries: page, has_more: true }));
		const reader = new HistoryWindow(fetch, () => {});
		reader.accept(frame());
		await reader.load(true);
		expect(ids(reader.visibleRows)).toEqual(ids(page));
		expect(reader.cursor).toBeUndefined();
		// Never the beginning, and never a silent success: the retry is offered.
		expect(reader.olderState).toBe("unknown");
		expect(reader.hasMore).toBe(true);
		expect(reader.error).toBe("failed");
		expect(reader.errorScope).toBe("newest");
	});

	it("CI S5/find-caveat control: a before-page that cannot advance its cursor still stalls", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce({ entries: [row("a")], has_more: true })
			.mockResolvedValueOnce({ entries: [row("tc-minted")], has_more: true });
		const reader = new HistoryWindow(fetch, () => {});
		await reader.load();
		await reader.load();
		expect(reader.error).toBe("stalled");
		expect(ids(reader.rows)).toEqual(["a"]);
	});

	it("CI S5/rich-rows: rows sharing an identity keep their own bodies when a frame lands mid-read", async () => {
		const read = deferred<HistoryResponse>();
		const reader = new HistoryWindow(
			() => read.promise,
			() => {},
		);
		const rows = [
			row("m-1", "first"),
			row("m-1", "second"),
			row("m-1", "third"),
		];
		const request = reader.load(true);
		reader.accept(frame(...rows));
		read.resolve({
			entries: rows.map((entry) => ({ ...entry })),
			has_more: false,
		});
		await request;
		expect(reader.visibleRows.map((entry) => entry.text)).toEqual([
			"first",
			"second",
			"third",
		]);
	});

	/* PR #207 R5-2. A frame can hold no row the newest page shares: Core's
	 * fold mints reasoning, notices and not-yet-journaled tool calls under
	 * live-only ids. Those rows are the LIVE turn, so a cold page (history)
	 * goes before them. An anchorless merge put the turn above its history. */
	/* One user opener, then answers: a page of 80 user rows would trip the
	 * legacy "80 rows opening on a user row is a capped render" inference. */
	const coreJournal = (count: number) =>
		Array.from({ length: count }, (_, at) =>
			at === 0
				? row("m-0")
				: ({ ...row(`m-${at}`), kind: "assistant" } as TranscriptEntry),
		);

	it("a cold page sharing no row with a flag-true frame of minted rows lands above them", async () => {
		const journal = coreJournal(300);
		const minted = Array.from({ length: 15 }, (_, at) => row(`tc-${at}`));
		const reader = new HistoryWindow(pager(journal, 80), () => {});
		reader.accept({
			...frame(journal[0] as TranscriptEntry, ...minted),
			transcript_head_pinned: true,
		});
		expect(reader.cursor).toBeUndefined();
		await reader.load(true);
		expect(ids(reader.visibleRows)).toEqual([
			...ids(journal.slice(220)),
			...ids(minted),
		]);
	});

	it("a cold page under a flagless minted frame keeps later live rows at the newest edge", async () => {
		const journal = coreJournal(300);
		const reasoning = {
			...row("rz-live"),
			kind: "reasoning",
		} as TranscriptEntry;
		const reader = new HistoryWindow(pager(journal, 80), () => {});
		reader.accept(frame(reasoning, row("tc-x")));
		await reader.load(true);
		expect(ids(reader.visibleRows)).toEqual([
			...ids(journal.slice(220)),
			"rz-live",
			"tc-x",
		]);
		// The turn goes on: its rows, final answer included, must arrive below.
		reader.accept(frame(reasoning, row("tc-x"), row("tc-y"), row("m-300")));
		expect(ids(reader.visibleRows)).toEqual([
			...ids(journal.slice(220)),
			"rz-live",
			"tc-x",
			"tc-y",
			"m-300",
		]);
		expect(reader.hasGap).toBe(false);
	});

	it("an explicit transcript_head_pinned:false frame hides nothing when the page answered first", async () => {
		const journal = sequence(200);
		const reader = new HistoryWindow(pager(journal, 80), () => {});
		await reader.load(true);
		reader.accept({ ...frame(...journal), transcript_head_pinned: false });
		expect(ids(reader.visibleRows)).toEqual(ids(journal));
	});

	/* The mock relay's long conversation AS IT WAS when PR #207's visual gate
	 * failed: 13 turns of user + 38 tools + answer, every id carrying the
	 * live-only `tc-` prefix, in one 520-row frame silent about
	 * `transcript_head_pinned`. No relay sends this, and the reader must still
	 * hold to its invariant: every row of an accepted frame is displayed, in
	 * order, whatever its ids are and whichever of HTTP and the stream wins. */
	const originalLongWorld = () =>
		Array.from({ length: 13 }, (_, turn) => {
			const at = String(turn).padStart(2, "0");
			return [
				row(`tc-conv-${at}-user`, `prompt ${at}`),
				...Array.from({ length: 38 }, (_, step) => ({
					...row(`tc-conv-${at}-tool-${String(step).padStart(2, "0")}`),
					kind: "tool" as const,
					tool_call_id: `conv-${turn}-${step}`,
				})),
				{ ...row(`tc-conv-${at}-answer`, `answer ${at}`), kind: "assistant" },
			] as TranscriptEntry[];
		}).flat();

	for (const order of ["frame first", "page first", "frame mid-read"]) {
		it(`invariant: a 520-row flagless frame of live-only ids is wholly displayed (${order})`, async () => {
			const world = originalLongWorld();
			expect(world).toHaveLength(520);
			const read = deferred<void>();
			const serve = pager(world, 80);
			const reader = new HistoryWindow(
				async (before) => {
					if (order === "frame mid-read") await read.promise;
					return serve(before);
				},
				() => {},
			);
			if (order === "frame first") reader.accept(frame(...world));
			const request = reader.load(true);
			if (order === "frame mid-read") {
				reader.accept(frame(...world));
				read.resolve();
			}
			await request;
			reader.accept(frame(...world));
			// Held, visible and in conversation order: what find searches.
			expect(reader.visibleRows.map((entry) => entry.id)).toEqual(
				world.map((entry) => entry.id),
			);
			expect(reader.visibleRows.map((entry) => entry.id)).toContain(
				"tc-conv-03-user",
			);
			// Live-only ids are never cursors, so nothing is claimed about older
			// rows: the caveat stays up and the beginning is not asserted.
			expect(reader.cursor).toBeUndefined();
			expect(reader.olderState).toBe("unknown");
			expect(reader.hasMore).toBe(true);
		});
	}

	it("invariant: an oversized flagless frame with journal ids is displayed whole while paging walks back through it", async () => {
		const journal = sequence(200);
		for (const pageFirst of [false, true]) {
			const reader = new HistoryWindow(pager(journal, 80), () => {});
			if (pageFirst) await reader.load(true);
			reader.accept(frame(...journal));
			expect(ids(reader.visibleRows)).toEqual(ids(journal));
			while (reader.hasMore && !reader.error) {
				await reader.load();
				// Every page lands in place: never above rows older than it.
				expect(ids(reader.visibleRows)).toEqual(ids(journal));
			}
			expect(reader.error).toBeNull();
			expect(reader.olderState).toBe("end");
		}
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

/** Core's capped live frame: the first user message re-sent at the head of
 * every frame, then the newest 79 rows, flagged `transcript_head_pinned`. */
const capped = (journal: TranscriptEntry[], end: number, flag = true) =>
	({
		transcript: [journal[0], ...journal.slice(end - 79, end)],
		...(flag ? { transcript_head_pinned: true } : {}),
	}) as SessionProjection;
const missing = (journal: TranscriptEntry[], window: HistoryWindow) => {
	const held = new Set(ids(window.rows));
	return journal.filter((entry) => !held.has(rowIdentity(entry))).length;
};
/** use-session's "older rows exist" claim; false renders "Beginning of retained
 * messages". It must never be false while retained rows are unreachable. */
const claimsBeginning = (window: HistoryWindow) =>
	window.read === "ok" && !window.hasMore && !window.hasGap;

describe("a reader paged to the beginning never claims it across a hole (PR #207)", () => {
	const readToBeginning = async (retained: () => TranscriptEntry[]) => {
		const journal = sequence(1500);
		const fetch = vi.fn((before?: string) => pager(retained(), 80)(before));
		const window = new HistoryWindow(fetch, () => {});
		window.accept(capped(journal, 1200));
		await window.load();
		while (window.hasMore && !window.error) await window.load();
		expect(window.error).toBeNull();
		expect(window.olderState).toBe("end");
		// The opener is now an ordinary paged row, no longer detached context.
		expect(ids(window.visibleRows)).toEqual(ids(journal.slice(0, 1200)));
		expect(window.hasGap).toBe(false);
		return { journal, fetch, window };
	};

	it.each([true, false])(
		"Q2: a disjoint reconnect frame cannot overlap only through the re-sent opener (flag %s)",
		async (flag) => {
			const journal = sequence(1500);
			const { window } = await readToBeginning(() => journal.slice(0, 1200));
			window.accept(capped(journal, 1500, flag));
			expect(missing(journal, window)).toBe(221);
			expect(window.hasGap).toBe(true);
			expect(claimsBeginning(window)).toBe(false);
		},
	);

	it("Q2 control: a contiguous capped frame after reading to the beginning is not a gap", async () => {
		const journal = sequence(1500);
		const { window } = await readToBeginning(() => journal.slice(0, 1200));
		for (let end = 1201; end <= 1279; end++)
			window.accept(capped(journal, end));
		expect(window.hasGap).toBe(false);
		expect(missing(journal.slice(0, 1279), window)).toBe(0);
		expect(claimsBeginning(window)).toBe(true);
	});

	it("R1: a refresh disjoint from every held row flags the gap, whichever of HTTP or the frame wins", async () => {
		const journal = sequence(1500);
		let retained = journal.slice(0, 1200);
		const { window, fetch } = await readToBeginning(() => retained);
		retained = journal;
		await window.load(true);
		expect(fetch).toHaveBeenLastCalledWith(undefined);
		expect(window.hasGap).toBe(true);
		window.accept(capped(journal, 1500));
		expect(missing(journal, window)).toBe(220);
		expect(window.hasGap).toBe(true);
		expect(claimsBeginning(window)).toBe(false);
		// The gap's Reload history action recovers every retained row.
		await window.reload();
		while (window.hasMore && !window.error) await window.load();
		expect(ids(window.visibleRows)).toEqual(ids(journal));
		expect(window.hasGap).toBe(false);
	});

	it("R1 control: a refresh that overlaps the held rows merges without a gap", async () => {
		const journal = sequence(1500);
		let retained = journal.slice(0, 1200);
		const { window } = await readToBeginning(() => retained);
		retained = journal.slice(0, 1250);
		await window.load(true);
		expect(window.hasGap).toBe(false);
		expect(ids(window.visibleRows)).toEqual(ids(journal.slice(0, 1250)));
		expect(claimsBeginning(window)).toBe(true);
	});

	it("R2: a failed newest refresh retries as a refresh, even at the beginning", async () => {
		const journal = sequence(1500);
		let fail = false;
		let retained = journal.slice(0, 1200);
		const { window, fetch } = await readToBeginning(() => {
			if (fail) throw new Error("offline");
			return retained;
		});
		fail = true;
		await window.load(true);
		expect(window.error).toBe("failed");
		expect(window.errorScope).toBe("newest");
		expect(window.hasMore).toBe(false);
		fail = false;
		retained = journal.slice(0, 1210);
		const calls = fetch.mock.calls.length;
		await window.retry();
		expect(fetch.mock.calls.slice(calls)).toEqual([[undefined]]);
		expect(window.error).toBeNull();
		expect(window.errorScope).toBeNull();
		expect(ids(window.visibleRows)).toEqual(ids(journal.slice(0, 1210)));
	});

	it("R2: an older-page failure retries that same older cursor", async () => {
		const journal = sequence(400);
		let fail = false;
		const fetch = vi.fn((before?: string) => {
			if (fail) return Promise.reject(new Error("offline"));
			// Not 80: a no-cursor 80-row user page reads as a legacy pinned frame.
			return pager(journal, 50)(before);
		});
		const window = new HistoryWindow(fetch, () => {});
		await window.load();
		const cursor = window.cursor;
		fail = true;
		await window.load();
		expect(window.errorScope).toBe("older");
		fail = false;
		await window.retry();
		expect(fetch).toHaveBeenLastCalledWith(cursor);
		expect(window.error).toBeNull();
		expect(ids(window.rows)).toEqual(ids(journal.slice(300)));
	});

	/** Journal positions of the visible rows, for order assertions: QA's
	 * order.qa.test.ts shape (PR #207 Q7) reads the list exactly as it renders. */
	const positions = (window: HistoryWindow) =>
		window.visibleRows.map((entry) => Number(entry.id.slice(1)));
	const descendingBreaks = (seq: number[]) =>
		seq.filter((value, at) => at > 0 && value < (seq[at - 1] ?? -1));

	it.each([true, false])(
		"Q7: a disjoint reconnect tail renders AFTER the held rows, with the hole between them (drained %s)",
		async (drained) => {
			const journal = sequence(1500);
			const fetch = vi.fn((before?: string) =>
				pager(journal.slice(0, 1200), 80)(before),
			);
			const window = new HistoryWindow(fetch, () => {});
			window.accept(capped(journal, 1200));
			await window.load();
			if (drained) while (window.hasMore && !window.error) await window.load();
			window.accept(capped(journal, 1500));
			expect(window.hasGap).toBe(true);
			const seq = positions(window);
			expect(descendingBreaks(seq)).toEqual([]);
			expect(seq.slice(-5)).toEqual([1495, 1496, 1497, 1498, 1499]);
			// The hole sits right before the first row of the new tail.
			expect(window.gapBefore).toBe("q01421");
			const at = seq.indexOf(1421);
			expect(seq[at - 1]).toBe(1199);
			// Live frames after the gap keep extending the tail in order.
			window.accept(capped(journal.concat(row("q01500")), 1501));
			expect(descendingBreaks(positions(window))).toEqual([]);
			expect(positions(window).at(-1)).toBe(1500);
			await window.reload();
			expect(window.gapBefore).toBeNull();
		},
	);

	it("Q7: a disjoint newest-page refresh also lands after the held rows and marks the hole", async () => {
		const journal = sequence(1500);
		let retained = journal.slice(0, 1200);
		const { window } = await readToBeginning(() => retained);
		retained = journal;
		await window.load(true);
		expect(window.hasGap).toBe(true);
		expect(descendingBreaks(positions(window))).toEqual([]);
		expect(window.gapBefore).toBe("q01420");
	});

	it("D1: a newest refresh is not reported as an older load", async () => {
		const journal = sequence(300);
		const read = deferred<HistoryResponse>();
		const fetch = vi.fn((before?: string) =>
			before === undefined && window.cursor !== undefined
				? read.promise
				: pager(journal, 80)(before),
		);
		const window = new HistoryWindow(fetch, () => {});
		await window.load();
		const refresh = window.load(true);
		expect(window.loading).toBe(true);
		expect(window.loadingScope).toBe("newest");
		read.resolve({ entries: journal.slice(-80), has_more: true });
		await refresh;
		expect(window.loadingScope).toBeNull();
		const older = window.load();
		expect(window.loadingScope).toBe("older");
		await older;
	});
});

/* ------------------------------------------------------------------------
 * Automatic gap healing (TestFlight report: "Reload from latest messages"
 * after returning to a running session). The relay serves `before=` pages
 * only: no `after=` read and no SSE replay cursor, so the reader walks back
 * from the newer island until a page overlaps the rows held below the hole.
 * ---------------------------------------------------------------------- */
describe("a reconnect or foreground hole heals itself", () => {
	/** The relay's own cursor contract: rows strictly older than `before`, and
	 * an unknown cursor answered as end-of-history (`_journal_page`), never as
	 * an arbitrary slice. */
	const relay = (journal: () => TranscriptEntry[], limit = 80) =>
		vi.fn(async (before?: string): Promise<HistoryResponse> => {
			const rows = journal();
			const end =
				before === undefined
					? rows.length
					: rows.findIndex((entry) => entry.id === before);
			if (end < 0) return { entries: [], has_more: false };
			const start = Math.max(0, end - limit);
			return { entries: rows.slice(start, end), has_more: start > 0 };
		});
	const settle = async (window: HistoryWindow) => {
		// The fill starts on a microtask after accept(); let it run to the end.
		for (let turn = 0; turn < 50 && window.healState === "healing"; turn++)
			await new Promise((resolve) => setTimeout(resolve, 0));
	};
	const contiguous = (window: HistoryWindow) => {
		const seq = window.visibleRows.map((entry) => Number(entry.id.slice(1)));
		return seq.every(
			(value, at) => at === 0 || value === (seq[at - 1] ?? 0) + 1,
		);
	};
	const opened = async (
		journal: TranscriptEntry[],
		retained: () => TranscriptEntry[],
		options: ConstructorParameters<typeof HistoryWindow>[2] = {
			autoHeal: true,
		},
	) => {
		const fetch = relay(retained);
		const changed = vi.fn();
		const window = new HistoryWindow(fetch, changed, options);
		window.accept(capped(journal, 1200));
		await window.load();
		return { fetch, changed, window };
	};

	it("(a) a resume frame that overlaps the held tail merges with no gap and no extra read", async () => {
		const journal = sequence(1500);
		const { fetch, window } = await opened(journal, () =>
			journal.slice(0, 1260),
		);
		const calls = fetch.mock.calls.length;
		window.accept(capped(journal, 1260));
		await settle(window);
		expect(window.hasGap).toBe(false);
		expect(window.healState).toBe("idle");
		expect(fetch.mock.calls.length).toBe(calls);
		// The newest-page refresh a foreground fires also overlaps: still no gap.
		await window.load(true);
		expect(window.hasGap).toBe(false);
		const shown = ids(window.visibleRows);
		expect(new Set(shown).size).toBe(shown.length);
		expect(shown.at(-1)).toBe("q01259");
		expect(contiguous(window)).toBe(true);
	});

	it("(b) a disjoint resume frame is back-filled automatically until it overlaps, with no notice", async () => {
		const journal = sequence(1500);
		const { fetch, window } = await opened(journal, () => journal);
		const calls = fetch.mock.calls.length;
		window.accept(capped(journal, 1500));
		// The render that discovers the hole is already "healing": no notice frame.
		expect(window.hasGap).toBe(true);
		expect(window.healState).toBe("healing");
		await settle(window);
		expect(fetch.mock.calls.slice(calls)).toEqual([
			["q01421"],
			["q01341"],
			["q01261"],
		]);
		expect(window.hasGap).toBe(false);
		expect(window.gapBefore).toBeNull();
		expect(window.healState).toBe("idle");
		// 1041: the older page the reader had already loaded stays loaded.
		expect(ids(window.visibleRows)).toEqual(ids(journal.slice(1041, 1500)));
		expect(contiguous(window)).toBe(true);
	});

	it("(b) a disjoint newest-page refresh (foreground HTTP read) heals the same way", async () => {
		const journal = sequence(1500);
		let retained = journal.slice(0, 1200);
		const { window } = await opened(journal, () => retained);
		retained = journal;
		await window.load(true);
		await settle(window);
		expect(window.hasGap).toBe(false);
		expect(ids(window.visibleRows)).toEqual(ids(journal.slice(1041, 1500)));
	});

	it("(c) a hole larger than the budget stops quietly, and Load continues from where it stopped", async () => {
		const journal = sequence(2400);
		const { fetch, window, changed } = await opened(journal, () => journal);
		const calls = fetch.mock.calls.length;
		window.accept(capped(journal, 2400));
		await settle(window);
		// 5 pages x 80 rows: the budget, not the hole, ended the walk.
		expect(fetch.mock.calls.length - calls).toBe(5);
		expect(window.hasGap).toBe(true);
		expect(window.healState).toBe("exhausted");
		expect(window.gapBefore).toBe("q01921");
		expect(contiguous(window)).toBe(false);
		expect(changed).toHaveBeenCalled();
		// The notice's Load: a fresh budget from the same hole, nothing reset.
		await window.heal();
		expect(fetch.mock.calls[calls + 5]).toEqual(["q01921"]);
		// Still more than one budget away (1200..1520): progress, then quiet again.
		expect(window.gapBefore).toBe("q01521");
		expect(window.healState).toBe("exhausted");
		await window.heal();
		expect(fetch.mock.calls.length - calls).toBe(15);
		expect(window.hasGap).toBe(false);
		expect(window.healState).toBe("idle");
		expect(ids(window.visibleRows)).toEqual(ids(journal.slice(1041, 2400)));
		// The oldest-edge cursor was never touched by the fill.
		expect(window.cursor).toBe("q01041");
	});

	it("(c) a hung page shows the notice at the time budget; the late page still closes the hole", async () => {
		vi.useFakeTimers();
		try {
			const journal = sequence(1500);
			const late = deferred<HistoryResponse>();
			let hang = false;
			const base = relay(() => journal);
			const fetch = vi.fn((before?: string) =>
				hang ? late.promise : base(before),
			);
			const window = new HistoryWindow(fetch, () => {}, {
				budget: { pages: 5, rows: 400, ms: 3000 },
			});
			window.accept(capped(journal, 1200));
			await window.load();
			// Frame 1279..1357: the page before it (1199..1278) overlaps at 1199.
			window.accept(capped(journal, 1358));
			expect(window.hasGap).toBe(true);
			hang = true;
			const healing = window.heal();
			expect(window.healState).toBe("healing");
			await vi.advanceTimersByTimeAsync(3000);
			expect(window.healState).toBe("exhausted");
			hang = false;
			late.resolve(await base("q01279"));
			await healing;
			expect(window.hasGap).toBe(false);
			expect(window.healState).toBe("idle");
			expect(ids(window.visibleRows)).toEqual(ids(journal.slice(1041, 1358)));
		} finally {
			vi.useRealTimers();
		}
	});

	it("(c) a failed or unavailable gap page ends the fill as a quiet notice, never a loop", async () => {
		const journal = sequence(1500);
		let mode: "fail" | "unavailable" | "ok" = "fail";
		const base = relay(() => journal);
		const fetch = vi.fn((before?: string) => {
			if (before !== undefined && before > "q01300" && mode === "fail")
				return Promise.reject(new Error("offline"));
			if (before !== undefined && before > "q01300" && mode === "unavailable")
				return Promise.resolve({
					entries: [],
					has_more: false,
					unavailable: "x",
				});
			return base(before);
		});
		const window = new HistoryWindow(fetch, () => {}, { autoHeal: true });
		window.accept(capped(journal, 1200));
		await window.load();
		const calls = fetch.mock.calls.length;
		window.accept(capped(journal, 1500));
		await settle(window);
		expect(fetch.mock.calls.length - calls).toBe(1);
		expect(window.healState).toBe("exhausted");
		expect(window.error).toBeNull();
		mode = "unavailable";
		await window.heal();
		expect(window.healState).toBe("exhausted");
		expect(window.hasGap).toBe(true);
		mode = "ok";
		await window.heal();
		expect(window.hasGap).toBe(false);
	});

	it("(e) healing never moves or re-keys a held row: same objects, upper island order kept, live tail still last", async () => {
		const journal = sequence(1500);
		const late = deferred<HistoryResponse>();
		const base = relay(() => journal);
		let hold = true;
		const fetch = vi.fn((before?: string) =>
			before === "q01421" && hold ? late.promise : base(before),
		);
		const window = new HistoryWindow(fetch, () => {}, { autoHeal: true });
		window.accept(capped(journal, 1200));
		await window.load();
		window.accept(capped(journal, 1500));
		const before = [...window.visibleRows];
		// A live frame lands while the first gap page is in flight: the tail grows.
		const grown = journal.concat(row("q01500"), row("q01501"));
		window.accept(capped(grown, 1502));
		hold = false;
		late.resolve(await base("q01421"));
		await settle(window);
		expect(window.hasGap).toBe(false);
		const after = window.visibleRows;
		// Every row that was on screen is the SAME object (no re-key, no flicker)
		// and keeps its relative order.
		const kept = after.filter((entry) => before.includes(entry));
		expect(kept).toEqual(before);
		expect(after.at(-1)?.id).toBe("q01501");
		expect(ids(after)).toEqual(ids(grown.slice(1041, 1502)));
	});

	it("(f) the PR #207 1200/1500 replay ends with zero missing rows and no duplicates", async () => {
		const journal = sequence(1500);
		const { window } = await opened(journal, () => journal);
		window.accept(capped(journal, 1500));
		await settle(window);
		while (window.hasMore && !window.error) await window.load();
		expect(missing(journal, window)).toBe(0);
		expect(ids(window.visibleRows)).toEqual(ids(journal));
		expect(new Set(ids(window.visibleRows)).size).toBe(1500);
		expect(claimsBeginning(window)).toBe(true);
	});

	it("(f) a reader already paged to the beginning heals a reconnect hole to the full journal", async () => {
		const journal = sequence(1500);
		const fetch = relay(() => journal);
		const window = new HistoryWindow(fetch, () => {}, { autoHeal: true });
		window.accept(capped(journal, 1200));
		await window.load();
		while (window.hasMore && !window.error) await window.load();
		window.accept(capped(journal, 1500, false));
		await settle(window);
		expect(window.hasGap).toBe(false);
		expect(ids(window.visibleRows)).toEqual(ids(journal));
	});

	it("reload and retire fence an in-flight fill", async () => {
		const journal = sequence(1500);
		const late = deferred<HistoryResponse>();
		const base = relay(() => journal);
		const fetch = vi.fn((before?: string) =>
			before === "q01421" ? late.promise : base(before),
		);
		const window = new HistoryWindow(fetch, () => {}, { autoHeal: true });
		window.accept(capped(journal, 1200));
		await window.load();
		window.accept(capped(journal, 1500));
		await Promise.resolve();
		window.retire();
		late.resolve(await base("q01421"));
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(window.healState).toBe("idle");
		expect(ids(window.rows)).not.toContain("q01341");
	});

	it("without autoHeal the bare PR #207 detection contract is unchanged", async () => {
		const journal = sequence(1500);
		const { fetch, window } = await opened(journal, () => journal, {});
		const calls = fetch.mock.calls.length;
		window.accept(capped(journal, 1500));
		await Promise.resolve();
		expect(window.hasGap).toBe(true);
		expect(window.healState).toBe("idle");
		expect(fetch.mock.calls.length).toBe(calls);
	});

	/* PR #217 Q1. A resume fires the newest-page refresh and the gap fill in the
	 * same tick. The newest page holds 80 rows, one more than the capped frame's
	 * 79, so its oldest row is one the reader does not hold. It used to merge at
	 * the LIST HEAD, and the fill then took it for its overlap and closed the
	 * hole with nothing inserted. Every arrival order must leave zero missing. */
	const gaps = (window: HistoryWindow) => {
		const seq = window.visibleRows.map((entry) => Number(entry.id.slice(1)));
		return seq.filter((value, at) => at > 0 && value !== (seq[at - 1] ?? 0) + 1)
			.length;
	};
	/** A relay whose answers are held until the test releases them, so the two
	 * reads can be made to land in a chosen order. */
	const gatedOpen = async (
		journal: TranscriptEntry[],
		retained: () => TranscriptEntry[],
	) => {
		const inner = relay(retained);
		const queue: { before?: string; release: () => void }[] = [];
		let gate = false;
		const fetch = vi.fn((before?: string) =>
			gate
				? new Promise<HistoryResponse>((resolve) =>
						queue.push({
							before,
							release: () => void inner(before).then(resolve),
						}),
					)
				: inner(before),
		);
		const window = new HistoryWindow(fetch, vi.fn(), { autoHeal: true });
		window.accept(capped(journal, 1200));
		await window.load();
		gate = true;
		const take = (newest: boolean) => {
			const at = queue.findIndex(
				(call) => (call.before === undefined) === newest,
			);
			const [call] = queue.splice(at, 1);
			call?.release();
		};
		return { window, queue, take, ungate: () => (gate = false) };
	};
	const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

	it("(Q1) a newest refresh racing the fill, newest page landing first, loses no row", async () => {
		const journal = sequence(1500);
		let retained = journal.slice(0, 1200);
		const { window, queue, take, ungate } = await gatedOpen(
			journal,
			() => retained,
		);
		retained = journal.slice(0, 1350);
		window.accept(capped(journal, 1350));
		await flush(); // the fill's microtask has issued its page
		void window.load(true);
		await flush(); // load() issues its read on a microtask too
		expect(queue.map((call) => call.before)).toEqual(["q01271", undefined]);
		ungate();
		take(true);
		await flush();
		// The 80th newest-page row sits at the newer block's bottom, never the head.
		expect(window.visibleRows[0]?.id).toBe("q01041");
		expect(window.gapBefore).toBe("q01270");
		take(false);
		await settle(window);
		expect(window.hasGap).toBe(false);
		expect(window.healState).toBe("idle");
		expect(ids(window.visibleRows)).toEqual(ids(journal.slice(1041, 1350)));
	});

	it("(Q1) the same race with the gap page landing first loses no row", async () => {
		const journal = sequence(1500);
		let retained = journal.slice(0, 1200);
		const { window, take, ungate } = await gatedOpen(journal, () => retained);
		retained = journal.slice(0, 1350);
		window.accept(capped(journal, 1350));
		await flush();
		void window.load(true);
		ungate();
		take(false);
		await flush();
		take(true);
		await settle(window);
		await flush();
		expect(window.hasGap).toBe(false);
		expect(ids(window.visibleRows)).toEqual(ids(journal.slice(1041, 1350)));
	});

	it("(Q1) a refresh fired in the same tick as the hole is merged before the fill reads", async () => {
		const journal = sequence(1500);
		let retained = journal.slice(0, 1200);
		const { fetch, window } = await opened(journal, () => retained);
		const calls = fetch.mock.calls.length;
		retained = journal.slice(0, 1350);
		window.accept(capped(journal, 1350));
		const refresh = window.load(true);
		await refresh;
		await settle(window);
		// The fill waited for the refresh, so it walks from the boundary the
		// refresh moved (q01270), not the frame's oldest row.
		expect(fetch.mock.calls.slice(calls)).toEqual([[undefined], ["q01270"]]);
		expect(window.hasGap).toBe(false);
		expect(ids(window.visibleRows)).toEqual(ids(journal.slice(1041, 1350)));
	});

	it("(Q1) a 1000-row hole under the same race reaches the budget and keeps the notice", async () => {
		const journal = sequence(2400);
		let retained = journal.slice(0, 1200);
		const { window, take, ungate } = await gatedOpen(journal, () => retained);
		retained = journal.slice(0, 2200);
		window.accept(capped(journal, 2200));
		await flush();
		void window.load(true);
		await flush();
		ungate();
		take(true); // the shape QA saw: the newest page lands first
		await flush();
		take(false);
		await settle(window);
		await flush();
		expect(window.healState).toBe("exhausted");
		expect(window.hasGap).toBe(true);
		// One hole, at the boundary; nothing misplaced above the held history.
		expect(gaps(window)).toBe(1);
		expect(window.visibleRows[0]?.id).toBe("q01041");
		expect(claimsBeginning(window)).toBe(false);
		for (let turn = 0; turn < 5 && window.hasGap; turn++) await window.heal();
		expect(window.hasGap).toBe(false);
		expect(ids(window.visibleRows)).toEqual(ids(journal.slice(1041, 2200)));
	});

	/* PR #217 R1-1. Two resumes leave two holes. Closing the newer one must not
	 * declare the transcript complete while the older one is still open. */
	it("(R1-1) two resumes, the first past the budget: the older hole stays marked until it is filled", async () => {
		const journal = sequence(4000);
		let retained = journal.slice(0, 2300);
		const { window } = await opened(journal, () => retained);
		window.accept(capped(journal, 2300));
		await settle(window);
		expect(window.healState).toBe("exhausted");
		const older = window.gapBefore;
		expect(older).not.toBeNull();
		retained = journal.slice(0, 2600);
		window.accept(capped(journal, 2600));
		await settle(window);
		// The small newer hole closed; the older one is still open and marked.
		expect(window.hasGap).toBe(true);
		expect(window.healState).toBe("exhausted");
		expect(gaps(window)).toBe(1);
		expect(window.gapBefore).not.toBeNull();
		// Paging to the retained beginning still does not claim it.
		for (let turn = 0; turn < 40 && window.hasMore; turn++) await window.load();
		expect(window.hasMore).toBe(false);
		expect(claimsBeginning(window)).toBe(false);
		for (let turn = 0; turn < 10 && window.hasGap; turn++) await window.heal();
		expect(window.hasGap).toBe(false);
		expect(missing(journal.slice(0, 2600), window)).toBe(0);
		expect(gaps(window)).toBe(0);
		expect(claimsBeginning(window)).toBe(true);
	});
});
