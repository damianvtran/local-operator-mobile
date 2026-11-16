/**
 * The durable outbox against a REAL loopback relay (`node:http`), through the
 * real client stack (`createRelayClient` → `RelayEndpoints` → `sendPersistedCommand`).
 *
 * The relay below models the one property every retry relies on: the
 * daemon's identity ledger. A POST's `command_id` is ADMITTED once; any later
 * POST under the same id is answered `already admitted` and admits nothing.
 * So "the server sees one admission" is measured, not assumed: `admissions`
 * counts ledger inserts, `posts` counts every request that reached it.
 *
 * Time is scaled down (policy below) so a stall the size of a cold wake on a
 * slow tunnel fits in a unit run; the ratios between the client deadline, the
 * server's answer time and the outbox's attempt deadline are what matter.
 */

import { randomUUID } from "node:crypto";
import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type CustomRoute, createRelayClient } from "@/connection";
import {
	type EnvelopeStore,
	isRelayError,
	memoryEnvelopeStore,
	type RelayEndpoints,
	RetryEnvelopeStore,
	sendPersistedCommand,
} from "@/relay";
import { composerControls } from "./composer";
import {
	Outbox,
	type OutboxPolicy,
	outboxVerdict,
	retryDelayMs,
} from "./outbox";
import {
	clearPendingEchoes,
	pendingEchoCaption,
	pendingEchoFor,
	putBackPendingEcho,
	registerPendingEcho,
} from "./pending-echo";

const SESSION = "6714def86197";
const TIMEOUT_CAUSE = /^timeout/;

/** Scaled: client default 300 ms stands for the transport's 20 s; the relay's
 *  slow answer (700 ms) for a 45 s cold wake; the outbox's 1.5 s attempt
 *  deadline for its 60 s. */
const CLIENT_DEFAULT_MS = 300;
const POLICY: OutboxPolicy = {
	attemptTimeoutMs: 1_500,
	firstRetryMs: 20,
	maxRetryMs: 80,
	keepTryingMs: 10_000,
};

type Behaviour =
	/** Admit, then never answer: the acknowledgement is lost. */
	| "admit-stall"
	/** Admit, answer after `slowMs`. */
	| "admit-slow"
	/** Drop the connection without admitting (the tunnel lost it). */
	| "drop"
	/** Admit and answer at once. */
	| "ok"
	/** A definitive pre-admission refusal. */
	| "refuse-422";

interface Relay {
	baseUrl: string;
	posts: string[];
	admissions: number;
	/** Whether `/history` shows admitted ids as user rows. */
	transcriptWrites: boolean;
	close(): Promise<void>;
}

const servers: Server[] = [];

async function relay(
	script: (postNumber: number) => Behaviour,
	options: { slowMs?: number; transcriptWrites?: boolean; port?: number } = {},
): Promise<Relay> {
	const ledger = new Map<string, string>();
	const state: Relay = {
		baseUrl: "",
		posts: [],
		admissions: 0,
		transcriptWrites: options.transcriptWrites ?? false,
		close: async () => {},
	};
	const admit = (id: string, text: string): string => {
		if (ledger.has(id)) return "already admitted";
		ledger.set(id, text);
		state.admissions += 1;
		return "prompt admitted";
	};
	const json = (response: ServerResponse, status: number, body: unknown) => {
		response.writeHead(status, { "content-type": "application/json" });
		response.end(JSON.stringify(body));
	};
	const server = createServer(
		(request: IncomingMessage, response: ServerResponse) => {
			const url = request.url ?? "";
			if (request.method === "GET" && url.includes("/history")) {
				json(response, 200, {
					entries: state.transcriptWrites
						? [...ledger].map(([id, text]) => userRow(id, text))
						: [],
					has_more: false,
				});
				return;
			}
			let raw = "";
			request.on("data", (chunk) => {
				raw += chunk;
			});
			request.on("end", () => {
				const body = JSON.parse(raw) as { command_id: string; text: string };
				state.posts.push(body.command_id);
				const behaviour = script(state.posts.length);
				switch (behaviour) {
					case "admit-stall":
						admit(body.command_id, body.text);
						return; // never answered
					case "admit-slow": {
						const detail = admit(body.command_id, body.text);
						setTimeout(
							() => json(response, 200, { ok: true, detail }),
							options.slowMs ?? 700,
						);
						return;
					}
					case "drop":
						request.socket.destroy();
						return;
					case "ok":
						json(response, 200, {
							ok: true,
							detail: admit(body.command_id, body.text),
						});
						return;
					case "refuse-422":
						json(response, 422, { error: "prompt text is empty" });
						return;
				}
			});
		},
	);
	servers.push(server);
	await new Promise<void>((resolve) =>
		server.listen(options.port ?? 0, "127.0.0.1", resolve),
	);
	const { port } = server.address() as AddressInfo;
	state.baseUrl = `http://127.0.0.1:${port}`;
	state.close = () =>
		new Promise<void>((resolve) => {
			server.close(() => resolve());
			server.closeAllConnections();
		});
	return state;
}

function userRow(id: string, text: string) {
	return {
		id,
		kind: "user",
		text,
		tool_call_id: "",
		tool_name: "",
		tool_state: "interrupted",
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
	};
}

function clientFor(baseUrl: string): RelayEndpoints {
	return createRelayClient({
		route: {
			mode: "custom",
			baseUrl,
			allowInsecure: true,
		} satisfies CustomRoute,
		timeoutMs: CLIENT_DEFAULT_MS,
	});
}

function envelopesOn(backing: EnvelopeStore = memoryEnvelopeStore()) {
	return new RetryEnvelopeStore({ store: backing, randomUuid: randomUUID });
}

/** The composer's `onHeld`, reduced to what the outbox needs: the row. */
const paint =
	(text: string) =>
	(envelope: { command_id: string; op: "prompt" | "steer" }) =>
		registerPendingEcho(SESSION, {
			commandId: envelope.command_id,
			text,
			imageCount: 0,
			op: envelope.op,
			accepted: false,
		});

async function until(check: () => boolean, ms = 5_000): Promise<void> {
	const deadline = Date.now() + ms;
	while (!check()) {
		if (Date.now() > deadline) throw new Error("condition not met in time");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

const outboxes: Outbox[] = [];
function makeOutbox(extra: ConstructorParameters<typeof Outbox>[0] = {}) {
	const created = new Outbox({ policy: POLICY, random: () => 0.5, ...extra });
	outboxes.push(created);
	return created;
}

beforeEach(() => clearPendingEchoes());
afterEach(async () => {
	for (const box of outboxes.splice(0)) box.abandonAll();
	clearPendingEchoes();
	await Promise.all(
		servers.splice(0).map(
			(server) =>
				new Promise<void>((resolve) => {
					server.close(() => resolve());
					server.closeAllConnections();
				}),
		),
	);
});

describe("reproduction: a relay slower than the transport default", () => {
	it("BEFORE: the single 20 s-class attempt gives up on a prompt the relay was still admitting", async () => {
		const server = await relay(() => "admit-slow", { slowMs: 700 });
		const envelopes = envelopesOn();
		const failure = await sendPersistedCommand({
			client: clientFor(server.baseUrl),
			envelopes,
			sessionId: SESSION,
			op: "prompt",
			text: "hello",
		}).catch((error: unknown) => error);
		expect(isRelayError(failure) && failure.kind).toBe("transport");
		expect(isRelayError(failure) && failure.transportCause).toMatch(
			TIMEOUT_CAUSE,
		);
		// The relay DID admit it; the phone reports an unknown outcome anyway.
		expect(server.admissions).toBe(1);
		expect(await envelopes.peek(SESSION)).not.toBeNull();
	});

	it("AFTER: the outbox's attempt deadline waits the relay out — delivered on one POST", async () => {
		const server = await relay(() => "admit-slow", { slowMs: 700 });
		const envelopes = envelopesOn();
		const outcome = await makeOutbox().deliver({
			client: clientFor(server.baseUrl),
			envelopes,
			sessionId: SESSION,
			op: "prompt",
			text: "hello",
		});
		expect(outcome.kind).toBe("delivered");
		expect(server.posts).toHaveLength(1);
		expect(server.admissions).toBe(1);
		expect(await envelopes.peek(SESSION)).toBeNull();
	});
});

describe("stall → retry → delivered once", () => {
	it("replays the SAME command_id after a lost acknowledgement; the relay admits it once", async () => {
		const server = await relay((n) => (n === 1 ? "admit-stall" : "ok"));
		const envelopes = envelopesOn();
		const box = makeOutbox();
		const outcome = await box.deliver({
			client: clientFor(server.baseUrl),
			envelopes,
			sessionId: SESSION,
			op: "prompt",
			text: "hello",
			onHeld: paint("hello"),
		});
		// The composer is released while the outbox keeps going.
		expect(outcome.kind).toBe("background");
		const id = outcome.kind === "background" ? outcome.commandId : "";
		expect(pendingEchoFor(SESSION, id)?.outbox).toBe("waiting");
		expect(box.entryFor(SESSION)?.phase).toBe("waiting");

		await until(() => box.entryFor(SESSION) === null);
		expect(server.posts.length).toBeGreaterThanOrEqual(2);
		expect(new Set(server.posts)).toEqual(new Set([id]));
		expect(server.admissions).toBe(1);
		const echo = pendingEchoFor(SESSION, id);
		expect(echo?.accepted).toBe(true);
		expect(echo?.outbox).toBeUndefined();
		expect(await envelopes.peek(SESSION)).toBeNull();
	});
});

describe("an ambiguous outcome is reconciled by id before any resend", () => {
	it("finds the command in the transcript and settles it with no second POST", async () => {
		const server = await relay(() => "admit-stall", { transcriptWrites: true });
		const envelopes = envelopesOn();
		const box = makeOutbox();
		const outcome = await box.deliver({
			client: clientFor(server.baseUrl),
			envelopes,
			sessionId: SESSION,
			op: "prompt",
			text: "hello",
			onHeld: paint("hello"),
		});
		expect(outcome.kind).toBe("background");
		await until(() => box.entryFor(SESSION) === null);
		expect(server.posts).toHaveLength(1);
		expect(server.admissions).toBe(1);
		const id = server.posts[0] ?? "";
		expect(pendingEchoFor(SESSION, id)?.accepted).toBe(true);
		expect(await envelopes.peek(SESSION)).toBeNull();
	});
});

describe("a definitive refusal stops", () => {
	it("on the first attempt: the composer gets the error, no retry", async () => {
		const server = await relay(() => "refuse-422");
		const box = makeOutbox();
		const failure = await box
			.deliver({
				client: clientFor(server.baseUrl),
				envelopes: envelopesOn(),
				sessionId: SESSION,
				op: "prompt",
				text: "hello",
			})
			.catch((error: unknown) => error);
		expect(isRelayError(failure) && failure.status).toBe(422);
		await new Promise((resolve) => setTimeout(resolve, 200));
		expect(server.posts).toHaveLength(1);
		expect(box.entryFor(SESSION)).toBeNull();
	});

	it("in the background: the row becomes the put-back row and nothing more is sent", async () => {
		const server = await relay((n) => (n === 1 ? "drop" : "refuse-422"));
		const envelopes = envelopesOn();
		const box = makeOutbox();
		const outcome = await box.deliver({
			client: clientFor(server.baseUrl),
			envelopes,
			sessionId: SESSION,
			op: "prompt",
			text: "hello",
			onHeld: paint("hello"),
		});
		expect(outcome.kind).toBe("background");
		await until(() => box.entryFor(SESSION) === null);
		await new Promise((resolve) => setTimeout(resolve, 200));
		expect(server.posts).toHaveLength(2);
		expect(server.admissions).toBe(0);
		const id = server.posts[0] ?? "";
		expect(pendingEchoFor(SESSION, id)?.failure).toBe("refused");
		expect(await envelopes.peek(SESSION)).toBeNull();
	});
});

describe("background → foreground", () => {
	it("frozen timers (iOS suspension) do not strand the send: foreground attempts at once", async () => {
		const server = await relay((n) => (n === 1 ? "drop" : "ok"));
		const envelopes = envelopesOn();
		/* A timer that never fires stands for JS suspended in the background:
		 * the scheduled retry does not run until the app is foregrounded. */
		const frozen: Array<() => void> = [];
		const box = makeOutbox({
			setTimer: (run) => {
				frozen.push(run);
				return frozen.length;
			},
			clearTimer: () => {},
		});
		const outcome = await box.deliver({
			client: clientFor(server.baseUrl),
			envelopes,
			sessionId: SESSION,
			op: "prompt",
			text: "hello",
			onHeld: paint("hello"),
		});
		expect(outcome.kind).toBe("background");
		await new Promise((resolve) => setTimeout(resolve, 150));
		expect(server.posts).toHaveLength(1);
		expect(box.entryFor(SESSION)?.phase).toBe("waiting");

		box.onForeground();
		await until(() => box.entryFor(SESSION) === null);
		expect(server.posts).toHaveLength(2);
		expect(new Set(server.posts).size).toBe(1);
		expect(server.admissions).toBe(1);
	});
});

describe("relaunch", () => {
	it("resumes from the persisted envelope after a kill: repaints the row, delivers under the original id", async () => {
		/* The device storage outlives the process; everything in memory does not. */
		const backing = memoryEnvelopeStore();
		/* The ownership ledger is device storage too (`OutboxLedger`). */
		const owned = new Set<string>();
		const ledger = {
			add: async (id: string) => {
				owned.add(id);
			},
			remove: async (id: string) => {
				owned.delete(id);
			},
		};
		const down = await relay(() => "drop");
		const first = makeOutbox();
		first.setLedger(ledger);
		const outcome = await first.deliver({
			client: clientFor(down.baseUrl),
			envelopes: envelopesOn(backing),
			sessionId: SESSION,
			op: "prompt",
			text: "survive the kill",
			onHeld: paint("survive the kill"),
		});
		expect(outcome.kind).toBe("background");
		const id = outcome.kind === "background" ? outcome.commandId : "";
		// Custody was recorded before the first attempt and kept at hand-off.
		expect([...owned]).toEqual([SESSION]);
		// Kill: the outbox and the echo store are gone; only storage remains.
		first.abandonAll();
		clearPendingEchoes();
		await down.close();

		const up = await relay(() => "ok");
		const relaunched = makeOutbox();
		relaunched.setLedger(ledger);
		relaunched.setClient(clientFor(up.baseUrl));
		const envelopes = envelopesOn(backing);
		// The host resumes exactly the ledger's sessions.
		await relaunched.resume(
			[...owned].map((sessionId) => ({ sessionId, envelopes })),
		);
		// The row is back, from the envelope's own bytes, before the answer.
		expect(pendingEchoFor(SESSION, id)?.text).toBe("survive the kill");
		await until(() => relaunched.entryFor(SESSION) === null);
		expect(up.posts).toEqual([id]);
		expect(up.admissions).toBe(1);
		expect(pendingEchoFor(SESSION, id)?.accepted).toBe(true);
		expect(await envelopes.peek(SESSION)).toBeNull();
		// Delivered: the mark goes with the job.
		expect(owned.size).toBe(0);
	});

	it("a kill DURING the composer's first attempt still resumes it (QA round 1, Q1)", async () => {
		const backing = memoryEnvelopeStore();
		const owned = new Set<string>();
		const ledger = {
			add: async (id: string) => {
				owned.add(id);
			},
			remove: async (id: string) => {
				owned.delete(id);
			},
		};
		/* The relay admits and never answers: the attached attempt is still out
		 * (the 60 s window on a slow link) when the app is killed. */
		const slow = await relay(() => "admit-stall");
		let markedAtFirstPost: boolean | null = null;
		const watch = setInterval(() => {
			if (markedAtFirstPost === null && slow.posts.length > 0)
				markedAtFirstPost = owned.has(SESSION);
		}, 1);
		const first = makeOutbox();
		first.setLedger(ledger);
		let id = "";
		void first
			.deliver({
				client: clientFor(slow.baseUrl),
				envelopes: envelopesOn(backing),
				sessionId: SESSION,
				op: "prompt",
				text: "killed mid-send",
				onHeld: (envelope) => {
					id = envelope.command_id;
					paint("killed mid-send")(envelope);
				},
			})
			.catch(() => undefined);
		await until(() => slow.posts.length === 1);
		clearInterval(watch);
		// Custody was on disk before the first byte, not only at hand-off.
		expect(markedAtFirstPost).toBe(true);
		expect(first.entryFor(SESSION)?.phase).toBe("sending");
		// Kill mid-attempt: only storage survives.
		first.abandonAll();
		clearPendingEchoes();
		await slow.close();
		expect([...owned]).toEqual([SESSION]);

		const up = await relay(() => "ok");
		const relaunched = makeOutbox();
		relaunched.setLedger(ledger);
		relaunched.setClient(clientFor(up.baseUrl));
		const envelopes = envelopesOn(backing);
		await relaunched.resume(
			[...owned].map((sessionId) => ({ sessionId, envelopes })),
		);
		// The conversation list's marker (`useOutboxPhase`) reads this entry.
		expect(relaunched.entryFor(SESSION)?.phase).toBe("waiting");
		expect(pendingEchoFor(SESSION, id)?.text).toBe("killed mid-send");
		await until(() => relaunched.entryFor(SESSION) === null);
		// Same UUID as the killed attempt; never a new one.
		expect(up.posts).toEqual([id]);
		expect(pendingEchoFor(SESSION, id)?.accepted).toBe(true);
		expect(owned.size).toBe(0);
	});

	it("a kill before the envelope is held leaves only a stale mark, dropped on resume", async () => {
		const backing = memoryEnvelopeStore();
		const owned = new Set<string>([SESSION]);
		const relaunched = makeOutbox();
		relaunched.setLedger({
			add: async (id: string) => {
				owned.add(id);
			},
			remove: async (id: string) => {
				owned.delete(id);
			},
		});
		await relaunched.resume([
			{ sessionId: SESSION, envelopes: envelopesOn(backing) },
		]);
		expect(relaunched.entryFor(SESSION)).toBeNull();
		await until(() => owned.size === 0);
	});
});

describe("the reader stays in control", () => {
	it("stops after the keep-trying window (envelope kept), and Retry delivers under the same id", async () => {
		let healthy = false;
		const server = await relay(() => (healthy ? "ok" : "drop"));
		const envelopes = envelopesOn();
		let clock = 0;
		const box = makeOutbox({
			now: () => clock,
			policy: { ...POLICY, keepTryingMs: 1_000 },
		});
		const outcome = await box.deliver({
			client: clientFor(server.baseUrl),
			envelopes,
			sessionId: SESSION,
			op: "prompt",
			text: "hello",
			onHeld: paint("hello"),
		});
		const id = outcome.kind === "background" ? outcome.commandId : "";
		clock = 5_000; // past the window
		await until(() => box.entryFor(SESSION)?.phase === "failed");
		expect(pendingEchoFor(SESSION, id)?.outbox).toBe("exhausted");
		expect(await envelopes.peek(SESSION)).not.toBeNull();

		healthy = true;
		box.retryNow(SESSION);
		await until(() => box.entryFor(SESSION) === null);
		expect(new Set(server.posts)).toEqual(new Set([id]));
		expect(server.admissions).toBe(1);
		expect(pendingEchoFor(SESSION, id)?.accepted).toBe(true);
	});

	it("Discard stops retrying, drops the envelope and the row", async () => {
		const server = await relay(() => "drop");
		const envelopes = envelopesOn();
		const box = makeOutbox({ policy: { ...POLICY, firstRetryMs: 200 } });
		const outcome = await box.deliver({
			client: clientFor(server.baseUrl),
			envelopes,
			sessionId: SESSION,
			op: "prompt",
			text: "hello",
			onHeld: paint("hello"),
		});
		const id = outcome.kind === "background" ? outcome.commandId : "";
		await box.discard(SESSION);
		const sent = server.posts.length;
		await new Promise((resolve) => setTimeout(resolve, 400));
		expect(server.posts).toHaveLength(sent);
		expect(box.entryFor(SESSION)).toBeNull();
		// The row stays, as the put-back row (UX round 1, U2)…
		expect(pendingEchoFor(SESSION, id)?.outbox).toBe("discarded");
		expect(await envelopes.peek(SESSION)).toBeNull();
		// …and its tap puts the words back in the composer, row gone.
		const restored: string[] = [];
		putBackPendingEcho(SESSION, id, {
			read: () => ({ text: "", imageCount: 0 }),
			clear: () => {},
			restore: () => {},
			prepend: (text) => restored.push(text),
		});
		expect(restored).toEqual(["hello"]);
		expect(pendingEchoFor(SESSION, id)).toBeUndefined();
	});

	it("Discard during the reconcile read sends nothing more (agent review round 1, R1)", async () => {
		const server = await relay(() => "drop");
		const envelopes = envelopesOn();
		let reconcileStarted = false;
		let answer: (landed: boolean) => void = () => {};
		const box = makeOutbox({
			reconcile: () => {
				reconcileStarted = true;
				return new Promise<boolean>((resolve) => {
					answer = resolve;
				});
			},
		});
		const outcome = await box.deliver({
			client: clientFor(server.baseUrl),
			envelopes,
			sessionId: SESSION,
			op: "prompt",
			text: "hello",
			onHeld: paint("hello"),
		});
		expect(outcome.kind).toBe("background");
		// The retry is inside its history check (a slow GET on a bad link).
		await until(() => reconcileStarted);
		const before = server.posts.length;
		const discarded = box.discard(SESSION);
		answer(false);
		await discarded;
		await new Promise((resolve) => setTimeout(resolve, 300));
		expect(server.posts).toHaveLength(before);
		expect(box.entryFor(SESSION)).toBeNull();
		expect(await envelopes.peek(SESSION)).toBeNull();
	});

	it("Discard while a POST is on the wire changes the row at once (UX round 1, U1)", async () => {
		// The retry is admitted and never answered: the full attempt deadline.
		const server = await relay((n) => (n === 1 ? "drop" : "admit-stall"));
		const envelopes = envelopesOn();
		const box = makeOutbox();
		const outcome = await box.deliver({
			client: clientFor(server.baseUrl),
			envelopes,
			sessionId: SESSION,
			op: "prompt",
			text: "hello",
			onHeld: paint("hello"),
		});
		const id = outcome.kind === "background" ? outcome.commandId : "";
		await until(() => server.posts.length === 2);
		const tapped = Date.now();
		const discarded = box.discard(SESSION);
		// Same tick, before any await: the row and the entry already moved.
		expect(pendingEchoFor(SESSION, id)?.outbox).toBe("discarded");
		expect(box.entryFor(SESSION)?.phase).toBe("discarding");
		expect(
			composerControls({
				streaming: false,
				hasDraft: true,
				hasImages: false,
				sending: false,
				envelopePending: false,
				outboxPhase: "discarding",
				ended: false,
			}).disabledReason,
		).toBe(
			"Discarding your earlier message. You can send this one in a moment.",
		);
		await discarded;
		// It waited out the attempt it could not abort, and sent nothing new.
		expect(Date.now() - tapped).toBeGreaterThan(POLICY.attemptTimeoutMs / 2);
		expect(server.posts).toHaveLength(2);
		expect(box.entryFor(SESSION)).toBeNull();
		expect(await envelopes.peek(SESSION)).toBeNull();
		expect(pendingEchoFor(SESSION, id)?.outbox).toBe("discarded");
	});

	it("an attempt already on the wire that lands after Discard still shows as sent", async () => {
		const server = await relay((n) => (n === 1 ? "drop" : "admit-slow"), {
			slowMs: 300,
		});
		const envelopes = envelopesOn();
		const box = makeOutbox();
		const outcome = await box.deliver({
			client: clientFor(server.baseUrl),
			envelopes,
			sessionId: SESSION,
			op: "prompt",
			text: "hello",
			onHeld: paint("hello"),
		});
		const id = outcome.kind === "background" ? outcome.commandId : "";
		await until(() => server.posts.length === 2);
		await box.discard(SESSION);
		// The truth beats the discard: the relay took it, the row says so.
		expect(server.admissions).toBe(1);
		expect(pendingEchoFor(SESSION, id)?.accepted).toBe(true);
		expect(pendingEchoFor(SESSION, id)?.outbox).toBeUndefined();
		expect(box.entryFor(SESSION)).toBeNull();
	});

	it("refuses a DIFFERENT instruction on the same session while one is owned", async () => {
		const server = await relay(() => "drop");
		const envelopes = envelopesOn();
		const box = makeOutbox({ policy: { ...POLICY, firstRetryMs: 5_000 } });
		await box.deliver({
			client: clientFor(server.baseUrl),
			envelopes,
			sessionId: SESSION,
			op: "prompt",
			text: "first",
		});
		const refused = await box
			.deliver({
				client: clientFor(server.baseUrl),
				envelopes,
				sessionId: SESSION,
				op: "prompt",
				text: "second",
			})
			.catch((error: unknown) => error);
		expect(isRelayError(refused) && refused.kind).toBe("ambiguous-delivery");
		expect(server.posts).toHaveLength(1);
	});
});

describe("policy and copy", () => {
	it("backs off exponentially with equal jitter, capped, honouring Retry-After as a floor", () => {
		const policy = {
			...POLICY,
			firstRetryMs: 2_000,
			maxRetryMs: 30_000,
			keepTryingMs: 900_000,
		};
		expect(retryDelayMs(1, () => 0, policy)).toBe(1_000);
		expect(retryDelayMs(1, () => 1, policy)).toBe(2_000);
		expect(retryDelayMs(3, () => 1, policy)).toBe(8_000);
		expect(retryDelayMs(10, () => 1, policy)).toBe(30_000);
		expect(retryDelayMs(10, () => 0, policy)).toBe(15_000);
		expect(retryDelayMs(1, () => 0, policy, 20_000)).toBe(20_000);
	});

	it("reads the taxonomy's verdicts: keep → retry, clear → refused, never → stop", async () => {
		const server = await relay(() => "refuse-422");
		const error = await clientFor(server.baseUrl)
			.command(SESSION, {
				op: "prompt",
				command_id: randomUUID(),
				text: "x",
			})
			.catch((caught: unknown) => caught);
		expect(isRelayError(error) && outboxVerdict(error)).toBe("refused");
	});

	it("captions the outbox states, and blocks the composer with its own sentence", () => {
		const base = {
			commandId: "c",
			text: "t",
			imageCount: 0,
			op: "prompt" as const,
			accepted: false,
		};
		expect(pendingEchoCaption({ ...base, outbox: "waiting" }, false)).toBe(
			"waiting for your computer — still trying",
		);
		expect(pendingEchoCaption({ ...base, outbox: "exhausted" }, false)).toBe(
			"couldn’t deliver — stopped trying",
		);
		expect(pendingEchoCaption({ ...base, outbox: "discarded" }, false)).toBe(
			"discarded — it may already have arrived · tap to put back",
		);
		const controlsAt = (
			outboxPhase: "sending" | "waiting" | "failed" | "discarding" | null,
		) =>
			composerControls({
				streaming: false,
				hasDraft: true,
				hasImages: false,
				sending: false,
				envelopePending: false,
				outboxPhase,
				ended: false,
			});
		expect(controlsAt("waiting").primary.disabled).toBe(true);
		expect(controlsAt("waiting").disabledReason).toBe(
			"Your earlier message is still sending. You can send this one once it’s delivered.",
		);
		// Stopped: the hint agrees with the row (UX round 1, U3 / review R6).
		expect(controlsAt("failed").primary.disabled).toBe(true);
		expect(controlsAt("failed").disabledReason).toBe(
			"Your earlier message stopped sending. Retry or discard it above to send this one.",
		);
		expect(controlsAt(null).primary.disabled).toBe(false);
		expect(controlsAt(null).disabledReason).toBeNull();
	});
});
