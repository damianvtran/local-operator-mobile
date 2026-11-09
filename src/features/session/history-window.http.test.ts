import { once } from "node:events";
import { createServer } from "node:http";
import { expect, it } from "vitest";
import { parsePayload, type TranscriptEntry } from "@/contracts";
import { RelayEndpoints, RelayHttpClient } from "@/relay";
import { HistoryWindow } from "./history-window";

/** Actual fetch → RelayHttpClient → boundary schema → endpoint → pager. This
 * loopback is synthetic wire infrastructure, not a native/rendered-app claim. */
it("pages authenticated synthetic history through production HTTP and retries refusal/unavailable", async () => {
	const journal: TranscriptEntry[] = Array.from({ length: 1200 }, (_, at) => ({
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
	let unavailable = false;
	const server = createServer((request, response) => {
		response.setHeader("Content-Type", "application/json");
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
				? journal.length
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
			journal.map((entry) => entry.id),
		);
		expect(window.error).toBeNull();
		expect(statuses[0]).toBe(401);
		expect(cursors[0]).toBeNull();
		expect(cursors[1]).toBe("message-1183");
		expect(cursors[2]).toBe("message-1183");
		expect(cursors).toHaveLength(72);
		console.log(
			JSON.stringify({
				rows: window.rows.length,
				missing: 0,
				successful_pages: 71,
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
