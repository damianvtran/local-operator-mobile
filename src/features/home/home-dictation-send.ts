/**
 * The home composer's send, as it touches dictation (issue #323; round 1, m1).
 *
 * The home's start coordinator decides AFTER the tap whether the message is
 * admitted (`startup-coordinator.ts` `enqueue`: a revoked route, an unconfirmed
 * create, a full queue or a failed draft write each keep the draft and never call
 * back). So the two dictation effects of a send land at different moments:
 *
 * - a recording or transcribing take is TRANSCRIBED AND SENT: Send stops it and
 *   the words go out once they are in the draft (`useDictatedSend`), the relay's
 *   "send recording";
 * - any other live take (`starting`: nothing is recorded yet) is dropped, and
 *   the drop said, at the tap (design §2.5/U2) — a transcript must not land in a
 *   draft that is leaving;
 * - a RESTING line ends only on admission, which is the session composer's order
 *   (it clears after its own refusals). A refused tap keeps the draft, so it keeps
 *   the line beside it. Admission after a live drop does nothing further, so the
 *   "Voice input discarded." line stays said.
 *
 * Pure, so the Node runner can drive it with the real machine behind the calls.
 */
export const sendFromHome = (
	voice: {
		readonly phase: string;
		/** What Send does with a dictation in flight (`DictatedSend`). */
		readonly sendMode: "live" | "pending" | null;
		finishAndSend: () => void;
		cancelForSend: () => void;
		clearOutcome: () => void;
	},
	send: (onAccepted?: () => void) => void,
): void => {
	/* Send while dictating is "transcribe and send", never a discard: the words
	 * are sent once they are in the draft (`useDictatedSend`), and a press that is
	 * already waiting for them is inert. */
	if (voice.sendMode !== null) {
		if (voice.sendMode === "live") voice.finishAndSend();
		return;
	}
	if (voice.phase !== "idle") {
		voice.cancelForSend();
		send();
		return;
	}
	send(voice.clearOutcome);
};
