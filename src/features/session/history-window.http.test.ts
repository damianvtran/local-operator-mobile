import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { expect, it, vi } from "vitest";
import {
	parsePayload,
	type SessionProjection,
	type TranscriptEntry,
} from "@/contracts";
import { RelayEndpoints, RelayHttpClient } from "@/relay";
import { createProjectionStore } from "@/state";
import { fixtureBody } from "@/testing/fixture-relay";
import { HistoryWindow } from "./history-window";
import { LIVE_INLINE_UI } from "./live-inline-ui";

/** Actual fetch → RelayHttpClient → boundary schema → endpoint → pager. This
 * loopback is synthetic wire infrastructure, not a native/rendered-app claim. */
it("pages authenticated synthetic history through production HTTP and retries refusal/unavailable", async () => {
	const journal: TranscriptEntry[] = Array.from({ length: 1500 }, (_, at) => ({
		id: `message-${at}`,
		kind: "user",
		text: "synthetic",
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
	}));
	const cursors: Array<string | null> = [];
	const statuses: number[] = [];
	let admitted = false;
	let retainedCount = 1200;
	const methods: string[] = [];
	let unavailable = false;
	const server = createServer((request, response) => {
		response.setHeader("Content-Type", "application/json");
		methods.push(request.method ?? "");
		if (!admitted) {
			statuses.push(401);
			response.writeHead(401);
			response.end(JSON.stringify({ error: "unauthorized" }));
			return;
		}
		const url = new URL(request.url ?? "/", "http://127.0.0.1");
		expect(url.pathname).toBe(
			"/api/sessions/00000000-0000-4000-8000-000000000001/history",
		);
		const before = url.searchParams.get("before");
		cursors.push(before);
		statuses.push(200);
		if (unavailable) {
			unavailable = false;
			response.end(
				JSON.stringify({
					entries: [],
					has_more: false,
					unavailable: "synthetic unsupported archive",
				}),
			);
			return;
		}
		const end =
			before === null
				? retainedCount
				: journal.findIndex((entry) => entry.id === before);
		const start = Math.max(0, end - Number(url.searchParams.get("limit")));
		response.end(
			JSON.stringify({
				entries: journal.slice(start, end),
				has_more: start > 0,
			}),
		);
	});
	server.listen(0, "127.0.0.1");
	try {
		await once(server, "listening");
		const address = server.address();
		if (!address || typeof address === "string")
			throw new Error("No ephemeral loopback address");
		const baseUrl = `http://127.0.0.1:${address.port}`;
		const endpoints = new RelayEndpoints(
			new RelayHttpClient({
				baseUrl,
				auth: () => ({ cookie: null, origin: null, credentials: "omit" }),
			}),
		);
		const window = new HistoryWindow(
			(before) =>
				endpoints.history("00000000-0000-4000-8000-000000000001", {
					before,
					limit: 17,
				}),
			() => {},
		);
		await window.load();
		expect(window.error).toBe("failed");
		expect(window.rows).toEqual([]);
		admitted = true;
		await window.load();
		expect(window.rows).toHaveLength(17);
		const cursor = window.cursor;
		unavailable = true;
		await window.load();
		expect(window.error).toBe("failed");
		expect(window.cursor).toBe(cursor);
		expect(window.hasMore).toBe(true);
		while (window.hasMore && !window.error) await window.load();
		// The previous unavailable response must require explicit retry, not an
		// automatic polling loop or a false terminal-empty success.
		expect(window.error).toBe("failed");
		await window.load();
		while (window.hasMore && !window.error) await window.load();
		expect(window.rows.map((entry) => entry.id)).toEqual(
			journal.slice(0, 1200).map((entry) => entry.id),
		);
		expect(window.error).toBeNull();
		expect(statuses[0]).toBe(401);
		expect(cursors[0]).toBeNull();
		expect(cursors[1]).toBe("message-1183");
		expect(cursors[2]).toBe("message-1183");
		expect(cursors).toHaveLength(72);
		// A coalesced reconnect frame is disjoint from the previously read tail.
		window.accept({
			transcript: journal.slice(1421),
		} as SessionProjection);
		expect(window.hasGap).toBe(true);
		expect(window.hasMore).toBe(false);
		// PR #207 Q7: the reconnect tail renders after every held row, newest last.
		const order = window.visibleRows.map((entry) =>
			Number(entry.id.replace("message-", "")),
		);
		expect(
			order.every(
				(value, at) =>
					at === 0 || value > (order[at - 1] ?? Number.POSITIVE_INFINITY),
			),
		).toBe(true);
		expect(window.visibleRows.at(-1)?.id).toBe("message-1499");
		expect(window.gapBefore).toBe("message-1421");
		const missingBefore = journal.filter(
			(entry) => !window.rows.some((row) => row.id === entry.id),
		).length;
		expect(missingBefore).toBe(221);
		retainedCount = 1500;
		await window.reload();
		// The newest durable page (PR #356 R1), not an older page from the frame.
		expect(cursors.at(-1)).toBeNull();
		expect(window.visibleRows.at(-1)?.id).toBe("message-1499");
		while (window.hasMore && !window.error) await window.load();
		expect(window.rows.map((entry) => entry.id)).toEqual(
			journal.map((entry) => entry.id),
		);
		expect(window.hasGap).toBe(false);
		expect(window.error).toBeNull();
		expect(methods.every((method) => method === "GET")).toBe(true);
		console.log(
			JSON.stringify({
				recovery: "explicit-reader-reload",
				missing_before: missingBefore,
				rows_after: window.rows.length,
				missing_after: journal.filter(
					(entry) => !window.rows.some((row) => row.id === entry.id),
				).length,
				latest: window.rows.at(-1)?.id,
				methods: [...new Set(methods)],
			}),
		);
		console.log(
			JSON.stringify({
				rows: window.rows.length,
				missing: 0,
				successful_pages: cursors.length - 1,
				unavailable: 1,
				refusals: 1,
				requests: statuses.length,
				final_has_more: window.hasMore,
			}),
		);
	} finally {
		server.closeAllConnections();
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve())),
		);
	}
});

it("negotiates live and paged overlays over HTTP and falls back to legacy prose", async () => {
	const session = "00000000-0000-4000-8000-000000000001";
	const base = parsePayload(
		"sessionProjection",
		fixtureBody("sse/sse-projection-live-idle.json"),
	);
	const answer = (id: string, text: string): TranscriptEntry => ({
		id,
		kind: "assistant",
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
	const live = answer("current", "Legacy live table");
	const mid = answer("middle", "Legacy middle answer");
	const older = answer("older", "Legacy older table");
	const widget = {
		type: "table",
		title: "Counts",
		columns: ["N"],
		rows: [[3]],
	};
	const envelope = (offset: number) => ({
		version: 1,
		text: "Hi😀\r\nBye",
		widgets: [{ offset, payload: widget }],
	});
	const requests: string[] = [];
	const commands: unknown[] = [];
	const server = createServer((request, response) => {
		const url = new URL(request.url ?? "/", "http://127.0.0.1");
		requests.push(`${request.method} ${url.pathname}${url.search}`);
		const rich = url.searchParams.get("inline_ui") === "1";
		if (url.pathname.endsWith("/events")) {
			response.writeHead(200, { "content-type": "text/event-stream" });
			const seed = { ...base, session_id: session, transcript: [live] };
			const emit = (data: object) =>
				response.write(`event: projection\ndata: ${JSON.stringify(data)}\n\n`);
			emit({
				...seed,
				version: 1,
				...(rich && {
					inline_ui: { version: 1, messages: { current: envelope(4) } },
				}),
			});
			// A later full frame must remove only the addressed rich content, even
			// when the legacy row is byte-identical and the UI memoizes it.
			emit({
				...seed,
				version: 2,
				...(rich && {
					inline_ui: { version: 1, messages: { current: envelope(3) } },
				}),
			});
			emit({ ...seed, version: 3 });
			return;
		}
		response.setHeader("content-type", "application/json");
		if (url.pathname.endsWith("/history")) {
			const first = url.searchParams.get("before") === live.id;
			const row = first ? mid : older;
			response.end(
				JSON.stringify({
					entries: [row],
					has_more: first,
					...(rich && {
						inline_ui: {
							version: 1,
							messages: { [row.id]: envelope(4), current: envelope(4) },
						},
					}),
				}),
			);
			return;
		}
		let raw = "";
		request.on("data", (chunk) => {
			raw += chunk;
		});
		request.on("end", () => {
			commands.push(JSON.parse(raw));
			response.end(JSON.stringify({ ok: true, detail: "received" }));
		});
	});
	server.listen(0, "127.0.0.1");
	try {
		await once(server, "listening");
		const address = server.address();
		if (!address || typeof address === "string")
			throw new Error("No loopback address");
		const endpoints = new RelayEndpoints(
			new RelayHttpClient({
				baseUrl: `http://127.0.0.1:${address.port}`,
				auth: () => ({ cookie: null, origin: null, credentials: "omit" }),
			}),
		);
		const store = createProjectionStore();
		store.getState().beginStream(session);
		const window = new HistoryWindow(
			(before) => endpoints.history(session, { before, inlineUi: true }),
			() => {},
		);
		const observed: unknown[] = [];
		const stream = endpoints.sessionStream(session, {
			inlineUi: true,
			steerJournalOrder: true,
			onFrame: (frame) => {
				if (frame.kind !== "projection") return;
				store.getState().applyFrame(session, frame.data);
				window.accept(store.getState().entries[session]?.projection ?? null);
				const tail = window.visibleRows.at(-1);
				observed.push(tail?.[LIVE_INLINE_UI] ?? tail?.text);
			},
		});
		stream.connection.start();
		try {
			await vi.waitFor(() => expect(observed).toHaveLength(3));
			const rich = [
				{ kind: "markdown", text: "Hi😀" },
				{ kind: "ui", value: widget },
				{ kind: "markdown", text: "\r\nBye" },
			];
			expect(observed).toEqual([rich, live.text, live.text]);
			await window.load();
			await window.load();
			expect(
				window.visibleRows.map((row) => [
					row.id,
					row[LIVE_INLINE_UI] ?? row.text,
				]),
			).toEqual([
				[older.id, rich],
				[mid.id, rich],
				[live.id, live.text],
			]);
			expect(window.hasMore).toBe(false);
			const legacy = await endpoints.history(session, { before: live.id });
			expect(legacy).toMatchObject({ entries: [mid], has_more: true });
			expect(legacy.inline_ui).toBeUndefined();
			const prompt = {
				op: "prompt",
				command_id: "10000000-0000-4000-8000-000000000001",
				text: "Count them",
			} as const;
			const steer = {
				op: "steer",
				command_id: "10000000-0000-4000-8000-000000000002",
				text: "Use the last week",
			} as const;
			expect(await endpoints.command(session, prompt)).toMatchObject({
				ok: true,
			});
			expect(await endpoints.command(session, steer)).toMatchObject({
				ok: true,
			});
			expect(await endpoints.ping(session)).toMatchObject({ ok: true });
			expect(commands).toEqual([
				{ ...prompt, inline_ui: true },
				{ ...steer, inline_ui: true },
				{ op: "ping" },
			]);
			const path = `/api/sessions/${session}`;
			expect(requests).toEqual([
				`GET ${path}/events?steer_journal_order=1&inline_ui=1`,
				`GET ${path}/history?before=current&inline_ui=1`,
				`GET ${path}/history?before=middle&inline_ui=1`,
				`GET ${path}/history?before=current`,
				`POST ${path}/command`,
				`POST ${path}/command`,
				`POST ${path}/command`,
			]);
			console.log(
				JSON.stringify({
					requests,
					sse: observed,
					paged: window.visibleRows.map((row) => ({
						id: row.id,
						overlay: !!row[LIVE_INLINE_UI],
					})),
					commands,
				}),
			);
		} finally {
			stream.stop();
		}
	} finally {
		server.closeAllConnections();
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve())),
		);
	}
});

it("the production boundary preserves unavailable instead of treating it as an empty success", () => {
	expect(
		parsePayload("history", {
			entries: [],
			has_more: false,
			unavailable: "synthetic",
		}),
	).toEqual({ entries: [], has_more: false, unavailable: "synthetic" });
	expect(() =>
		parsePayload("history", {
			entries: [],
			has_more: false,
			unavailable: true,
		}),
	).toThrow();
});

/** Captured synthetic Core production responses, not a hand-written pager.
 * Provenance (Core head/helper ref) is retained in each fixture's result field.
 * The initial rendered has_more is intentionally NOT the journal domain. */
it.each(["short", "compaction"] as const)(
	"projection-first cursor paging reaches the captured %s journal",
	async (name) => {
		const fixture = JSON.parse(
			readFileSync(
				new URL(`./fixtures/${name}-production-wire.json`, import.meta.url),
				"utf8",
			),
		);
		if (name === "short") {
			expect(fixture.initial.entries).toHaveLength(11);
			expect(fixture.initial.has_more).toBe(false);
			expect(
				fixture.expected.filter(
					(id: string) =>
						!fixture.initial.entries.some(
							(row: TranscriptEntry) => row.id === id,
						),
				),
			).toHaveLength(326);
		}
		const requests: string[] = [];
		let pageIndex = 0;
		let expectedBefore = fixture.initial.entries[0].id;
		const server = createServer((request, response) => {
			requests.push(request.url ?? "");
			const url = new URL(request.url ?? "/", "http://127.0.0.1");
			expect(request.method).toBe("GET");
			expect(url.searchParams.get("before")).toBe(expectedBefore);
			const page = fixture.pages_from_initial[pageIndex++];
			expectedBefore = page.entries[0]?.id;
			response.setHeader("Content-Type", "application/json");
			response.end(JSON.stringify(page));
		});
		server.listen(0, "127.0.0.1");
		try {
			await once(server, "listening");
			const address = server.address();
			if (!address || typeof address === "string")
				throw new Error("No loopback address");
			const endpoints = new RelayEndpoints(
				new RelayHttpClient({
					baseUrl: `http://127.0.0.1:${address.port}`,
					auth: () => ({ cookie: null, origin: null, credentials: "omit" }),
				}),
			);
			const reader = new HistoryWindow(
				(before) =>
					endpoints.history("00000000-0000-4000-8000-000000000001", {
						before,
						limit: 17,
					}),
				() => {},
			);
			reader.accept(fixture.projection);
			expect(reader.olderState).toBe("unknown");
			expect(reader.hasMore).toBe(true);
			expect(reader.visibleRows.at(-1)?.id).toBe(
				fixture.projection.transcript.at(-1).id,
			);
			while (reader.hasMore && !reader.error) await reader.load();
			expect(reader.error).toBeNull();
			expect(reader.rows.map((row) => row.id)).toEqual(fixture.expected);
			expect(reader.olderState).toBe("end");
			expect(pageIndex).toBe(fixture.pages_from_initial.length);
			expect(
				requests.every((url) =>
					new URL(url, "http://fixture").searchParams.has("before"),
				),
			).toBe(true);
			console.log(
				JSON.stringify({
					fixture: name,
					core_head: fixture.result.core_head,
					initial_render_rows: fixture.initial.entries.length,
					initial_render_has_more: fixture.initial.has_more,
					rows_after: reader.rows.length,
					missing: fixture.expected.filter(
						(id: string) => !reader.rows.some((row) => row.id === id),
					).length,
					canonical_pages: pageIndex,
					no_cursor_requests: 0,
				}),
			);
		} finally {
			server.closeAllConnections();
			await new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve())),
			);
		}
	},
);
