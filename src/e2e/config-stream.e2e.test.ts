/**
 * The config stream, outside-in: the app's REAL client and subscription against
 * REAL HTTP servers, in both daemon generations this app must survive.
 *
 * Four facts no unit test can hold, each one a rule the contract draws.
 * Against an OLDER daemon — one without `/api/config/events` — the relay's own
 * `404` is ABSENCE: exactly one request, `supported: false`, and NO retry, ever
 * (`restartMs` is injected small so "no retry" is a measured window, not a
 * hope). Against a daemon that serves the route, the connect-time baseline
 * frame lands the current resolved language, and a change published while the
 * socket is open lands the new tag. And a TRANSIENT failure — the 503, not the
 * 404 — takes the list stream's own cadence: reopen, not stop.
 *
 * The server is this test's own, the `deadline` suite's shape; what is
 * asserted is what crossed the socket. Auth is covered by
 * `relay-client.e2e.test.ts`; this file is about the config stream's slice of
 * the contract.
 */

import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import { type CustomRoute, createRelayClient } from "../connection";
import { startConfigStream } from "../features/auth/config-stream";
import { createConfigStore } from "../state";
import { loadFixture } from "../testing/fixtures";

/** The restart cadence injected into the subscription under test: small so the
 *  suite measures policy, not patience. */
const RESTART_MS = 30;
/** A window ~8 restarts wide. A retry loop would have asked again inside it;
 *  one request is the assertion. */
const NO_RETRY_WINDOW_MS = 250;

const servers: Server[] = [];
afterEach(async () => {
	await Promise.all(
		servers.splice(0).map(
			(server) =>
				new Promise<void>((resolve) => {
					server.close(() => resolve());
					/* A served stream keeps its socket; `close` waits for it. */
					server.closeAllConnections();
				}),
		),
	);
});

interface Recorded {
	method: string;
	path: string;
}

/** A server whose one handler decides every answer, with every request recorded
 *  so an assertion can be about how many times a route was asked for. */
async function serve(
	handle: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<{ baseUrl: string; requests: Recorded[] }> {
	const requests: Recorded[] = [];
	const server = createServer((request, response) => {
		requests.push({ method: request.method ?? "", path: request.url ?? "" });
		handle(request, response);
	});
	servers.push(server);
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	return { baseUrl: `http://127.0.0.1:${port}`, requests };
}

function clientFor(baseUrl: string) {
	return createRelayClient({
		route: {
			mode: "custom",
			baseUrl,
			allowInsecure: true,
		} satisfies CustomRoute,
	});
}

const CONFIG_FRAME = loadFixture<{ event: string; data: unknown }>(
	"synthetic/sse-config-frame.json",
);

/** One `event: config` frame, as the daemon writes it. */
function configWire(payload: unknown): string {
	return `event: ${CONFIG_FRAME.event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

/** The headers a relay sends for an event stream, before any frame. */
function openEventStream(response: ServerResponse): void {
	response.writeHead(200, {
		"content-type": "text/event-stream",
		"cache-control": "no-store",
	});
	response.flushHeaders();
}

describe("an older daemon: the relay's 404 is absence, terminal for the route", () => {
	it("asks once, marks absence, and never retries", async () => {
		const { baseUrl, requests } = await serve((_request, response) => {
			response.writeHead(404, { "content-type": "application/json" });
			response.end(JSON.stringify({ error: "not found" }));
		});
		const store = createConfigStore();
		const handle = startConfigStream(clientFor(baseUrl), store, {
			restartMs: RESTART_MS,
		});
		await vi.waitFor(() => expect(requests.length).toBe(1), { timeout: 5_000 });
		await new Promise((resolve) => setTimeout(resolve, NO_RETRY_WINDOW_MS));
		handle.stop();

		expect(
			requests.map((request) => `${request.method} ${request.path}`),
			"one probe; a retry loop would have asked again inside the window",
		).toEqual(["GET /api/config/events"]);
		expect(store.getState().supported).toBe(false);
		/* Absence is not a language and not a frame: nothing was inferred. */
		expect(store.getState().language).toBeNull();
		expect(store.getState().frameCount).toBe(0);
	});
});

describe("a daemon that serves the route: baseline, then per-change frames", () => {
	it("lands the resolved language from the connect-time baseline frame", async () => {
		const { baseUrl, requests } = await serve((_request, response) => {
			openEventStream(response);
			response.write(configWire(CONFIG_FRAME.data));
			/* Hold the body open, as the daemon does until the gateway's lease. */
		});
		const store = createConfigStore();
		const handle = startConfigStream(clientFor(baseUrl), store, {
			restartMs: RESTART_MS,
		});
		await vi.waitFor(() => expect(store.getState().language).toBe("en"), {
			timeout: 5_000,
		});
		handle.stop();

		expect(requests.map((request) => request.path)).toEqual([
			"/api/config/events",
		]);
		expect(store.getState().supported).toBe(true);
		expect(store.getState().frameCount).toBe(1);
		expect(store.getState().lastFrameAt).not.toBeNull();
	});

	it("applies a change published while the socket is open", async () => {
		const { baseUrl } = await serve((_request, response) => {
			openEventStream(response);
			response.write(configWire(CONFIG_FRAME.data));
			/* A real change, later: the daemon resolves and stamps when it drains
			 * the watcher's doorbell rather than at connect. `fr` is in the core's
			 * SUPPORTED_LOCALES; the shipped set is `en` today, so this sample pins
			 * the CLIENT's adoption path — the contract the day a locale ships. */
			const timer = setTimeout(() => {
				response.write(
					configWire({ changed_keys: ["language"], language: "fr" }),
				);
			}, RESTART_MS);
			response.on("close", () => clearTimeout(timer));
		});
		const store = createConfigStore();
		const handle = startConfigStream(clientFor(baseUrl), store, {
			restartMs: RESTART_MS,
		});
		await vi.waitFor(() => expect(store.getState().frameCount).toBe(2), {
			timeout: 5_000,
		});
		handle.stop();

		expect(store.getState().language).toBe("fr");
		expect(store.getState().supported).toBe(true);
	});

	it("drops a malformed frame with a warning, and keeps the stream", async () => {
		const warns: unknown[][] = [];
		const warn = vi.spyOn(console, "warn").mockImplementation((...args) => {
			warns.push(args);
		});
		try {
			const { baseUrl, requests } = await serve((_request, response) => {
				openEventStream(response);
				response.write(configWire(CONFIG_FRAME.data));
				/* An empty `language` is not a tag the relay emits; the schema refuses it. */
				response.write(
					'event: config\ndata: {"changed_keys":[],"language":""}\n\n',
				);
				const timer = setTimeout(() => {
					response.write(
						configWire({ changed_keys: ["language"], language: "en" }),
					);
				}, RESTART_MS);
				response.on("close", () => clearTimeout(timer));
			});
			const store = createConfigStore();
			const handle = startConfigStream(clientFor(baseUrl), store, {
				restartMs: RESTART_MS,
			});
			await vi.waitFor(() => expect(store.getState().frameCount).toBe(2), {
				timeout: 5_000,
			});
			handle.stop();

			/* The bad frame was REPORTED, dropped, and the stream carried on: the two
			 * good frames landed, on the one connection, and the drop is not counted. */
			expect(
				warns.some((args) => String(args[0]).includes("[config]")),
				"the drop is on the log, not silent",
			).toBe(true);
			expect(store.getState().language).toBe("en");
			expect(requests.length).toBe(1);
		} finally {
			warn.mockRestore();
		}
	});

	it("reopens after a transient failure instead of stopping the loop", async () => {
		let connects = 0;
		const { baseUrl, requests } = await serve((_request, response) => {
			connects += 1;
			if (connects === 1) {
				/* A bare 503: `computer-offline`, the transient class — NOT the
				 * relay's own 404, which is the one failure that ends the loop. */
				response.writeHead(503, { "content-type": "text/plain" });
				response.end();
				return;
			}
			openEventStream(response);
			response.write(configWire(CONFIG_FRAME.data));
		});
		const store = createConfigStore();
		const handle = startConfigStream(clientFor(baseUrl), store, {
			restartMs: RESTART_MS,
		});
		await vi.waitFor(() => expect(store.getState().language).toBe("en"), {
			timeout: 5_000,
		});
		handle.stop();

		expect(
			requests.length,
			"the first open failed transiently; the subscription reopened",
		).toBeGreaterThanOrEqual(2);
		expect(store.getState().supported).toBe(true);
	});
});
