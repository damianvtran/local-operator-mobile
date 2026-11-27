// biome-ignore-all lint/style/noNonNullAssertion: an assertion after a length or
// definedness guard is the guard; a longhand local for it would obscure it.
/**
 * The dictation flow: each call uploads once. Successful/empty transcriptions
 * release the file; ordinary failures retain it for a manual retry. A 401 still
 * deletes before rethrowing — recovery never crosses an authentication boundary.
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

	it("retains the recording and reports the sentence on a refusal", async () => {
		const h = harness(async () => ({
			status: 422,
			text: JSON.stringify({ error: "Unsupported audio format: text/plain." }),
		}));
		expect(await dictate(RECORDING, h.deps)).toEqual({
			kind: "failed",
			sentence: "Unsupported audio format: text/plain.",
		});
		expect(h.discarded).toBe(0);
	});

	it("retains the same recording for a manual retry after transport failure", async () => {
		const h = harness(async () => {
			throw new Error("network down");
		});
		expect(await dictate(RECORDING, h.deps)).toEqual({
			kind: "failed",
			sentence: STT_COPY.retry,
		});
		expect(h.discarded).toBe(0);
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

	it("retains malformed success audio instead of treating it as a completed take", async () => {
		const h = harness(async () => ({ status: 200, text: "not json" }));
		expect(await dictate(RECORDING, h.deps)).toEqual({
			kind: "failed",
			sentence: STT_COPY.malformed,
		});
		expect(h.discarded).toBe(0);
	});

	it("uploads exactly the retained recording on an explicit second call", async () => {
		const seen: MicrophoneRecording[] = [];
		let calls = 0;
		const h = harness(async () => ({
			status: 200,
			text: JSON.stringify({ text: "recovered" }),
		}));
		const deps = {
			...h.deps,
			transcribe: async (rec: MicrophoneRecording) => {
				seen.push(rec);
				if (++calls === 1) throw new Error("synthetic network failure");
				return h.deps.transcribe(rec);
			},
		};
		expect((await dictate(RECORDING, deps)).kind).toBe("failed");
		expect(seen).toEqual([RECORDING]);
		expect(h.discarded).toBe(0);
		expect((await dictate(RECORDING, deps)).kind).toBe("transcript");
		expect(seen).toEqual([RECORDING, RECORDING]);
		expect(seen[0]).toBe(seen[1]);
		expect(h.discarded).toBe(1);
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
