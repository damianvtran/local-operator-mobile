import { describe, expect, it } from "vitest";

import { COMPOSER_COPY, composerControls } from "@/features/session/composer";
import {
	composerStateFlags,
	type SessionStateFacts,
	sessionStateFlags,
} from "@/features/session/state-marker";
import { EMPTY, STATE_MARKER, SURFACE } from "@/ui/a11y";

/**
 * Which states are affirmed, as behaviour rather than as prose.
 *
 * The audit reads a marker as an AFFIRMATIVE claim about the frame, so both
 * directions matter: a fact that is true has to leave its marker, and a fact that
 * is false must not. A function that only ever affirmed one state would fail the
 * first direction for the cells a settled session also satisfies (S5/subagents is
 * populated too), and one that affirmed everything would fail the second.
 */

const facts = (over: Partial<SessionStateFacts> = {}): SessionStateFacts => ({
	connected: true,
	streaming: false,
	ended: false,
	aborted: false,
	error: false,
	degraded: false,
	queued: 0,
	richRows: false,
	pending: null,
	subagents: 0,
	entries: 2,
	...over,
});

const flagged = (over: Partial<SessionStateFacts> = {}): string[] =>
	Object.entries(sessionStateFlags(facts(over)))
		.filter(([, value]) => value)
		.map(([key]) => key)
		.sort();

const capitalise = (key: string): string =>
	`${key[0]?.toUpperCase() ?? ""}${key.slice(1)}`;

describe("sessionStateFlags", () => {
	it("claims nothing before a projection arrives", () => {
		// The skeleton and the no-route empty state carry their own markers
		// (`SURFACE.sessionLoading`, `EMPTY.session`); a second one here would be the
		// same id twice in the DOM, saying nothing.
		expect(flagged({ connected: false })).toEqual([]);
	});

	it("affirms the settled session and the roster together", () => {
		// The case the affirmative rule exists for: a populated session with a roster
		// answers S5/populated AND S5/subagents from one frame.
		expect(flagged({ subagents: 3 })).toEqual(["populated", "subagents"]);
	});

	it("names each state the view can actually phrase", () => {
		// Every one of these is a fact this view holds, which is why none of them is
		// left as a declared gap: `stop_reason` (the route's resume gate),
		// `projection.degraded`, `queued_count`, and a row the classifier calls a tool
		// call or one carrying images.
		expect(flagged({ streaming: true })).toContain("streaming");
		expect(flagged({ ended: true })).toContain("ended");
		expect(flagged({ aborted: true })).toContain("aborted");
		expect(flagged({ error: true })).toContain("error");
		expect(flagged({ degraded: true })).toContain("degraded");
		expect(flagged({ queued: 2 })).toContain("queued");
		expect(flagged({ richRows: true })).toContain("richRows");
	});

	it("tells an approval from an ask, and never claims both", () => {
		const approval = sessionStateFlags(facts({ pending: "approval" }));
		expect(approval.pendingApproval).toBe(true);
		expect(approval.pendingAsk).toBe(false);

		const ask = sessionStateFlags(facts({ pending: "ask" }));
		expect(ask.pendingAsk).toBe(true);
		expect(ask.pendingApproval).toBe(false);
	});

	it("falls back to idle, so a connected session always affirms something", () => {
		expect(flagged({ entries: 0 })).toEqual(["idle"]);
	});

	it("has exactly one flag per declared session marker", () => {
		// The other half of the guard: the render check proves a declared marker is
		// rendered, this proves nothing is DECLARED with no derivation behind it and no
		// flag is derived that the contract does not name.
		const declared = Object.keys(STATE_MARKER)
			.filter((key) => key.startsWith("session"))
			.map((key) => key.slice("session".length))
			.sort();
		expect(
			Object.keys(sessionStateFlags(facts())).map(capitalise).sort(),
		).toEqual(declared);
	});

	it("leaves the two states the contract already carried to their own renderers", () => {
		// `session-empty` is `EMPTY.session` and `session-loading` is
		// `SURFACE.sessionLoading`; declaring a second constant for either would put a
		// duplicate in `IDENTIFIERS`, which the namespace check refuses.
		expect(Object.values(STATE_MARKER)).not.toContain(EMPTY.session);
		expect(Object.values(STATE_MARKER)).not.toContain(SURFACE.sessionLoading);
	});
});

describe("composerStateFlags", () => {
	const input = {
		streaming: false,
		hasDraft: true,
		hasImages: false,
		sending: false,
		envelopePending: false,
		ended: false,
	};

	it("reads the primary's op rather than recomputing it", () => {
		expect(composerStateFlags(composerControls(input))).toEqual({
			idle: true,
			steering: false,
			sending: false,
			ended: false,
		});
		expect(
			composerStateFlags(composerControls({ ...input, streaming: true })),
		).toEqual({ idle: false, steering: true, sending: false, ended: false });
	});

	it("prefers the send in flight, and names the ended session", () => {
		expect(
			composerStateFlags(
				composerControls({ ...input, streaming: true, sending: true }),
			),
		).toEqual({ idle: false, steering: false, sending: true, ended: false });

		const ended = composerControls({ ...input, ended: true });
		expect(ended.disabledReason).toBe(COMPOSER_COPY.endedSession);
		expect(composerStateFlags(ended)).toEqual({
			idle: false,
			steering: false,
			sending: false,
			ended: true,
		});
	});

	it("has exactly one flag per declared composer marker", () => {
		const declared = Object.keys(STATE_MARKER)
			.filter((key) => key.startsWith("composer"))
			.map((key) => key.slice("composer".length))
			.sort();
		expect(
			Object.keys(composerStateFlags(composerControls(input)))
				.map(capitalise)
				.sort(),
		).toEqual(declared);
	});
});
