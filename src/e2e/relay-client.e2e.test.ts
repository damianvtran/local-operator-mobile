/**
 * Outside-in: the app's REAL client against a REAL HTTP server.
 *
 * Nothing on the client side is injected except the platform's own jar (Node has
 * none) — `createRelayClient`, `RelayHttpClient`, `SseConnection`, the retry
 * envelope and the zustand stores are the production modules. The server replays
 * captured `fixtures/relay/**` bodies over an actual socket, so what is asserted is
 * what crossed the wire, not what a module told itself.
 *
 * Peer: an in-test `node:http` server (`src/testing/fixture-relay.ts`). PR #8's
 * typed mock relay replaces it when that lands; the assertions only need a base
 * URL. The same client is also run against a real isolated `lop mobile serve` by
 * `scripts/relay-smoke.ts`, which this suite does not replace — a fixture server
 * cannot prove the daemon still behaves as the fixtures say.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { createRelayClient, type TunnelSession } from "../connection";
import {
	type DecodedFrame,
	memoryEnvelopeStore,
	type RelayError,
	RetryEnvelopeStore,
	type StreamStatus,
	sendPersistedCommand,
} from "../relay";
import { createListStore, createProjectionStore } from "../state";
import { createCookieJarFetch } from "../testing/cookie-jar-fetch";
import {
	FIXTURE_SESSION_ID,
	type FixtureRelay,
	fixtureBody,
	startFixtureRelay,
} from "../testing/fixture-relay";

const relays: FixtureRelay[] = [];
afterEach(async () => {
	for (const relay of relays.splice(0)) await relay.close();
});

async function relayWith(
	options: Parameters<typeof startFixtureRelay>[0],
): Promise<FixtureRelay> {
	const relay = await startFixtureRelay(options);
	relays.push(relay);
	return relay;
}

const HOSTNAME = "0123456789abcdef0123456789abcdef-lop.radienthq.com";
const GRANT = "grant-jwt";

function tunnelSession(overrides: Partial<TunnelSession> = {}): TunnelSession {
	return {
		grant: GRANT,
		refreshHandle: "thirty-day-handle",
		grantExpiresAt: 0,
		refreshExpiresAt: 0,
		hostname: HOSTNAME,
		tunnelId: "t-1",
		mintedAt: 0,
		...overrides,
	};
}

/** The Radient origin is https and fixed by the route; only the URL is pointed at
 *  the local server, so every header the client built reaches it unchanged. */
function viaTunnel(
	relay: FixtureRelay,
	clientHeaders: Record<string, string>[] = [],
): typeof globalThis.fetch {
	return (input, init) => {
		/* Recorded at the platform boundary: this is what the CLIENT chose to send.
		 * Node's own fetch adds `sec-fetch-mode` on the way out, so the server alone
		 * cannot say whether the client claimed browser fetch metadata. */
		clientHeaders.push(
			Object.fromEntries(
				[...new Headers(init?.headers)].map(([k, v]) => [k.toLowerCase(), v]),
			),
		);
		const url = new URL(String(input));
		return globalThis.fetch(
			`${relay.baseUrl}${url.pathname}${url.search}`,
			init,
		);
	};
}

function customClient(relay: FixtureRelay) {
	const jar = createCookieJarFetch();
	const client = createRelayClient({
		route: { mode: "custom", baseUrl: relay.baseUrl, allowInsecure: true },
		fetchImpl: jar.fetch,
	});
	return { client, jar };
}

function radientClient(
	relay: FixtureRelay,
	session = tunnelSession(),
	clientHeaders: Record<string, string>[] = [],
) {
	return createRelayClient({
		route: { mode: "radient", hostname: HOSTNAME, tunnelId: "t-1" },
		tunnelSession: () => session,
		fetchImpl: viaTunnel(relay, clientHeaders),
	});
}

/** Waits for a condition with a real deadline; no fake timers anywhere. */
async function until(check: () => boolean, ms = 5_000): Promise<void> {
	await vi.waitFor(() => expect(check()).toBe(true), { timeout: ms });
}

/* ------------------------------------------------------ custom route: login */

describe("custom route: password login and the cookie jar", () => {
	it("is refused before login, accepted after, and refused again after logout", async () => {
		const relay = await relayWith({ auth: { mode: "custom" } });
		const { client, jar } = customClient(relay);

		await expect(client.sessions()).rejects.toMatchObject({
			kind: "relay-unauthorized",
			status: 401,
		});

		const wrong = await client.login("not the password");
		expect(wrong).toEqual({ status: 401, signedIn: false });
		expect(jar.names()).toEqual([]);

		const ok = await client.login("correct horse");
		expect(ok).toEqual({ status: 303, signedIn: true });
		expect(jar.names()).toEqual(["lop_mobile"]);

		const list = await client.sessions();
		expect(list.sessions[0]?.session_id).toBe(FIXTURE_SESSION_ID);

		/* The server saw the cookie only because the jar replayed it: the client
		 * never wrote a Cookie header on this route. */
		const authed = relay.requests.filter((r) => r.path === "/api/sessions");
		expect(
			String(authed.at(-1)?.headers.cookie).startsWith("lop_mobile="),
		).toBe(true);
		expect(authed[0]?.headers.cookie).toBeUndefined();

		await client.logout();
		expect(jar.names()).toEqual([]);
		await expect(client.sessions()).rejects.toMatchObject({
			kind: "relay-unauthorized",
		});
	});

	it("reads the read-only routes through the real schemas", async () => {
		const relay = await relayWith({ auth: { mode: "custom" } });
		const { client } = customClient(relay);
		await client.login("correct horse");

		const started = await client.startSession({});
		expect(started.session_id).toBe(FIXTURE_SESSION_ID);
		const history = await client.history(FIXTURE_SESSION_ID, { limit: 5 });
		expect(history.entries.length).toBeGreaterThan(0);
		expect(relay.requests.at(-1)?.path).toBe(
			`/api/sessions/${FIXTURE_SESSION_ID}/history?limit=5`,
		);
	});
});

/* --------------------------------------------------------------- list stream */

describe("the list stream drives the list store", () => {
	it("paints a wholesale frame from the server", async () => {
		const relay = await relayWith({ auth: { mode: "custom" } });
		const { client } = customClient(relay);
		await client.login("correct horse");
		const list = createListStore();

		const stream = client.sessionsStream({
			onFrame: (frame) => {
				if (frame.kind === "sessions") list.getState().applyFrame(frame.data);
			},
		});
		stream.connection.start();
		await until(() => list.getState().frameCount >= 1);
		stream.stop();

		expect(list.getState().sessions.map((s) => s.session_id)).toEqual([
			FIXTURE_SESSION_ID,
		]);
		expect(list.getState().stale).toBe(false);
	});
});

/* ------------------------------------------- session stream and the fence */

function projectionAt(version: number): unknown {
	const base = fixtureBody("sse/sse-projection-live-idle.json") as Record<
		string,
		unknown
	>;
	return { ...base, version };
}

describe("the session stream and the snapshot fence", () => {
	it("drops a frame older than the one held, and resyncs from the seed after a reconnect", async () => {
		/* Connection 1: 171, then a STALE 100, then 172. Connection 2 (after the
		 * server cuts the first) seeds at 50 — LOWER than anything held — and must
		 * still be accepted, because a reconnect's seed is authoritative and a
		 * version drop is never read as "the session restarted". */
		const relay = await relayWith({
			auth: { mode: "custom" },
			cutStreamAfterMs: 150,
			projectionFrames: (connection) =>
				connection === 1
					? [projectionAt(171), projectionAt(100), projectionAt(172)]
					: [projectionAt(50)],
		});
		const { client } = customClient(relay);
		await client.login("correct horse");
		const store = createProjectionStore();
		const versions: number[] = [];

		const stream = client.sessionStream(FIXTURE_SESSION_ID, {
			onState: (status: StreamStatus) => {
				if (status.state === "open")
					store.getState().beginStream(FIXTURE_SESSION_ID);
			},
			onFrame: (frame: DecodedFrame) => {
				if (frame.kind !== "projection") return;
				store.getState().applyFrame(FIXTURE_SESSION_ID, frame.data);
				versions.push(
					store.getState().entries[FIXTURE_SESSION_ID]?.version ?? -1,
				);
			},
		});
		stream.connection.start();
		await until(() => versions.length >= 4);
		stream.stop();

		/* 171 accepted, 100 dropped (held stays 171), 172 accepted, then the
		 * reconnect's seed 50 accepted. */
		expect(versions).toEqual([171, 171, 172, 50]);
		const entry = store.getState().entries[FIXTURE_SESSION_ID];
		expect(entry?.droppedFrames).toBe(1);
		expect(
			relay.streamOpens.get(`/api/sessions/${FIXTURE_SESSION_ID}/events`),
		).toBeGreaterThanOrEqual(2);
	});

	it("reopens after the gateway's 60 s cut, reported as a rotation and never as an error", async () => {
		const relay = await relayWith({
			auth: { mode: "custom" },
			cutStreamAfterMs: 120,
		});
		const { client } = customClient(relay);
		await client.login("correct horse");
		const states: StreamStatus[] = [];
		const errors: RelayError[] = [];
		let seeds = 0;

		/* The server cuts after 120 ms of REAL time; the client's clock runs 1000x
		 * fast, so that open reads as ~120 s — longer than the gateway's 60 s lease.
		 * Only the client's notion of elapsed time is scaled: the socket, the cut,
		 * the EOF and the reopen are all real. */
		const epoch = Date.now();
		const stream = client.sessionStream(FIXTURE_SESSION_ID, {
			now: () => epoch + (Date.now() - epoch) * 1000,
			random: () => 0,
			onState: (status) => void states.push(status),
			onError: (error) => void errors.push(error),
			onFrame: (frame) => {
				if (frame.kind === "projection") seeds += 1;
			},
		});
		stream.connection.start();
		await until(() => seeds >= 3);
		const beforeStop = [...states];
		stream.stop();

		expect(errors).toEqual([]);
		expect(beforeStop.some((s) => s.state === "closed")).toBe(false);
		/* A lease running out is the NORMAL case: silent, and distinct from an early
		 * EOF, which means the gateway stopped forwarding. */
		expect(beforeStop.some((s) => s.state === "rotating")).toBe(true);
		expect(beforeStop.some((s) => s.state === "stalled")).toBe(false);
		/* Each reopen delivered a fresh seed snapshot: continuity is never assumed. */
		expect(seeds).toBeGreaterThanOrEqual(3);
	});

	it("reports a stream that ends early as stalled, and still reopens at once", async () => {
		const relay = await relayWith({
			auth: { mode: "custom" },
			cutStreamAfterMs: 60,
		});
		const { client } = customClient(relay);
		await client.login("correct horse");
		const states: StreamStatus[] = [];
		let seeds = 0;
		const stream = client.sessionStream(FIXTURE_SESSION_ID, {
			onState: (status) => void states.push(status),
			onFrame: (frame) => {
				if (frame.kind === "projection") seeds += 1;
			},
		});
		stream.connection.start();
		await until(() => seeds >= 2);
		const beforeStop = [...states];
		stream.stop();

		expect(beforeStop.some((s) => s.state === "stalled")).toBe(true);
		expect(beforeStop.some((s) => s.state === "closed")).toBe(false);
	});
});

/* ---------------------------------- a prompt whose acknowledgement is lost */

describe("a prompt sent once, acknowledged never, and replayed", () => {
	it("replays the SAME command_id and the relay admits it exactly once", async () => {
		const relay = await relayWith({
			auth: { mode: "custom" },
			dropAckOnCommand: 1,
		});
		const { client } = customClient(relay);
		await client.login("correct horse");
		const envelopes = new RetryEnvelopeStore({ store: memoryEnvelopeStore() });

		/* First attempt: the relay admits the prompt, then the socket dies before
		 * the answer. The client cannot know — that is the ambiguity. */
		await expect(
			sendPersistedCommand({
				client,
				envelopes,
				sessionId: FIXTURE_SESSION_ID,
				op: "prompt",
				text: "run the tests",
			}),
		).rejects.toMatchObject({ kind: "transport" });
		const held = await envelopes.peek(FIXTURE_SESSION_ID);
		expect(held?.text).toBe("run the tests");
		expect(relay.admitted.size).toBe(1);

		/* The user taps send again — with different text in the box. The stored
		 * bytes win, and the composer is told. */
		const replay = await sendPersistedCommand({
			client,
			envelopes,
			sessionId: FIXTURE_SESSION_ID,
			op: "prompt",
			text: "something else entirely",
		});

		expect(replay.commandId).toBe(held?.command_id);
		expect(replay.detail).toBe("already admitted");
		expect(replay.reusedPreviousDraft).toBe(true);
		/* Two requests crossed the wire, carrying one id, and ONE prompt exists. */
		const commands = relay.requests.filter((r) => r.path.endsWith("/command"));
		expect(commands).toHaveLength(2);
		expect(
			new Set(
				commands.map((c) => (c.body as { command_id: string }).command_id),
			).size,
		).toBe(1);
		/* The replay carries the FIRST draft's bytes, not the second's. */
		const replayed = commands[1]?.body;
		expect(replayed).toMatchObject({ text: "run the tests" });
		expect([...relay.admitted.values()]).toEqual([1]);
		/* A definitive acknowledgement ended the ambiguity. */
		expect(await envelopes.peek(FIXTURE_SESSION_ID)).toBeNull();
	});
});

/* ---------------------------------------------------------- Radient route */

describe("Radient route: exactly what the edge is sent", () => {
	it("presents the grant alone and the tunnel origin on every request, ordinary and stream", async () => {
		const relay = await relayWith({
			auth: { mode: "radient", grant: GRANT, origin: `https://${HOSTNAME}` },
		});
		const clientHeaders: Record<string, string>[] = [];
		const client = radientClient(relay, tunnelSession(), clientHeaders);

		await client.sessions();
		await client.command(FIXTURE_SESSION_ID, { op: "ping" });
		const seen: string[] = [];
		const stream = client.sessionsStream({
			onFrame: (frame) => void seen.push(frame.kind),
		});
		stream.connection.start();
		await until(() => seen.includes("sessions"));
		stream.stop();

		/* A browser's fetch metadata is never claimed by a native client. */
		expect(clientHeaders.length).toBeGreaterThanOrEqual(3);
		for (const headers of clientHeaders) {
			expect(
				Object.keys(headers).filter((h) => h.startsWith("sec-fetch-")),
			).toEqual([]);
		}
		expect(relay.requests.length).toBeGreaterThanOrEqual(3);
		for (const request of relay.requests) {
			expect(request.headers.cookie).toBe(`__Host-radient-grant=${GRANT}`);
			expect(request.headers.origin).toBe(`https://${HOSTNAME}`);
			/* `sec-fetch-site` is the value the edge rejects when it is cross/same-site. */
			expect(request.headers["sec-fetch-site"]).toBeUndefined();
			expect(String(request.headers.cookie)).not.toContain("thirty-day-handle");
		}
	});

	it("reads a 401 from the edge as an expired tunnel session, on a request and on a stream", async () => {
		const relay = await relayWith({
			auth: { mode: "radient", grant: GRANT, origin: `https://${HOSTNAME}` },
		});
		const stale = radientClient(relay, tunnelSession({ grant: "expired" }));

		await expect(stale.sessions()).rejects.toMatchObject({
			kind: "radiant-login-required",
			retry: "re-mint",
			envelope: "clear-all",
		});

		const errors: RelayError[] = [];
		const stream = stale.sessionsStream({
			onFrame: () => undefined,
			onError: (error) => void errors.push(error),
		});
		stream.connection.start();
		await until(() => errors.length === 1);
		expect(errors[0]?.kind).toBe("radiant-login-required");
		/* A 401 must END the loop: an EventSource-shaped client retries it forever. */
		expect(stream.connection.isRunning).toBe(false);
	});

	it("stops with the login error when the session expires MID-stream, after a healthy rotation", async () => {
		const relay = await relayWith({
			auth: { mode: "radient", grant: GRANT, origin: `https://${HOSTNAME}` },
			cutStreamAfterMs: 100,
			rejectStreamsFrom: 2,
		});
		const client = radientClient(relay);
		const frames: string[] = [];
		const errors: RelayError[] = [];
		const stream = client.sessionsStream({
			onFrame: (frame) => void frames.push(frame.kind),
			onError: (error) => void errors.push(error),
		});
		stream.connection.start();
		await until(() => errors.length === 1);

		expect(frames).toContain("sessions");
		expect(errors[0]?.kind).toBe("radiant-login-required");
		expect(errors[0]?.status).toBe(401);
		expect(stream.connection.isRunning).toBe(false);
		expect(relay.streamOpens.get("/api/sessions/events")).toBe(2);
	});
});
