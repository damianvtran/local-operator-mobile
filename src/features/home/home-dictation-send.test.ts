/**
 * The home composer's send, as it touches dictation (issue #323; round 1, m1).
 *
 * The home's start coordinator can refuse a tap AFTER it is made (a revoked
 * route, an unconfirmed create, a full queue, a draft write that failed): the
 * draft stays, and so must the mic line beside it. Only an ADMITTED message
 * ends a resting line. A live take is still dropped, and said, at the tap (design
 * §2.5/U2), and admission must not then erase that "discarded" line.
 *
 * The voice here is the REAL machine (`reduceDictation`) behind the three calls
 * the helper makes, so each assertion reads the line the reader would see.
 */
import { describe, expect, it } from "vitest";

import { sendFromHome } from "@/features/home/home-dictation-send";
import {
	type DictationSnapshot,
	dictationStatusLine,
	reduceDictation,
} from "@/stt/dictation-machine";

const voiceAt = (start: DictationSnapshot) => {
	let state = start;
	const calls: string[] = [];
	return {
		get phase() {
			return state.phase;
		},
		sendMode:
			start.phase === "recording" || start.phase === "transcribing"
				? ("live" as const)
				: null,
		finishAndSend: () => {
			calls.push("finishAndSend");
		},
		line: () => dictationStatusLine(state),
		calls,
		cancelForSend: () => {
			calls.push("cancelForSend");
			state = reduceDictation(state, { type: "send" }).state;
		},
		clearOutcome: () => {
			calls.push("clearOutcome");
			state = reduceDictation(state, { type: "edit" }).state;
		},
	};
};

/** A coordinator that holds the admission callback until the test decides. */
const coordinator = () => {
	let admit: (() => void) | undefined;
	return {
		send: (onAccepted?: () => void) => {
			admit = onAccepted;
		},
		admit: () => admit?.(),
	};
};

const failed: DictationSnapshot = { phase: "idle", outcome: "mic-failed" };

describe("the home send and a resting mic line", () => {
	it("keeps the line while the coordinator has not admitted the message", () => {
		const voice = voiceAt(failed);
		const start = coordinator();
		sendFromHome(voice, start.send);
		// A refused tap never calls back: the draft stays, and so does its line.
		expect(voice.line()).toBe(
			"Couldn’t start recording. Check your microphone and try again.",
		);
		expect(voice.calls).toEqual([]);
	});

	it("ends the line once the message is admitted", () => {
		const voice = voiceAt(failed);
		const start = coordinator();
		sendFromHome(voice, start.send);
		start.admit();
		expect(voice.line()).toBe("");
	});

	it("sends a recording as 'transcribe and send' instead of dropping it", () => {
		const voice = voiceAt({ phase: "recording", outcome: null });
		const start = coordinator();
		sendFromHome(voice, start.send);
		// The take is finished and its words sent once they land; nothing is
		// discarded, so no "Voice input discarded." and no direct send of the draft.
		expect(voice.calls).toEqual(["finishAndSend"]);
		expect(voice.line()).toBe("Recording");
		start.admit();
		expect(voice.calls).toEqual(["finishAndSend"]);
	});

	it("does nothing for a press already waiting for its transcript", () => {
		const voice = {
			...voiceAt({ phase: "transcribing", outcome: null }),
			sendMode: "pending" as const,
		};
		let sent = 0;
		sendFromHome(voice, () => {
			sent += 1;
		});
		expect(sent).toBe(0);
		expect(voice.calls).toEqual([]);
	});

	it("still drops a take that has not started recording, and says so", () => {
		const voice = voiceAt({ phase: "starting", outcome: null });
		const start = coordinator();
		sendFromHome(voice, start.send);
		expect(voice.calls).toEqual(["cancelForSend"]);
		expect(voice.line()).toBe("Voice input discarded.");
		start.admit();
		expect(voice.line()).toBe("Voice input discarded.");
	});
});
