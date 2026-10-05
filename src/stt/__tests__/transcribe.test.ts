// biome-ignore-all lint/style/noNonNullAssertion: the assertions are the guard —
// a fixture whose shape is asserted then indexed is exactly what a test is for.
/**
 * Each `POST /api/transcribe` status mapped to its sentence.
 *
 * The two rules that matter: the daemon's own sentence is preferred where it
 * exists (so a rewrite on the relay side is not fought by a second copy here), and
 * `502` never surfaces the upstream body — it is routed to the app's retry
 * sentence. A malformed success is refused, never coerced to `""`.
 */

import { describe, expect, it } from "vitest";

import { STT_COPY, transcribeOutcome } from "@/stt/transcribe";

describe("transcribeOutcome", () => {
	it("reads a success into text and the returned path", () => {
		const outcome = transcribeOutcome(
			200,
			JSON.stringify({
				text: "hello there",
				provider: "radient",
				model: "whisper-1",
				path: "provider_stt_radient",
			}),
		);
		expect(outcome).toEqual({
			kind: "transcript",
			text: "hello there",
			path: "provider_stt_radient",
		});
	});

	it("reads an absent path as empty, so the caller stores absence", () => {
		const outcome = transcribeOutcome(
			200,
			JSON.stringify({ text: "hi", provider: "radient", path: null }),
		);
		expect(outcome).toEqual({ kind: "transcript", text: "hi", path: "" });
	});

	it("answers a blank transcript with the empty arm", () => {
		expect(
			transcribeOutcome(200, JSON.stringify({ text: "", path: "p" })),
		).toEqual({ kind: "empty" });
		expect(
			transcribeOutcome(200, JSON.stringify({ text: "   ", path: "p" })),
		).toEqual({ kind: "empty" });
	});

	it("refuses a malformed success instead of coercing it to ''", () => {
		expect(transcribeOutcome(200, "not json")).toEqual({
			kind: "failed",
			sentence: STT_COPY.malformed,
		});
		expect(transcribeOutcome(200, JSON.stringify({ path: "p" }))).toEqual({
			kind: "failed",
			sentence: STT_COPY.malformed,
		});
		expect(
			transcribeOutcome(200, JSON.stringify({ text: 42, path: "p" })),
		).toEqual({ kind: "failed", sentence: STT_COPY.malformed });
	});

	it("prefers the daemon's own sentence for 413/422/402/503/500", () => {
		const body = (sentence: string) => JSON.stringify({ error: sentence });
		expect(transcribeOutcome(413, body("too big"))).toEqual({
			kind: "failed",
			sentence: "too big",
		});
		expect(transcribeOutcome(422, body("bad mime"))).toEqual({
			kind: "failed",
			sentence: "bad mime",
		});
		expect(transcribeOutcome(402, body("out of credit"))).toEqual({
			kind: "failed",
			sentence: "out of credit",
		});
		expect(
			transcribeOutcome(
				503,
				JSON.stringify({
					error: "Voice input isn't available on this machine.",
					code: "stt_unavailable",
				}),
			),
		).toEqual({
			kind: "failed",
			sentence: "Voice input isn't available on this machine.",
		});
		expect(transcribeOutcome(500, body("boom"))).toEqual({
			kind: "failed",
			sentence: "boom",
		});
	});

	it("falls back to app copy when a refusal body carries no sentence", () => {
		expect(transcribeOutcome(413, "")).toEqual({
			kind: "failed",
			sentence: STT_COPY.tooLarge,
		});
		expect(transcribeOutcome(422, "<html>")).toEqual({
			kind: "failed",
			sentence: STT_COPY.badAudio,
		});
		expect(transcribeOutcome(503, "{}")).toEqual({
			kind: "failed",
			sentence: STT_COPY.unavailable,
		});
		expect(transcribeOutcome(500, "")).toEqual({
			kind: "failed",
			sentence: STT_COPY.failed,
		});
	});

	it("never surfaces an upstream payload on a 502", () => {
		/* Even when the body carries a sentence, it is not shown — the design routes
		 * 502 to the retry sentence because the body is upstream text. */
		expect(
			transcribeOutcome(502, JSON.stringify({ error: "upstream said: 429" })),
		).toEqual({ kind: "failed", sentence: STT_COPY.retry });
		expect(transcribeOutcome(502, "gateway timeout")).toEqual({
			kind: "failed",
			sentence: STT_COPY.retry,
		});
	});
});
