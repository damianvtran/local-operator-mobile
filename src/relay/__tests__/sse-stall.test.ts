/**
 * The silence watchdog, driven through a real socket and the real abort path.
 *
 * A fake timer or a scripted reader would skip the exact mechanism that failed:
 * `AbortController.abort()` surfaces as a REJECTED `read()`, and the connection
 * loop has to tell that rejection from a genuine transport error. So the server
 * here is a real `node:http` listener that answers the first request with headers
 * and then nothing, and the client reads it with the platform `fetch`.
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";
import { loadFixture } from "../../testing/fixtures";
import {
	type DecodedFrame,
	SseConnection,
	STREAM_RETRY_BASE_MS,
	STREAM_RETRY_MAX_MS,
	type StreamStatus,
	streamRetryDelayMs,
} from "../index";

const projection = loadFixture<{ event: string; data: unknown }>(
	"sse/sse-projection-live-idle.json",
);

const servers: Server[] = [];
afterEach(async () => {
	for (const server of servers.splice(0)) {
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
});

describe("a stream that goes silent is reopened, not abandoned", () => {
	it("tears down the quiet socket and reopens on the same path as a rotation", async () => {
		let requests = 0;
		const server = createServer((_request, response) => {
			requests += 1;
			response.writeHead(200, {
				"content-type": "text/event-stream",
				"cache-control": "no-store",
			});
			response.flushHeaders();
			/* The first connection: open, headers sent, then dead air — the shape of a
			 * tunnel that stopped forwarding while the socket stays up. The second
			 * connection behaves, and starts with the seed snapshot. */
			if (requests >= 2) {
				response.write(
					`event: ${projection.event}\ndata: ${JSON.stringify(projection.data)}\n\n`,
				);
			}
		});
		servers.push(server);
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve),
		);
		const { port } = server.address() as AddressInfo;

		const states: StreamStatus[] = [];
		const frames: DecodedFrame[] = [];
		const errors: unknown[] = [];
		const connection = new SseConnection({
			open: async (signal) => {
				const response = await fetch(`http://127.0.0.1:${port}/stream`, {
					signal,
				});
				if (!response.body) throw new Error("no body");
				const reader = response.body.getReader();
				return {
					reader,
					release: async () => {
						await reader.cancel().catch(() => undefined);
					},
				};
			},
			onFrame: (frame) => void frames.push(frame),
			onState: (status) => void states.push(status),
			onError: (error) => void errors.push(error),
			random: () => 0,
			silenceMs: 150,
		});

		connection.start();
		await vi.waitFor(
			() => expect(frames.some((f) => f.kind === "projection")).toBe(true),
			{ timeout: 5_000 },
		);
		const beforeStop = [...states];
		const stillRunning = connection.isRunning;
		connection.stop();

		expect(requests).toBeGreaterThanOrEqual(2);
		expect(stillRunning).toBe(true);
		/* The stall is routine, so nothing user-visible: no error, and no `closed`
		 * state before the caller's own stop(). */
		expect(errors).toEqual([]);
		expect(beforeStop.some((s) => s.state === "closed")).toBe(false);
		/* It is reported as a stall (so a screen may dim, not fail), then reopens and
		 * ends in `open` with the second attempt's seed frame delivered. */
		const names = beforeStop.map((s) => s.state);
		expect(names).toContain("stalled");
		expect(names.at(-1)).toBe("open");
		expect(beforeStop.at(-1)?.attempt).toBe(2);
	});

	it("reopens after a mid-body reset and resyncs, instead of stopping", async () => {
		/* The other half of the flag: the WATCHDOG did not abort here — the server
		 * destroyed the socket mid-body, which is what a phone changing networks looks
		 * like from inside the app. The stream is broken, not gone, so the loop reopens
		 * on the stall/rotation path rather than stopping and leaving a screen to
		 * restart it. */
		let requests = 0;
		const server = createServer((request, response) => {
			requests += 1;
			response.writeHead(200, {
				"content-type": "text/event-stream",
				"cache-control": "no-store",
			});
			response.flushHeaders();
			if (requests === 1) {
				/* Headers, then a hard reset mid-body. */
				setTimeout(() => request.socket.destroy(), 20);
				return;
			}
			response.write(
				`event: ${projection.event}\ndata: ${JSON.stringify(projection.data)}\n\n`,
			);
		});
		servers.push(server);
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve),
		);
		const { port } = server.address() as AddressInfo;

		const states: StreamStatus[] = [];
		const frames: DecodedFrame[] = [];
		const errors: unknown[] = [];
		const connection = new SseConnection({
			open: async (signal) => {
				const response = await fetch(`http://127.0.0.1:${port}/stream`, {
					signal,
				});
				if (!response.body) throw new Error("no body");
				const reader = response.body.getReader();
				return {
					reader,
					release: async () => {
						await reader.cancel().catch(() => undefined);
					},
				};
			},
			onFrame: (frame) => void frames.push(frame),
			onState: (status) => void states.push(status),
			onError: (error) => void errors.push(error),
			random: () => 0,
			silenceMs: 30_000,
		});
		connection.start();
		await vi.waitFor(
			() => expect(frames.some((f) => f.kind === "projection")).toBe(true),
			{ timeout: 5_000 },
		);
		const beforeStop = [...states];
		const stillRunning = connection.isRunning;
		connection.stop();

		expect(stillRunning).toBe(true);
		expect(requests).toBeGreaterThanOrEqual(2);
		/* The reset is reported as a stall whose leg ended in an error, carrying the
		 * cause, and the loop then reopened and delivered the second connection's
		 * seed frame. */
		const stalled = beforeStop.find((status) => status.state === "stalled");
		expect(stalled?.lastEnd).toBe("error");
		expect(stalled?.lastError?.kind).toBe("transport");
		expect(beforeStop.at(-1)?.state).toBe("open");
		expect(beforeStop.at(-1)?.attempt).toBe(2);
		/* A reset is routine on a phone, so it is not a user-visible failure: nothing
		 * reaches onError and the loop never reports itself closed while the caller
		 * still wants it. */
		expect(errors).toEqual([]);
		expect(beforeStop.some((status) => status.state === "closed")).toBe(false);
	});

	it("spaces consecutive failures out instead of retrying flat out", () => {
		expect(streamRetryDelayMs(1)).toBe(STREAM_RETRY_BASE_MS);
		expect(streamRetryDelayMs(2)).toBe(STREAM_RETRY_BASE_MS * 2);
		expect(streamRetryDelayMs(3)).toBe(STREAM_RETRY_BASE_MS * 4);
		expect(streamRetryDelayMs(0)).toBe(STREAM_RETRY_BASE_MS);
		expect(streamRetryDelayMs(50)).toBe(STREAM_RETRY_MAX_MS);
	});
});
