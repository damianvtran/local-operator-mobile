// biome-ignore-all lint/style/noNonNullAssertion: an assertion after a length or
// definedness guard is the guard; a longhand local for it would obscure it.
/**
 * The dictation flow: the upload happens once, and the local recording is
 * DISCARDED after it — on success, on a refusal, and on a re-thrown `401`.
 *
 * The discard is the design's hard requirement (the phone must not become the
 * retention point the daemon is not), so it is asserted on every arm, including
 * the one where the upload never produced an answer.
 */

import { describe, expect, it } from "vitest";

import { RelayError } from "@/relay";
import { dictate, type TranscribeWireResult } from "@/stt/dictate";
import type { MicrophoneRecording } from "@/stt/recorder";
import { STT_COPY } from "@/stt/transcribe";

const RECORDING: MicrophoneRecording = {
	uri: "file:///tmp/recording.m4a",
	mimeType: "audio/mp4",
	name: "recording.m4a",
	durationMs: 1200,
};

/** Records the ORDER of the two calls so "discard after upload" is asserted, not
 *  just the discard's occurrence. */
function harness(transcribe: () => Promise<TranscribeWireResult>): {
	deps: Parameters<typeof dictate>[1];
	order: string[];
	discarded: number;
} {
	const order: string[] = [];
	const state = { discarded: 0 };
	return {
		order,
		get discarded() {
			return state.discarded;
		},
		deps: {
			transcribe: async () => {
				order.push("transcribe");
				return transcribe();
			},
			discard: async () => {
				order.push("discard");
				state.discarded += 1;
			},
		},
	};
}

describe("dictate", () => {
	it("returns the transcript and discards the recording after the upload", async () => {
		const h = harness(async () => ({
			status: 200,
			text: JSON.stringify({ text: "hello", path: "provider_stt_radient" }),
		}));
		const outcome = await dictate(RECORDING, h.deps);
		expect(outcome).toEqual({
			kind: "transcript",
			text: "hello",
			path: "provider_stt_radient",
		});
		expect(h.discarded).toBe(1);
		expect(h.order).toEqual(["transcribe", "discard"]);
	});

	it("discards even when the transcript is empty", async () => {
		const h = harness(async () => ({
			status: 200,
			text: JSON.stringify({ text: "" }),
		}));
		expect(await dictate(RECORDING, h.deps)).toEqual({ kind: "empty" });
		expect(h.discarded).toBe(1);
	});

	it("discards and reports the sentence on a refusal", async () => {
		const h = harness(async () => ({
			status: 422,
			text: JSON.stringify({ error: "Unsupported audio format: text/plain." }),
		}));
		expect(await dictate(RECORDING, h.deps)).toEqual({
			kind: "failed",
			sentence: "Unsupported audio format: text/plain.",
		});
		expect(h.discarded).toBe(1);
	});

	it("discards and answers the retry sentence on a transport failure", async () => {
		const h = harness(async () => {
			throw new Error("network down");
		});
		expect(await dictate(RECORDING, h.deps)).toEqual({
			kind: "failed",
			sentence: STT_COPY.retry,
		});
		expect(h.discarded).toBe(1);
	});

	it("re-throws a 401 (the shared reload rule) but still discards the recording", async () => {
		const unauthorized = new RelayError("relay-unauthorized", "auth required", {
			status: 401,
		});
		expect(unauthorized.envelope).toBe("clear-all");
		const h = harness(async () => {
			throw unauthorized;
		});
		await expect(dictate(RECORDING, h.deps)).rejects.toBe(unauthorized);
		expect(h.discarded).toBe(1);
		expect(h.order).toEqual(["transcribe", "discard"]);
	});

	it("passes the abort signal through to the upload", async () => {
		const seen: (AbortSignal | undefined)[] = [];
		const controller = new AbortController();
		await dictate(
			RECORDING,
			{
				transcribe: async (_recording, options) => {
					seen.push(options?.signal);
					return { status: 200, text: JSON.stringify({ text: "x" }) };
				},
				discard: async () => undefined,
			},
			{ signal: controller.signal },
		);
		expect(seen[0]).toBe(controller.signal);
	});
});
