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

import {
	type CustomRoute,
	createRelayClient,
	signInToCustomRoute,
	type TunnelSession,
} from "../connection";
import {
	type DecodedFrame,
	memoryEnvelopeStore,
	type RelayError,
	RetryEnvelopeStore,
	type SendCommandInput,
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
import { loadFixture } from "../testing/fixtures";
import { browserRedirectFetch } from "../testing/opaque-redirect-fetch";

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
/* The second session id and the command id appear in the captures this file
 * replays: the route table must address the SAME session the sample records, or
 * the replay index misses and the failure would be the harness's, not the
 * client's. */
const OTHER_SESSION = "9ed9e2f534cd";
const COMMAND_UUID = "cf13127c-6523-4138-a225-0eccdba095da";
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

/** The same client with the platform's own quirk in front of it: a browser hides
 *  every redirect (`redirect: 'manual'` answers an opaque response). The jar and
 *  the server are real; only the redirect is hidden, exactly as Chrome hides it. */
function browserClient(relay: FixtureRelay) {
	const jar = createCookieJarFetch();
	const client = createRelayClient({
		route: { mode: "custom", baseUrl: relay.baseUrl, allowInsecure: true },
		fetchImpl: browserRedirectFetch(jar.fetch),
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
		expect(wrong).toEqual({ status: 401, signedIn: false, verified: false });
		expect(jar.names()).toEqual([]);

		const ok = await client.login("correct horse");
		expect(ok).toEqual({ status: 303, signedIn: true, verified: false });
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

	it("reports the hidden redirect's outcome by verifying admission, not by reading a status", async () => {
		/* QA round 3, Q1: in Chrome this same sign-in returned `ERR kind=rejected
		 * status=0 msg=""` while the cookie had been set, so a signed-in user was told
		 * their login failed. Node cannot produce that shape, so the platform boundary
		 * does; the verification read it triggers is a real one.
		 *
		 * `status` stays 0 — the number the transport actually reported — because the
		 * verdict is `signedIn` + `verified`, and a synthesised 303 would look
		 * authoritative to anything that logs it (review round 3, R3-5). */
		const relay = await relayWith({ auth: { mode: "custom" } });
		const { client, jar } = browserClient(relay);

		const outcome = await client.login("correct horse");
		expect(outcome).toEqual({ status: 0, signedIn: true, verified: true });
		expect(jar.names()).toEqual(["lop_mobile"]);

		/* The verification was the gated read itself, carrying the jar's cookie — and
		 * it is the CHEAPEST gated route, not the 80-row sessions list (R3-7). */
		const gated = relay.requests.filter((r) => r.path === "/api/models");
		expect(gated).toHaveLength(1);
		expect(String(gated[0]?.headers.cookie).startsWith("lop_mobile=")).toBe(
			true,
		);
		expect(relay.requests.some((r) => r.path === "/api/sessions")).toBe(false);
		/* And the session is genuinely usable afterwards. */
		await expect(client.sessions()).resolves.toMatchObject({
			sessions: expect.any(Array),
		});
	});

	it("reports a refusal through the taxonomy when the cookie never lands", async () => {
		/* The blind path can also refuse: the redirect happens but the session is still
		 * not admitted (a proxy eating the `Set-Cookie`, a jar that dropped it). The
		 * sentence must come from the taxonomy, not from the status 0 the platform
		 * showed. */
		const relay = await relayWith({ auth: { mode: "custom" } });
		const client = createRelayClient({
			route: { mode: "custom", baseUrl: relay.baseUrl, allowInsecure: true },
			/* No jar: the cookie the login set is never presented again. */
			fetchImpl: browserRedirectFetch(globalThis.fetch),
		});

		const outcome = await client.login("correct horse");
		expect(outcome.signedIn).toBe(false);
		expect(outcome.verified).toBe(true);
		expect(outcome.status).toBe(0);
		expect(outcome.detail).toBe(
			(fixtureBody("http/unauth-api-sessions.json") as { error: string }).error,
		);
	});

	it("verifies that a logout actually ended the session", async () => {
		const relay = await relayWith({ auth: { mode: "custom" } });
		const { client } = browserClient(relay);
		await client.login("correct horse");

		const outcome = await client.logout();
		expect(outcome).toEqual({ status: 0, signedOut: true, verified: true });
		await expect(client.sessions()).rejects.toMatchObject({
			kind: "relay-unauthorized",
		});
	});

	it("gives every failure back as a verdict through the helper a screen calls", async () => {
		/* Review round 3, R3-1: this boundary publishes `ok: true` unconditionally, so
		 * it must never reject — an unhandled rejection is not a refusal the user can
		 * act on. These are the five ways the sign-in can fail or succeed on a page,
		 * including the relay's own cross-origin gate, which a browser meets first. */
		const jar = createCookieJarFetch();
		const routeFor = (baseUrl: string) =>
			({ mode: "custom", baseUrl, allowInsecure: true }) satisfies CustomRoute;

		/* 1. The relay's 403 for a foreign `Origin` — the corpus's own capture. */
		const crossOrigin = await relayWith({
			auth: { mode: "custom" },
			loginRefusal: "http/login-cross-origin.json",
		});
		const refusedByGate = await signInToCustomRoute(
			routeFor(crossOrigin.baseUrl),
			"correct horse",
			{ fetchImpl: jar.fetch },
		);
		expect(refusedByGate).toEqual({
			ok: true,
			signedIn: false,
			detail: (fixtureBody("http/login-cross-origin.json") as { error: string })
				.error,
		});

		/* 2. A gateway 502 — a status, not a refusal the client parses. */
		const gatewayDown = await relayWith({
			auth: { mode: "custom" },
			loginRefusal: 502,
		});
		const relayDown = await signInToCustomRoute(
			routeFor(gatewayDown.baseUrl),
			"correct horse",
			{ fetchImpl: jar.fetch },
		);
		expect(relayDown.ok).toBe(true);
		expect(relayDown.signedIn).toBe(false);

		/* 3. A wrong password: the visible 401, with the route's own sentence. */
		const wrongPassword = await relayWith({ auth: { mode: "custom" } });
		expect(
			await signInToCustomRoute(routeFor(wrongPassword.baseUrl), "not it", {
				fetchImpl: jar.fetch,
			}),
		).toEqual({
			ok: true,
			signedIn: false,
			detail: "That password was not accepted.",
		});

		/* 4. Nothing listening at all: no answer to classify. */
		const closed = await relayWith({ auth: { mode: "custom" } });
		const closedUrl = closed.baseUrl;
		await closed.close();
		expect(
			await signInToCustomRoute(routeFor(closedUrl), "correct horse", {
				fetchImpl: jar.fetch,
			}),
		).toEqual({
			ok: true,
			signedIn: false,
			detail: "The relay could not be reached.",
		});

		/* 5. The browser's opaque redirect: signed in, verified. */
		const browser = await relayWith({ auth: { mode: "custom" } });
		expect(
			await signInToCustomRoute(routeFor(browser.baseUrl), "correct horse", {
				fetchImpl: browserRedirectFetch(jar.fetch),
			}),
		).toEqual({ ok: true, signedIn: true });
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

/* --------------------------------------- two sends in the same tick */

describe("a double-tap that lands before the composer can disable send", () => {
	it("is ONE instruction: the second caller joins the send in flight", async () => {
		/* QA round 3, Q2, measured against the real daemon: two concurrent calls each
		 * minted a `command_id` and the prompt RAN TWICE. `holdNew` reads the envelope
		 * slot before it writes it, so two calls in one tick both saw it empty. */
		const relay = await relayWith({ auth: { mode: "custom" } });
		const { client } = customClient(relay);
		await client.login("correct horse");
		const envelopes = new RetryEnvelopeStore({ store: memoryEnvelopeStore() });

		const draft: SendCommandInput = {
			client,
			envelopes,
			sessionId: FIXTURE_SESSION_ID,
			op: "prompt",
			text: "double-tap",
		};
		const [first, second] = await Promise.all([
			sendPersistedCommand(draft),
			sendPersistedCommand(draft),
		]);

		/* One request crossed the wire, carrying one id, and the relay admitted ONE
		 * instruction — which is the whole point of the envelope. */
		const commands = relay.requests.filter((r) => r.path.endsWith("/command"));
		expect(commands).toHaveLength(1);
		expect([...relay.admitted.values()]).toEqual([1]);
		/* Both callers are told the same outcome. `reusedPreviousDraft` stays false:
		 * the joiner's own bytes are the ones that were sent, so nothing was dropped
		 * and there is nothing to warn the user about. */
		expect(second.commandId).toBe(first.commandId);
		expect(second.detail).toBe("prompt admitted");
		expect(first.reusedPreviousDraft).toBe(false);
		expect(second.reusedPreviousDraft).toBe(false);
	});

	it("keeps two DIFFERENT drafts as two instructions, one after the other", async () => {
		/* Waiting must not become dropping: two different drafts in one tick are two
		 * things the user meant, so the second is sent — after the first, never
		 * interleaved with it in the single envelope slot. */
		const relay = await relayWith({ auth: { mode: "custom" } });
		const { client } = customClient(relay);
		await client.login("correct horse");
		const envelopes = new RetryEnvelopeStore({ store: memoryEnvelopeStore() });

		const [first, second] = await Promise.all([
			sendPersistedCommand({
				client,
				envelopes,
				sessionId: FIXTURE_SESSION_ID,
				op: "prompt",
				text: "first draft",
			}),
			sendPersistedCommand({
				client,
				envelopes,
				sessionId: FIXTURE_SESSION_ID,
				op: "prompt",
				text: "second draft",
			}),
		]);

		const commands = relay.requests.filter((r) => r.path.endsWith("/command"));
		expect(commands).toHaveLength(2);
		expect(relay.admitted.size).toBe(2);
		expect(first.commandId).not.toBe(second.commandId);
		/* Both bodies crossed the wire, in the order they were meant: `objectContaining`
		 * so each is matched as a request body rather than re-asserted field by field. */
		expect(commands.map((request) => request.body)).toEqual([
			expect.objectContaining({ text: "first draft" }),
			expect.objectContaining({ text: "second draft" }),
		]);
	});

	it("lets the waiter through with a FRESH id when the send it waited on was rejected definitively", async () => {
		/* The other half of the rule below: a definitive rejection clears the envelope,
		 * so the waiter is simply a new instruction — new id, its own text, nothing to
		 * inherit and nothing lost. */
		const relay = await relayWith({
			auth: { mode: "custom" },
			rejectCommandOn: 1,
		});
		const { client } = customClient(relay);
		await client.login("correct horse");
		const envelopes = new RetryEnvelopeStore({ store: memoryEnvelopeStore() });
		const draft: Omit<SendCommandInput, "text"> = {
			client,
			envelopes,
			sessionId: FIXTURE_SESSION_ID,
			op: "prompt",
		};

		const first = sendPersistedCommand({ ...draft, text: "rejected draft" });
		const second = sendPersistedCommand({ ...draft, text: "second draft" });

		await expect(first).rejects.toMatchObject({
			kind: "rejected",
			envelope: "clear",
		});
		const secondResult = await second;
		expect(secondResult.reusedPreviousDraft).toBe(false);

		const commands = relay.requests.filter((r) => r.path.endsWith("/command"));
		expect(commands).toHaveLength(2);
		/* Only the second is in the ledger, under its OWN id. */
		expect(relay.admitted.size).toBe(1);
		expect(relay.admitted.has(secondResult.commandId)).toBe(true);
		expect(commands.at(-1)?.body).toMatchObject({ text: "second draft" });
	});

	it("refuses a different instruction while the send it waited on has an UNKNOWN delivery", async () => {
		/* Review round 3, R3-2. An ambiguous failure keeps the envelope, and the store's
		 * reuse rule then hands it to the next caller — so a waiter with DIFFERENT bytes
		 * would have its draft silently replaced by the earlier instruction's (replayed
		 * under the earlier id, de-duplicated, so nothing runs twice, but the caller
		 * never sent what it asked to send). It is refused instead, with
		 * `ambiguous-delivery`, and the composer re-offers the draft. */
		const relay = await relayWith({
			auth: { mode: "custom" },
			dropAckOnCommand: 1,
		});
		const { client } = customClient(relay);
		await client.login("correct horse");
		const envelopes = new RetryEnvelopeStore({ store: memoryEnvelopeStore() });
		const draft: Omit<SendCommandInput, "text"> = {
			client,
			envelopes,
			sessionId: FIXTURE_SESSION_ID,
			op: "prompt",
		};

		const first = sendPersistedCommand({ ...draft, text: "first draft" });
		const second = sendPersistedCommand({ ...draft, text: "second draft" });

		await expect(first).rejects.toMatchObject({
			kind: "transport",
			envelope: "keep",
		});
		await expect(second).rejects.toMatchObject({
			kind: "ambiguous-delivery",
			envelope: "keep",
		});

		/* The second instruction never reached the wire… */
		const commands = relay.requests.filter((r) => r.path.endsWith("/command"));
		expect(commands).toHaveLength(1);
		expect(commands[0]?.body).toMatchObject({ text: "first draft" });
		/* …and the held envelope is still the first instruction's, so a retry of it
		 * replays the same id rather than sending something new. */
		const held = await envelopes.peek(FIXTURE_SESSION_ID);
		expect(held?.text).toBe("first draft");
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

/* ------------------------------------------------- the wire, route by route */

/**
 * Every route the client exposes, checked against the request its own capture
 * records.
 *
 * Each fixture in the corpus carries the request that produced it
 * (`request.method` + `request.path`, query included), so the capture is the
 * oracle: the assertion is that the request the SERVER received is the one the
 * relay's own sample says that route takes. A wrong path, a wrong query or a
 * renamed body key fails here — which matters because these routes are otherwise
 * covered only by the daemon-bound smoke script, and a drift would pass CI.
 */
const WIRE_ROUTES: {
	fixture: string;
	call: (client: ReturnType<typeof customClient>["client"]) => Promise<unknown>;
	/** The body keys the contract's own sample implies, when the route mutates. */
	bodyKeys?: string[];
	expectedBody?: unknown;
	/** Set when the recorded sample is a refusal: the status it must classify to. */
	expectFailure?: number;
}[] = [
	{
		fixture: "http/past-with-rows.json",
		call: (client) => client.pastSessions(),
	},
	{
		fixture: "http/search-hit.json",
		call: (client) => client.searchSessions({ query: "hello", limit: 5 }),
	},
	{
		/* Also pins the OMISSION: a limit the caller did not give is not sent, which
		 * the capture shows and the contract leaves to the relay to default. */
		fixture: "http/history-unknown.json",
		call: (client) => client.history("ffffffffffff", {}),
		expectFailure: 404,
	},
	{
		fixture: "http/search-empty.json",
		call: (client) => client.searchSessions({ query: "hello" }),
	},
	{
		fixture: "http/models.json",
		call: (client) => client.models(),
	},
	{
		fixture: "http/commands.json",
		call: (client) => client.commands(),
	},
	{
		fixture: "http/directories.json",
		call: (client) => client.directories(),
	},
	{
		fixture: "http/history-ok.json",
		call: (client) => client.history(FIXTURE_SESSION_ID, { limit: 5 }),
	},
	{
		fixture: "http/start-session.json",
		call: (client) => client.startSession({}),
	},
	{
		/* `pin` sends the DESIRED STATE, not a toggle: the sample's own response
		 * field is `pinned`, and the relay refuses anything else with a 422. */
		fixture: "http/pin-true.json",
		call: (client) => client.pin(FIXTURE_SESSION_ID, true),
		expectedBody: { pinned: true },
	},
	{
		fixture: "http/seen-real-token.json",
		call: (client) => client.seen(FIXTURE_SESSION_ID, "token-from-the-frame"),
		bodyKeys: ["completion_token"],
	},
	{
		fixture: "http/op-ping.json",
		call: (client) => client.ping(OTHER_SESSION),
		expectedBody: { op: "ping" },
	},
	{
		fixture: "http/command-prompt-ok.json",
		call: (client) =>
			client.command(FIXTURE_SESSION_ID, {
				op: "prompt",
				command_id: COMMAND_UUID,
				text: "hello",
			}),
		bodyKeys: ["op", "command_id", "text"],
	},
	{
		/* No success capture exists for the subagent routes; the recorded refusal is
		 * still the wire fact, so the request is asserted and the 404 classified. */
		fixture: "http/subagent-unknown.json",
		call: (client) => client.agentDetail(FIXTURE_SESSION_ID, "job-x"),
		expectFailure: 404,
	},
	{
		fixture: "http/subagent-history-unknown.json",
		call: (client) => client.agentHistory(FIXTURE_SESSION_ID, "job-x"),
		expectFailure: 404,
	},
	{
		fixture: "http/image-ok.json",
		call: (client) =>
			client.image(OTHER_SESSION, "723ebb3d-8535-4fb3-9a13-e4399b085e85", 0),
	},
];

describe("every route is sent as the relay's own capture records it", () => {
	it.each(WIRE_ROUTES)("$fixture", async (route) => {
		const relay = await relayWith({
			auth: { mode: "custom" },
			replay: WIRE_ROUTES.map((entry) => entry.fixture),
		});
		const { client } = customClient(relay);
		await client.login("correct horse");

		const recorded = loadFixture<{ request: { method: string; path: string } }>(
			route.fixture,
		).request;

		try {
			await route.call(client);
		} catch (cause) {
			const error = cause as { status?: number };
			if (route.expectFailure === undefined) throw cause;
			expect(error.status).toBe(route.expectFailure);
		}

		const sent = relay.requests.at(-1);
		expect(`${sent?.method} ${sent?.path}`).toBe(
			`${recorded.method} ${recorded.path}`,
		);
		if (route.expectedBody !== undefined) {
			expect(sent?.body).toEqual(route.expectedBody);
		}
		if (route.bodyKeys) {
			expect(Object.keys(sent?.body as object).sort()).toEqual(
				[...route.bodyKeys].sort(),
			);
		}
	});
});
