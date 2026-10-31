import { describe, expect, it, vi } from "vitest";
import type { RelayEndpoints } from "../endpoints";
import { memoryEnvelopeStore, RetryEnvelopeStore } from "../retry-envelope";
import { sendPersistedCommand } from "../send-command";

/** Only the command route is exercised; the fake is typed against the real
 *  contract so a narrowed mock cannot disagree with what the adapter sends. */
const commandClient = (
	behaviour: () => Promise<{ ok: true; detail: string }> = async () => ({
		ok: true as const,
		detail: "prompt admitted",
	}),
) => {
	const command = vi.fn(
		async (
			_sessionId: string,
			_body: Parameters<RelayEndpoints["command"]>[1],
		) => behaviour(),
	);
	const client = { command } as unknown as Pick<RelayEndpoints, "command">;
	return { client, command };
};

const id = "10000000-0000-4000-8000-000000000001";
const nextId = "10000000-0000-4000-8000-000000000002";
const make = () =>
	new RetryEnvelopeStore({
		store: memoryEnvelopeStore(),
		randomUuid: () => nextId,
	});

describe("startup outbox envelope authority", () => {
	it("reimports the immutable ID after helper ACK cleanup, never minting a replacement", async () => {
		const envelopes = make();
		const { client, command } = commandClient();
		const input = {
			client,
			envelopes,
			sessionId: "session-a",
			op: "prompt" as const,
			text: "A",
			envelope: { command_id: id, op: "prompt" as const, text: "A" },
		};
		await sendPersistedCommand(input);
		await sendPersistedCommand(input);
		expect(command.mock.calls.map((call) => call[1].command_id)).toEqual([
			id,
			id,
		]);
	});
	it("refuses to replace another held command, even with equal text", async () => {
		const envelopes = make();
		await envelopes.hold("session-a", {
			command_id: nextId,
			op: "prompt",
			text: "A",
		});
		const { client, command } = commandClient();
		await expect(
			sendPersistedCommand({
				client,
				envelopes,
				sessionId: "session-a",
				op: "prompt",
				text: "A",
				envelope: { command_id: id, op: "prompt", text: "A" },
			}),
		).rejects.toThrow();
		expect(command).not.toHaveBeenCalled();
		expect((await envelopes.peek("session-a"))?.command_id).toBe(nextId);
	});
});
