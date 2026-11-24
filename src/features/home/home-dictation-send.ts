/**
 * The home composer's send, as it touches dictation (issue #323; round 1, m1).
 *
 * The home's start coordinator decides AFTER the tap whether the message is
 * admitted (`startup-coordinator.ts` `enqueue`: a revoked route, an unconfirmed
 * create, a full queue or a failed draft write each keep the draft and never call
 * back). So the two dictation effects of a send land at different moments:
 *
 * - a LIVE take is dropped, and the drop said, at the tap (design §2.5/U2), the
 *   same as before — a transcript must not land in a draft that is leaving;
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
		cancelForSend: () => void;
		clearOutcome: () => void;
	},
	send: (onAccepted?: () => void) => void,
): void => {
	if (voice.phase !== "idle") {
		voice.cancelForSend();
		send();
		return;
	}
	send(voice.clearOutcome);
};
