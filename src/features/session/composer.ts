/**
 * The composer's decisions, as pure functions: which command the one primary
 * control sends, what the receipt says, and what happens to a retained
 * instruction when a send comes back ambiguous.
 *
 * The invariant this module exists to protect is `docs/relay/contract.md` § 5.1:
 * **the UUID is the identity of the body.** A typed instruction whose delivery is
 * unknown is retained under its own `command_id`, and every later attempt replays
 * those same bytes under that same id — because re-sending after an ambiguous
 * failure under a FRESH id is exactly the duplicate the envelope exists to
 * prevent. The state machine is here rather than in the component so the rule can
 * be tested without a screen, a socket or a storage adapter.
 *
 * Two behaviours are deliberately NOT here, because they need React state and
 * have no rule to get wrong: the auto-growing field's height, and the image
 * thumbnail strip.
 *
 * No React, no React Native.
 */

import type { PromptImage } from "@/contracts";
import { relaySentence } from "@/features/session/connection-view";
import type { ContinuationOp, RelayError } from "@/relay";

/* ------------------------------------------------------------------- copy */

/**
 * One place for every sentence the composer can say.
 *
 * The web client's own wording, kept verbatim where it exists: these are reviewed
 * product sentences, and a native port that rewords them makes the two clients
 * describe one state two ways. `U5`'s rule is the reason "earlier" is used in all
 * three places a retained instruction is named — the alert, the retry button and
 * the delivered acknowledgement — rather than "previous"/"pending"/"last".
 */
export const COMPOSER_COPY = {
	placeholder: "Message Local Operator…",
	/** A send that could not reach the runtime at all. Never the raw fetch error:
	 *  "Load failed" was a shipped first impression (U3). */
	continuationError: "Couldn’t continue this conversation. Try again.",
	/** Only for a steer, where a live turn is the context. */
	steerError: "Couldn’t send this instruction. Try again.",
	/** The retained envelope is older than the visible draft. */
	retainedError:
		"An earlier instruction may have been delivered. Retry that earlier instruction before sending your current draft.",
	retryLabel: "Retry earlier instruction",
	retryDisabledHint: "Resolve the earlier instruction first.",
	/** A positive outcome, so it renders in the success roles, never the danger
	 *  container the failure alert uses (D11). */
	retryAckNotice:
		"Earlier instruction delivered. Your edited draft is ready to send.",
	/** The resume affordance, driven by `stop_reason === "aborted"` (the wire
	 *  fact), never by `streaming` — a turn that completes also stops streaming,
	 *  and only an aborted one should offer to resume. */
	resumeLabel: "Retry earlier instruction",
	attaching: "Attaching…",
	/** A picked image that could not be read. Said, never swallowed: collapsing it
	 *  into "nothing attached" tells the reader nothing happened when their image
	 *  was lost. */
	attachError: "Couldn’t attach that image. Try again.",
} as const;

/* ------------------------------------------------------------------- the op */

/** Which op the primary control sends, from the one fact that decides it. */
export const chooseOp = (streaming: boolean): ContinuationOp =>
	streaming ? "steer" : "prompt";

/* --------------------------------------------------------------- the control */

export interface PrimaryControl {
	kind: "send" | "steer";
	/** The visible label. The control's geometry does NOT change with it: the
	 *  width is pinned at the render site, because a control that grows when its
	 *  label changes moves the thing under the thumb about to press it
	 *  (`components.md` § 12). */
	label: string;
	op: ContinuationOp;
	disabled: boolean;
	accessibilityLabel: string;
}

export interface ComposerControls {
	primary: PrimaryControl;
	/** Stop is a separate control beside the primary, and it exists exactly while
	 *  a turn is running. */
	stopVisible: boolean;
	/** A send is in flight: the primary reads `…` and is disabled. */
	sending: boolean;
	/** Why the primary is disabled, when the reason is one the reader must be
	 *  told. `null` when it is disabled for the self-evident reason (no draft). */
	disabledReason: string | null;
}

export interface ComposerControlInput {
	streaming: boolean;
	hasDraft: boolean;
	hasImages: boolean;
	/** A send is in flight. */
	sending: boolean;
	/** An instruction is retained whose delivery is unknown. */
	envelopePending: boolean;
	/** The session has ended, so nothing can be sent to it. */
	ended: boolean;
}

/**
 * The send / steer / stop morph (`components.md` § 12), in one function.
 *
 * The morph is the COMMAND, not the glyph: the same control, in the same place,
 * sends `prompt` when the session is idle and `steer` when a turn is running.
 * That is the part a naive port gets wrong by reading `streaming` at a different
 * moment than the send does — so the op is computed here, once, and handed to the
 * sender rather than recomputed at the call site.
 */
export const composerControls = (
	input: ComposerControlInput,
): ComposerControls => {
	const op = chooseOp(input.streaming);
	const hasContent = input.hasDraft || input.hasImages;
	/* An unresolved instruction blocks the primary: sending a second, differently
	 * keyed instruction while the first may already be admitted is the duplicate
	 * hazard, and the disabled control must say why (U4). */
	const blocked = input.envelopePending;
	/* A retry with an EMPTY draft is sendable on the reference client (it replays
	 * the envelope's own bytes), and it is the reason the check below is not simply
	 * `!hasContent`: but the primary is deliberately NOT that control. The retry
	 * lives on its own control in the alert, so the primary stays disabled and its
	 * hint says which act resolves it — one control, one meaning. */
	const disabled = input.sending || blocked || input.ended || !hasContent;
	return {
		primary: {
			kind: input.streaming ? "steer" : "send",
			// `↑` whatever the op: the spec's morph is "same control, same place,
			// different command". The word lives in the accessible label, not on the
			// face, because a 96 pt "Steer" pill squeezed the field at 320 pt until its
			// placeholder broke mid-word (captured frame, iphone-se).
			label: input.sending ? "…" : "↑",
			op,
			disabled,
			accessibilityLabel: input.sending
				? "Sending"
				: input.streaming
					? "Steer the running turn"
					: "Send message",
		},
		stopVisible: input.streaming,
		sending: input.sending,
		disabledReason: blocked ? COMPOSER_COPY.retryDisabledHint : null,
	};
};

/* -------------------------------------------------------------- the envelope */

/** What a send's outcome means for the READER. */
export type SendReceipt =
	/** Delivery is unknown. Keep the envelope and offer the retry. */
	| { kind: "ambiguous"; message: string }
	/** A pre-admission rejection. Clear the envelope; a replay is never useful. */
	| { kind: "rejected"; message: string }
	/** `401`: the identity that owned the envelopes is gone. Clear them all. */
	| { kind: "sign-out"; message: string };

/**
 * Read a failure into the sentence the reader sees and the class of outcome it is.
 *
 * This deliberately does NOT decide the envelope's fate. That decision belongs to
 * `settleOutcomeFromError`, which maps the same `RelayError` onto the store's own
 * four outcomes — the store already knows the status table, and a second copy of
 * it here is how one failure ends up with two rules. What this function owns is the
 * wording, because wording is a product decision and the store has no opinion on it.
 */
export const receiptForError = (error: RelayError): SendReceipt => {
	/*
	 * The sentence, in the order the three sources deserve to be trusted:
	 *
	 *   1. `detail` — the GATEWAY's own sentence, written for a phone and already
	 *      reviewed (`RELAY_DETAIL`). It is the product's vocabulary.
	 *   2. `serverError` — the relay's or the edge's own `error` string / body text,
	 *      which is also product copy ("Tunnel temporarily unavailable").
	 *   3. the product's own sentence for the class.
	 *
	 * `error.message` is deliberately NOT in that list, and neither is
	 * `displayableMessage()` — which falls back to it. A transport error's message is
	 * the RUNTIME's prose ("Load failed", "Failed to fetch", a platform string), and
	 * surfacing it was a shipped first impression of a failure (U3). A class with no
	 * relay-supplied sentence gets the product's words instead.
	 */
	const message =
		relaySentence(error) ??
		(error.kind === "ambiguous-delivery"
			? COMPOSER_COPY.steerError
			: COMPOSER_COPY.continuationError);
	if (error.envelope === "clear-all") return { kind: "sign-out", message };
	if (error.envelope === "keep") return { kind: "ambiguous", message };
	return { kind: "rejected", message };
};

/**
 * Read a `200` acknowledgement.
 *
 * `duplicate` is not on the wire — the relay maps the runtime's ack to
 * `{"ok": true, "detail": "..."}` and the flag is lost — so the client derives it
 * from the one sentence the contract says it will see, and treats it as a SUCCESS
 * either way. It matters only for the receipt's wording: "already admitted" means
 * the reader's instruction is in the transcript and no second row was created
 * (§ 5.2), which is the outcome they wanted.
 */
/* ------------------------------------------------------- the draft after an ack */
/** The sentence for a failure whose outcome is ambiguous and which arrived while
 *  a turn was running. A live steer reads differently from a fresh prompt, because
 *  "couldn't send this instruction" and "couldn't continue this conversation" are
 *  two different expectations about what the session was doing. */
export const ambiguousMessage = (streaming: boolean): string =>
	streaming ? COMPOSER_COPY.steerError : COMPOSER_COPY.continuationError;

/* ------------------------------------------------------- the draft after an ack */

export interface DraftPayload {
	text: string;
	images?: PromptImage[];
}

/**
 * Whether the acknowledged envelope is the instruction the reader can still see.
 *
 * This is the `U1`/D11 case: the retained envelope predates an edit, so the ack
 * proves THAT instruction was delivered and says nothing about the draft in front
 * of the reader. Comparing them is what keeps the app from clearing a draft the
 * owner never sent — an acknowledgement presented as delivery of content the
 * server never received.
 *
 * Images are compared as the wire form, in order: the same bytes in the same
 * order is the same instruction.
 */
export const acknowledgedCurrentDraft = (
	envelope: DraftPayload,
	current: DraftPayload,
): boolean => {
	if (envelope.text !== current.text) return false;
	return (
		JSON.stringify(envelope.images ?? null) ===
		JSON.stringify(current.images ?? null)
	);
};

/* --------------------------------------------------------------- attachments */

/**
 * The unit the reader sees for an attachment's cost, before send.
 *
 * Base64 is the wire form and is 4/3 of the bytes plus padding, so a reader shown
 * the encoded length would be shown a number a third too large. The estimate is
 * labelled as one for that reason.
 */
export const attachmentLabel = (image: PromptImage): string => {
	const encoded = image.data_b64.length;
	const bytes = Math.floor((encoded * 3) / 4);
	const kb = bytes / 1024;
	const size =
		kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.round(kb)} KB`;
	const kind = image.mime_type.replace("image/", "").toUpperCase();
	return `${kind} · ${size}`;
};

/**
 * The long edge a phone photo is downscaled to before upload.
 *
 * 1568 px is the session's own bound, and matching it here means the rebound the
 * runtime would otherwise do on the way in costs no pixels (`components.md` § 12).
 * The web client's canvas path, reproduced natively by the attachment component.
 */
export const MAX_IMAGE_EDGE = 1568;
