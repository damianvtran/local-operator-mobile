// biome-ignore-all lint/style/noNonNullAssertion: an assertion after a guard is
// the guard.
/**
 * `expand_skills` rides the retry envelope: it is part of the instruction's
 * identity, so a retry asks for the same expansion (or it would send the literal
 * text of a message written as a skill invocation), and the receipt's `skills`
 * block reaches the caller.
 */

import { describe, expect, it } from "vitest";

import {
	isValidEnvelope,
	memoryEnvelopeStore,
	type RelayEndpoints,
	RetryEnvelopeStore,
	sendPersistedCommand,
} from "@/relay";

const store = () => new RetryEnvelopeStore({ store: memoryEnvelopeStore() });
const UUID = "00000000-0000-0000-0000-000000000000";

const recordingClient = (skills?: {
	attached: string[];
	skipped: string[];
}) => {
	const bodies: Record<string, unknown>[] = [];
	const client = {
		async command(_sessionId: string, body: Record<string, unknown>) {
			bodies.push(body);
			return {
				ok: true as const,
				detail: "prompt admitted",
				...(skills ? { skills } : {}),
			};
		},
	} as unknown as Pick<RelayEndpoints, "command">;
	return { client, bodies };
};

describe("expand_skills on the send body", () => {
	it("is sent only when asked for, as a literal true", async () => {
		const { client, bodies } = recordingClient();
		await sendPersistedCommand({
			client,
			envelopes: store(),
			sessionId: "a",
			op: "prompt",
			text: "use $research",
			expand_skills: true,
		});
		expect(bodies[0]!.expand_skills).toBe(true);

		await sendPersistedCommand({
			client,
			envelopes: store(),
			sessionId: "b",
			op: "prompt",
			text: "no skills here",
		});
		// Absent — never `false`: the body stays byte-identical to an older client's.
		expect("expand_skills" in bodies[1]!).toBe(false);
	});

	it("goes on a steer too", async () => {
		const { client, bodies } = recordingClient();
		await sendPersistedCommand({
			client,
			envelopes: store(),
			sessionId: "c",
			op: "steer",
			text: "also $research",
			expand_skills: true,
		});
		expect(bodies[0]!.op).toBe("steer");
		expect(bodies[0]!.expand_skills).toBe(true);
	});

	it("is replayed from the stored envelope on a retry", async () => {
		const envelopes = store();
		const failing = {
			async command() {
				throw new Error("network down");
			},
		} as unknown as Pick<RelayEndpoints, "command">;
		await expect(
			sendPersistedCommand({
				client: failing,
				envelopes,
				sessionId: "d",
				op: "prompt",
				text: "use $research",
				expand_skills: true,
			}),
		).rejects.toBeTruthy();
		expect((await envelopes.peek("d"))?.expand_skills).toBe(true);

		// The retry passes NO flag of its own: the envelope's bytes are the identity.
		const { client, bodies } = recordingClient();
		await sendPersistedCommand({
			client,
			envelopes,
			sessionId: "d",
			op: "prompt",
			text: "use $research",
		});
		expect(bodies[0]!.expand_skills).toBe(true);
	});

	it("is not part of a draft that never asked: nothing is stored for it", async () => {
		const envelopes = store();
		const failing = {
			async command() {
				throw new Error("network down");
			},
		} as unknown as Pick<RelayEndpoints, "command">;
		await expect(
			sendPersistedCommand({
				client: failing,
				envelopes,
				sessionId: "e",
				op: "prompt",
				text: "plain",
			}),
		).rejects.toBeTruthy();
		expect("expand_skills" in ((await envelopes.peek("e")) ?? {})).toBe(false);
	});
});

describe("the receipt's skills block", () => {
	it("reaches the caller, skipped names included", async () => {
		const { client } = recordingClient({
			attached: ["research"],
			skipped: ["empty-skill"],
		});
		const result = await sendPersistedCommand({
			client,
			envelopes: store(),
			sessionId: "f",
			op: "prompt",
			text: "$research $empty-skill",
			expand_skills: true,
		});
		expect(result.skills).toEqual({
			attached: ["research"],
			skipped: ["empty-skill"],
		});
	});

	it("is absent from a relay that does not expand", async () => {
		const { client } = recordingClient();
		const result = await sendPersistedCommand({
			client,
			envelopes: store(),
			sessionId: "g",
			op: "prompt",
			text: "hi $x",
			expand_skills: true,
		});
		expect("skills" in result).toBe(false);
	});
});

describe("envelope validation", () => {
	const base = { op: "prompt" as const, command_id: UUID, text: "hi" };
	it("accepts true or absence, and refuses anything else as a corrupt item", () => {
		expect(isValidEnvelope({ ...base, expand_skills: true })).toBe(true);
		expect(isValidEnvelope(base)).toBe(true);
		expect(isValidEnvelope({ ...base, expand_skills: false })).toBe(false);
		expect(isValidEnvelope({ ...base, expand_skills: "true" })).toBe(false);
	});
});
