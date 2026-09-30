// biome-ignore-all lint/performance/useTopLevelRegex: a regex literal inside an
// assertion is not a hot path — there is no per-frame work here to hoist out of.
// biome-ignore-all lint/style/noNonNullAssertion: an assertion after an explicit
// length/definedness check is the guard; a longhand local for it would obscure it.
/**
 * The SSE client: framing, resync, and the 60-second cut.
 *
 * The framing cases feed **literal wire bytes** — a frame split at every possible
 * byte boundary, several frames in one chunk, CRLF, multi-line `data:`, and the
 * captured `: keepalive` bytes read from the `literal` field of
 * `fixtures/relay/sse/sse-keepalive.json`.
 * A hand-written encoder in this file would have tested the encoder, which is
 * exactly the failure the fixtures' README warns about.
 *
 * The connection cases assert behaviour a user feels: an EOF after a long open is
 * a rotation (no error, reopen at once, no user-visible state), an EOF after a
 * short open is a stalled gateway (still reconnect, but report it), and a status
 * failure ends the loop with the error rather than retrying forever.
 */

import { describe, expect, it, vi } from "vitest";

import { loadFixture } from "../../testing/fixtures";

import {
	type DecodedFrame,
	decodeFrame,
	GATEWAY_LEASE_MS,
	ProjectionFence,
	SseConnection,
	SseFrameReader,
	type StreamStatus,
} from "../index";

/** A frame's literal wire bytes, built from the captured `data` — the same text
 *  the relay emits, so the reader is fed the wire and not a re-encoding of it. */
function wire(event: string, data: unknown): string {
	return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

const LIST_FRAME = loadFixture("sse/sse-list-frame.json") as {
	event: string;
	data: unknown;
};
const PROJECTION_FRAME = loadFixture("sse/sse-projection-live-idle.json") as {
	event: string;
	data: unknown;
};
/* The keep-alive sample is JSON with its bytes in a `literal` field, because the
 * corpus requires a `provenance` marker on every file and `: keepalive\n\n` has
 * nowhere to carry one. It is still the captured string, fed to the parser as-is
 * — decoding it into a hand-built frame is the mistake the README names. */
const KEEPALIVE_BYTES = (
	loadFixture("sse/sse-keepalive.json") as { literal: string }
).literal;

/** A frame's `data`, which is `string | undefined` on the wire type but is always
 *  present on a `data:`-bearing frame. Reading it through one helper keeps the
 *  assertions free of non-null assertions (which the linter refuses anyway). */
function dataOf(frame: { data?: string } | undefined): string {
	return frame?.data ?? "";
}

function bytes(text: string): Uint8Array {
	return new TextEncoder().encode(text);
}

function readAll(
	reader: SseFrameReader,
	chunks: Uint8Array[],
): ReturnType<SseFrameReader["push"]> {
	const frames: ReturnType<SseFrameReader["push"]> = [];
	for (const chunk of chunks) frames.push(...reader.push(chunk));
	return frames;
}

describe("framing is robust to how the network chops the bytes", () => {
	const doc = wire(LIST_FRAME.event, LIST_FRAME.data);
	const encoded = bytes(doc);

	it("reads a whole frame delivered in one chunk", () => {
		const frames = readAll(new SseFrameReader(), [encoded]);
		expect(frames).toHaveLength(1);
		expect(frames[0]?.event).toBe("sessions");
		expect(JSON.parse(dataOf(frames[0]))).toEqual(LIST_FRAME.data);
	});

	it("reads a frame split at EVERY byte boundary", () => {
		/* This is the case a naive line-splitter fails: the boundary can land inside
		 * `event:`, inside the JSON, or between the two newlines that terminate. */
		for (let split = 1; split < encoded.length; split += 1) {
			const reader = new SseFrameReader();
			const first = reader.push(encoded.slice(0, split));
			const second = reader.push(encoded.slice(split));
			const frames = [...first, ...second];
			expect(frames, `split at ${split}`).toHaveLength(1);
			expect(frames[0]?.event, `split at ${split}`).toBe("sessions");
			expect(JSON.parse(dataOf(frames[0])), `split at ${split}`).toEqual(
				LIST_FRAME.data,
			);
		}
	});

	it("reads several frames delivered in one chunk", () => {
		const frames = readAll(new SseFrameReader(), [
			bytes(
				wire(LIST_FRAME.event, LIST_FRAME.data) +
					wire(PROJECTION_FRAME.event, PROJECTION_FRAME.data),
			),
		]);
		expect(frames.map((frame) => frame.event)).toEqual([
			"sessions",
			"projection",
		]);
	});

	it("reads a frame whose data is split across several `data:` lines", () => {
		const json = JSON.stringify(LIST_FRAME.data);
		const half = Math.floor(json.length / 2);
		const doc = `event: sessions\ndata: ${json.slice(0, half)}\ndata: ${json.slice(half)}\n\n`;
		const frames = readAll(new SseFrameReader(), [bytes(doc)]);
		expect(frames).toHaveLength(1);
		/* The two lines are joined with a newline by the SSE spec; this payload is
		 * JSON, which tolerates the whitespace the split introduced. */
		expect(JSON.parse(dataOf(frames[0]).replace(/\n/g, " "))).toEqual(
			LIST_FRAME.data,
		);
	});

	it("reads a frame terminated with CRLF", () => {
		const doc = `event: sessions\r\ndata: ${JSON.stringify(LIST_FRAME.data)}\r\n\r\n`;
		const frames = readAll(new SseFrameReader(), [bytes(doc)]);
		expect(frames).toHaveLength(1);
		expect(JSON.parse(dataOf(frames[0]))).toEqual(LIST_FRAME.data);
	});

	it("does not emit a half-arrived frame", () => {
		const reader = new SseFrameReader();
		const cut = Math.floor(encoded.length / 2);
		expect(reader.push(encoded.slice(0, cut))).toEqual([]);
		expect(reader.push(encoded.slice(cut))).toHaveLength(1);
	});

	it("keeps a multi-byte character intact when UTF-8 is split across chunks", () => {
		const payload = {
			...(LIST_FRAME.data as Record<string, unknown>),
			conversation_name: "héllo — 完了",
		};
		const doc = wire("sessions", payload);
		const buffer = bytes(doc);
		for (let split = 1; split < buffer.length; split += 1) {
			const reader = new SseFrameReader();
			const frames = [
				...reader.push(buffer.slice(0, split)),
				...reader.push(buffer.slice(split)),
			];
			expect(frames, `split at ${split}`).toHaveLength(1);
			expect(
				(JSON.parse(dataOf(frames[0])) as { conversation_name: string })
					.conversation_name,
			).toBe("héllo — 完了");
		}
	});
});

describe("keep-alives are comments, not frames", () => {
	it("reads the captured keep-alive bytes as the relay wrote them", () => {
		/* A byte-exactness guard on the sample itself, not on the parser: the fixture
		 * is the capture, and a re-typed copy of it would silently stop testing the
		 * wire. The blank line is part of the sample (`SSE_KEEPALIVE_S` writes both). */
		expect(KEEPALIVE_BYTES).toBe(": keepalive\n\n");
	});

	it("treats the captured keep-alive bytes as liveness and not as data", () => {
		const reader = new SseFrameReader();
		const frames = reader.push(bytes(KEEPALIVE_BYTES));
		/* The captured bytes are `: keepalive` plus a blank line. Whatever the parser
		 * does with a comment, no DATA frame may come out of it. */
		expect(frames.filter((frame) => frame.data.length > 0)).toEqual([]);
	});

	it("counts the keep-alives it saw, so a caller can tell quiet from dead", () => {
		const reader = new SseFrameReader();
		reader.push(bytes(KEEPALIVE_BYTES));
		reader.push(bytes(KEEPALIVE_BYTES));
		/* Exactly two: the count is what tells "no frames because nothing changed"
		 * from "no frames because the connection died", so it has to be a count and
		 * not a flag, and a parser that swallowed comments would leave it at zero. */
		expect(reader.keepaliveCount).toBe(2);
	});

	it("still frames the data that follows a keep-alive", () => {
		const reader = new SseFrameReader();
		const frames = readAll(reader, [
			bytes(
				KEEPALIVE_BYTES + wire(PROJECTION_FRAME.event, PROJECTION_FRAME.data),
			),
		]);
		/* Two frames, and the order matters: the comment is reported as ignorable
		 * liveness and the projection as data. Asserting only the projection would
		 * pass against a reader that dropped the keep-alive on the floor — which is
		 * what this reader used to do. */
		expect(frames.map((frame) => decodeFrame(frame).kind)).toEqual([
			"ignorable",
			"projection",
		]);
		expect(reader.keepaliveCount).toBe(1);
	});
});

describe("a frame becomes a typed value, or a survivable failure", () => {
	it("decodes the captured list frame", () => {
		const [frame] = readAll(new SseFrameReader(), [
			bytes(wire("sessions", LIST_FRAME.data)),
		]);
		const decoded = decodeFrame(frame!);
		expect(decoded.kind).toBe("sessions");
		if (decoded.kind !== "sessions") return;
		expect(decoded.data.sessions[0]?.session_id).toBe("6714def86197");
	});

	it("decodes the captured projection frame", () => {
		const [frame] = readAll(new SseFrameReader(), [
			bytes(wire("projection", PROJECTION_FRAME.data)),
		]);
		const decoded = decodeFrame(frame!);
		expect(decoded.kind).toBe("projection");
		if (decoded.kind !== "projection") return;
		expect(decoded.data.session_id).toBe("6714def86197");
		expect(decoded.data.version).toBeGreaterThan(0);
	});

	it("decodes a frame whose payload the schema rejects WITHOUT throwing", () => {
		/* A malformed push must reach the caller as data: throwing here would tear
		 * the stream down and, worse, look like a transport failure. */
		const [frame] = readAll(new SseFrameReader(), [
			bytes('event: projection\ndata: {"session_id":"x"}\n\n'),
		]);
		const decoded = decodeFrame(frame!);
		expect(decoded.kind).toBe("malformed");
		if (decoded.kind !== "malformed") return;
		expect(decoded.error.ok).toBe(false);
	});

	it("treats an event name this build does not know as ignorable rather than fatal", () => {
		const [frame] = readAll(new SseFrameReader(), [
			bytes('event: something_new\ndata: {"a":1}\n\n'),
		]);
		const decoded = decodeFrame(frame!);
		expect(decoded.kind).toBe("ignorable");
	});

	it("treats a data frame with no event name as ignorable", () => {
		const [frame] = readAll(new SseFrameReader(), [bytes('data: {"a":1}\n\n')]);
		expect(decodeFrame(frame!).kind).toBe("ignorable");
	});
});

describe("the snapshot fence, which must not blank a live transcript", () => {
	it("accepts the first frame of a connection whatever its version", () => {
		const fence = new ProjectionFence();
		/* The daemon's epoch can restart across a reconnection, so a lower number
		 * after a reopen is a new epoch, not a stale frame. */
		expect(fence.accept(3)).toBe("accepted-snapshot");
		expect(fence.needsSnapshot).toBe(false);
	});

	it("drops a frame older than the one it holds, inside one connection", () => {
		const fence = new ProjectionFence();
		fence.accept(10);
		expect(fence.accept(9)).toBe("dropped-older");
		/* Equal is accepted, and that is the contract's own comparison: the rule is
		 * `incoming.version < current.version`, and a repaint at the same epoch is the
		 * same content. Dropping it would be the stricter reading, and it is the one
		 * that blanks a frame when nothing is actually stale. */
		expect(fence.accept(10)).toBe("accepted-newer");
		expect(fence.accept(11)).toBe("accepted-newer");
	});

	it("re-seeds after a reconnect instead of comparing across connections", () => {
		const fence = new ProjectionFence();
		fence.accept(42);
		fence.reset();
		expect(fence.accept(1)).toBe("accepted-snapshot");
	});
});

/* --------------------------------------------------------------- connection */

function readerOf(chunks: (string | Uint8Array)[]) {
	const encoder = new TextEncoder();
	let index = 0;
	return {
		reader: {
			read: async (): Promise<ReadableStreamReadResult<Uint8Array>> => {
				if (index >= chunks.length) return { done: true, value: undefined };
				const chunk = chunks[index];
				index += 1;
				if (typeof chunk === "string")
					return { done: false, value: encoder.encode(chunk) };
				return { done: false, value: chunk as Uint8Array };
			},
			cancel: async () => undefined,
			releaseLock: () => undefined,
		} as unknown as ReadableStreamDefaultReader<Uint8Array>,
		release: async () => undefined,
	};
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("a stream that is cut is rotated, not reported as broken", () => {
	it("reopens after the gateway's lease expires, with no error and no closed state", async () => {
		let clock = 0;
		let opens = 0;
		const states: StreamStatus[] = [];
		const errors: unknown[] = [];
		const frames: DecodedFrame[] = [];
		const connection = new SseConnection({
			/* Each open is 60 s on the injected clock, then EOFs: exactly the gateway's
			 * lease. `random: 0` removes the jitter so the test is not timing-dependent. */
			open: async (): Promise<{
				reader: ReadableStreamDefaultReader<Uint8Array>;
				release: () => Promise<void>;
			}> => {
				opens += 1;
				return readerOf([wire("projection", PROJECTION_FRAME.data)]);
			},
			/* The lease clock advances while the stream is OPEN — the "opened at" instant
			 * is when the connection was established, so advancing it inside `open()`
			 * would model a connect that took the whole lease. */
			onFrame: (frame) => {
				frames.push(frame);
				clock += GATEWAY_LEASE_MS;
			},
			onState: (status) => void states.push(status),
			onError: (error) => void errors.push(error),
			now: () => clock,
			random: () => 0,
			silenceMs: 5_000,
		});
		connection.start();
		await vi.waitFor(() => expect(opens).toBeGreaterThanOrEqual(2));
		/* Snapshot BEFORE stopping: `stop()` legitimately emits `closed`, and the
		 * claim here is about the rotation, not about teardown. */
		const beforeStop = [...states];
		connection.stop();
		await sleep(10);

		expect(errors).toEqual([]);
		/* The user must not see a reconnect flash every minute: no `closed` state,
		 * and the reopen is reported as a rotation. */
		expect(beforeStop.some((status) => status.state === "closed")).toBe(false);
		expect(states.some((status) => status.state === "rotating")).toBe(true);
		/* And the frames from every connection are delivered — resync is by snapshot,
		 * so the caller re-renders from the seed frame each time. */
		expect(
			frames.filter((frame) => frame.kind === "projection").length,
		).toBeGreaterThanOrEqual(2);
	});

	it("reports an early EOF as stalled while still reconnecting at once", async () => {
		let clock = 0;
		let opens = 0;
		const states: StreamStatus[] = [];
		const connection = new SseConnection({
			/* No time passes on the injected clock, so every open is "early": an EOF
			 * that cannot be the lease expiring means the gateway stopped forwarding
			 * (lease lapse or a revoke). */
			open: async () => {
				opens += 1;
				return readerOf([]);
			},
			onFrame: () => undefined,
			onState: (status) => void states.push(status),
			now: () => clock,
			random: () => 0,
			silenceMs: 5_000,
		});
		connection.start();
		await vi.waitFor(() => expect(opens).toBeGreaterThanOrEqual(2));
		const beforeStop = [...states];
		connection.stop();
		await sleep(10);
		expect(beforeStop.some((status) => status.state === "stalled")).toBe(true);
		expect(beforeStop.some((status) => status.state === "closed")).toBe(false);
		clock += 0;
	});

	it("ends the loop with the error on a status failure instead of retrying forever", async () => {
		const errors: unknown[] = [];
		const states: StreamStatus[] = [];
		let opens = 0;
		const connection = new SseConnection({
			open: async () => {
				opens += 1;
				/* The shape of the bug the contract calls out: an EventSource-shaped
				 * client cannot see this status and retries forever. */
				throw Object.assign(new Error("tunnel session expired"), {
					kind: "radiant-login-required",
				});
			},
			onFrame: () => undefined,
			onState: (status) => void states.push(status),
			onError: (error) => void errors.push(error),
			random: () => 0,
		});
		connection.start();
		await vi.waitFor(() => expect(errors.length).toBe(1));
		await sleep(10);
		connection.stop();
		expect(opens).toBe(1);
		expect(states.at(-1)?.state).toBe("closed");
	});

	it("asks the caller for a fresh connection on every reopen, so a refreshed grant is used", async () => {
		const tokens: string[] = [];
		let opens = 0;
		const connection = new SseConnection({
			open: async () => {
				opens += 1;
				tokens.push(`grant-${opens}`);
				return readerOf([]);
			},
			onFrame: () => undefined,
			random: () => 0,
			now: () => 0,
		});
		connection.start();
		await vi.waitFor(() => expect(opens).toBeGreaterThanOrEqual(3));
		connection.stop();
		/* Each attempt calls `open` again rather than reusing a captured request:
		 * that is what lets the auth callback return the grant minted since. */
		expect(new Set(tokens).size).toBeGreaterThanOrEqual(3);
	});
});

describe("stopping is final", () => {
	it("does not reopen after stop()", async () => {
		let opens = 0;
		const connection = new SseConnection({
			open: async () => {
				opens += 1;
				return readerOf([]);
			},
			onFrame: () => undefined,
			random: () => 0,
			now: () => 0,
		});
		connection.start();
		await vi.waitFor(() => expect(opens).toBeGreaterThanOrEqual(2));
		connection.stop();
		const settled = opens;
		await sleep(30);
		expect(opens).toBe(settled);
		expect(connection.isRunning).toBe(false);
	});

	it("ignores a second start while running", async () => {
		let opens = 0;
		const connection = new SseConnection({
			open: async () => {
				opens += 1;
				return readerOf([]);
			},
			onFrame: () => undefined,
			random: () => 0,
			now: () => 0,
		});
		connection.start();
		connection.start();
		await vi.waitFor(() => expect(opens).toBe(1));
		connection.stop();
	});
});
