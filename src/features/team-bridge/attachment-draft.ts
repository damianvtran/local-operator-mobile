import { type ChipStatus, dataUri } from "@/team-bridge/attachments";
import { isHubError } from "@/team-bridge/client";

/**
 * The composer's staged images: one chip per picked/pasted image, from
 * conversion through upload to the id a send carries.
 *
 * WHY A PLAIN CONTROLLER. The chip lifecycle (prepare → upload → ready, with
 * failure, retry and removal at every step) is the part most likely to go
 * subtly wrong, and the unit suite has no React Native host. So it is a small
 * observable object with injected effects, rendered by the thread screen.
 *
 * RULES IT HOLDS:
 * - At most `maxCount` chips (the hub's `status.attachments.max_count`, ≤ 4).
 *   Extra picks are refused with a sentence, never silently dropped.
 * - A removed chip is gone at once; if it had already uploaded, the staged
 *   image is deleted on the hub (best effort, the hub's 72 h staged expiry is
 *   the backstop). A removal that races an upload deletes the id on arrival.
 * - Retry re-runs only the step that failed: the bounded bytes are kept after
 *   a failed upload so a retry does not re-convert.
 * - Nothing about an image (bytes, id, size) is ever logged. The preview is an
 *   in-memory `data:` URI of the bounded bytes, dropped with the chip.
 */

export interface Prepared {
	bytes: Uint8Array;
	mime: "image/png" | "image/jpeg";
	width: number;
	height: number;
}

export interface DraftChip {
	key: string;
	status: ChipStatus;
	/** In-memory preview of the bounded image; absent until converted. */
	preview: string | null;
	attachmentId: string | null;
	/** A content-free sentence for a failed chip. */
	error: string | null;
	/**
	 * Whether Retry can change the outcome. A refusal the hub will repeat for
	 * the same bytes (413/415/422 = `invalid`, or an expired staged image) is
	 * final: the chip offers only Remove, never a futile retry.
	 */
	retryable: boolean;
}

interface Entry extends DraftChip {
	raw: unknown;
	prepared: Prepared | null;
	removed: boolean;
}

/**
 * The chip's sentence and retry affordance for one failed step, from the
 * hub's error class. Content-free on purpose: no size, type or id is echoed.
 */
function failureOf(
	error: unknown,
	step: "prepare" | "upload",
): { error: string; retryable: boolean } {
	if (step === "prepare")
		return { error: "This image could not be prepared.", retryable: true };
	const kind = isHubError(error) ? error.kind : null;
	if (kind === "invalid")
		return {
			error: "Radient cannot accept this image. Remove it.",
			retryable: false,
		};
	if (kind === "rate_limited")
		return {
			error: "Too many images at once. Try again shortly.",
			retryable: true,
		};
	/*
	 * 409 `attachment_quota_exceeded`: this account already has 8 images
	 * waiting to be sent in this organization (staged in other drafts too, for
	 * up to 72 h). Retrying repeats the 409 until one of those is sent or
	 * removed, so the chip is final and says what frees a slot.
	 */
	if (
		kind === "conflict" &&
		isHubError(error) &&
		error.code === "attachment_quota_exceeded"
	)
		return {
			error:
				"You have 8 images waiting to send. Send or remove some, then add this one again.",
			retryable: false,
		};
	if (kind === "not_found")
		return {
			error: "This conversation is no longer available. Remove the image.",
			retryable: false,
		};
	return { error: "This image did not upload.", retryable: true };
}

export function createAttachmentDraft(deps: {
	maxCount: number;
	prepare: (raw: unknown) => Promise<Prepared>;
	upload: (bytes: Uint8Array) => Promise<{ id: string }>;
	discard: (attachmentId: string) => Promise<void>;
	/**
	 * Release a picked source's on-device copy (the picker writes a
	 * full-resolution original, EXIF included, into the app cache). Called once
	 * the source is no longer needed: after a successful convert, or when the
	 * chip is removed/disposed. Never throws.
	 */
	releaseSource?: (raw: unknown) => void;
	onChange: () => void;
}) {
	let entries: Entry[] = [];
	let counter = 0;
	let snapshot: DraftChip[] = [];
	/*
	 * Ids handed to a send that has not settled. `dispose` (Back while sending)
	 * must not DELETE them: the DELETE and the send's bind race on separate
	 * requests, and a DELETE that wins turns the send into a 404 on a screen
	 * that is gone. The hub's staged expiry is the backstop if that send fails.
	 */
	let sending: ReadonlySet<string> = new Set();

	const publish = () => {
		snapshot = entries.map(
			({ key, status, preview, attachmentId, error, retryable }) => ({
				retryable,
				key,
				status,
				preview,
				attachmentId,
				error,
			}),
		);
		deps.onChange();
	};

	const limitNotice = (): string =>
		`You can attach up to ${deps.maxCount} ${deps.maxCount === 1 ? "image" : "images"} per message.`;

	const release = (entry: Entry) => {
		if (entry.raw === null || entry.raw === undefined) return;
		const raw = entry.raw;
		entry.raw = null;
		try {
			deps.releaseSource?.(raw);
		} catch {
			/* A leftover cache file is the OS's to clear; never fail the chip. */
		}
	};

	const discard = (id: string) => {
		if (sending.has(id)) return;
		void deps.discard(id).catch(() => undefined);
	};

	async function run(entry: Entry): Promise<void> {
		try {
			if (!entry.prepared) {
				entry.status = "preparing";
				entry.error = null;
				publish();
				let prepared: Prepared;
				try {
					prepared = await deps.prepare(entry.raw);
				} catch (error) {
					if (entry.removed) return;
					entry.status = "failed";
					Object.assign(entry, failureOf(error, "prepare"));
					publish();
					return;
				}
				if (entry.removed) return;
				entry.prepared = prepared;
				entry.preview = dataUri(prepared.mime, prepared.bytes);
				// The bounded bytes are all an upload or retry needs from here.
				release(entry);
			}
			entry.status = "uploading";
			entry.error = null;
			entry.retryable = true;
			publish();
			const answer = await deps.upload(entry.prepared.bytes);
			if (entry.removed) {
				discard(answer.id);
				return;
			}
			entry.attachmentId = answer.id;
			entry.status = "ready";
			// The bytes are on the hub now; keep only the preview.
			entry.prepared = null;
			publish();
		} catch (error) {
			if (entry.removed) return;
			entry.status = "failed";
			Object.assign(entry, failureOf(error, "upload"));
			publish();
		}
	}

	return {
		chips: (): DraftChip[] => snapshot,

		/** How many more images may be added now. */
		remaining: (): number => Math.max(0, deps.maxCount - entries.length),

		/**
		 * Add picked/pasted images. Returns a refusal sentence when some did not
		 * fit under the per-message limit (the rest are still added).
		 */
		add(sources: readonly unknown[]): string | null {
			const room = Math.max(0, deps.maxCount - entries.length);
			const accepted = sources.slice(0, room);
			for (const raw of accepted) {
				counter += 1;
				const entry: Entry = {
					key: `chip-${counter}`,
					status: "preparing",
					preview: null,
					attachmentId: null,
					error: null,
					retryable: true,
					raw,
					prepared: null,
					removed: false,
				};
				entries = [...entries, entry];
				void run(entry);
			}
			publish();
			return accepted.length < sources.length ? limitNotice() : null;
		},

		limitNotice,

		retry(key: string): void {
			const entry = entries.find((e) => e.key === key);
			if (entry?.status === "failed" && entry.retryable) void run(entry);
		},

		remove(key: string): void {
			const entry = entries.find((e) => e.key === key);
			if (!entry) return;
			entry.removed = true;
			entries = entries.filter((e) => e !== entry);
			release(entry);
			if (entry.attachmentId) discard(entry.attachmentId);
			publish();
		},

		/** The ids a send carries, in chip order. Valid only when all are ready. */
		attachmentIds: (): string[] =>
			entries.flatMap((e) => (e.attachmentId ? [e.attachmentId] : [])),

		/**
		 * Fence ids for the duration of a send (`dispose` skips them). Returns
		 * the release to call when the send settles, either way.
		 */
		beginSend(ids: readonly string[]): () => void {
			const fenced = new Set(ids);
			sending = new Set([...sending, ...fenced]);
			return () => {
				sending = new Set([...sending].filter((id) => !fenced.has(id)));
			};
		},

		/**
		 * The hub answered a send with `404 attachment_not_found`: a staged image
		 * expired (72 h) or was already used. Retrying the same ids repeats the
		 * 404, so every ready chip becomes a final failure the reader removes.
		 */
		markExpired(): void {
			for (const entry of entries) {
				if (entry.status !== "ready") continue;
				entry.status = "failed";
				entry.error = "This image expired before it was sent. Remove it.";
				entry.retryable = false;
			}
			publish();
		},

		/**
		 * After a confirmed send: the hub bound these ids to the message, so the
		 * chips go WITHOUT a delete (deleting a bound image is refused anyway).
		 */
		clearSent(): void {
			for (const entry of entries) entry.removed = true;
			entries = [];
			publish();
		},

		/** Leaving the conversation unsent: staged images are released. */
		dispose(): void {
			for (const entry of entries) {
				entry.removed = true;
				release(entry);
				if (entry.attachmentId) discard(entry.attachmentId);
			}
			entries = [];
			snapshot = [];
		},

		/** The strip's visible summary line; see `stripSummary`. */
		summary: (): string => stripSummary(entries),
	};
}

export type AttachmentDraft = ReturnType<typeof createAttachmentDraft>;

/**
 * How the composer explains a failed send that carried images.
 *
 * `expired` ONLY for the hub's `attachment_not_found` (a staged image expired
 * after 72 h, or was already bound). The same 404 status also carries
 * `conversation_not_found` (the reader left or was removed, or the
 * conversation is gone): calling that "image expired" would tell them to remove
 * images that are not the problem, so it stays on the generic path.
 */
export function sendFailureOf(
	error: unknown,
	attachmentIds: readonly string[],
): "expired" | "generic" {
	return attachmentIds.length > 0 &&
		isHubError(error) &&
		error.code === "attachment_not_found"
		? "expired"
		: "generic";
}

export interface HeldDraft {
	draft: AttachmentDraft;
	conversationId: string;
}

/**
 * The thread screen's one draft for the current capability and conversation.
 *
 * - Capability withdrawn (a status refresh after a hub rollback): the held
 *   draft is DISPOSED (its staged ids released) and nothing is held. The strip
 *   disappears with it, and a later text send can never carry invisible
 *   `attachment_ids` that an older hub answers 400.
 * - A different conversation: the old draft is disposed and a new one created.
 * - No conversation yet (a draft DM before its first send): nothing is held;
 *   an upload needs a conversation id.
 */
export function syncDraft(
	held: HeldDraft | null,
	limits: { maxCount: number } | null,
	conversationId: string | null,
	create: (
		limits: { maxCount: number },
		conversationId: string,
	) => AttachmentDraft,
): HeldDraft | null {
	if (!limits || !conversationId) {
		held?.draft.dispose();
		return null;
	}
	if (held && held.conversationId === conversationId) return held;
	held?.draft.dispose();
	return { draft: create(limits, conversationId), conversationId };
}

const images = (n: number) => `${n} ${n === 1 ? "image" : "images"}`;

/**
 * The composer's ONE image status line (design D9, code R3-05): one sentence
 * for one fix, and one live region, instead of a summary plus a separate
 * reason line that a screen reader announced twice.
 *
 * Priority: what needs the reader's hand (failures), then what they wait on
 * (uploads), then the plain count. A failure whose reason is final and shared
 * by every failed chip is shown VERBATIM (design D8): the quota sentence, a
 * refused type, an expired image. Those reasons are not "didn't upload, remove
 * them", and the quota one is not fixed by removing these images at all.
 */
export function stripSummary(
	chips: ReadonlyArray<Pick<DraftChip, "status" | "retryable" | "error">>,
): string {
	if (chips.length === 0) return "";
	const failed = chips.filter((c) => c.status === "failed");
	const busy = chips.filter(
		(c) => c.status === "preparing" || c.status === "uploading",
	).length;
	if (failed.length > 0) {
		const one = failed.length === 1;
		const reasons = new Set(failed.map((c) => c.error));
		const shared = reasons.size === 1 ? [...reasons][0] : null;
		if (shared && failed.every((c) => !c.retryable)) return shared;
		if (failed.some((c) => c.retryable))
			return one
				? "1 image didn't upload. Retry or remove it."
				: `${failed.length} images didn't upload. Retry or remove them.`;
		return one
			? "1 image can't be sent. Remove it to send."
			: `${failed.length} images can't be sent. Remove them to send.`;
	}
	if (busy > 0)
		return `Uploading ${images(busy)}… Send is available when ${busy === 1 ? "it finishes" : "they finish"}.`;
	return `${images(chips.length)} attached`;
}

/**
 * The short state word drawn ON a chip, under its thumbnail. The full sentence
 * is the summary line and the chip's accessible label; this is what a sighted
 * reader scanning the strip sees on each image.
 */
export function chipStateLabel(
	chip: Pick<DraftChip, "status" | "retryable">,
): string | null {
	if (chip.status === "preparing") return "Preparing…";
	if (chip.status === "uploading") return "Uploading…";
	if (chip.status === "failed") return chip.retryable ? "Failed" : "Can't send";
	return null;
}

/**
 * Why Send is disabled, in words, or `null` when it is not blocked by images
 * (design round 1, D4). Empty text with no images needs no sentence: the empty
 * field already says it.
 */
export function sendBlockedReason(
	chips: ReadonlyArray<Pick<DraftChip, "status" | "retryable">>,
): string | null {
	if (chips.some((c) => c.status === "failed"))
		return chips.some((c) => c.status === "failed" && !c.retryable)
			? "Remove the images that can't be sent to send this message."
			: "Retry or remove the images that didn't upload to send.";
	if (chips.some((c) => c.status === "preparing" || c.status === "uploading"))
		return "Send is available when the images finish uploading.";
	return null;
}

/**
 * Hit rectangles for a chip's two controls, relative to the chip's top-left
 * (design D7/D12, code R3-02). Each is a full 44 pt square and the two are
 * DISJOINT: Remove owns the top band (y < 38), Retry the band below it
 * (y ≥ 38). `outset` is how far a target reaches past the chip edge; the strip
 * pads its content by the same amount so no target is clipped by the
 * ScrollView (which clips on iOS, Android and web alike).
 */
export const CHIP_CONTROL_OUTSET = 6;

/**
 * The visible 24 pt badges inside those hit rects, and the state word's row,
 * in chip coordinates (design D13). The hit rects stay 44 pt; only the drawn
 * badge moves. Retry's badge sits on the thumbnail's bottom-left corner, top
 * of its hit rect, so it ends 2 pt ABOVE the thumbnail's bottom edge and
 * never draws over the state word ("Failed") centred in the row below.
 * The label row is taken at full chip width: the word's own width varies
 * with copy and text scale, and the badge must clear any of them.
 */
export const CHIP_BADGE_SIZE = 24;
/** `pt-0.5` above the word, and `text-meta`'s 12 × 1.4 line box. */
const CHIP_LABEL_TOP_GAP = 2;
const CHIP_LABEL_LINE = 12 * 1.4;
export function chipBadgeRects(chipSize: number, target: number) {
	const hit = chipControlRects(chipSize, target);
	const o = CHIP_CONTROL_OUTSET;
	const s = CHIP_BADGE_SIZE;
	return {
		remove: {
			x: hit.remove.x + target - o - s,
			y: hit.remove.y + o,
			width: s,
			height: s,
		},
		retry: { x: hit.retry.x + o, y: hit.retry.y, width: s, height: s },
		label: {
			x: 0,
			y: chipSize + CHIP_LABEL_TOP_GAP,
			width: chipSize,
			height: CHIP_LABEL_LINE,
		},
	};
}

/**
 * The strip's box model (R4-02). The margin is on the ScrollView, so its
 * viewport grows by the outset on every side; the padding is on the scroll
 * CONTENT, so the chips sit `outset` inside that viewport. Net chip position
 * in the parent: margin + padding = 0, unchanged. Putting both on the same
 * inner View cancels them (its margin box shrinks back to the chips).
 */
export const CHIP_STRIP_LAYOUT = {
	scroll: { margin: -CHIP_CONTROL_OUTSET },
	content: { padding: CHIP_CONTROL_OUTSET },
} as const;
export function chipControlRects(
	chipSize: number,
	target: number,
): {
	remove: { x: number; y: number; width: number; height: number };
	retry: { x: number; y: number; width: number; height: number };
} {
	const o = CHIP_CONTROL_OUTSET;
	const removeBottom = -o + target;
	return {
		remove: {
			x: chipSize + o - target,
			y: -o,
			width: target,
			height: target,
		},
		retry: { x: -o, y: removeBottom, width: target, height: target },
	};
}
