/**
 * Upload one completed recording, retaining failures for an explicit retry.
 *
 * A failed upload is not consent to delete the reader's speech. The caller owns
 * the retained handle and must discard it on explicit cancel or scope teardown;
 * this module deletes only after a successful (including empty) transcription.
 * Authentication failure keeps its privacy precedence: clear-all still discards
 * before rethrowing to the shared 401 handler. Nothing here schedules a retry.
 *
 * No React, no network.
 */

import { isRelayError } from "@/relay";
import type { MicrophoneRecording } from "@/stt/recorder";
import {
	STT_COPY,
	type TranscribeOutcome,
	transcribeOutcome,
} from "@/stt/transcribe";

/** The raw answer the endpoint hands back, before it is read. */
export interface TranscribeWireResult {
	status: number;
	/** The response body text. */
	text: string;
}

export interface DictateDeps {
	/** Performs `POST /api/transcribe` and returns the raw status and body. */
	transcribe: (
		recording: MicrophoneRecording,
		options?: { signal?: AbortSignal },
	) => Promise<TranscribeWireResult>;
	/** Deletes the local file. Injecting it keeps this module free of the native
	 *  filesystem and lets a test assert the discard happened. */
	discard: (recording: MicrophoneRecording) => Promise<void>;
}

/**
 * Uploads once. Success releases the audio; an ordinary failure leaves the same
 * file available to the caller. A `401` still releases it before rethrowing.
 */
export async function dictate(
	recording: MicrophoneRecording,
	deps: DictateDeps,
	options?: { signal?: AbortSignal },
): Promise<TranscribeOutcome> {
	let wire: TranscribeWireResult | null = null;
	let failure: unknown = null;
	try {
		wire = await deps.transcribe(recording, options);
	} catch (cause) {
		failure = cause;
	}
	if (failure !== null) {
		if (isRelayError(failure) && failure.envelope === "clear-all") {
			await deps.discard(recording);
			throw failure;
		}
		return { kind: "failed", sentence: STT_COPY.retry };
	}
	/* Unreachable: the try assigns `wire` before it can throw and the catch is the
	 * only path that leaves it null. Stated for the type checker, and answered with
	 * the retry sentence rather than a non-null assertion. */
	if (wire === null) return { kind: "failed", sentence: STT_COPY.retry };
	const outcome = transcribeOutcome(wire.status, wire.text);
	if (outcome.kind !== "failed") await deps.discard(recording);
	return outcome;
}
