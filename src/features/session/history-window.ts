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
/** The relay's frame cap: the pinned opener plus the newest 79 rows. */
const FRAME_CAP = 80;
/** ONLY A FRAME AT EXACTLY THE CAP CAN BE INFERRED CAPPED. A flagless frame
 * longer than the cap is not a capped projection at all (a legacy oversized
 * render, or a relay that sent the whole conversation): reading it as
 * "opener + 79" held every row ahead of its last 79 back as hidden context,
 * so a reader handed 520 rows showed 79 of them (PR #207 CI, S5/find-*). */
const headPinned = (rows: TranscriptEntry[], flag?: boolean): boolean =>
	flag ?? (rows.length === FRAME_CAP && rows[0]?.kind === "user");

/** How far an automatic gap fill may walk before it hands the hole to the
 * reader as a quiet notice. A resume after a long background can leave
 * thousands of rows unseen; walking all of them unasked would hold the radio
 * and the relay for minutes. The cap is five pages (the relay serves 80 rows
 * per `before=` page), so up to five round trips; the common
 * return-to-a-running-turn case closes in one or two. The time cap keeps a
 * slow link from hiding the hole behind an invisible fetch. One budget covers
 * a whole run, however many holes it works. */
export const HEAL_BUDGET = { pages: 5, rows: 400, ms: 3000 } as const;

/** `healing`: an automatic or requested gap fill is in flight, so the list
 * shows no notice. `exhausted`: the fill stopped (budget, failure or no
 * progress) with the hole still open; the list shows the quiet notice. */
export type HealState = "idle" | "healing" | "exhausted";

export interface HistoryWindowOptions {
	/** Fill a detected reconnect/refresh hole without the reader acting.
	 * Off by default so the PR #207 reader tests keep pinning the bare
	 * detection contract; the session screen turns it on. */
	autoHeal?: boolean;
	budget?: { pages: number; rows: number; ms: number };
	now?: () => number;
}

/** A screen-owned reader, not a second transcript store. Capped projections are
 * not deletion signals: keep accepted server rows until this reader is retired.
 * The wire has no retention generation, so unseen prunes cannot be inferred. */
export class HistoryWindow {
	rows: TranscriptEntry[] = [];
	cursor: string | undefined;
	/** Only a canonical before-page can establish the retained beginning. */
	olderState: "unknown" | "more" | "end" = "unknown";
	hasMore = true;
	/** EVERY open hole, oldest → newest by list position. Each names the first
	 * row AFTER it (the oldest row of the newer block). A list, not one marker:
	 * two resumes can leave two holes, and tracking only the newest let closing
	 * it declare the transcript complete while the older one was still open —
	 * 621 rows silently missing and "Beginning of retained messages" claimed
	 * over them (PR #217 R1-1). Objects, not ids, so a fill that is in flight
	 * still finds its hole after a refresh moved the hole's boundary. */
	private holes: { before: string }[] = [];
	/** Some retained rows sit in a hole older paging cannot reach. True until
	 * EVERY hole is closed; the beginning is never claimed while it is. */
	get hasGap(): boolean {
		return this.holes.length > 0;
	}
	/** The first row after the newest open hole, so the list marks the gap where
	 * it is (PR #207 U2). The newest is the one a reader at the tail meets
	 * first, and the one the fill works; the next shows once it closes. */
	get gapBefore(): string | null {
		return this.holes.at(-1)?.before ?? null;
	}
	loading = false;
	/** Which read is in flight: the list must not claim "Loading earlier
	 * messages" while a foreground refresh re-reads the NEWEST page (PR #207 D1). */
	loadingScope: "newest" | "older" | null = null;
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
	/** Explicit wire evidence survives a later flagless frame; cap inference
	 * does not. Only a durable page can reconnect a confirmed detached opener. */
	private confirmedPinned = false;
	private visibleSource: TranscriptEntry[] | null = null;
	private visible: TranscriptEntry[] = [];
	private cursors = new Set<string>();
	private durableIds = new Set<string>();
	private revision = 0;
	private liveAt = new Map<string, number>();
	private pending: Promise<void> | null = null;
	/** Gap fill state. The relay has no forward (`after=`) read and no SSE
	 * replay cursor, so a hole between the held rows and a newer tail is closed
	 * by walking `before=` pages back from the oldest row of the newer island
	 * until a page shares a row with the island below the hole. */
	healState: HealState = "idle";
	private healRun: Promise<void> | null = null;

	constructor(
		private fetchPage: (before?: string) => Promise<HistoryResponse>,
		private changed: () => void,
		private options: HistoryWindowOptions = {},
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
		// INVARIANT: every row of an accepted live frame is displayed. The one
		// exception is the single pinned opener of a capped frame, which is
		// context detached from the newest window until paging reaches it. Rows
		// with live-only ids are merely never cursors; they are never hidden.
		const openerOf = headPinned(
			projection.transcript,
			projection.transcript_head_pinned,
		)
			? projection.transcript[0]
			: undefined;
		// A frame that pins no opener retires context an earlier INFERENCE
		// detached (a flagless 80-row page opening on a user row): the frame
		// holds that row in place, so it is shown.
		if (projection.transcript_head_pinned !== undefined)
			this.confirmedPinned = projection.transcript_head_pinned;
		if (!openerOf && !this.confirmedPinned) this.detached = [];
		// HTTP may win the opening race. Classify the pinned opener against
		// durable identities on that path too, not only when the first page lands.
		else if (
			openerOf &&
			this.read === "ok" &&
			this.cursor !== undefined &&
			!this.durableIds.has(rowIdentity(openerOf)) &&
			!this.detached.some((row) => rowIdentity(row) === rowIdentity(openerOf))
		) {
			this.detached = [...this.detached, openerOf];
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
		const head = openerOf;
		const disjoint =
			this.read === "ok" &&
			spine.length > 0 &&
			this.flagDisjoint(spine, frame, head ? rowIdentity(head) : undefined);
		this.detached = this.detached.map(
			(row) =>
				projection.transcript.find(
					(live) => rowIdentity(live) === rowIdentity(row),
				) ?? row,
		);
		this.rows = [
			...this.detached,
			...(disjoint
				? this.appendAfterHole(spine, frame)
				: this.mergeNewest(spine, frame, head ? rowIdentity(head) : undefined)),
		];
	}

	/** Merge a newest-edge read (a live frame or a newest-page refresh) that
	 * overlaps what is held.
	 *
	 * WITH A HOLE OPEN, ONLY AGAINST THE BLOCK ABOVE IT. A newest page carries
	 * 80 rows and a capped frame 79, so the page's oldest row is often one the
	 * reader does not hold. mergeTranscript puts a row older than every shared
	 * row at the HEAD of the list; with a hole open that head is the oldest
	 * block, so the row landed above history it is newer than, and the gap fill
	 * then took it for its overlap and closed the hole with nothing inserted —
	 * 70 (or 920) rows silently lost (PR #217 Q1). Such a row is older than the
	 * newer block and newer than the hole, so it joins the newer block at its
	 * bottom edge and becomes the hole's new boundary. A read that also shares a
	 * row with the block BELOW the newest hole spans that hole: the whole-list
	 * merge places its rows between the two and the hole is closed. */
	private mergeNewest(
		spine: TranscriptEntry[],
		incoming: TranscriptEntry[],
		context?: string,
	): TranscriptEntry[] {
		const whole = () =>
			mergeTranscript({ transcript: incoming } as SessionProjection, spine)
				.rows;
		const newest = this.holes.at(-1);
		const at = newest ? spine.findIndex((row) => row.id === newest.before) : -1;
		if (!newest || at < 0) return whole();
		const lower = spine.slice(0, at);
		const upper = spine.slice(at);
		const incomingIds = new Set(incoming.map(rowIdentity));
		const lowerIds = new Set(lower.map(rowIdentity));
		const bridges = lower.some(
			(row) =>
				rowIdentity(row) !== context &&
				journalAddressableRow(row) &&
				incomingIds.has(rowIdentity(row)),
		);
		if (bridges) {
			this.holes = this.holes.filter((hole) => hole !== newest);
			return whole();
		}
		// Rows the lower blocks already hold (the pinned opener once paging has
		// reached it) keep their place; they are not newer-block rows.
		const merged = mergeTranscript(
			{
				transcript: incoming.filter((row) => !lowerIds.has(rowIdentity(row))),
			} as SessionProjection,
			upper,
		).rows;
		if (merged[0]) newest.before = merged[0].id;
		return [...lower, ...merged];
	}

	/** A disjoint tail is NEWER than everything held, so it goes after the held
	 * rows with the hole between them (PR #207 Q7). mergeTranscript cannot be used
	 * here: once paging has reached the beginning the pinned opener is a held row,
	 * and the merge would anchor the whole new tail right after it, producing
	 * `opener, newest…, 1, 2, …`. Rows the reader already holds (that opener)
	 * keep their held position. */
	private appendAfterHole(
		held: TranscriptEntry[],
		incoming: TranscriptEntry[],
	): TranscriptEntry[] {
		const heldIds = new Set(held.map(rowIdentity));
		const tail = incoming.filter((row) => !heldIds.has(rowIdentity(row)));
		// A new hole, newer than any already open: older holes stay listed.
		if (tail[0]) this.holes.push({ before: tail[0].id });
		return [...held, ...tail];
	}

	/** An older page goes immediately BEFORE the row its cursor named, not at the
	 * head: held rows ahead of the cursor (an oversized frame's older rows,
	 * preserved compaction turns) are displayed, so prepending would put the
	 * page above rows that are older than it. Fold-minted rows directly ahead
	 * of the cursor row belong to it (a reasoning prefix), so the page lands
	 * above them. A cold page, or a cursor no held row carries, keeps the head. */
	private insertOlder(
		page: TranscriptEntry[],
		held: TranscriptEntry[],
		before?: string,
	): TranscriptEntry[] {
		let at =
			before === undefined ? 0 : held.findIndex((row) => row.id === before);
		if (at < 0) at = 0;
		while (at > 0) {
			const previous = held[at - 1];
			if (!previous || journalAddressableRow(previous)) break;
			at -= 1;
		}
		return [...held.slice(0, at), ...page, ...held.slice(at)];
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
	): boolean {
		const previous = new Set(
			held
				.filter((row) => rowIdentity(row) !== context && heldFilter(row))
				.map(rowIdentity),
		);
		const witness = incoming.filter((row) => rowIdentity(row) !== context);
		// Without a durable reconnect witness, do not call unseen rows complete.
		const disjoint =
			previous.size > 0 &&
			witness.length > 0 &&
			!witness.some((row) => previous.has(rowIdentity(row)));
		// The caller records the hole (appendAfterHole) before the fill's
		// microtask runs.
		if (disjoint) this.scheduleHeal();
		return disjoint;
	}

	/** Same bootstrap domain as the relay: the projection is a newest render,
	 * not evidence about older retention. Never fall back to a pinned opener
	 * when the rest of the tail contains only fold-minted rows. */
	private seedCursor(rows: TranscriptEntry[], headPinnedFlag?: boolean): void {
		const pinned = headPinned(rows, headPinnedFlag);
		// Capped wire projections carry at most opener + 79 tail rows. A
		// legacy oversized render can also re-inject preserved compaction turns:
		// those are context too, never the newest tail's chronological cursor.
		// The CURSOR still comes from the newest window of an oversized flagless
		// render: paging back from there is what restores the journal's order.
		// That choice hides nothing — only the pinned opener is ever detached.
		const tail = pinned
			? rows.slice(1)
			: rows.length > FRAME_CAP && headPinnedFlag === undefined
				? rows.slice(rows.length - (FRAME_CAP - 1))
				: rows;
		if (pinned && rows[0]) this.detached = [rows[0]];
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
		this.loadingScope = before === undefined ? "newest" : "older";
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
				// A COLD no-cursor page is exempt: there is no cursor to cycle on, its
				// has_more is not a retained-journal verdict (see the seed below), and
				// throwing here discarded the page before its rows were held — a
				// reopened conversation whose frame carries no rows then rendered as
				// EMPTY although the relay had just served its newest page (PR #207 CI,
				// S5/find-caveat). Its rows are kept; a page with no addressable row
				// still fails at the seed below, with the rows on screen.
				const coldSeed = before === undefined && this.cursor === undefined;
				if (
					!coldSeed &&
					page.has_more &&
					(!next ||
						next === before ||
						(before !== undefined && this.cursors.has(next)))
				) {
					throw new Error("stalled");
				}
				// BY OCCURRENCE, NOT BY IDENTITY ALONE: the n-th page row with an
				// identity takes the n-th held row with it, the rule mergeTranscript
				// already applies. A plain identity map kept only the LAST held row,
				// so when a live frame landed during the read every page row sharing
				// an identity was rewritten to that one body (PR #207 CI,
				// S5/rich-rows: five rows became five copies of the last answer).
				const accepted = new Map<string, TranscriptEntry[]>();
				for (const row of this.rows) {
					const slots = accepted.get(rowIdentity(row));
					if (slots === undefined) accepted.set(rowIdentity(row), [row]);
					else slots.push(row);
				}
				const authoritative = page.entries.map((row) => {
					const held = accepted.get(rowIdentity(row))?.shift();
					return (this.liveAt.get(rowIdentity(row)) ?? 0) > started
						? (held ?? row)
						: row;
				});
				const pageIds = new Set(authoritative.map(rowIdentity));
				for (const id of pageIds) this.durableIds.add(id);
				if (this.cursor === undefined && this.rows.length > 0) {
					// The live fold may pin an opener before a detached newest window.
					// Keep it as context, not as a durable cursor or a prepend anchor.
					const firstShared = this.rows.findIndex((row) =>
						pageIds.has(rowIdentity(row)),
					);
					// Only a capped frame's single opener: every other held row ahead of
					// the page is a displayed row the page simply does not reach.
					const frame = this.projection;
					const opener = this.rows[0];
					if (
						firstShared > 0 &&
						opener &&
						frame &&
						headPinned(frame.transcript, frame.transcript_head_pinned)
					)
						this.detached = [opener];
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
				let disjoint = false;
				const opener = this.projection;
				const context =
					opener &&
					headPinned(opener.transcript, opener.transcript_head_pinned) &&
					opener.transcript[0]
						? rowIdentity(opener.transcript[0])
						: undefined;
				if (refreshing) {
					// More than a page appended while backgrounded makes the newest page
					// disjoint from everything held; merging would silently bridge the
					// hole (PR #207 R1). mergeTranscript's holeBelowPage is not used: it
					// also fires on a head insert. Same test accept() applies.
					disjoint = this.flagDisjoint(
						spine,
						authoritative,
						context,
						journalAddressableRow,
					);
				}
				const joined = disjoint
					? this.appendAfterHole(spine, authoritative)
					: refreshing
						? this.mergeNewest(spine, authoritative, context)
						: // A cold page landing on rows a frame already supplied is a merge
							// too: those rows are displayed and keep their positions; the
							// page must not be stacked above rows older than it.
							// ONLY ON OVERLAP. With no shared row the merge has no anchor and
							// returns `[...held, ...page]`, which is right for a refresh (the
							// page is newer) and wrong here: the held rows are the LIVE tail
							// and the cold page is the history before it, so the turn rendered
							// above its own history and every later live row kept anchoring
							// there (PR #207 R5-2). Disjoint cold pages fall through to
							// insertOlder, which keeps the page first.
							before === undefined &&
								spine.some((row) => pageIds.has(rowIdentity(row)))
							? mergeTranscript(
									{ transcript: authoritative } as SessionProjection,
									spine,
								).rows
							: this.insertOlder(authoritative, held, before);
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
				this.loadingScope = null;
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
		this.holes = [];
		this.loading = false;
		this.loadingScope = null;
		this.error = null;
		this.errorScope = null;
		this.read = "unknown";
		this.projection = null;
		this.detached = [];
		this.confirmedPinned = false;
		this.visibleSource = null;
		this.cursors.clear();
		this.durableIds.clear();
		this.liveAt.clear();
		this.healRun = null;
		this.healState = "idle";
		this.revision = 0;
		// Re-seed from the current stream frame, not the retired page islands.
		// This also preserves a known pinned-head exclusion during rare fallback.
		this.accept(currentTail);
		return this.load();
	}

	activate(): void {
		this.active = true;
	}

	/** Called from `accept()`, which runs during render: it must not notify
	 * (`changed()` is a React state setter). `healing` is set synchronously so
	 * the render that discovers the hole never paints the notice for one frame
	 * before the fill starts; the fill itself starts on the next microtask. */
	private scheduleHeal(): void {
		if (!this.options.autoHeal || !this.active || this.healRun) return;
		this.healState = "healing";
		const lease = this.lease;
		queueMicrotask(() => {
			if (lease === this.lease) void this.heal();
		});
	}

	/** The oldest journal-addressable row of the newer island: the `before=`
	 * cursor whose page is the rows immediately older than that island. */
	private gapCursor(hole: { before: string }): string | undefined {
		const at = this.rows.findIndex((row) => row.id === hole.before);
		if (at < 0) return undefined;
		return this.rows.slice(at).find(journalAddressableRow)?.id;
	}

	/** Put one gap page into `hole`, read against the rows as they are NOW (a
	 * refresh may have moved the boundary while the page was in flight). The
	 * overlap must be a row of the block directly BELOW this hole — the one
	 * between the previous hole (or the list head) and this one — and the row
	 * nearest the hole wins: a page is contiguous and older than its cursor, so
	 * the held row that continues the older block is the one adjacent to the
	 * hole. Any id anywhere in the list is not an overlap: a misplaced row at
	 * the list head once "overlapped" and closed a 70-row hole with nothing
	 * inserted (PR #217 Q1). Everything after the overlap is the missing run,
	 * and the hole is closed. Without an overlap the page becomes the new
	 * bottom edge of the upper island and the walk continues from it. Rows
	 * already held keep their objects and positions, so nothing on screen
	 * re-keys or moves; only rows the reader never had are inserted, all of
	 * them between the islands (native maintainVisibleContentPosition keeps a
	 * reader inside the upper island still; a reader at the tail stays pinned). */
	private spliceGapPage(hole: { before: string }, page: HistoryResponse): void {
		const at = this.rows.findIndex((row) => row.id === hole.before);
		if (at < 0) {
			// Its boundary row is gone (cannot happen short of a reload, which
			// clears every hole): an unplaceable hole must not keep the walk alive.
			this.holes = this.holes.filter((open) => open !== hole);
			return;
		}
		const previous = this.holes[this.holes.indexOf(hole) - 1];
		const floor = previous
			? Math.max(
					0,
					this.rows.findIndex((row) => row.id === previous.before),
				)
			: 0;
		const detachedIds = new Set(this.detached.map(rowIdentity));
		const block = this.rows
			.slice(floor, at)
			.filter(
				(row) =>
					!detachedIds.has(rowIdentity(row)) && journalAddressableRow(row),
			);
		const pageAt = new Map<string, number>();
		for (const [index, row] of page.entries.entries())
			pageAt.set(rowIdentity(row), index);
		const held = new Set(this.rows.map(rowIdentity));
		for (const row of page.entries) this.durableIds.add(rowIdentity(row));
		let overlap = -1;
		for (let index = block.length - 1; index >= 0; index -= 1) {
			const entry = block[index];
			const found = entry ? pageAt.get(rowIdentity(entry)) : undefined;
			if (found !== undefined) {
				overlap = found;
				break;
			}
		}
		const fresh = page.entries
			.slice(overlap + 1)
			.filter((row) => !held.has(rowIdentity(row)));
		this.rows = [...this.rows.slice(0, at), ...fresh, ...this.rows.slice(at)];
		// Reaching the journal's beginning also ends the walk: nothing older can
		// still be missing between the islands.
		if (overlap >= 0 || !page.has_more) {
			this.holes = this.holes.filter((open) => open !== hole);
		} else if (fresh[0]) {
			hole.before = fresh[0].id;
		}
	}

	/** Close every open hole, newest first, by walking `before=` pages back from
	 * it, within ONE budget for the whole run. Also the quiet notice's Load
	 * action, which grants a fresh budget. Joins a fill already in flight.
	 * Independent of `load()`'s oldest-edge cursor: the two touch different
	 * spans of `rows`, and each applies its page against the rows as they are
	 * when it lands. A newest-page read in flight is waited for first, so the
	 * fill starts from the boundary that read leaves (PR #217 Q1). */
	heal(): Promise<void> {
		if (this.healRun) return this.healRun;
		if (!this.active || !this.hasGap) {
			this.healState = "idle";
			return Promise.resolve();
		}
		const budget = this.options.budget ?? HEAL_BUDGET;
		const now = this.options.now ?? Date.now;
		const lease = this.lease;
		const startedAt = now();
		this.healState = "healing";
		this.changed();
		let run: Promise<void> | null = null;
		// A hung request must not hide the hole: past the time budget the notice
		// shows, and a page that still lands closes it after all.
		const timer = setTimeout(() => {
			if (this.healRun !== run || lease !== this.lease) return;
			if (this.healState !== "healing" || !this.hasGap) return;
			this.healState = "exhausted";
			this.changed();
		}, budget.ms);
		const walk = async () => {
			let pages = 0;
			let rows = 0;
			let previous: string | undefined;
			let previousHole: { before: string } | undefined;
			while (this.active && lease === this.lease && this.hasGap) {
				// The newest-page refresh and the fill fire in the same tick on a
				// resume; let the refresh merge first (its failure is its own).
				if (this.pending && this.loadingScope === "newest") {
					await this.pending.catch(() => undefined);
					continue;
				}
				if (
					pages >= budget.pages ||
					rows >= budget.rows ||
					now() - startedAt >= budget.ms
				)
					return;
				const hole = this.holes.at(-1);
				if (!hole) return;
				if (hole !== previousHole) previous = undefined;
				previousHole = hole;
				const cursor = this.gapCursor(hole);
				// No progress since the last page: a repeating page must not become
				// an automatic request loop.
				if (!cursor || cursor === previous) return;
				previous = cursor;
				const page = await this.fetchPage(cursor);
				if (!this.active || lease !== this.lease) return;
				pages += 1;
				rows += page.entries.length;
				if (page.unavailable) return;
				// A read in flight closed this hole (it spanned it): nothing to put.
				// A NEWER hole opening meanwhile does not void the page: it still
				// belongs to this hole, and the next turn walks the newest one.
				if (!this.holes.includes(hole)) continue;
				this.spliceGapPage(hole, page);
				this.changed();
			}
		};
		run = walk()
			.catch(() => undefined)
			.finally(() => {
				clearTimeout(timer);
				if (this.healRun !== run) return;
				this.healRun = null;
				if (!this.active || lease !== this.lease) return;
				this.healState = this.hasGap ? "exhausted" : "idle";
				this.changed();
			});
		this.healRun = run;
		return run;
	}

	retire(): void {
		this.active = false;
		this.lease += 1;
		this.healRun = null;
		this.healState = "idle";
		this.pending = null;
		this.loading = false;
		this.loadingScope = null;
	}
}
