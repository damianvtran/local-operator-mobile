import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { SessionProjection, TranscriptEntry } from "@/contracts";
import { COMPOSER_COPY, composerControls } from "@/features/session/composer";
import {
	composerStateFlags,
	type SessionStateFacts,
	type SessionStateFlags,
	sessionFactsFrom,
	sessionStateFlags,
} from "@/features/session/state-marker";
import { CONTROL, EMPTY, STATE_MARKER, SURFACE } from "@/ui/a11y";

const root = fileURLToPath(new URL("../../../", import.meta.url));

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
	tables: false,
	delivery: false,
	pending: null,
	subagents: 0,
	entries: 2,
	voice: false,
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

	it("has exactly one flag per DERIVED session marker", () => {
		// The other half of the guard: the render check proves a declared marker is
		// rendered, this proves nothing is DECLARED with no derivation behind it and no
		// flag is derived that the contract does not name. The two screen-level states
		// (`loading`, `empty`) are the exception, and they are named here rather than
		// quietly excluded: no runtime fact decides them, the route does.
		const screenLevel = ["loading", "empty"];
		// The find states are the second exception, one layer down from the route:
		// their derivation is `FindStateMarkers`' own inputs (the find session's
		// mode/query/answer — `components/state-markers.tsx`), never a projection
		// fact. A completion does not decide whether a search sheet is open, so
		// requiring a `sessionStateFlags` entry for them would demand a derivation
		// from the wrong layer. Named, like the route pair, rather than excluded.
		const findLevel = [
			"find-results",
			"find-related",
			"find-empty",
			"find-hit",
			"find-caveat",
		];
		const derived = Object.keys(STATE_MARKER.session)
			.filter(
				(state) => !screenLevel.includes(state) && !findLevel.includes(state),
			)
			.sort();
		expect(
			Object.keys(sessionStateFlags(facts())).map(stateKeyFor).sort(),
		).toEqual(derived);
	});

	it("points the empty and loading states at the id a connected frame carries", () => {
		// QA round 6, Q1. `session-empty` is `EMPTY.session`, painted on the NOT-connected
		// branch; a connected session that has answered with no rows paints the
		// transcript's own empty state, and one that has not answered paints the
		// skeleton. Declaring the first as the cell's marker would blame the app's DOM for
		// a name the harness picked.
		expect(STATE_MARKER.session.empty).toBe(SURFACE.sessionTranscriptEmpty);
		expect(STATE_MARKER.session.loading).toBe(SURFACE.sessionLoading);
		expect(Object.values(STATE_MARKER.session)).not.toContain(EMPTY.session);
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
		expect(
			Object.keys(composerStateFlags(composerControls(composerInput()))).sort(),
		).toEqual(Object.keys(STATE_MARKER.composer).sort());
	});
});

/**
 * The route's own derivation, tested against the wire rather than against a
 * hand-built facts object: `S5/degraded` and `S5/queued` were declared with
 * derivations that were right and unreachable, because the scenarios serving those
 * cells clone fixtures with the field at its default (review round 6, M3).
 */
const projection = (over: Partial<SessionProjection> = {}): SessionProjection =>
	({
		ended: false,
		stop_reason: "completed",
		degraded: false,
		queued_count: 0,
		pending: null,
		...over,
	}) as SessionProjection;

/* `tool_name` and `details` are on EVERY wire row (`TranscriptEntry`: a string,
 * schema-validated), so the minimal entry carries them too — the `send-delivery`
 * fact reads through the row's own gate, which touches the name. */
const entry = (kind: string, text = ""): TranscriptEntry =>
	({
		kind,
		text,
		images: [],
		tool_name: "",
		details: {},
	}) as unknown as TranscriptEntry;

describe("sessionFactsFrom", () => {
	it("reads the aborted turn from the wire, and only when it has settled", () => {
		const settled = sessionFactsFrom({
			projection: projection({ stop_reason: "aborted" }),
			streaming: false,
			error: false,
			entries: [],
			subagents: 0,
			micVisible: false,
		});
		expect(settled.aborted).toBe(true);

		const running = sessionFactsFrom({
			projection: projection({ stop_reason: "aborted" }),
			streaming: true,
			error: false,
			entries: [],
			subagents: 0,
			micVisible: false,
		});
		expect(running.aborted).toBe(false);
	});

	it("takes degraded and queued from the projection's own fields", () => {
		// The two the scenarios had to start serving (M3).
		const facts = sessionFactsFrom({
			projection: projection({ degraded: true, queued_count: 1 }),
			streaming: false,
			error: false,
			entries: [],
			subagents: 0,
			micVisible: false,
		});
		expect(facts.degraded).toBe(true);
		expect(facts.queued).toBe(1);
		expect(sessionStateFlags(facts).degraded).toBe(true);
		expect(sessionStateFlags(facts).queued).toBe(true);
	});

	it("calls a row rich only when it is a FENCED markdown row", () => {
		// The discriminating case: a tool row and an image are not what S5/rich-rows
		// names, so a frame with both and no fence must NOT affirm it.
		const toolAndImage = sessionFactsFrom({
			projection: projection(),
			streaming: false,
			error: false,
			entries: [
				entry("tool", "no fence here"),
				{ ...entry("assistant"), images: [{}] } as TranscriptEntry,
			],
			subagents: 0,
			micVisible: false,
		});
		expect(toolAndImage.richRows).toBe(false);
		expect(sessionStateFlags(toolAndImage).richRows).toBe(false);

		const fenced = sessionFactsFrom({
			projection: projection(),
			streaming: false,
			error: false,
			entries: [entry("assistant", "Here:\n```ts\nconst a = 1;\n```\n")],
			subagents: 0,
			micVisible: false,
		});
		expect(fenced.richRows).toBe(true);
	});

	it("does not read a fence out of a row the transcript does not render as markdown", () => {
		const user = sessionFactsFrom({
			projection: projection(),
			streaming: false,
			error: false,
			entries: [entry("user", "```\nnot rendered as markdown\n```")],
			subagents: 0,
			micVisible: false,
		});
		expect(user.richRows).toBe(false);
	});

	it("affirms the voice mic only for the composer's own gate", () => {
		/* The gate is `capabilities.stt` AND this build's recorder, and the marker
		 * reads the COMPOSER's decision rather than re-reading either half — so a frame
		 * can only claim the mic it actually rendered. */
		const base = {
			projection: projection(),
			streaming: false,
			error: false,
			entries: [entry("assistant", "hi")],
			subagents: 0,
		};
		expect(
			sessionStateFlags(sessionFactsFrom({ ...base, micVisible: true })).voice,
		).toBe(true);
		expect(
			sessionStateFlags(sessionFactsFrom({ ...base, micVisible: false })).voice,
		).toBe(false);
	});

	it("names the mic's own control as the voice marker's id", () => {
		/* The marker MAPS onto the control the composer renders, so the control's
		 * presence IS the claim: there is no second, zero-size id that a mic-less
		 * frame could carry (a11y.ts's marker table is allowed to reuse a declared
		 * id for exactly this). */
		expect(STATE_MARKER.session.voice).toBe(CONTROL.composerMic);
	});

	it("affirms send-delivery only through the row's own gate", () => {
		/* Review MINOR-1: the marker used to flip on ANY entry whose details
		 * carried a known `delivery.state`, while the row renders the word only
		 * for `send` — so a lookalike key on another tool affirmed a marker no
		 * row backed. Both read `sendDeliveryStateOf` now. */
		const lookalike = sessionFactsFrom({
			projection: projection(),
			streaming: false,
			error: false,
			subagents: 0,
			micVisible: false,
			entries: [
				{
					...entry("tool"),
					tool_name: "bash",
					details: { delivery: { state: "failed" } },
				} as TranscriptEntry,
			],
		});
		expect(sessionStateFlags(lookalike).delivery).toBe(false);

		const send = sessionFactsFrom({
			projection: projection(),
			streaming: false,
			error: false,
			subagents: 0,
			micVisible: false,
			entries: [
				{
					...entry("tool"),
					tool_name: "send",
					details: { delivery: { state: "failed" } },
				} as TranscriptEntry,
			],
		});
		expect(sessionStateFlags(send).delivery).toBe(true);
	});
});

describe("the flag-to-marker pairing", () => {
	const source = readFileSync(
		join(root, "src/features/session/components/state-markers.tsx"),
		"utf8",
	);
	/* Both components use `flags.idle`, so each is searched in its own half: a
	 *  document-wide search would pair the session's idle with the composer's. */
	const composerAt = source.indexOf("export const ComposerStateMarkers");
	const scopes = {
		session: source.slice(0, composerAt),
		composer: source.slice(composerAt),
	};

	/**
	 * The pairing is what makes a marker MEAN the state, and it is invisible to both
	 * directions of `a11y.e2e.test.ts`: swapping two flags there keeps every name
	 * present and every flag correct, so a frame would affirm the wrong state and both
	 * checks would pass. This reads the render site and pins each flag to its id.
	 */
	const paired = (
		scope: keyof typeof scopes,
		flag: string,
		marker: string,
	): void => {
		const segments = scopes[scope].split("flags.");
		const segment = segments.find((part) => part.startsWith(`${flag} ?`));
		expect(segment, `no render site for flags.${flag}`).toBeDefined();
		expect(
			segment?.split("flags.")[0],
			`flags.${flag} renders something other than STATE_MARKER.${marker}`,
		).toContain(`STATE_MARKER.${marker}`);
	};

	it("pairs every session flag with the marker of the state it affirms", () => {
		for (const key of Object.keys(sessionStateFlags(factsOf()))) {
			paired("session", key, `session${markerSuffixFor(stateKeyFor(key))}`);
		}
	});

	it("pairs every composer flag with the marker of the same name", () => {
		for (const key of Object.keys(
			composerStateFlags(composerControls(composerInput())),
		)) {
			paired("composer", key, `composer.${key}`);
		}
	});
});

/** The input `composerControls` wants, for the pairing test. */
const composerInput = () => ({
	streaming: false,
	hasDraft: true,
	hasImages: false,
	sending: false,
	envelopePending: false,
	ended: false,
});

/** Every flag, so the pairing test covers all of them rather than the ones true. */
const factsOf = (): SessionStateFacts => facts({ connected: true });

/**
 * The state key a flag affirms, and the shape its id is written in.
 *
 * Stated here rather than derived from the flag's name because the correspondence is
 * not a case convention: `richRows` is `rich-rows`, `pendingApproval` is
 * `pending-approval`. That IS the pairing the render site has to make, so the test
 * states it and then checks the render site against it.
 */
const STATE_KEY: Record<keyof SessionStateFlags, string> = {
	error: "error",
	streaming: "streaming",
	ended: "ended",
	aborted: "aborted",
	degraded: "degraded",
	queued: "queued",
	richRows: "rich-rows",
	tables: "tables",
	delivery: "send-delivery",
	pendingApproval: "pending-approval",
	pendingAsk: "pending-ask",
	subagents: "subagents",
	populated: "populated",
	idle: "idle",
	voice: "voice",
};

const stateKeyFor = (key: string): string =>
	STATE_KEY[key as keyof SessionStateFlags] ?? key;

/** `rich-rows` → `["rich-rows"]`; `idle` → `.idle`. */
const markerSuffixFor = (stateKey: string): string =>
	stateKey.includes("-") ? `["${stateKey}"]` : `.${stateKey}`;
