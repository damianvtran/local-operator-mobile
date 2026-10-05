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
 *
 * **This path is single-flight per session.** Two calls in the same tick — a
 * double-tap that lands before the composer disables its button, two composers on
 * one session, a timer-driven retry — would otherwise both read an empty envelope
 * slot (`holdNew` reads before it writes) and mint two `command_id`s, and the real
 * daemon then runs the instruction TWICE. That is precisely the duplicated
 * instruction this module exists to prevent, so it is fixed here rather than left
 * to each caller:
 *
 * - a second call carrying the SAME bytes joins the unresolved send and shares
 *   its outcome — one request, one id, one admitted instruction;
 * - a second call carrying DIFFERENT bytes waits for the unresolved send and then
 *   runs normally. "Wait" must not become "silently drop what the user typed".
 * - unless the send it waited on OVERLAPPED it and failed AMBIGUOUSLY: its delivery
 *   is unknown and its envelope is still held, so a different instruction must not
 *   take that slot. `holdNew` would hand it the held envelope and the wire would
 *   carry the earlier instruction's bytes again — de-duplicated, so nothing runs
 *   twice, but the caller's own draft would be replaced by one it never issued.
 *   The waiter is refused with `ambiguous-delivery` instead, naming the unresolved
 *   instruction, and the composer re-offers the draft. A DEFINITIVE failure clears
 *   the envelope and the waiter proceeds with a fresh id, which is why the two kinds
 *   are distinguished rather than lumped together.
 *
 * **That refusal needs the two calls to overlap, and saying so is part of the
 * contract.** A LATE re-send — the ordinary composer flow, where the user edits and
 * taps again after the first failure has already surfaced — does not take that path
 * at all: the ambiguous send has left the registry by then, `holdNew` hands back the
 * held envelope, and the result is `reusedPreviousDraft: true` with the EARLIER
 * instruction on the wire. The safety property holds there too, by a different
 * mechanism: `hold` writes an envelope's id and its bytes together and only `runSend`
 * sends them, so no path puts different bytes under the earlier id. What the composer
 * owes the user in both cases is a visible affordance for `reusedPreviousDraft`.
 *
 * The join window is the request's own lifetime (the HTTP layer's 20 s deadline),
 * which keeps it narrow on purpose: two identical sends further apart than that
 * are two instructions, not one double-tap.
 */

import type { InputMode, PromptImage } from "../contracts";
import type { RelayEndpoints } from "./endpoints";
import { isRelayError, RelayError, transportError } from "./errors";
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

export interface SendCommandInput {
	client: Pick<RelayEndpoints, "command">;
	envelopes: RetryEnvelopeStore;
	sessionId: string;
	op: ContinuationOp;
	text: string;
	images?: PromptImage[];
	/** The silent annotation (design §2.1): `input_mode` and, when a dictation ran,
	 *  the `input_path` the transcribe response returned. Part of the instruction's
	 *  identity, so it is stored WITH the envelope and replayed on a retry. */
	input_mode?: InputMode;
	input_path?: string;
}

/** One send's outcome as a VALUE rather than a rejection. The promise carrying it
 *  is shared by every caller of the same instruction, and a promise that rejected
 *  cannot be awaited twice without an unhandled-rejection warning. */
type Settled =
	| { ok: true; result: SendResult }
	| { ok: false; error: RelayError };

/** The unresolved send for one session. */
interface InFlightSend {
	/** The exact bytes, so a concurrent duplicate is recognised as one. */
	payload: string;
	/** Resolves to the settled outcome once this send's envelope work is done.
	 *  Never rejects, so any number of callers may await it. */
	finished: Promise<Settled>;
}

/**
 * Keyed by the envelope store, not by session id alone: the single slot a send
 * protects belongs to one store, and two stores (two routes, two tests) must not
 * queue behind each other. A `WeakMap` scopes it that way with nothing to
 * unsubscribe and nothing to leak.
 */
const inFlightByStore = new WeakMap<
	RetryEnvelopeStore,
	Map<string, InFlightSend>
>();

function registryFor(envelopes: RetryEnvelopeStore): Map<string, InFlightSend> {
	const existing = inFlightByStore.get(envelopes);
	if (existing) return existing;
	const created = new Map<string, InFlightSend>();
	inFlightByStore.set(envelopes, created);
	return created;
}

/** The instruction's identity as the wire sees it. The image fields are ordered
 *  here rather than read from the caller's object, so two callers that built the
 *  same image with its fields in a different order are still one instruction. */
function payloadKeyOf(input: SendCommandInput): string {
	return JSON.stringify([
		input.op,
		input.text,
		(input.images ?? []).map((image) => [image.mime_type, image.data_b64]),
		/* The annotation is part of the body's identity: two sends that differ only
		 * in how they were produced must not be joined as one instruction. */
		input.input_mode ?? null,
		input.input_path ?? null,
	]);
}

function begin(
	input: SendCommandInput,
	registry: Map<string, InFlightSend>,
	predecessor: InFlightSend | undefined,
	payload: string,
): InFlightSend {
	const finished = (async (): Promise<Settled> => {
		if (predecessor) {
			const settled = await predecessor.finished;
			/* A DIFFERENT instruction must not take the single envelope slot while the
			 * send it waited on has an UNKNOWN delivery: `holdNew` would return that
			 * held envelope and put the earlier instruction's bytes on the wire again
			 * under its id. Nothing runs twice — the relay de-duplicates the replay —
			 * but the caller that lost the race would have its own draft silently
			 * replaced by an instruction it never issued, which is the outcome this
			 * guard makes explicit. A DEFINITIVE failure has already cleared the
			 * envelope, so that waiter proceeds with a fresh id. */
			if (
				predecessor.payload !== payload &&
				!settled.ok &&
				settled.error.envelope === "keep"
			) {
				return {
					ok: false,
					error: unresolvedPredecessor(settled.error, input.sessionId),
				};
			}
		}
		try {
			return { ok: true, result: await runSend(input) };
		} catch (cause) {
			return {
				ok: false,
				error: isRelayError(cause)
					? cause
					: transportError(cause, "send command"),
			};
		}
	})();
	const entry: InFlightSend = { payload, finished };
	registry.set(input.sessionId, entry);
	void finished.then(() => {
		/* Cleared by IDENTITY: an earlier send finishing late must not remove the
		 * entry a later one has since registered for the same session. */
		if (registry.get(input.sessionId) === entry)
			registry.delete(input.sessionId);
	});
	return entry;
}

function outcomeOf(settled: Settled): SendResult {
	if (settled.ok) return settled.result;
	throw settled.error;
}

/** The outcome for a caller whose DIFFERENT instruction waited on one whose
 *  delivery is still unknown. It never reaches the wire: either it would reuse the
 *  earlier instruction's id for other bytes, or it would mint a second id while the
 *  first may still be admitted. `envelope: "keep"` is deliberate — the held
 *  envelope belongs to the unresolved instruction and the caller's next move is to
 *  retry THAT one (same id, de-duplicated) or discard it.
 *
 * `retry: "never"` is stated explicitly for this caller rather than left to the
 * taxonomy's row: `same-id` is right for a caller that minted an envelope, and this
 * one never did — the instruction to retry is the held one, which the diagnostic
 * names. A retry here would be a NEW instruction, not a replay. */
function unresolvedPredecessor(
	cause: RelayError,
	sessionId: string,
): RelayError {
	return new RelayError(
		"ambiguous-delivery",
		"an earlier instruction on this session has an unknown outcome, so this one was not sent",
		{
			diagnostic: `a different instruction waited for a send whose delivery is unknown; the instruction to retry is the one held for session ${sessionId}`,
			retry: "never",
			envelope: "keep",
			cause,
		},
	);
}

/**
 * Holds, sends and settles one instruction, joining or waiting for an unresolved
 * send on the same session (see the header).
 */
export async function sendPersistedCommand(
	input: SendCommandInput,
): Promise<SendResult> {
	const registry = registryFor(input.envelopes);
	const unresolved = registry.get(input.sessionId);
	const payload = payloadKeyOf(input);
	if (unresolved && unresolved.payload === payload) {
		/* The same instruction: join it. The joiner's own bytes ARE what is being
		 * sent, so `reusedPreviousDraft` stays false — nothing was discarded. */
		return outcomeOf(await unresolved.finished);
	}
	return outcomeOf(await begin(input, registry, unresolved, payload).finished);
}

/** The one place an envelope is held, sent and settled. */
async function runSend(input: SendCommandInput): Promise<SendResult> {
	const { client, envelopes, sessionId } = input;
	const held = await envelopes.holdNew(
		sessionId,
		input.op,
		input.text,
		input.images,
		{ input_mode: input.input_mode, input_path: input.input_path },
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
			/* From the ENVELOPE, not from `input`: a replayed envelope carries the
			 * annotation it was retained with, so a retry sends identical bytes. */
			...(envelope.input_mode !== undefined
				? { input_mode: envelope.input_mode }
				: {}),
			...(envelope.input_path !== undefined
				? { input_path: envelope.input_path }
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
