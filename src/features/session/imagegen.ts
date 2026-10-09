/**
 * The image-generation tool surface: which tool rows are cards, and the ONE
 * entry→view-model adapter those cards render from.
 *
 * The programme this file belongs to freezes the WIRE SHAPE incrementally: the
 * harness tool (`generate_image` — image-to-image is a `source_image_path`
 * parameter on the SAME tool; there is no second name) lands in another lane,
 * and the platform's live-detail fields (`queue_position`, a progress fraction,
 * `logs`, the platform's stable `error` sentence and its `error_type` code)
 * freeze after it. So this module is the
 * single place in this app where those field names appear — when the freeze
 * brings a rename, this file and its test change and nothing else does. That is
 * `delivery.ts`'s rule (one reader per tool field), applied to a live one.
 *
 * Vocabulary, from the frozen facts of the programme:
 *
 *   - Surface states: `queued -> running -> done | failed | cancelled`, plus
 *     `cancelling` — which is NOT a wire state. It is the overlay the card
 *     applies after a cancel is requested and until the confirmation lands
 *     (`never optimistically "cancelled"`). It lives in the component, and the
 *     WORD table below is shared so the overlay and the wire states read as one
 *     vocabulary.
 *   - The projection's own `tool_state` is the mapping's source: `composing`
 *     and `queued` are "not started" (the reduced `queued` state — a call the
 *     model is still writing is no more running than one behind a sibling),
 *     `running` is running, `done` is done, `failed` is failed, and
 *     `interrupted` is the surface's `cancelled` (an aborted call, whether the
 *     reader stopped it or the turn did).
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

/** The card's states, mapped from the wire's `tool_state`. */
export type ImageGenPhase =
	| "queued"
	| "running"
	| "done"
	| "failed"
	| "cancelled";

/**
 * The phase the card DRAWS — `ImageGenPhase` plus the local overlay. Exported
 * because the component and its copy table both speak it, and because the
 * restart/steer slots (unwired) will join it rather than invent a second one.
 */
export type ImageGenCardPhase = ImageGenPhase | "cancelling";

const PHASE_OF_TOOL_STATE: Record<ToolState, ImageGenPhase> = {
	composing: "queued",
	queued: "queued",
	running: "running",
	done: "done",
	failed: "failed",
	interrupted: "cancelled",
};

/** The glyph and identity colour of each state, in the tool row's own eight
 *  characters (`docs/design/components.md` § 15) — the card is the same visual
 *  family as the tool row, and a second pen for state is the anti-pattern the
 *  glyph table already exists to prevent. */
export interface ImageGenTone {
	glyph: string;
	inkClass: string;
}

export const IMAGEGEN_TONE: Record<ImageGenCardPhase, ImageGenTone> = {
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
 * outcome (`Reconnecting…` is the same register); every other word is a state
 * the reader can act on, and none of them is a verdict the feed has not stated.
 * `done`'s word is chosen by `imageGenStateLine` — "Image ready" claims an image
 * is there, which is only true once the artifact has arrived.
 */
export const IMAGEGEN_STATE_WORD: Record<ImageGenCardPhase, string> = {
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
 * `failed` says "Already finished" when the row is the cancel-vs-finished
 * conflict — a conflict the frozen rules refuse to paint as an error.
 */
export const imageGenStateLine = (
	phase: ImageGenCardPhase,
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
	if (phase === "failed" && state.alreadyFinished) return "Already finished";
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
): ImageGenCardPhase =>
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
 * The provider's live-detail payload, as far as this build reads it.
 *
 * Every field is validated and every failure reads as ABSENT: a queue position
 * that is not a non-negative integer, a progress value outside `[0, 1]`, a
 * `logs` array that is not all strings, an `error` that is not a string — each
 * one renders as the reduced state rather than as a number or a sentence this
 * build invented. Values pass through UNMODIFIED (a log line and an error say
 * what the provider said; clamping or trimming them would be this client
 * editing the machine's words).
 */
export interface ImageGenLiveDetail {
	/** The provider's queue placement, when it stated one. */
	queuePosition: number | null;
	/** The provider's progress fraction in `[0, 1]`, or `null` (indeterminate). */
	progress: number | null;
	/** The provider's log lines, in its own order; possibly empty. */
	logs: string[];
	/** The platform's error sentence, verbatim — the sanctioned form of a
	 *  failure (harness-lane freeze, 2026-10-08: surfaces never receive FAL
	 *  free-text, so this text is safe to render as-is). `null` when none was
	 *  stated. */
	error: string | null;
	/** The platform's structured code (`media_rejected | media_failed |
	 *  media_rate_limited | media_unavailable`, or FAL's own code where one
	 *  exists); `null` when none was stated. The one code that changes the
	 *  card's reading is `media_already_completed` — see
	 *  `IMAGEGEN_ALREADY_FINISHED`. */
	errorType: string | null;
}

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
 * The field names below are the ONE place they appear. `queue_position` and
 * `logs` are the frozen vocabulary's own names; `progress` is the one name this
 * lane had to choose for the progress fraction (flagged to the harness lane —
 * if the freeze brings another spelling, this function is the whole change).
 * `error` is read from the ENTRY's own field first (the field every other
 * surface already reads) and falls back to the provisionally-named
 * `details.error` — the platform's stable sentence in either place.
 * `error_type` rides `details` beside it (the same freeze).
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
	const logs = Array.isArray(bag.logs)
		? bag.logs.filter((line): line is string => typeof line === "string")
		: [];
	return {
		queuePosition: nonNegativeInt(bag.queue_position),
		progress: fraction(bag.progress),
		logs,
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
	/** Whether a failed row is really the cancel-vs-finished conflict rather
	 *  than a failure: rendered quietly, never with the failure treatment. */
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
	const phase = PHASE_OF_TOOL_STATE[entry.tool_state];
	const image = entry.images[0];
	const artifact =
		phase === "done" && image !== undefined
			? { index: image.index, mimeType: image.mime_type }
			: null;
	const live = imageGenLiveDetail(entry);
	return {
		tool: entry.tool_name,
		summary: entry.summary,
		phase,
		live,
		elapsed: toolElapsed(entry),
		artifact,
		alreadyFinished:
			phase === "failed" && live.errorType === IMAGEGEN_ALREADY_FINISHED,
		cancelable: imageGenLivePhase(phase),
	};
};
