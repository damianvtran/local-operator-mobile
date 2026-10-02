/**
 * What the per-request deadline covers — QA round 4, Q1.
 *
 * The deadline used to be cleared in `open()`'s `finally`, which runs when the
 * HEADERS arrive. A response that sends headers and then stalls its body was
 * therefore unbounded: measured still pending at 30,000 ms against a 500 ms
 * deadline, and in the reporter's first rig still pending when a 120 s outer
 * `timeout` killed it. For `sendPersistedCommand` that is the composer waiting for
 * ever with the envelope held and the outcome never reported.
 *
 * Three response classes, one behaviour each, driven against real servers:
 * a short body is bounded (this file's first case), a normal body is unaffected
 * (the second), and a STREAM's body is deliberately not (the third) — the last one
 * is why the fix is not "clear the deadline later, everywhere".
 */

import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import { type CustomRoute, createRelayClient } from "../connection";
import { isRelayError, type RelayError } from "../relay";
import { loadFixture } from "../testing/fixtures";

/** The deadline under test. Small on purpose: the failure it guards against is
 *  measured in tens of seconds, so a sub-second budget separates the two outcomes
 *  without making the suite wait. */
const DEADLINE_MS = 500;

const servers: Server[] = [];

afterEach(async () => {
	await Promise.all(
		servers.splice(0).map(
			(server) =>
				new Promise<void>((resolve) => {
					server.close(() => resolve());
					/* A stalled response keeps its socket, and `close` waits for it. */
					server.closeAllConnections();
				}),
		),
	);
});

/** A server that answers every request the way the test's handler decides. */
async function serve(
	handle: (response: ServerResponse) => void,
): Promise<string> {
	const server = createServer((_request, response) => handle(response));
	servers.push(server);
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } =
		server.address() as AddressInfo; /* `listen(0)` always yields an
	 *  `AddressInfo`; the union is Node's typing for a unix-socket address. */
	return `http://127.0.0.1:${port}`;
}

function clientFor(baseUrl: string) {
	return createRelayClient({
		route: {
			mode: "custom",
			baseUrl,
			allowInsecure: true,
		} satisfies CustomRoute,
		timeoutMs: DEADLINE_MS,
	});
}

const projection = loadFixture<{ event: string; data: unknown }>(
	"sse/sse-projection-live-idle.json",
);
const SESSION_ID = "3fc2070e836c";

describe("the deadline bounds a short body, and does not bound a stream's", () => {
	it("settles a response that stalls after its headers, inside the deadline", async () => {
		const baseUrl = await serve((response) => {
			/* Headers, then nothing: no body chunk and no end, which is what a proxy
			 * does while it waits for a backend that never answers. */
			response.writeHead(200, { "content-type": "application/json" });
			response.flushHeaders();
		});

		const started = Date.now();
		let settled: unknown;
		try {
			await clientFor(baseUrl).sessions();
		} catch (cause) {
			settled = cause;
		}
		const elapsed = Date.now() - started;

		expect(
			elapsed,
			`the stalled body settled in ${elapsed} ms against a ${DEADLINE_MS} ms deadline`,
		).toBeGreaterThanOrEqual(DEADLINE_MS - 50);
		expect(
			elapsed,
			`the stalled body settled in ${elapsed} ms against a ${DEADLINE_MS} ms deadline`,
		).toBeLessThan(DEADLINE_MS + 2_500);
		expect(isRelayError(settled)).toBe(true);
		const error =
			settled as RelayError; /* narrowed by the assertion above; the cast
		 *  is what carries that into the type checker. */
		expect(error.kind).toBe("transport");
		/* A body that never finished produced no answer, so the delivery is unknown
		 * and the taxonomy keeps the envelope: the instruction can be replayed. */
		expect(error.envelope).toBe("keep");
		/* And the sentence a screen shows is copy, not the runtime's words. */
		expect(error.displayableMessage).toBe("The relay could not be reached.");
	});

	it("leaves a normal body untouched at the same deadline", async () => {
		const baseUrl = await serve((response) => {
			response.writeHead(200, { "content-type": "application/json" });
			response.end(
				JSON.stringify(loadFixture<{ body: unknown }>("http/models.json").body),
			);
		});
		const models = await clientFor(baseUrl).models();
		expect(Array.isArray(models.models)).toBe(true);
	});

	it("does not cut a stream's body at the deadline", async () => {
		/* Five frames 150 ms apart is ~600 ms of streaming, past the 500 ms deadline: if
		 * the deadline followed the stream's body this would stop part-way, and a phone
		 * would see a live session freeze on a healthy connection. */
		const frameCount = 5;
		let connects = 0;
		const baseUrl = await serve((response) => {
			connects += 1;
			response.writeHead(200, {
				"content-type": "text/event-stream",
				"cache-control": "no-store",
			});
			response.flushHeaders();
			let sent = 0;
			const timer = setInterval(() => {
				response.write(
					`event: ${projection.event}\ndata: ${JSON.stringify(projection.data)}\n\n`,
				);
				sent += 1;
				if (sent === frameCount) clearInterval(timer);
			}, 150);
			response.on("close", () => clearInterval(timer));
		});

		const client = clientFor(baseUrl);
		const received: number[] = [];
		const states: string[] = [];
		const stream = client.sessionStream(SESSION_ID, {
			onFrame: () => void received.push(Date.now()),
			onState: (status) => void states.push(status.state),
		});
		stream.connection.start();
		await vi.waitFor(() => expect(received.length).toBe(frameCount), {
			timeout: 15_000,
		});
		expect(received.length).toBe(frameCount);
		const first = received[0];
		const last = received.at(-1);
		if (first === undefined || last === undefined) {
			throw new Error("the stream delivered no frame at all");
		}
		// WAIT PAST the deadline as an event, then require the stream to still be live.
		// The assertion this replaces compared the wall-clock spread of the five frames
		// against the deadline, which a loaded host compresses — measured: "delivered 5
		// frames over 498 ms with a 500 ms deadline", red in 4 of 22 runs, for a reason
		// unrelated to the behaviour under test. Sleeping for the deadline and then
		// checking the connection cannot be raced: it only makes the test take longer.
		void last;
		await new Promise((resolve) => setTimeout(resolve, DEADLINE_MS + 150));
		expect(
			connects,
			`the stream was cut and reopened inside the window (${connects} connections)`,
		).toBe(1);
		/* THE property that differs (review round 5, R5-M1). The frames alone do not
		 * discriminate: a deadline that followed the stream's body would cut it here, the
		 * watchdog would reopen it, and all five frames would still arrive — across TWO
		 * connections, with a `stalled` and a second `connecting` in between. "The body is
		 * exempt" means exactly ONE connection and no reopen for the whole window, which
		 * is what a phone sees as a quietly frozen live session when it regresses. */
		expect(states).not.toContain("stalled");
		expect(states.indexOf("connecting")).toBe(states.lastIndexOf("connecting"));
		expect(states.indexOf("connecting")).toBeLessThan(states.indexOf("open"));
		expect(connects).toBe(1);
		expect(stream.connection.isRunning).toBe(true);
		stream.stop();
	}, 20_000);

	it("still bounds the CONNECT phase of a stream that never answers", async () => {
		/* The other half of the distinction: the response has to be bounded, or a
		 * connector that accepts the connection and says nothing leaves the stream in
		 * "connecting" for ever — and the silence watchdog only starts once the headers
		 * have arrived. */
		const baseUrl = await serve((response) => {
			/* The connection is accepted and NOTHING is answered: no status line, no
			 * headers. That is the phase the deadline owns for a stream — the watchdog only
			 * starts once headers have arrived, so without this bound the stream would sit
			 * in `connecting` for ever. Sending headers first would make this the watchdog's
			 * case instead, which the SSE suite already covers. */
			void response;
		});
		const errors: unknown[] = [];
		const stream = clientFor(baseUrl).sessionStream(SESSION_ID, {
			onFrame: () => undefined,
			onError: (error) => void errors.push(error),
		});
		stream.connection.start();
		await vi.waitFor(() => expect(errors.length).toBe(1), { timeout: 20_000 });
		expect(isRelayError(errors[0])).toBe(true);
		/* The loop's own verdict: it retries a stalled body, so the classified failure
		 * it eventually reports is the ceiling's, not a raw platform error. */
		expect((errors[0] as RelayError).kind).toBe(
			"transport",
		); /* the loop is the only
		 *  source of `onError` here, and it reports the taxonomy's type. */
		stream.stop();
	}, 30_000);
});
