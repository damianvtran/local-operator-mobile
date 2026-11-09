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

/** Core caps a live frame to its first user message plus the newest 79 rows and
 * says so with `transcript_head_pinned`. Older wires lack the flag, so infer the
 * same shape they produced. */
const headPinned = (rows: TranscriptEntry[], flag?: boolean): boolean =>
	flag ?? (rows.length >= 80 && rows[0]?.kind === "user");

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
	/** Which request `error` belongs to, so a retry repeats THAT request: a
	 * failed newest-page read (foreground refresh, reload, cold seed) is retried
	 * as a newest read, never answered by fetching an older page instead. */
	errorScope: "newest" | "older" | null = null;
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
		// The opener is context, never evidence that two capped tails overlap.
		// Once paging reaches the true beginning it is no longer detached, but
		// Core still re-sends it at the head of EVERY capped frame, so a disjoint
		// reconnect tail would otherwise "overlap" through it alone (PR #207 Q2).
		const head = headPinned(
			projection.transcript,
			projection.transcript_head_pinned,
		)
			? projection.transcript[0]
			: undefined;
		if (this.read === "ok" && spine.length > 0)
			this.flagDisjoint(spine, frame, head ? rowIdentity(head) : undefined);
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

	/** The reader cannot claim continuity between what it holds and a newer tail
	 * that shares no row with it: rows between the two are unreachable by older
	 * paging, so surface the gap and its Reload history action. Both `accept()`
	 * (a live frame) and a newest-page refresh (an HTTP page) apply this ONE
	 * test. `context` is the pinned opener, which repeats across disjoint tails;
	 * fold-minted held rows are not journal rows a durable page could share. */
	private flagDisjoint(
		held: TranscriptEntry[],
		incoming: TranscriptEntry[],
		context?: string,
		heldFilter: (row: TranscriptEntry) => boolean = () => true,
	): void {
		const previous = new Set(
			held
				.filter((row) => rowIdentity(row) !== context && heldFilter(row))
				.map(rowIdentity),
		);
		const witness = incoming.filter((row) => rowIdentity(row) !== context);
		// Without a durable reconnect witness, do not call unseen rows complete.
		if (
			previous.size > 0 &&
			witness.length > 0 &&
			!witness.some((row) => previous.has(rowIdentity(row)))
		)
			this.hasGap = true;
	}

	/** Same bootstrap domain as the relay: the projection is a newest render,
	 * not evidence about older retention. Never fall back to a pinned opener
	 * when the rest of the tail contains only fold-minted rows. */
	private seedCursor(rows: TranscriptEntry[], headPinnedFlag?: boolean): void {
		const pinned = headPinned(rows, headPinnedFlag);
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
		// A refresh arriving while an older page is in flight joins that page
		// rather than racing it. Dropping it is safe: the next live frame still
		// runs accept()'s disjoint-tail test, and the foreground/reload refresh is
		// re-fired on the next return, so a hole it would have revealed is still
		// flagged rather than silently bridged (PR #207 R3).
		if (this.pending) return this.pending;
		// After a failed newest read `read` is "failed"; its retry must still ask
		// for the newest page, not the older page at `cursor`.
		const before =
			refresh && (this.read === "ok" || this.errorScope === "newest")
				? undefined
				: this.cursor;
		const lease = this.lease;
		const started = this.revision;
		this.loading = true;
		this.error = null;
		this.errorScope = null;
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
				const refreshing = before === undefined && this.cursor !== undefined;
				const spine = this.rows.filter(
					(row) => !detachedIds.has(rowIdentity(row)),
				);
				if (refreshing) {
					// More than a page appended while backgrounded makes the newest page
					// disjoint from everything held; merging would silently bridge the
					// hole (PR #207 R1). mergeTranscript's holeBelowPage is not used: it
					// also fires on a head insert. Same test accept() applies.
					const opener = this.projection;
					const context =
						opener &&
						headPinned(opener.transcript, opener.transcript_head_pinned) &&
						opener.transcript[0]
							? rowIdentity(opener.transcript[0])
							: undefined;
					this.flagDisjoint(
						spine,
						authoritative,
						context,
						journalAddressableRow,
					);
				}
				const joined = refreshing
					? mergeTranscript(
							{ transcript: authoritative } as SessionProjection,
							spine,
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
				this.errorScope = before === undefined ? "newest" : "older";
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

	/** Repeat the request that failed: a newest-page failure is re-read as the
	 * newest page, an older-page failure re-requests the same cursor. */
	retry(): Promise<void> {
		return this.load(this.errorScope === "newest");
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
		this.errorScope = null;
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
