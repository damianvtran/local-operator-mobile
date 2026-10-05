import { describe, expect, it } from "vitest";

import {
	DICTATION_OUTCOME_COPY,
	type DictationEvent,
	type DictationSnapshot,
	dictationStatusLine,
	IDLE_DICTATION,
	MIC_HINT,
	mayStartDictation,
	micLabel,
	reduceDictation,
} from "@/stt/dictation-machine";

/** Run one event and return the transition, asserting nothing jumped a state the
 *  machine does not allow. */
const step = (state: DictationSnapshot, event: DictationEvent) =>
	reduceDictation(state, event);

const recording: DictationSnapshot = { phase: "recording", outcome: null };
const transcribing: DictationSnapshot = {
	phase: "transcribing",
	outcome: null,
};
const starting: DictationSnapshot = { phase: "starting", outcome: null };

describe("the dictation machine's phases", () => {
	it("acknowledges a press in the same transition that asks for the microphone", () => {
		// The start-lag fix: the machine leaves `idle` on the press, not on the
		// microphone opening, so the composer can render and announce the state while
		// the permission prompt and the audio session are still pending.
		const { state, effects } = step(IDLE_DICTATION, {
			type: "press",
			sending: false,
		});
		expect(state.phase).toBe("starting");
		expect(effects).toEqual(["open-mic"]);
	});

	it("ignores a second press while the microphone is opening", () => {
		// Otherwise a double tap on the mic opens two recorders and leaks one.
		const { state, effects } = step(starting, {
			type: "press",
			sending: false,
		});
		expect(state.phase).toBe("starting");
		expect(effects).toEqual([]);
	});

	it("only accepts a stop from a live recording", () => {
		expect(step(recording, { type: "stop" }).effects).toEqual([
			"stop-and-transcribe",
		]);
		// A stop from idle or from the open-microphone phase is a no-op; there is
		// nothing to stop and no clip to upload.
		expect(step(IDLE_DICTATION, { type: "stop" }).effects).toEqual([]);
		expect(step(starting, { type: "stop" }).effects).toEqual([]);
	});

	it("only settles a running transcription", () => {
		expect(
			step(transcribing, { type: "settle", outcome: "added" }).state,
		).toEqual({ phase: "idle", outcome: "added" });
		// A settle that arrives after a cancel has nothing to say: the machine is
		// already resting and must not resurrect the outcome.
		expect(
			step(IDLE_DICTATION, { type: "settle", outcome: "added" }).state,
		).toEqual(IDLE_DICTATION);
	});
});

describe("recording while a message is sending (defect 4)", () => {
	it("does NOT gate the mic on a send in flight", () => {
		// The rule this PR exists for. `sending` is an explicit input so the rule has
		// somewhere to live and a test that can fail; the answer must not depend on it.
		const base = {
			phase: "idle" as const,
			micVisible: true,
			hasEndpoints: true,
		};
		expect(mayStartDictation({ ...base, sending: true })).toBe(true);
		expect(mayStartDictation({ ...base, sending: false })).toBe(true);
	});

	it("still refuses a start the mic genuinely cannot make", () => {
		const base = { phase: "idle" as const, sending: true };
		expect(
			mayStartDictation({ ...base, micVisible: false, hasEndpoints: true }),
		).toBe(false);
		expect(
			mayStartDictation({ ...base, micVisible: true, hasEndpoints: false }),
		).toBe(false);
		expect(
			mayStartDictation({
				phase: "recording",
				micVisible: true,
				hasEndpoints: true,
				sending: false,
			}),
		).toBe(false);
	});
});

describe("send cancels an in-flight dictation, and says so (design §2.5/U2)", () => {
	it("discards a live recording and announces the loss", () => {
		const { state, effects } = step(recording, { type: "send" });
		expect(state).toEqual({ phase: "idle", outcome: "discarded" });
		expect(effects).toEqual(["discard-recording"]);
	});

	it("aborts a transcription already on the wire", () => {
		const { state, effects } = step(transcribing, { type: "send" });
		expect(state).toEqual({ phase: "idle", outcome: "discarded" });
		expect(effects).toEqual(["abort-request"]);
	});

	it("says nothing when there was no dictation to lose", () => {
		// Every send runs this path; a line claiming a discard that never happened
		// would be a lie on the common case.
		const { state, effects } = step(IDLE_DICTATION, { type: "send" });
		expect(state).toEqual(IDLE_DICTATION);
		expect(effects).toEqual([]);
	});
});

describe("an explicit cancel sends NO request (design §2.5/U5)", () => {
	it("discards a recording without ever transcribing it", () => {
		const { state, effects } = step(recording, { type: "cancel" });
		expect(effects).toEqual(["discard-recording"]);
		// The load-bearing negative: the cancel path must not also ask for a stop
		// that uploads. This is the defect the assertion exists for.
		expect(effects).not.toContain("stop-and-transcribe");
		expect(state.outcome).toBeNull();
	});

	it("aborts a transcription rather than awaiting it, and stays silent", () => {
		const { state, effects } = step(transcribing, { type: "cancel" });
		expect(effects).toEqual(["abort-request"]);
		expect(effects).not.toContain("stop-and-transcribe");
		// The reader's own discard is not a loss to announce.
		expect(state.outcome).toBeNull();
	});

	it("is a no-op at rest", () => {
		expect(step(IDLE_DICTATION, { type: "cancel" })).toEqual({
			state: IDLE_DICTATION,
			effects: [],
		});
	});

	it("cancels a microphone that is still opening", () => {
		expect(step(starting, { type: "cancel" }).effects).toEqual([
			"discard-recording",
		]);
	});
});

describe("the polite status row's line (design §2.5)", () => {
	it("names every live state", () => {
		expect(dictationStatusLine(starting)).toBe("Starting voice input");
		expect(dictationStatusLine(recording)).toBe("Recording");
		expect(dictationStatusLine(transcribing)).toBe("Transcribing");
	});

	it("carries the three outcome lines verbatim", () => {
		expect(dictationStatusLine({ phase: "idle", outcome: "added" })).toBe(
			DICTATION_OUTCOME_COPY.added,
		);
		expect(dictationStatusLine({ phase: "idle", outcome: "empty" })).toBe(
			DICTATION_OUTCOME_COPY.empty,
		);
		expect(dictationStatusLine({ phase: "idle", outcome: "discarded" })).toBe(
			DICTATION_OUTCOME_COPY.discarded,
		);
	});

	it("spells the sentences the design names, exactly", () => {
		// Pinned as literals, not through the constants: a rename inside the copy
		// table would otherwise keep both sides agreeing on the wrong sentence.
		expect(DICTATION_OUTCOME_COPY.added).toBe("Transcript added");
		expect(DICTATION_OUTCOME_COPY.empty).toBe("Didn't catch that — try again.");
		expect(DICTATION_OUTCOME_COPY.discarded).toBe("Voice input discarded.");
	});

	it("is silent only at rest with no outcome", () => {
		expect(dictationStatusLine(IDLE_DICTATION)).toBe("");
	});
});

describe("the mic's own vocabulary", () => {
	it("names what the control will do in every phase", () => {
		expect(micLabel("idle")).toBe("Start voice input");
		expect(micLabel("starting")).toBe("Starting voice input");
		expect(micLabel("recording")).toBe("Stop and transcribe");
		expect(micLabel("transcribing")).toBe("Transcribing");
	});

	it("has a hint for every state that can act, and none for the waiting one", () => {
		expect(MIC_HINT.idle).toBeTruthy();
		expect(MIC_HINT.recording).toBeTruthy();
		expect(MIC_HINT.transcribing).toBeUndefined();
	});
});
