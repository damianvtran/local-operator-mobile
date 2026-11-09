import type {
	HistoryResponse,
	SessionProjection,
	TranscriptEntry,
} from "@/contracts";
import { mergeTranscript, rowIdentity } from "./runtime";

/** The relay fold mints these non-journal ids. They cannot be before-cursors;
 * served tool aliases (<message>:call_<call>) remain journal-addressable. Keep
 * this protocol list aligned with Core mobile/web/src/components/transcript. */
const LIVE_ONLY_ROW_PREFIXES = [
	"rz-",
	"tc-",
	"nt-",
	"rt-",
	"err-",
	"rej-",
	"cx-",
	"peer-",
	"nonpeer-",
	"prompt:",
];
export const journalAddressableRow = (row: TranscriptEntry): boolean =>
	row.kind !== "reasoning" &&
	!!row.id &&
	!LIVE_ONLY_ROW_PREFIXES.some((prefix) => row.id.startsWith(prefix));

/** A screen-owned reader, not a second transcript store. Capped projections are
 * not deletion signals: keep accepted server rows until this reader is retired.
 * The wire has no retention generation, so unseen prunes cannot be inferred. */
export class HistoryWindow {
	rows: TranscriptEntry[] = [];
	cursor: string | undefined;
	/** Only a canonical before-page can establish the retained beginning. */
	olderState: "unknown" | "more" | "end" = "unknown";
	hasMore = true;
	hasGap = false;
	loading = false;
	error: string | null = null;
	read: "unknown" | "ok" | "failed" = "unknown";
	private active = true;
	private lease = 0;
	private projection: SessionProjection | null = null;
	private detached: TranscriptEntry[] = [];
	private visibleSource: TranscriptEntry[] | null = null;
	private visible: TranscriptEntry[] = [];
	private cursors = new Set<string>();
	private durableIds = new Set<string>();
	private revision = 0;
	private liveAt = new Map<string, number>();
	private pending: Promise<void> | null = null;

	constructor(
		private fetchPage: (before?: string) => Promise<HistoryResponse>,
		private changed: () => void,
	) {}

	/** Detached opener context is cached but not interleaved into a contiguous
	 * newest page. It returns to the list when its own durable page is reached. */
	get visibleRows(): TranscriptEntry[] {
		if (this.visibleSource !== this.rows) {
			const detached = new Set(this.detached.map(rowIdentity));
			this.visible = this.rows.filter((row) => !detached.has(rowIdentity(row)));
			this.visibleSource = this.rows;
		}
		return this.visible;
	}

	accept(projection: SessionProjection | null): void {
		if (!this.active || !projection || projection === this.projection) return;
		this.projection = projection;
		if (this.cursor === undefined && this.olderState === "unknown") {
			this.seedCursor(projection.transcript, projection.transcript_head_pinned);
		}
		// HTTP may win the opening race. Classify a detached live prefix against
		// durable identities on that path too, not only when the first page lands.
		if (this.read === "ok" && this.cursor !== undefined) {
			const firstDurable = projection.transcript.findIndex((row) =>
				this.durableIds.has(rowIdentity(row)),
			);
			if (firstDurable > 0) {
				const context = new Map(
					this.detached.map((row) => [rowIdentity(row), row]),
				);
				for (const row of projection.transcript.slice(0, firstDurable))
					context.set(rowIdentity(row), row);
				this.detached = [...context.values()];
			}
		}
		for (const row of projection.transcript) {
			this.liveAt.set(rowIdentity(row), ++this.revision);
		}
		const pinned = new Set(this.detached.map(rowIdentity));
		const spine = this.rows.filter((row) => !pinned.has(rowIdentity(row)));
		const frame = projection.transcript.filter(
			(row) => !pinned.has(rowIdentity(row)),
		);
		if (this.read === "ok" && spine.length > 0 && frame.length > 0) {
			const previous = new Set(spine.map(rowIdentity));
			// The opener is context, never evidence that two capped tails overlap.
			// Without a durable reconnect witness, do not call unseen rows complete.
			if (!frame.some((row) => previous.has(rowIdentity(row))))
				this.hasGap = true;
		}
		this.detached = this.detached.map(
			(row) =>
				projection.transcript.find(
					(live) => rowIdentity(live) === rowIdentity(row),
				) ?? row,
		);
		this.rows = [
			...this.detached,
			...mergeTranscript({ transcript: frame } as SessionProjection, spine)
				.rows,
		];
	}

	/** Same bootstrap domain as the relay: the projection is a newest render,
	 * not evidence about older retention. Never fall back to a pinned opener
	 * when the rest of the tail contains only fold-minted rows. */
	private seedCursor(rows: TranscriptEntry[], headPinned?: boolean): void {
		const pinned =
			headPinned ?? (rows.length >= 80 && rows[0]?.kind === "user");
		// Capped wire projections carry at most opener + 79 tail rows. A
		// legacy oversized render can also re-inject preserved compaction turns:
		// those are context too, never the newest tail's chronological cursor.
		const tail = pinned ? rows.slice(Math.max(1, rows.length - 79)) : rows;
		if (pinned) this.detached = rows.slice(0, rows.length - tail.length);
		const detachedIds = new Set(this.detached.map(rowIdentity));
		// A no-cursor fallback can repeat the known pinned opener while the
		// whole tail is minted. It still cannot turn that context into a cursor.
		const addressable = tail.filter(
			(row) => !detachedIds.has(rowIdentity(row)) && journalAddressableRow(row),
		);
		const candidate = addressable[0];
		if (!candidate) return;
		this.cursor = candidate.id;
		this.cursors.add(candidate.id);
		for (const row of addressable) this.durableIds.add(rowIdentity(row));
	}

	load(refresh = false): Promise<void> {
		if (!this.active || (!refresh && !this.hasMore)) return Promise.resolve();
		if (this.pending) return this.pending;
		const before = refresh && this.read === "ok" ? undefined : this.cursor;
		const lease = this.lease;
		const started = this.revision;
		this.loading = true;
		this.error = null;
		this.changed();
		this.pending = Promise.resolve()
			.then(() => this.fetchPage(before))
			.then((page) => {
				if (!this.active || lease !== this.lease) return;
				if (page.unavailable) throw new Error("failed");
				const next = page.entries.find(journalAddressableRow)?.id;
				// Cursor progress is independent of the detached opener in live frames.
				// A lying/overlapping page must not create an automatic request loop.
				if (
					page.has_more &&
					(!next ||
						next === before ||
						(before !== undefined && this.cursors.has(next)))
				) {
					throw new Error("stalled");
				}
				const accepted = new Map(
					this.rows.map((row) => [rowIdentity(row), row]),
				);
				const authoritative = page.entries.map((row) =>
					(this.liveAt.get(rowIdentity(row)) ?? 0) > started
						? (accepted.get(rowIdentity(row)) ?? row)
						: row,
				);
				const pageIds = new Set(authoritative.map(rowIdentity));
				for (const id of pageIds) this.durableIds.add(id);
				if (this.cursor === undefined && this.rows.length > 0) {
					// The live fold may pin an opener before a detached newest window.
					// Keep it as context, not as a durable cursor or a prepend anchor.
					const firstShared = this.rows.findIndex((row) =>
						pageIds.has(rowIdentity(row)),
					);
					if (firstShared > 0) this.detached = this.rows.slice(0, firstShared);
				}
				if (before !== undefined) {
					this.detached = this.detached.filter(
						(row) => !pageIds.has(rowIdentity(row)),
					);
				}
				const detachedIds = new Set(this.detached.map(rowIdentity));
				const held = this.rows.filter(
					(row) =>
						!pageIds.has(rowIdentity(row)) &&
						!detachedIds.has(rowIdentity(row)),
				);
				// Cursor pages state journal order, even for preserved turns re-injected
				// by compaction's render. Move overlapping copies to that stated position.
				// A refresh is a newest tail: it must not prepend newer rows over history.
				const joined =
					before === undefined && this.cursor !== undefined
						? mergeTranscript(
								{ transcript: authoritative } as SessionProjection,
								this.rows.filter((row) => !detachedIds.has(rowIdentity(row))),
							).rows
						: [...authoritative, ...held];
				this.rows = [...this.detached, ...joined];
				if (before !== undefined) {
					this.cursor = next ?? before;
					if (next) this.cursors.add(next);
					this.hasMore = page.has_more;
					this.olderState = page.has_more ? "more" : "end";
				} else if (this.cursor === undefined) {
					// Rare cold/no-addressable-live-tail fallback: this endpoint returns a
					// rendered seed. Its has_more is NOT a retained-journal verdict.
					this.seedCursor(page.entries);
					if (this.cursor === undefined) throw new Error("failed");
				}
				this.read = "ok";
			})
			.catch((error: unknown) => {
				if (!this.active || lease !== this.lease) return;
				this.error =
					error instanceof Error && error.message === "stalled"
						? "stalled"
						: "failed";
				this.read = "failed";
			})
			.finally(() => {
				if (!this.active || lease !== this.lease) return;
				this.pending = null;
				this.loading = false;
				this.changed();
			});
		return this.pending;
	}

	/** Explicitly jump back to the current durable tail. Background refresh must
	 * keep the reader's pages; only this user action discards its old read domain.
	 * Advancing the lease fences both success and failure of an old pending page. */
	reload(): Promise<void> {
		if (!this.active) return Promise.resolve();
		const currentTail = this.projection;
		this.lease += 1;
		this.pending = null;
		this.rows = [];
		this.cursor = undefined;
		this.hasMore = true;
		this.olderState = "unknown";
		this.hasGap = false;
		this.loading = false;
		this.error = null;
		this.read = "unknown";
		this.projection = null;
		this.detached = [];
		this.visibleSource = null;
		this.cursors.clear();
		this.durableIds.clear();
		this.liveAt.clear();
		this.revision = 0;
		// Re-seed from the current stream frame, not the retired page islands.
		// This also preserves a known pinned-head exclusion during rare fallback.
		this.accept(currentTail);
		return this.load();
	}

	activate(): void {
		this.active = true;
	}

	retire(): void {
		this.active = false;
		this.lease += 1;
		this.pending = null;
		this.loading = false;
	}
}
