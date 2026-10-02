import { describe, expect, it } from "vitest";

import { COMPOSER_COPY, composerControls } from "@/features/session/composer";
import {
	composerStateMarkers,
	type SessionStateFacts,
	sessionStateMarkers,
} from "@/features/session/state-marker";
import { EMPTY, STATE_MARKER, SURFACE } from "@/ui/a11y";

/**
 * The state markers, as behaviour rather than as prose.
 *
 * The audit reads a marker as an AFFIRMATIVE claim about the frame, so the two
 * directions both matter: a fact that is true has to leave its marker, and a fact
 * that is false must not. A derivation that only ever emitted one marker would
 * fail the first direction for the cells that declare a state a settled session
 * also has (S5/subagents is populated too), and one that emitted markers for
 * everything would fail the second.
 */

const facts = (over: Partial<SessionStateFacts> = {}): SessionStateFacts => ({
	connected: true,
	streaming: false,
	ended: false,
	error: false,
	pending: null,
	subagents: 0,
	entries: 2,
	...over,
});

describe("sessionStateMarkers", () => {
	it("claims nothing before a projection arrives", () => {
		// The skeleton and the no-route empty state carry their own markers
		// (`SURFACE.sessionLoading`, `EMPTY.session`); a second one here would be the
		// same id twice in the DOM, saying nothing.
		expect(sessionStateMarkers(facts({ connected: false }))).toEqual([]);
	});

	it("affirms the settled session and the roster together", () => {
		// The case the affirmative rule exists for: a populated session with a
		// roster answers S5/populated AND S5/subagents from one frame.
		expect(sessionStateMarkers(facts({ subagents: 3 }))).toEqual([
			STATE_MARKER.sessionSubagents,
			STATE_MARKER.sessionPopulated,
		]);
	});

	it("names the running turn, the ended session and the failure", () => {
		expect(sessionStateMarkers(facts({ streaming: true }))).toContain(
			STATE_MARKER.sessionStreaming,
		);
		expect(sessionStateMarkers(facts({ ended: true }))).toContain(
			STATE_MARKER.sessionEnded,
		);
		expect(sessionStateMarkers(facts({ error: true }))).toContain(
			STATE_MARKER.sessionError,
		);
	});

	it("tells an approval from an ask, and never claims both", () => {
		const approval = sessionStateMarkers(facts({ pending: "approval" }));
		expect(approval).toContain(STATE_MARKER.sessionPendingApproval);
		expect(approval).not.toContain(STATE_MARKER.sessionPendingAsk);

		const ask = sessionStateMarkers(facts({ pending: "ask" }));
		expect(ask).toContain(STATE_MARKER.sessionPendingAsk);
		expect(ask).not.toContain(STATE_MARKER.sessionPendingApproval);
	});

	it("falls back to idle, so a connected session always affirms something", () => {
		expect(sessionStateMarkers(facts({ entries: 0 }))).toEqual([
			STATE_MARKER.sessionIdle,
		]);
	});

	it("does not claim the markers whose facts it cannot phrase", () => {
		// `session-degraded`, `session-aborted`, `session-rich-rows` and
		// `session-queued` are deliberately absent from the derivation (see the
		// module's own note): a marker for a state the facts cannot name is a claim
		// nothing can reach, which is the failure the audit refuses rather than
		// rewards.
		const all = sessionStateMarkers(
			facts({ streaming: true, ended: true, subagents: 2 }),
		);
		expect(all).not.toContain("session-degraded");
		expect(all).not.toContain("session-aborted");
		expect(all).not.toContain("session-rich-rows");
		expect(all).not.toContain("session-queued");
	});

	it("leaves the two states the contract already carried to their own renderers", () => {
		// `session-empty` is `EMPTY.session` and `session-loading` is
		// `SURFACE.sessionLoading`; declaring a second constant for either would put a
		// duplicate in `IDENTIFIERS`, which the namespace check refuses.
		expect(Object.values(STATE_MARKER)).not.toContain(EMPTY.session);
		expect(Object.values(STATE_MARKER)).not.toContain(SURFACE.sessionLoading);
	});
});

describe("composerStateMarkers", () => {
	const input = {
		streaming: false,
		hasDraft: true,
		hasImages: false,
		sending: false,
		envelopePending: false,
		ended: false,
	};

	it("reads the primary's op rather than recomputing it", () => {
		expect(composerStateMarkers(composerControls(input))).toEqual([
			STATE_MARKER.composerIdle,
		]);
		expect(
			composerStateMarkers(composerControls({ ...input, streaming: true })),
		).toEqual([STATE_MARKER.composerSteering]);
	});

	it("prefers the send in flight, and names the ended session", () => {
		expect(
			composerStateMarkers(
				composerControls({ ...input, streaming: true, sending: true }),
			),
		).toEqual([STATE_MARKER.composerSending]);
		const ended = composerControls({ ...input, ended: true });
		expect(ended.disabledReason).toBe(COMPOSER_COPY.endedSession);
		expect(composerStateMarkers(ended)).toEqual([STATE_MARKER.composerEnded]);
	});
});
