import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { type CustomRoute, createRelayClient } from "../connection";
import {
	layoutRailMarks,
	marksBeyondWindow,
	railMarks,
	railState,
} from "../features/session/checkpoint-rail";
import { isRelayError } from "../relay";
import { loadFixture } from "../testing/fixtures";

/**
 * The checkpoint rail's wire, outside-in: the app's REAL client against a REAL
 * server serving the committed captures, and the rail's own reading of what
 * came back.
 *
 * The fact this file exists for is the WINDOWED-PROJECTION DRIVE: the phone's
 * projection is a bounded tail window (the newest 80 rows) and its first
 * history page is the same cap, so marks for older turns can only come from
 * the manifest — the rail must not shrink to the window. The deep capture
 * gives that claim numbers: 100 ticks over 50 turns, of which the loaded
 * window holds all but 19 (`checkpoints-deep-history*.json` reconstruct the
 * phone's whole reach: the newest 80 entries plus the page below them).
 *
 * The states are then each read through `railState` — the exact function the
 * component renders from — because the honesty rules are state-machine facts:
 * `error` is never "no checkpoints", `ready`+[] is genuinely empty, and
 * `building` keeps the previous scan painting while the caller polls.
 *
 * The server is this file's own, the `schedules.e2e.test.ts` shape: payloads
 * are the committed captures, served verbatim, and what is asserted is what
 * crossed the socket plus what the rail's own reading makes of it.
 */

const servers: Server[] = [];
const recorded: Array<{ method: string; path: string }> = [];

afterEach(async () => {
	await Promise.all(
		servers.splice(0).map(
			(server) =>
				new Promise<void>((resolve) => {
					server.close(() => resolve());
					server.closeAllConnections();
				}),
		),
	);
	recorded.length = 0;
});

/** A local server answering every request with one canned body. */
async function serve(body: unknown, status = 200): Promise<string> {
	const server = createServer((request, response) => {
		recorded.push({ method: request.method ?? "", path: request.url ?? "" });
		response.writeHead(status, { "content-type": "application/json" });
		response.end(JSON.stringify(body));
	});
	servers.push(server);
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	return `http://127.0.0.1:${port}`;
}

function clientFor(baseUrl: string) {
	const route: CustomRoute = { mode: "custom", baseUrl, allowInsecure: true };
	return createRelayClient({ route });
}

/** The captured body of a fixture, exactly as the relay sent it. */
function captured(rel: string): {
	session_id: string;
	index: unknown;
	checkpoints: unknown[];
} {
	return loadFixture<{ body: never }>(`http/${rel}`).body;
}

/** The captured SSE data frame of a fixture, exactly as the relay sent it. */
function capturedProjection(rel: string): {
	transcript: Array<{ id: string }>;
} {
	return loadFixture<{ data: never }>(`sse/${rel}`).data;
}

describe("GET /api/sessions/{id}/checkpoints through the real stack", () => {
	it("covers the WHOLE conversation — marks exist that no loaded window holds", async () => {
		const manifest = captured("checkpoints-deep.json");
		const baseUrl = await serve(manifest);
		const client = clientFor(baseUrl);

		const answer = await client.checkpoints("a751eae8b897");
		expect(recorded[0]?.method).toBe("GET");
		expect(recorded[0]?.path).toBe("/api/sessions/a751eae8b897/checkpoints");

		/* The window the phone can hold at first open: the projection's tail
		 * (≤80 rows) plus one history page — 80 entries, `has_more: true`, with
		 * the page BELOW them reachable only by paging (`before=`). */
		const pipeline = capturedProjection("sse-projection-checkpoints-deep.json");
		const newest = loadFixture<{ body: { entries: Array<{ id: string }> } }>(
			"http/checkpoints-deep-history.json",
		).body.entries;
		expect(pipeline.transcript).toHaveLength(80);
		expect(newest).toHaveLength(80);
		const loaded = new Set([
			...pipeline.transcript.map((row) => row.id),
			...newest.map((row) => row.id),
		]);

		const marks = railMarks(answer.checkpoints as never);
		expect(marks).toHaveLength(100);
		expect(marks[0]?.fraction).toBe(0);
		expect(marks[marks.length - 1]?.fraction).toBe(1);

		/* THE ASSERTION THIS ROUTE EXISTS FOR: a loaded-only rail could not
		 * carry these marks. 19 of the 100 ticks are for rows outside the whole
		 * reach above — pinned as a number so a fixture refresh that quietly
		 * shortened the conversation fails here rather than weakening the
		 * claim. */
		const beyond = marks.filter((mark) => !loaded.has(mark.id));
		expect(beyond).toHaveLength(19);
		expect(marksBeyondWindow(marks, loaded)).toBe(true);

		/* And the rail draws ALL of them: layout never filters to the window. */
		const placed = layoutRailMarks(marks, 300);
		expect(placed).toHaveLength(100);
		expect(placed[0]?.yPt).toBe(10);
		expect(placed[99]?.yPt).toBe(290);
	});
});

describe("the rail's states, read from the captures", () => {
	it("`building` keeps the previous rail painting and keeps the poll on", async () => {
		const baseUrl = await serve(captured("checkpoints-building.json"));
		const client = clientFor(baseUrl);
		const answer = await client.checkpoints("a751eae8b897");

		const state = railState(answer, false);
		expect(state.kind).toBe("marks");
		if (state.kind !== "marks") return;
		expect(state.building).toBe(true);
		/* The previous scan's FULL rail travels with the building answer — the
		 * reason "show the previous rail rather than nothing" is paint-able. */
		expect(state.marks).toHaveLength(100);
	});

	it("`ready` with no ticks is genuinely empty — no rail, and no failure mark", async () => {
		const baseUrl = await serve(captured("checkpoints-empty.json"));
		const client = clientFor(baseUrl);
		const answer = await client.checkpoints("51d24dbedb2b");

		expect(answer.index.state).toBe("ready");
		expect(railState(answer, false)).toEqual({ kind: "empty" });
	});

	it("the relay's own `error` can never render as no-checkpoints", async () => {
		const baseUrl = await serve(captured("checkpoints-error.json"));
		const client = clientFor(baseUrl);
		const answer = await client.checkpoints("d3044c49505c");

		const state = railState(answer, false);
		expect(state.kind).toBe("error");
		expect(state.kind).not.toBe("empty");
		expect(state.kind).not.toBe("unavailable");
	});

	it("refuses a manifest whose index state is not a word this build knows", async () => {
		const broken = {
			...captured("checkpoints-ready.json"),
			index: { state: "paused", built_at: null },
		};
		const baseUrl = await serve(broken);
		const client = clientFor(baseUrl);

		let caught: unknown;
		try {
			await client.checkpoints("7859176f7f2c");
		} catch (failure) {
			caught = failure;
		}
		expect(isRelayError(caught)).toBe(true);
		if (!isRelayError(caught)) return;
		/* The closed vocabulary is heard AT THE BOUNDARY: the rail is a
		 * decoration, and a mark painted for a meaning nothing assigned would be
		 * worse than a rail that refuses the frame. */
		expect(caught.kind).toBe("malformed-frame");
	});
});
