/**
 * Sending a `prompt`/`steer` through the persisted retry envelope.
 *
 * This is the one place the two halves meet — the endpoint that performs the
 * request and the store that remembers the instruction — so "hold, send, settle"
 * is written once instead of being re-derived by every composer. The rules it
 * applies are the store's and the error taxonomy's, not its own: it decides
 * nothing about which failures keep an envelope (`RelayError.envelope` does).
 *
 * The property that matters: a retry after an unknown outcome replays the SAME
 * `command_id`. The relay answers `already admitted` for an id it has seen, so a
 * lost acknowledgement costs one extra round trip and never a duplicate turn.
 */

import type { PromptImage } from "../contracts";
import type { RelayEndpoints } from "./endpoints";
import { isRelayError, transportError } from "./errors";
import type { ContinuationOp, RetryEnvelopeStore } from "./retry-envelope";

export interface SendResult {
	/** The relay's own sentence: `prompt admitted`, or `already admitted` on a
	 *  replay of an id it had seen. */
	detail: string;
	/** True when an earlier unresolved envelope was replayed INSTEAD of `text`. The
	 *  composer must tell the user, or the new draft vanishes without a word. */
	reusedPreviousDraft: boolean;
	commandId: string;
}

export async function sendPersistedCommand(input: {
	client: Pick<RelayEndpoints, "command">;
	envelopes: RetryEnvelopeStore;
	sessionId: string;
	op: ContinuationOp;
	text: string;
	images?: PromptImage[];
}): Promise<SendResult> {
	const { client, envelopes, sessionId } = input;
	const held = await envelopes.holdNew(
		sessionId,
		input.op,
		input.text,
		input.images,
	);
	const { envelope } = held;
	try {
		const ack = await client.command(sessionId, {
			op: envelope.op,
			command_id: envelope.command_id,
			text: envelope.text,
			...(envelope.images && envelope.images.length > 0
				? { images: envelope.images }
				: {}),
		});
		await envelopes.settle(sessionId, { kind: "ack" });
		return {
			detail: ack.detail,
			reusedPreviousDraft: held.reused,
			commandId: envelope.command_id,
		};
	} catch (cause) {
		/* Anything that is not already a classified error is a transport failure:
		 * the request may or may not have arrived, which is the keep case. */
		const error = isRelayError(cause)
			? cause
			: transportError(cause, "send command");
		await envelopes.settle(sessionId, { kind: "failed", error });
		throw error;
	}
}
