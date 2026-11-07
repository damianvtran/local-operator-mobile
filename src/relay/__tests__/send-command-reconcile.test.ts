/**
 * The prompt/steer race: the composer picks the op from the last painted
 * projection, and the runtime's turn state can move before the request lands.
 * A DEFINITIVE refusal that names that move is replayed ONCE as the other op
 * under the SAME `command_id` (so it can never run twice); anything ambiguous is
 * left to the retry envelope. The refusal bodies are the daemon's own
 * (`local_operator/mobile/daemon.py` `api_command`): a busy TUI-hosted owner's
 * `TurnInFlight` surfaces as `422 {"error": "session is already streaming; use
 * steer() to inject mid-turn"}`, a steer with no live runtime as `409 {"error":
 * "session not connected"}`.
 */

import { describe, expect, it } from "vitest";

import {
	memoryEnvelopeStore,
	type RelayEndpoints,
	RelayError,
	RetryEnvelopeStore,
	reconciledOp,
	sendPersistedCommand,
} from "@/relay";

const busy = () =>
	new RelayError(
		"rejected",
		"session is already streaming; use steer() to inject mid-turn",
		{
			status: 422,
			serverError:
				"session is already streaming; use steer() to inject mid-turn",
			envelope: "clear",
		},
	);
const cold = () =>
	new RelayError("rejected", "session not connected", {
		status: 409,
		serverError: "session not connected",
		envelope: "clear",
	});
const timedOut = () =>
	new RelayError("ambiguous-delivery", "session did not answer", {
		status: 504,
		serverError: "session did not answer",
		envelope: "keep",
	});

/** A command client that answers each call from a script, recording bodies. */
function scripted(answers: Array<RelayError | string>) {
	const bodies: Array<Record<string, unknown>> = [];
	const client = {
		async command(_sessionId: string, body: Record<string, unknown>) {
			bodies.push(body);
			const next = answers.shift();
			if (next instanceof RelayError) throw next;
			return { ok: true as const, detail: next ?? "unscripted" };
		},
	} as unknown as Pick<RelayEndpoints, "command">;
	return { client, bodies };
}

const store = () => new RetryEnvelopeStore({ store: memoryEnvelopeStore() });

describe("reconciledOp", () => {
	it("maps exactly the two turn-state refusals, and nothing ambiguous", () => {
		expect(reconciledOp("prompt", busy())).toBe("steer");
		expect(reconciledOp("steer", cold())).toBe("prompt");
		expect(reconciledOp("steer", busy())).toBeNull();
		expect(reconciledOp("prompt", cold())).toBeNull();
		expect(reconciledOp("prompt", timedOut())).toBeNull();
		expect(reconciledOp("steer", timedOut())).toBeNull();
	});
});

describe("a send racing the turn boundary", () => {
	it("re-delivers a prompt refused as busy as a steer under the same id", async () => {
		const { client, bodies } = scripted([busy(), "steering queued"]);
		const envelopes = store();
		const result = await sendPersistedCommand({
			client,
			envelopes,
			sessionId: "s1",
			op: "prompt",
			text: "also check the tests",
		});
		expect(bodies.map((body) => body.op)).toEqual(["prompt", "steer"]);
		expect(bodies[1]?.command_id).toBe(bodies[0]?.command_id);
		expect(bodies[1]?.text).toBe("also check the tests");
		expect(result.op).toBe("steer");
		expect(result.detail).toBe("steering queued");
		/* Acknowledged: nothing left to retry. */
		expect(await envelopes.peek("s1")).toBeNull();
	});

	it("re-delivers a steer refused for want of a live runtime as a prompt", async () => {
		const { client, bodies } = scripted([cold(), "prompt admitted"]);
		const result = await sendPersistedCommand({
			client,
			envelopes: store(),
			sessionId: "s1",
			op: "steer",
			text: "keep going",
		});
		expect(bodies.map((body) => body.op)).toEqual(["steer", "prompt"]);
		expect(bodies[1]?.command_id).toBe(bodies[0]?.command_id);
		expect(result.op).toBe("prompt");
	});

	it("replays only once: a second refusal surfaces and the draft's envelope is not invented", async () => {
		const { client, bodies } = scripted([busy(), cold()]);
		const envelopes = store();
		await expect(
			sendPersistedCommand({
				client,
				envelopes,
				sessionId: "s1",
				op: "prompt",
				text: "x",
			}),
		).rejects.toMatchObject({ status: 409 });
		expect(bodies).toHaveLength(2);
	});

	it("keeps the SWAPPED envelope when the replay's outcome is ambiguous", async () => {
		/* A later Retry must replay the op that can land, not the refused one. */
		const { client, bodies } = scripted([busy(), timedOut()]);
		const envelopes = store();
		await expect(
			sendPersistedCommand({
				client,
				envelopes,
				sessionId: "s1",
				op: "prompt",
				text: "x",
			}),
		).rejects.toMatchObject({ kind: "ambiguous-delivery" });
		const held = await envelopes.peek("s1");
		expect(held?.op).toBe("steer");
		expect(held?.command_id).toBe(bodies[0]?.command_id);
	});

	it("never reconciles an ambiguous first failure (it may already be admitted)", async () => {
		const { client, bodies } = scripted([timedOut()]);
		const envelopes = store();
		await expect(
			sendPersistedCommand({
				client,
				envelopes,
				sessionId: "s1",
				op: "prompt",
				text: "x",
			}),
		).rejects.toMatchObject({ status: 504 });
		expect(bodies).toHaveLength(1);
		expect((await envelopes.peek("s1"))?.op).toBe("prompt");
	});

	it("reports the requested op when nothing needed reconciling", async () => {
		const { client } = scripted(["steering queued"]);
		const result = await sendPersistedCommand({
			client,
			envelopes: store(),
			sessionId: "s1",
			op: "steer",
			text: "x",
		});
		expect(result.op).toBe("steer");
	});
});
