/**
 * The dictation flow, minus the platform and the screen: upload a stopped
 * recording and — always — discard it.
 *
 * The one rule this module exists to guarantee is the design's hard requirement:
 * **discard the local recording after upload.** The web composer replaces the blob
 * with the returned text; the phone must too, or the phone becomes the retention
 * point the daemon is not. So the discard happens exactly once, after the upload
 * has settled, on success AND on every failure — including the re-thrown `401`,
 * which would otherwise leak the file on its way to the sign-out handler.
 *
 * The second rule is the shared auth rule: a `401` is not this module's to
 * swallow. The relay transport classifies it as `relay-unauthorized` with
 * `envelope: "clear-all"` (the identity that owned the scoped storage is gone), so
 * it is re-thrown for the app's one 401 handler rather than rendered as a
 * transcription failure. Every OTHER transport failure means "no answer" and gets
 * the design's retry sentence.
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
 * Uploads one recording and returns the outcome, discarding the file either way.
 *
 * A `401` (`envelope: "clear-all"`) is re-thrown after the discard; every other
 * thrown failure is the retry sentence.
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
	/* The hard requirement, in the one place no arm can skip: the file is gone
	 * once the upload has settled, whatever it settled to. */
	await deps.discard(recording);
	if (failure !== null) {
		if (isRelayError(failure) && failure.envelope === "clear-all")
			throw failure;
		return { kind: "failed", sentence: STT_COPY.retry };
	}
	/* Unreachable: the try assigns `wire` before it can throw and the catch is the
	 * only path that leaves it null. Stated for the type checker, and answered with
	 * the retry sentence rather than a non-null assertion. */
	if (wire === null) return { kind: "failed", sentence: STT_COPY.retry };
	return transcribeOutcome(wire.status, wire.text);
}
