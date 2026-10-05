/**
 * The composer's dictation lifecycle, as a pure machine.
 *
 * The same division the rest of `stt/` follows: this module owns the RULES — which
 * event is admissible in which state, what the polite status row says, and what a
 * send does to a dictation in flight — and `features/session/use-dictation.ts` owns
 * the React state, the timers, the native handle and the request. Written this way
 * because the rules were previously enforced inside the hook, where the Node test
 * runner cannot reach them (no renderer is installed, deliberately — see
 * `vitest.config.ts`), so the four behaviours this PR exists for had no test that
 * could fail.
 *
 * Two of the rules are why the module is worth its own file rather than a few lines
 * in the hook:
 *
 * - **A send CANCELS a dictation, and says so.** A transcript that lands after the
 *   message it would join has left the composer belongs to the NEXT message, so it
 *   is discarded — never appended to a draft it did not record into. That is design
 *   §2.5/U2, and the line is shown because speech the reader just gave must not
 *   vanish silently. An EXPLICIT cancel is not the same event: it is the reader's
 *   own discard, so it sends no request and says nothing.
 * - **A send in flight does NOT gate the mic.** The next message's transcript is
 *   independent of the one on the wire, so `mayStartDictation` reads `sending` and
 *   deliberately ignores it. The parameter is present so the rule is stated where a
 *   reader looks for it and so a test can pin it, rather than living as a silent
 *   omission in one call site.
 *
 * No React, no React Native, no network.
 */

/** The mic's four resting/active phases. `starting` exists for the measured start
 *  lag: the press is acknowledged in the SAME frame, before the permission prompt
 *  and the native recorder are awaited, so a hold that has not yet opened the
 *  microphone is not silent (see `use-dictation.ts`'s note on the press path). */
export type DictationPhase = "idle" | "starting" | "recording" | "transcribing";

/** The one-line outcome the polite status row announces once a dictation has
 *  ended. `null` is "nothing to say" — a failure carries its own sentence on the
 *  composer's error line and must not also be announced here. */
export type DictationOutcome = "added" | "empty" | "discarded";

export interface DictationSnapshot {
	phase: DictationPhase;
	/** The resting sentence, once the machine is idle again. */
	outcome: DictationOutcome | null;
}

export const IDLE_DICTATION: DictationSnapshot = {
	phase: "idle",
	outcome: null,
};

/**
 * What the machine asks its caller to do. The caller owns the microphone, the
 * timers and the request, so the machine returns these rather than performing them
 * — which is what makes "an explicit cancel sends NO request" an assertion on a
 * returned value instead of a claim about a side effect nobody watched.
 */
export type DictationEffect =
	/** Ask for the microphone and start a native recording. */
	| "open-mic"
	/** Stop the recorder and upload it. */
	| "stop-and-transcribe"
	/** Stop the recorder and delete the file, sending nothing. */
	| "discard-recording"
	/** Abort a transcription already on the wire; its result is dropped. */
	| "abort-request";

export type DictationEvent =
	/** The reader pressed the mic. `sending` is read and ignored (see the header). */
	| { type: "press"; sending: boolean }
	/** The microphone opened: permission granted and the recorder running. */
	| { type: "mic-opened" }
	/** The microphone did not open (permission refused, or no recorder). */
	| { type: "mic-refused" }
	/** Stop the recording and transcribe it — the button, or the 120 s cap. */
	| { type: "stop" }
	/** A transcription ended. `outcome` is what the status row should rest on;
	 *  `null` for a failure, which the error line states in its own words. */
	| { type: "settle"; outcome: DictationOutcome | null }
	/** The reader's own discard: no request, and no line (their action, not a loss). */
	| { type: "cancel" }
	/** A send/steer took the composer: abort, discard, and SAY SO. */
	| { type: "send" };

export interface DictationTransition {
	state: DictationSnapshot;
	effects: DictationEffect[];
}

/** The states in which a dictation is live and can therefore be cancelled. */
const live = (phase: DictationPhase): boolean => phase !== "idle";

/**
 * Whether a mic press may START a recording.
 *
 * `sending` is part of the input and deliberately NOT read: a message on the wire
 * says nothing about whether the next message may be dictated (the defect this
 * fixes — the follow-up flow read as broken because the send was believed to gate
 * the mic). It is a parameter rather than an omission so the rule lives where a
 * reader looks for it AND a test can pin it.
 */
export const mayStartDictation = (input: {
	phase: DictationPhase;
	micVisible: boolean;
	hasEndpoints: boolean;
	sending: boolean;
}): boolean => input.phase === "idle" && input.micVisible && input.hasEndpoints;

/**
 * Advance the machine by one event.
 *
 * Every arm that can leave a recorder hot or a request out names the effect that
 * settles it, so no transition can strand either: `cancel` and `send` both discard
 * the recording, and `send` (or a cancel during `transcribing`) aborts a request
 * already on the wire.
 */
export function reduceDictation(
	state: DictationSnapshot,
	event: DictationEvent,
): DictationTransition {
	const { phase } = state;
	switch (event.type) {
		case "press":
			/* A press is ignored unless the machine is resting. While `starting` a
			 * second press must not open a second microphone; while `recording` the
			 * control morphs to stop and does not come through here at all. */
			return phase === "idle"
				? { state: { phase: "starting", outcome: null }, effects: ["open-mic"] }
				: { state, effects: [] };

		case "mic-opened":
			return phase === "starting"
				? { state: { phase: "recording", outcome: null }, effects: [] }
				: { state, effects: [] };

		case "mic-refused":
			return phase === "starting"
				? { state: IDLE_DICTATION, effects: [] }
				: { state, effects: [] };

		case "stop":
			return phase === "recording"
				? {
						state: { phase: "transcribing", outcome: null },
						effects: ["stop-and-transcribe"],
					}
				: { state, effects: [] };

		case "settle":
			return phase === "transcribing"
				? { state: { phase: "idle", outcome: event.outcome }, effects: [] }
				: { state, effects: [] };

		case "cancel": {
			if (!live(phase)) return { state: IDLE_DICTATION, effects: [] };
			/* No request on this path, ever: a recording is discarded, and a
			 * transcription already on the wire is aborted rather than awaited. The
			 * cancelled outcome is deliberately `null` — the reader's own discard
			 * needs no announcement. */
			return {
				state: IDLE_DICTATION,
				effects:
					phase === "transcribing" ? ["abort-request"] : ["discard-recording"],
			};
		}

		case "send": {
			if (!live(phase)) return { state, effects: [] };
			/* U2: the send is not a deliberate cancel, so the drop is SAID. */
			return {
				state: { phase: "idle", outcome: "discarded" },
				effects:
					phase === "transcribing" ? ["abort-request"] : ["discard-recording"],
			};
		}
	}
}

/** The copy the outcome lines own. The three sentences are design §2.5's, verbatim. */
export const DICTATION_OUTCOME_COPY = {
	/** U3: a landed transcript. Focus is deliberately NOT returned to the field. */
	added: "Transcript added",
	/** D2: a landed but blank transcript (or a stop that captured nothing). */
	empty: "Didn't catch that — try again.",
	/** U2: speech dropped because a send took the composer. */
	discarded: "Voice input discarded.",
} as const;

/**
 * The polite status row's line, for every state the machine can be in.
 *
 * One function rather than a per-phase ternary at the call site because the row is
 * `role="status"` (design §2.5): what it says IS the announcement a screen reader
 * gets, so a phase that renders but says nothing is a state a blind reader cannot
 * perceive. The empty string is the only "nothing" and it is reserved for a resting
 * machine with no outcome.
 */
export const dictationStatusLine = (state: DictationSnapshot): string => {
	switch (state.phase) {
		case "starting":
			return "Starting voice input";
		case "recording":
			return "Recording";
		case "transcribing":
			return "Transcribing";
		case "idle":
			return state.outcome === null
				? ""
				: DICTATION_OUTCOME_COPY[state.outcome];
	}
};

/** The mic's accessible name per state. The control MORPHS, so a label that named
 *  only "record" would lie once it is the control that stops. */
export const micLabel = (phase: DictationPhase): string =>
	phase === "recording"
		? "Stop and transcribe"
		: phase === "transcribing"
			? "Transcribing"
			: phase === "starting"
				? "Starting voice input"
				: "Start voice input";

/** The mic's accessibility hint per state. `undefined` is "nothing further to say". */
export const MIC_HINT: Record<DictationPhase, string | undefined> = {
	idle: "Record a voice message to append to the draft",
	starting: "Waiting for the microphone",
	recording: "Stops the recording and transcribes it",
	transcribing: undefined,
};
