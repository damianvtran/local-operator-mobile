import {
	COMPOSER_COPY,
	type ComposerControls,
} from "@/features/session/composer";
import { STATE_MARKER } from "@/ui/a11y";

/**
 * The session view's state markers, derived in one place.
 *
 * The design audit captures each cell as a frame and has to decide whether that
 * frame is EVIDENCE for the state the cell declares. Its rule is affirmative —
 * a cell declaring `<screen>/<state>` must carry the marker `<subject>-<state>` in
 * the DOM — because a rule that could only prohibit (`a populated cell must not
 * show *-empty`) was satisfied, measurably, by a page that was nothing in
 * particular. `src/ui/a11y.ts` declares the names; this module decides which of
 * them the current facts have earned.
 *
 * **Several markers at once is the point, not a bug.** A session can be populated
 * AND have a roster (S5/subagents) or be populated AND streaming (S5/streaming),
 * and each cell asserts only its own marker, so rendering the whole true set is
 * what lets one screen answer for several cells. The one thing not to do is
 * render a marker for a fact that is not true: the audit treats a marker as a
 * claim, and a wrong claim is worse than a missing one.
 *
 * The states this does NOT derive, and why, rather than a marker nothing can
 * reach:
 *
 *  - `session-degraded` (`projection.degraded`): the app reads the receipt, but the
 *    mock relay nulls `subagents_*` for the degraded scenario instead of setting
 *    the flag, so no scenario produces the state the app names.
 *  - `session-aborted` / `session-rich-rows`: renderings of a projection whose
 *    distinguishing fact (`stop_reason === "aborted"`, a row carrying an image or a
 *    tool block) is not carried by this view's facts, and no marker should claim
 *    what the facts cannot phrase.
 *  - `session-queued`: the queue lives in the composer's own state, so it is the
 *    composer that can affirm it (`composerStateMarkers` below is where the
 *    composer's facts are phrased), not this derivation.
 */
export interface SessionStateFacts {
	/** A projection has arrived: the session is connected, whatever else is true. */
	connected: boolean;
	/** A turn is running — the wire is still sending rows for it. */
	streaming: boolean;
	/** The turn ended and the session is over. */
	ended: boolean;
	/** The stream failed, or the route was refused. */
	error: boolean;
	/** The card the reader is being asked to answer, if any. `projection.pending`'s
	 *  kind, not the card's rendering. */
	pending: "approval" | "ask" | null;
	/** How many subagents the roster reports. */
	subagents: number;
	/** How many transcript rows the projection has. */
	entries: number;
}

/** Every state marker the facts earn, in a stable order. */
export const sessionStateMarkers = (facts: SessionStateFacts): string[] => {
	/* Nothing has arrived: the screen renders its skeleton (`SURFACE.sessionLoading`)
	 *  or its empty state (`EMPTY.session`) and either one is already the marker for
	 *  that state. Adding a derivation marker here would put the same id in the DOM
	 *  twice and say nothing new. */
	if (!facts.connected) return [];

	const markers: string[] = [];
	if (facts.error) markers.push(STATE_MARKER.sessionError);
	if (facts.streaming) markers.push(STATE_MARKER.sessionStreaming);
	if (facts.ended) markers.push(STATE_MARKER.sessionEnded);
	if (facts.pending === "approval") {
		markers.push(STATE_MARKER.sessionPendingApproval);
	} else if (facts.pending === "ask") {
		markers.push(STATE_MARKER.sessionPendingAsk);
	}
	if (facts.subagents > 0) markers.push(STATE_MARKER.sessionSubagents);
	if (facts.entries > 0) markers.push(STATE_MARKER.sessionPopulated);
	/* The fallback, so a connected session always affirms SOMETHING: a screen with a
	 *  root and no state marker is the case the affirmative rule exists to refuse. */
	if (markers.length === 0) markers.push(STATE_MARKER.sessionIdle);
	return markers;
};

/**
 * The composer's own states, from the one control that morphs.
 *
 * `composerControls` already decides the primary's op, whether a send is in
 * flight and why it is blocked; this reads that decision rather than recomputing
 * it at a second moment, which is the bug `chooseOp`'s own comment warns about.
 * The alert slots are not here: `composer-notice`, `composer-error` and
 * `composer-retained` are surfaces, rendered by the alert that carries them, so
 * they are already affirmative.
 */
export const composerStateMarkers = (controls: ComposerControls): string[] => {
	if (controls.sending) return [STATE_MARKER.composerSending];
	if (controls.disabledReason === COMPOSER_COPY.endedSession) {
		return [STATE_MARKER.composerEnded];
	}
	if (controls.primary.kind === "steer") return [STATE_MARKER.composerSteering];
	return [STATE_MARKER.composerIdle];
};
