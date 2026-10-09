/**
 * The image-generation tool surface: which tool rows are cards, and the ONE
 * entry→view-model adapter those cards render from.
 *
 * The wire shape FROZE on 2026-10-09 (the harness lane's local-operator
 * #2089): every `generate_image` update carries the canonical field set —
 * `stage`, `queue_position`, `progress_fraction`, `log_lines`, `error`,
 * `error_type` — with every key PRESENT and `None` where no provider supplied
 * one. So this module stays the single place in this app where those field
 * names appear — the freeze landed, and this file and its test were the whole
 * change, which is `delivery.ts`'s rule (one reader per tool field) holding.
 *
 * The card's state maps from `stage` first:
 *
 *   - `stage`: `queued` / `in_progress` / `completed` / `cancelled` /
 *     `cancelling`, and an explicit `None` on a mid-walk failure update, whose
 *     semantics ride the `error`/`error_type` pair instead (mapped to
 *     `failed`). An UNKNOWN value reads as absent — a future stage renders the
 *     reduced fallback rather than a state this build guessed.
 *   - `cancelling` is a WIRE state now (the cancel-confirmation hold). The
 *     card's local overlay still covers the window between the press and the
 *     feed's first `cancelling`, and both draw the same word.
 *   - A row with no `stage` at all (a pre-freeze fixture, or a final row that
 *     never carried a live stage) falls back to the projection's own
 *     `tool_state`: `composing` and `queued` are "not started" (the reduced
 *     `queued` state — a call the model is still writing is no more running
 *     than one behind a sibling), `running` is running, `done` is done,
 *     `failed` is failed, and `interrupted` is the surface's `cancelled` (an
 *     aborted call, whether the reader stopped it or the turn did).
 *
 * `log_lines` is the provider's own logs list passed through verbatim as
 * `[{message, timestamp}]`; the card renders the messages in order and does
 * not render timestamps yet (they are in the bag for whenever a design wants
 * them). `progress_fraction` stays `None` until a provider reports one — the
 * feed's own note is that elapsed-vs-budget is a TIMEOUT, never a bar — so
 * the indeterminate branch is the one that renders today.
 *
 * The reduced state is the honest one: every live detail is optional, and an
 * absent field renders the state without it — never a default, never a zero
 * (`docs/relay/contract.md`'s null-not-zero rule, which the app's schemas are
 * built around). A feed that carries no fraction gets the indeterminate
 * treatment, not a made-up `0%`.
 */

import type { ToolState, TranscriptEntry } from "@/contracts";
import { toolElapsed } from "@/features/session/projection";

/**
 * The detection set: the tools whose transcript row is an image-gen card.
 *
 * ONE set for this surface — the transcript row and every test read this
 * constant. It is a SET rather than a bare string because the surface's shape
 * is "the generation tools", and a future name would join here once; today the
 * frozen contract has exactly one tool (harness-lane update, 2026-10-08 — the
 * image-to-image case folded into `generate_image` as `source_image_path`).
 * Lower-cased comparison below because the wire carries the tool's own
 * spelling.
 */
export const IMAGEGEN_TOOLS: ReadonlySet<string> = new Set(["generate_image"]);

/** Whether a transcript entry is an image-generation call. */
export const isImageGenTool = (
	entry: Pick<TranscriptEntry, "tool_name">,
): boolean => IMAGEGEN_TOOLS.has(entry.tool_name.toLowerCase());

/* ------------------------------------------------------------- the vocabulary */

/** The card's states. `cancelling` was the component's local overlay alone
 *  until the freeze made it a wire stage too (the cancel-confirmation hold);
 *  the overlay still covers the window before the feed confirms, and the WORD
 *  table below is shared so the two read as one vocabulary. */
export type ImageGenPhase =
	| "queued"
	| "running"
	| "done"
	| "failed"
	| "cancelled"
	| "cancelling";

const PHASE_OF_TOOL_STATE: Record<ToolState, ImageGenPhase> = {
	composing: "queued",
	queued: "queued",
	running: "running",
	done: "done",
	failed: "failed",
	interrupted: "cancelled",
};

/** The canonical `stage` vocabulary (harness-lane freeze, 2026-10-09). */
const STAGE_VALUES = [
	"queued",
	"in_progress",
	"completed",
	"cancelled",
	"cancelling",
] as const;
export type ImageGenStage = (typeof STAGE_VALUES)[number];

/** `stage` → phase. Total over the canonical vocabulary by construction: a new
 *  stage must fail typecheck here rather than fall through to a wrong state. */
const PHASE_OF_STAGE: Record<ImageGenStage, ImageGenPhase> = {
	queued: "queued",
	in_progress: "running",
	completed: "done",
	cancelled: "cancelled",
	cancelling: "cancelling",
};

/**
 * The phase of one row, from the canonical `stage` first and the projection's
 * `tool_state` as the fallback.
 *
 * `stage: null` is the mid-walk failure update BY CONTRACT ("no canonical
 * stage names a mid-walk failure — the pair is the semantics"), so it maps to
 * `failed`; the platform's sentence rides the same update and renders from it.
 * `undefined` (no stage in the bag at all — a pre-freeze row) falls back to
 * `tool_state`.
 *
 * `completed` reads to the done-arm wherever it appears — the live completion
 * update (which the transcript does not receive today) and a settled receipt
 * that one day carries the terminal value alike: the vocabulary value is the
 * same statement in either place, so the read stays tolerant by construction
 * (wiring round, 2026-10-09).
 */
const phaseOf = (
	stage: ImageGenStage | null | undefined,
	toolState: ToolState,
): ImageGenPhase =>
	stage === null
		? "failed"
		: stage !== undefined
			? PHASE_OF_STAGE[stage]
			: PHASE_OF_TOOL_STATE[toolState];

/** The glyph and identity colour of each state, in the tool row's own eight
 *  characters (`docs/design/components.md` § 15) — the card is the same visual
 *  family as the tool row, and a second pen for state is the anti-pattern the
 *  glyph table already exists to prevent. */
export interface ImageGenTone {
	glyph: string;
	inkClass: string;
}

export const IMAGEGEN_TONE: Record<ImageGenPhase, ImageGenTone> = {
	queued: { glyph: "⋯", inkClass: "text-ink-dim" },
	running: { glyph: "⟳", inkClass: "text-accent" },
	/* Still running until the confirmation lands, so the tone stays the
	 * running one; the WORD is what changed. */
	cancelling: { glyph: "⟳", inkClass: "text-accent" },
	done: { glyph: "✓", inkClass: "text-success" },
	failed: { glyph: "✗", inkClass: "text-danger" },
	cancelled: { glyph: "–", inkClass: "text-warning" },
};

/**
 * The platform's code for "the cancel raced a job that had already finished"
 * (harness-lane freeze, 2026-10-08). The platform answers it as a CONFLICT,
 * and the frozen rule is that a surface must never paint it as an error: the
 * card says "Already finished" in the quiet register instead.
 */
export const IMAGEGEN_ALREADY_FINISHED = "media_already_completed";

/** The tone the already-finished reading takes: no danger and no verdict —
 *  the word carries the state, and the quiet ink is the one role that claims
 *  nothing about how it ended. */
export const IMAGEGEN_ALREADY_FINISHED_TONE: ImageGenTone = {
	glyph: "–",
	inkClass: "text-ink-dim",
};

/**
 * The state's own word, one per state.
 *
 * `cancelling` carries the ellipsis because it is a phase in progress, not an
 * outcome — the wire's cancel-confirmation hold and the card's local overlay
 * draw the same word (`Reconnecting…` is the same register); every other word
 * is a state the reader can act on, and none of them is a verdict the feed has
 * not stated.
 * `done`'s word is chosen by `imageGenStateLine` — "Image ready" claims an image
 * is there, which is only true once the artifact has arrived.
 *
 * `cancelled` is the provider's own terminal word for an aborted generation
 * (the frozen wire vocabulary's `CANCELLED`) and is deliberately NOT the
 * generic tool row's "Interrupted — the output above is partial." — that
 * sentence warns about partial TEXT output, which a generation does not have
 * (its artifact either arrived or did not). One wire state, two sentences
 * answering two different questions (design round 1, D3).
 */
export const IMAGEGEN_STATE_WORD: Record<ImageGenPhase, string> = {
	queued: "Queued",
	running: "Generating image",
	cancelling: "Cancelling…",
	done: "Image ready",
	failed: "Failed",
	cancelled: "Cancelled",
};

/**
 * The one-line state sentence a card draws under its header.
 *
 * The queue position joins the queued word only when the feed carried one —
 * `Queued · position 3` is a measurement, and `Queued` alone is the honest
 * reduced state. `done` degrades to `Done` when no artifact arrived, because
 * "Image ready" beside no image would be the card claiming bytes it cannot
 * show (the reduced state, again — never a claim the feed did not make).
 * `failed`'s sentence is withheld when the row is the cancel-vs-finished
 * conflict, and an already-finished reading says "Already finished" wherever
 * the row settles — the conflict folds as `cancelled` on the canonical wire
 * and `failed` on the tool_state fallback, and both draw the same quiet line.
 */
export const imageGenStateLine = (
	phase: ImageGenPhase,
	state: {
		queuePosition: number | null;
		hasArtifact: boolean;
		/** The failed phase is actually the cancel-vs-finished conflict. */
		alreadyFinished: boolean;
	},
): string => {
	if (phase === "queued" && state.queuePosition !== null) {
		return `${IMAGEGEN_STATE_WORD.queued} · position ${state.queuePosition}`;
	}
	if (phase === "done" && !state.hasArtifact) return "Done";
	if (state.alreadyFinished) return "Already finished";
	return IMAGEGEN_STATE_WORD[phase];
};

/* ------------------------------------------------------------ the cancel overlay */

/**
 * Whether a phase can still be cancelled: the call has not settled.
 *
 * ONE predicate for the card's Cancel gate and its overlay, so "cancelable"
 * and "still live" cannot drift apart.
 */
export const imageGenLivePhase = (phase: ImageGenPhase): boolean =>
	phase === "queued" || phase === "running";

/**
 * The phase the card DRAWS: the cancelling overlay on a live phase once a
 * request has been made, the wire's own phase otherwise.
 */
export const imageGenCardPhase = (
	phase: ImageGenPhase,
	requested: boolean,
): ImageGenPhase =>
	imageGenLivePhase(phase) && requested ? "cancelling" : phase;

/**
 * The cancel overlay's lifecycle, as one pure step.
 *
 * The transition that matters is `request-failed`: a request that never
 * reached the relay — no route, or the abort command answered an error — has
 * NOTHING in flight, so the overlay it raised must drop and the card must fall
 * back to its real phase (the composer's error line already carries the
 * failure). Latching "Cancelling…" over a request that was never made was
 * review round 1's finding F2.
 *
 * `request-delivered` keeps the current value: the request IS in flight, and
 * the overlay lives until the entry settles. `settled` clears it; the phase
 * itself also carries the truth once it leaves the live pair
 * (`imageGenCardPhase`), which is why this clear is hygiene rather than the
 * only defence.
 */
export type ImageGenCancelEvent =
	| "press"
	| "request-delivered"
	| "request-failed"
	| "settled";

export const imageGenCancelOverlay = (
	requested: boolean,
	event: ImageGenCancelEvent,
): boolean => {
	switch (event) {
		case "press":
			return true;
		case "request-delivered":
			return requested;
		case "request-failed":
			return false;
		case "settled":
			return false;
	}
};

/* ------------------------------------------------------------ the live detail */

/**
 * The provider's live-detail payload, as far as this build reads it, from the
 * canonical field set (harness-lane freeze, 2026-10-09).
 *
 * Every field is validated and every failure reads as ABSENT: a queue position
 * that is not a non-negative integer, a fraction outside `[0, 1]`, a
 * `log_lines` entry without a string `message`, an `error` that is not a
 * string, an unknown `stage` — each one renders as the reduced state rather
 * than as a number or a sentence this build invented. Values pass through
 * UNMODIFIED (a log message and an error say what the provider said; clamping
 * or trimming them would be this client editing the machine's words).
 *
 * `stage` is the one field with THREE readings, because the canonical shape
 * gives it three: one of the five values; an explicit `null` (the mid-walk
 * failure, whose semantics ride `error`/`error_type` — `phaseOf` maps it); or
 * absent, for a bag from before the freeze — the caller then falls back to
 * `tool_state`.
 */
export interface ImageGenLiveDetail {
	/** The canonical `stage`: a value, the stated `null` of a failure update, or
	 *  `undefined` when the bag carried none at all. */
	stage: ImageGenStage | null | undefined;
	/** The provider's queue placement, when it stated one. */
	queuePosition: number | null;
	/** The progress fraction in `[0, 1]` (`progress_fraction`), or `null` —
	 *  which is INDETERMINATE, never a synthesized zero. */
	progress: number | null;
	/** The provider's log messages (`log_lines`'s `message`s), in its own
	 *  order; possibly empty. Timestamps ride the wire and are not rendered
	 *  yet. */
	logs: string[];
	/** The platform's error sentence, verbatim — the sanctioned form of a
	 *  failure (surfaces never receive FAL free-text, so this text is safe to
	 *  render as-is). `null` when none was stated. */
	error: string | null;
	/** The platform's structured code (`media_rejected | media_failed |
	 *  media_rate_limited | media_unavailable`, a rung failure's own
	 *  classification, or the cancel conflict's `media_already_completed` — see
	 *  `IMAGEGEN_ALREADY_FINISHED`); `null` when none was stated. */
	errorType: string | null;
}

/** The canonical `stage`, read with its three outcomes (see the interface). */
const stageOrNull = (
	bag: Record<string, unknown>,
): ImageGenStage | null | undefined => {
	if (!("stage" in bag)) return undefined;
	const value = bag.stage;
	if (value === null) return null;
	return typeof value === "string" &&
		(STAGE_VALUES as readonly string[]).includes(value)
		? (value as ImageGenStage)
		: undefined;
};

/** The `message`s of a canonical `log_lines` array; non-object rows dropped. */
const logMessages = (value: unknown): string[] =>
	Array.isArray(value)
		? value.flatMap((line) => {
				if (line === null || typeof line !== "object") return [];
				const message = (line as { message?: unknown }).message;
				return typeof message === "string" ? [message] : [];
			})
		: [];

/** A finite non-negative integer, or `null`. */
const nonNegativeInt = (value: unknown): number | null =>
	typeof value === "number" && Number.isInteger(value) && value >= 0
		? value
		: null;

/** A finite fraction inside `[0, 1]`, or `null`. Anything else is absence: a
 *  fraction of a whole is the only shape a bar can draw without inventing. */
const fraction = (value: unknown): number | null =>
	typeof value === "number" &&
	Number.isFinite(value) &&
	value >= 0 &&
	value <= 1
		? value
		: null;

const stringOrNull = (value: unknown): string | null =>
	typeof value === "string" && value.length > 0 ? value : null;

/**
 * Read the live detail out of an entry's `details`.
 *
 * The field names below are the ONE place they appear — the canonical set the
 * harness lane froze on 2026-10-09 (`stage`, `queue_position`,
 * `progress_fraction`, `log_lines`; `error`/`error_type` beside them). `error`
 * is read from the ENTRY's own field first (the field every other surface
 * already reads) and falls back to `details.error` — the platform's stable
 * sentence in either place.
 *
 * `details` is read through an unknown-key widening rather than a widened
 * schema, for `delivery.ts`'s reason: the wire's `details` is a loose bag by
 * contract, and this build must render a future relay's frame without a schema
 * change. An unknown key simply reads as absent.
 */
export const imageGenLiveDetail = (
	entry: Pick<TranscriptEntry, "details" | "error">,
): ImageGenLiveDetail => {
	const bag = entry.details as unknown as Record<string, unknown>;
	return {
		stage: stageOrNull(bag),
		queuePosition: nonNegativeInt(bag.queue_position),
		progress: fraction(bag.progress_fraction),
		logs: logMessages(bag.log_lines),
		error: stringOrNull(entry.error) ?? stringOrNull(bag.error),
		errorType: stringOrNull(bag.error_type),
	};
};

/* -------------------------------------------------------------- the view model */

/** The finished artifact, indexed exactly like the entry's other images — the
 *  existing phone image path serves its bytes, so the card only needs the two
 *  fields `TranscriptImage` already takes. */
export interface ImageGenArtifact {
	index: number;
	mimeType: string;
}

/**
 * Everything the card renders, derived from ONE entry.
 *
 * The component takes this view and the entry's id — never the entry itself —
 * so a field name outside this module cannot reach a card by accident.
 */
export interface ImageGenView {
	/** The tool's own name, for the header line. */
	tool: string;
	/** The tool's one-line summary (the prompt, as the fold wrote it). */
	summary: string;
	phase: ImageGenPhase;
	live: ImageGenLiveDetail;
	/** The measured duration, in the transcript's own format; `null` while the
	 *  wire reports none (`toolElapsed`'s "0 is not measured yet" rule). */
	elapsed: string | null;
	/** The generated image, once the call is done and the row carries one. */
	artifact: ImageGenArtifact | null;
	/** Whether a settled row is really the cancel-vs-finished conflict rather
	 *  than a failure: rendered quietly, never with the failure treatment. The
	 *  conflict folds as `cancelled` on the canonical wire and `failed` on the
	 *  tool_state fallback; on a live or done row the code is not a reading this
	 *  client is entitled to make. */
	alreadyFinished: boolean;
	/** Whether the cancel affordance applies: live phases only. */
	cancelable: boolean;
}

/**
 * The adapter. `null` for anything outside the detection set, so the transcript
 * row's dispatch is one call.
 *
 * The artifact is read only in `done`: a running row with a stray image
 * reference must not render bytes the call has not produced, and an interrupted
 * one is precisely the state whose output must not read as a result. The first
 * image reference is the row's artifact — artifact blocks are indexed like
 * images (the frozen attachment contract), and a `generate` row carries the
 * generated image as its own block.
 */
export const imageGenView = (entry: TranscriptEntry): ImageGenView | null => {
	if (!isImageGenTool(entry)) return null;
	const live = imageGenLiveDetail(entry);
	const phase = phaseOf(live.stage, entry.tool_state);
	const image = entry.images[0];
	const artifact =
		phase === "done" && image !== undefined
			? { index: image.index, mimeType: image.mime_type }
			: null;
	return {
		tool: entry.tool_name,
		summary: entry.summary,
		phase,
		live,
		elapsed: toolElapsed(entry),
		artifact,
		alreadyFinished:
			(phase === "failed" || phase === "cancelled") &&
			live.errorType === IMAGEGEN_ALREADY_FINISHED,
		cancelable: imageGenLivePhase(phase),
	};
};
