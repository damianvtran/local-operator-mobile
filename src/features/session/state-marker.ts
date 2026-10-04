import type { SessionProjection, TranscriptEntry } from "@/contracts";
import { blockingPending } from "@/features/session/asks";
import {
	COMPOSER_COPY,
	type ComposerControls,
} from "@/features/session/composer";
import { deliveryStateFromDetails } from "@/features/session/delivery";
import { hasFencedBlock } from "@/features/session/markdown";
import { classifyEntry } from "@/features/session/projection";

/**
 * Which of the session view's states are true, decided in one place.
 *
 * The design audit captures each cell as a frame and has to decide whether that
 * frame is EVIDENCE for the state the cell declares. Its rule is affirmative — a
 * cell declaring `<screen>/<state>` must carry the marker `<subject>-<state>` in
 * the DOM — because a rule that could only prohibit (`a populated cell must not
 * show *-empty`) was satisfied, measurably, by a page that was nothing in
 * particular. `src/ui/a11y.ts` declares the names; this module decides which of
 * them the facts have earned, and `components/state-markers.tsx` renders them.
 *
 * **Several states at once is the point, not a bug.** A session can be populated
 * AND have a roster (S5/subagents) or be populated AND rich (S5/rich-rows), and
 * each cell asserts only its own marker, so the whole true set is rendered. The
 * one thing not to do is affirm a state that is not true: the audit treats a
 * marker as a claim, and a wrong claim is worse than a missing one.
 *
 * **Every fact here is one the view actually holds**, which is why there is no
 * list of "states we cannot phrase" any more — the four that used to be on it are
 * derived below:
 *
 *  - `degraded` — `SessionProjection.degraded` (`src/contracts/types.gen.ts`) and
 *    this route's own `stale` reading (`use-session.ts`).
 *  - `aborted` — `projection.stop_reason === "aborted"`, the same fact that gates
 *    the composer's resume affordance.
 *  - `rich-rows` — a row whose `classifyEntry` is `"tool"`, or one carrying images.
 *  - `queued` — `projection.queued_count`, already threaded to the composer.
 */
export interface SessionStateFacts {
	/** A projection has arrived: the session is connected, whatever else is true. */
	connected: boolean;
	/** A turn is running — the wire is still sending rows for it. */
	streaming: boolean;
	/** The turn ended and the session is over. */
	ended: boolean;
	/** The daemon stopped the turn (`stop_reason === "aborted"`). Only a turn that
	 *  was aborted offers the resume affordance — a completed one also stops
	 *  streaming, and offering to resume a finished conversation is a control with
	 *  no meaning. */
	aborted: boolean;
	/** The stream failed, or the route was refused. */
	error: boolean;
	/** The record is fresh but the entry's control socket is unreachable. */
	degraded: boolean;
	/** Instructions the relay is holding for the next turn. */
	queued: number;
	/** Rows that carry more than text: a tool call, or an image. */
	richRows: boolean;
	/** At least one settled row states a `send` delivery outcome (the four-state
	 *  arm — `S5/send-delivery`). Deliberately ANY of the four: the cell's claim is
	 *  "this frame shows the delivery vocabulary", and which state a given frame
	 *  shows is the row's own word, not a second marker per state. */
	delivery: boolean;
	/** The card the reader is being asked to answer, if any. `projection.pending`'s
	 *  kind, not the card's rendering. */
	pending: "approval" | "ask" | null;
	/** How many subagents the roster reports. */
	subagents: number;
	/** How many transcript rows the projection has. */
	entries: number;
}

/** The markers' own booleans: one per declared state, named as the marker is. */
export interface SessionStateFlags {
	error: boolean;
	streaming: boolean;
	ended: boolean;
	aborted: boolean;
	degraded: boolean;
	queued: boolean;
	richRows: boolean;
	delivery: boolean;
	pendingApproval: boolean;
	pendingAsk: boolean;
	subagents: boolean;
	populated: boolean;
	idle: boolean;
}

/** No state is affirmed: nothing has arrived yet. */
const NOTHING: SessionStateFlags = {
	error: false,
	streaming: false,
	ended: false,
	aborted: false,
	degraded: false,
	queued: false,
	richRows: false,
	delivery: false,
	pendingApproval: false,
	pendingAsk: false,
	subagents: false,
	populated: false,
	idle: false,
};

/** What the session route knows, which is all this derivation reads. */
export interface SessionStateInput {
	projection: SessionProjection | null;
	/** A turn is running — the wire is still sending rows for it. */
	streaming: boolean;
	/** The stream failed, or the route was refused. */
	error: boolean;
	entries: TranscriptEntry[];
	/** How many subagents the roster reports. */
	subagents: number;
}

/**
 * The facts the route reads, in one place.
 *
 * `aborted` is the reason this exists at all: it is the composer's resume gate as
 * well as a state marker, and two copies of one predicate is how what a reader sees
 * and what a cell is measured by drift apart. It lives here rather than in the route
 * so the rig that boots the relay per scenario derives the same markers the screen
 * does, from the same served projection.
 */
export const sessionFactsFrom = (
	input: SessionStateInput,
): SessionStateFacts => ({
	connected: input.projection !== null,
	streaming: input.streaming,
	ended: input.projection?.ended === true,
	aborted:
		input.projection?.stop_reason === "aborted" && input.streaming === false,
	error: input.error,
	degraded: input.projection?.degraded === true,
	queued: input.projection?.queued_count ?? 0,
	/* A fenced markdown row, which is what `S5/rich-rows` names: the rows that own
	 * the copy control. A tool row or an image is a different kind of row and a
	 * different claim — deriving this from "a tool row or an image" passed on a
	 * fixture that happened to carry both, and would have passed with no fenced block
	 * in the frame at all (review round 6, M4). */
	richRows: input.entries.some(
		(entry) =>
			classifyEntry(entry) === "assistant" && hasFencedBlock(entry.text),
	),
	/* Read through the same function the row renders with, so a marker can never
	 * affirm a state the reader's row would not show — the `richRows` lesson. */
	delivery: input.entries.some(
		(entry) => deliveryStateFromDetails(entry.details) !== null,
	),
	pending: pendingKindOf(input.projection),
	subagents: input.subagents,
	entries: input.entries.length,
});

/** The card the reader is being asked to answer, or `null`.
 *
 *  THE MIRROR RULE APPLIES HERE TOO (design §4's client rule N3): once `asks`
 *  is present, a `pending` slot with `kind == "ask"` is the legacy mirror of
 *  one of those rows and the screen renders the queued surfaces instead — so
 *  the `pending-ask` marker must not claim a card that is not on screen. */
const pendingKindOf = (
	projection: SessionProjection | null,
): SessionStateFacts["pending"] => {
	const pending = blockingPending(
		projection?.pending ?? null,
		projection?.asks,
	);
	if (pending === null) return null;
	return pending.kind === "ask" ? "ask" : "approval";
};

export const sessionStateFlags = (
	facts: SessionStateFacts,
): SessionStateFlags => {
	/* Nothing has arrived: the screen renders its skeleton (`SURFACE.sessionLoading`)
	 * or its empty state (`EMPTY.session`) and either one is already the marker for
	 * that state. A derivation marker here would put the same id in the DOM twice and
	 * say nothing. */
	if (!facts.connected) return NOTHING;

	const flags: SessionStateFlags = {
		error: facts.error,
		streaming: facts.streaming,
		ended: facts.ended,
		aborted: facts.aborted,
		degraded: facts.degraded,
		queued: facts.queued > 0,
		richRows: facts.richRows,
		delivery: facts.delivery,
		pendingApproval: facts.pending === "approval",
		pendingAsk: facts.pending === "ask",
		subagents: facts.subagents > 0,
		populated: facts.entries > 0,
		idle: false,
	};
	/* The fallback, so a connected session always affirms SOMETHING: a screen with a
	 * root and no state marker is the case the affirmative rule exists to refuse. */
	flags.idle = !Object.entries(flags).some(
		([key, value]) => key !== "idle" && value,
	);
	return flags;
};

export interface ComposerStateFlags {
	idle: boolean;
	steering: boolean;
	sending: boolean;
	ended: boolean;
}

/**
 * The composer's own states, from the one control that morphs.
 *
 * `composerControls` already decides the primary's op, whether a send is in flight
 * and why it is blocked; this reads that decision rather than recomputing it at a
 * second moment, which is the bug `chooseOp`'s own comment warns about. The alert
 * slots are not here: `composer-notice`, `composer-error` and `composer-retained`
 * are surfaces, rendered by the alert that carries them, so they are already
 * affirmative.
 *
 * No harness cell maps to a `composer` subject today (`SCREEN_MARKER_SUBJECT` maps
 * S5/S8/S9 to `session`), so these make nothing measurable on their own — see
 * `STATE_MARKER`'s own note in `src/ui/a11y.ts`. They are rendered anyway: the
 * state has to be named where the fact lives, and the session-level rendering of
 * the one that DOES have a cell is `sessionQueued`.
 */
export const composerStateFlags = (
	controls: ComposerControls,
): ComposerStateFlags => {
	/* One precedence, `sending > ended > steer > idle`, and it is a precedence rather
	 * than four independent tests: a session can be ended AND still streaming, and a
	 * disabled-for-ended primary is not "steering" whatever the wire says. Four
	 * independent predicates reported ended AND steering at once, which is a state
	 * the composer has no single look for. */
	const sending = controls.sending;
	const ended =
		!sending && controls.disabledReason === COMPOSER_COPY.endedSession;
	const steering = !sending && !ended && controls.primary.kind === "steer";
	return {
		idle: !sending && !ended && !steering,
		steering,
		sending,
		ended,
	};
};
