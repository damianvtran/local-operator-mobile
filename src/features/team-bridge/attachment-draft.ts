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

		/** The accessible summary of the strip ("2 images attached"). */
		summary: (): string =>
			entries.length === 0
				? ""
				: `${entries.length} ${entries.length === 1 ? "image" : "images"} attached`,
	};
}

export type AttachmentDraft = ReturnType<typeof createAttachmentDraft>;
