// biome-ignore-all lint/style/noNonNullAssertion: an assertion after a guard is
// the guard.
/**
 * The silent annotation rides the retry envelope: it is part of the instruction's
 * immutable identity, so a retry replays the same `input_mode`/`input_path`, and
 * the stored form is validated as strictly as the relay validates the wire
 * (`input_mode` is a closed vocabulary, `input_path` bounded at 96).
 */

import { describe, expect, it } from "vitest";

import {
	envelopeKey,
	isValidEnvelope,
	memoryEnvelopeStore,
	type RelayEndpoints,
	RetryEnvelopeStore,
	sendPersistedCommand,
} from "@/relay";

function store(): RetryEnvelopeStore {
	return new RetryEnvelopeStore({ store: memoryEnvelopeStore() });
}

/** A syntactically valid `command_id` — the only shape `isValidEnvelope` accepts. */
const UUID = "00000000-0000-0000-0000-000000000000";

/** A minimal command client that records the bodies it is handed. */
function recordingClient() {
	const bodies: Record<string, unknown>[] = [];
	const client = {
		async command(_sessionId: string, body: Record<string, unknown>) {
			bodies.push(body);
			return { ok: true as const, detail: "prompt admitted" };
		},
	} as unknown as Pick<RelayEndpoints, "command">;
	return { client, bodies };
}

describe("envelope annotation validation", () => {
	it("accepts the closed vocabulary and rejects anything else", () => {
		const base = { op: "prompt" as const, command_id: UUID, text: "hi" };
		expect(isValidEnvelope({ ...base, input_mode: "typed" })).toBe(true);
		expect(isValidEnvelope({ ...base, input_mode: "dictated" })).toBe(true);
		expect(isValidEnvelope({ ...base, input_mode: "mixed" })).toBe(true);
		/* A malformed present value is refused, never coerced (design §2.1). */
		expect(isValidEnvelope({ ...base, input_mode: "spoken" })).toBe(false);
	});

	it("bounds input_path at 96 characters", () => {
		const base = { op: "prompt" as const, command_id: UUID, text: "hi" };
		expect(isValidEnvelope({ ...base, input_path: "a".repeat(96) })).toBe(true);
		expect(isValidEnvelope({ ...base, input_path: "a".repeat(97) })).toBe(
			false,
		);
		expect(isValidEnvelope({ ...base, input_path: 5 })).toBe(false);
	});
});

describe("the annotation on the send envelope", () => {
	it("puts input_mode and input_path on the wire from the stored envelope", async () => {
		const envelopes = store();
		const { client, bodies } = recordingClient();
		await sendPersistedCommand({
			client,
			envelopes,
			sessionId: "s1",
			op: "prompt",
			text: "hello",
			input_mode: "dictated",
			input_path: "provider_stt_radient",
		});
		expect(bodies[0]!.input_mode).toBe("dictated");
		expect(bodies[0]!.input_path).toBe("provider_stt_radient");
	});

	it("omits input_path entirely for a typed instruction (absence, not '')", async () => {
		const envelopes = store();
		const { client, bodies } = recordingClient();
		await sendPersistedCommand({
			client,
			envelopes,
			sessionId: "s2",
			op: "prompt",
			text: "hello",
			input_mode: "typed",
		});
		expect(bodies[0]!.input_mode).toBe("typed");
		expect("input_path" in bodies[0]!).toBe(false);
	});

	it("replays the annotation on a retry — the stored bytes are the identity", async () => {
		const envelopes = store();
		// First send fails ambiguously, so the envelope is KEPT.
		const failing = {
			async command() {
				throw new Error("network down");
			},
		} as unknown as Pick<RelayEndpoints, "command">;
		await expect(
			sendPersistedCommand({
				client: failing,
				envelopes,
				sessionId: "s3",
				op: "prompt",
				text: "hello",
				input_mode: "mixed",
				input_path: "provider_stt_openai",
			}),
		).rejects.toBeTruthy();
		const held = await envelopes.peek("s3");
		expect(held?.input_mode).toBe("mixed");
		expect(held?.input_path).toBe("provider_stt_openai");

		// The retry replays it: same id, same annotation.
		const { client, bodies } = recordingClient();
		await sendPersistedCommand({
			client,
			envelopes,
			sessionId: "s3",
			op: "prompt",
			text: "hello",
			input_mode: "mixed",
			input_path: "provider_stt_openai",
		});
		expect(bodies[0]!.command_id).toBe(held?.command_id);
		expect(bodies[0]!.input_mode).toBe("mixed");
		expect(bodies[0]!.input_path).toBe("provider_stt_openai");
	});

	it("does not overwrite a held envelope's annotation with a new draft's", async () => {
		const envelopes = store();
		await envelopes.holdNew("s4", "prompt", "first", undefined, {
			input_mode: "dictated",
			input_path: "provider_stt_radient",
		});
		// A second mint with different bytes reuses the held envelope verbatim: the
		// annotation on the wire belongs to the bytes that are actually sent.
		const reused = await envelopes.holdNew(
			"s4",
			"prompt",
			"second",
			undefined,
			{
				input_mode: "typed",
			},
		);
		expect(reused.reused).toBe(true);
		expect(reused.envelope.input_mode).toBe("dictated");
		expect(reused.envelope.input_path).toBe("provider_stt_radient");
		expect(reused.envelope.text).toBe("first");
		// And it survives a round trip through storage.
		const raw = await memoryRoundTrip(envelopes, "s4");
		expect(raw).toBe("provider_stt_radient");
	});
});

/** Reads the stored envelope's `input_path` back through the store's own reader,
 *  proving the annotation persisted rather than living only in memory. */
async function memoryRoundTrip(
	envelopes: RetryEnvelopeStore,
	sessionId: string,
): Promise<string | undefined> {
	const held = await envelopes.peek(sessionId);
	expect(held).not.toBeNull();
	expect(envelopeKey(sessionId)).toBe(`lo-mobile-command:${sessionId}`);
	return held?.input_path;
}
