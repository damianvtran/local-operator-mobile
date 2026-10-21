import { type ChipStatus, dataUri } from "@/team-bridge/attachments";

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
}

interface Entry extends DraftChip {
	raw: unknown;
	prepared: Prepared | null;
	removed: boolean;
}

export function createAttachmentDraft(deps: {
	maxCount: number;
	prepare: (raw: unknown) => Promise<Prepared>;
	upload: (bytes: Uint8Array) => Promise<{ id: string }>;
	discard: (attachmentId: string) => Promise<void>;
	onChange: () => void;
}) {
	let entries: Entry[] = [];
	let counter = 0;
	let snapshot: DraftChip[] = [];

	const publish = () => {
		snapshot = entries.map(({ key, status, preview, attachmentId, error }) => ({
			key,
			status,
			preview,
			attachmentId,
			error,
		}));
		deps.onChange();
	};

	const limitNotice = (): string =>
		`You can attach up to ${deps.maxCount} ${deps.maxCount === 1 ? "image" : "images"} per message.`;

	const discard = (id: string) => {
		void deps.discard(id).catch(() => undefined);
	};

	async function run(entry: Entry): Promise<void> {
		try {
			if (!entry.prepared) {
				entry.status = "preparing";
				entry.error = null;
				publish();
				const prepared = await deps.prepare(entry.raw);
				if (entry.removed) return;
				entry.prepared = prepared;
				entry.preview = dataUri(prepared.mime, prepared.bytes);
			}
			entry.status = "uploading";
			entry.error = null;
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
			entry.raw = null;
			publish();
		} catch {
			if (entry.removed) return;
			entry.status = "failed";
			entry.error = entry.prepared
				? "This image did not upload."
				: "This image could not be prepared.";
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
			if (entry?.status === "failed") void run(entry);
		},

		remove(key: string): void {
			const entry = entries.find((e) => e.key === key);
			if (!entry) return;
			entry.removed = true;
			entries = entries.filter((e) => e !== entry);
			if (entry.attachmentId) discard(entry.attachmentId);
			publish();
		},

		/** The ids a send carries, in chip order. Valid only when all are ready. */
		attachmentIds: (): string[] =>
			entries.flatMap((e) => (e.attachmentId ? [e.attachmentId] : [])),

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
