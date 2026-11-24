import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
	HistoryResponse,
	SubagentDetail,
	TranscriptEntry,
} from "@/contracts";
import { isRelayMissing } from "@/relay/errors";
import { HistoryWindow } from "./history-window";
import { visibleTranscriptEntries } from "./projection";

/**
 * How often an OPEN subagent screen re-reads a running child.
 *
 * The relay SPA's own cadence for the same route (Core
 * `mobile/web/src/screens/agent-view.tsx` `SUBAGENT_TRANSCRIPT_POLL_MS`): frequent
 * enough to read as live, and bounded to ONE newest-page read plus one detail
 * read per tick, only while the child is running or queued AND the screen is
 * mounted. A settled child is read once and never polled.
 */
export const SUBAGENT_POLL_MS = 1500;

/**
 * How many newest-page reads in a row must fail before a RUNNING child with rows
 * already on screen shows the list's "latest messages could not be loaded"
 * footer (agent review round 1, R1-2).
 *
 * One dropped tick on a flaky link is not news: the next tick (1.5 s later)
 * usually lands, and `HistoryWindow.load` clears its error as each read starts,
 * so passing every failure through made the footer blink — moving the tail and
 * re-announcing a polite live region — every tick. Three in a row (~4.5 s) is a
 * link that is actually down; from then on the footer holds steady until a read
 * succeeds. A settled child is not polled, so its single failure shows at once.
 */
export const SUBAGENT_NEWEST_FAILURES_BEFORE_NOTICE = 3;

/**
 * What the transcript body should be, beyond its rows.
 *
 * - `loading`: the first read has not answered yet.
 * - `rows`: there is something to draw (history rows, or the inline fallback)
 *   AFTER the list's own notice filter — a child whose only rows are hidden
 *   harness notices has nothing to draw (R1-3).
 * - `empty`: a read SUCCEEDED and the child genuinely has no rows of its own —
 *   the only state allowed to say so.
 * - `unavailable`: the RELAY's own 404 (`isRelayMissing`: an older Core without
 *   the route, or a child whose session directory it can no longer resolve) for
 *   a SETTLED child, and the detail carried no inline rows either. Terminal:
 *   retrying cannot change it. A running or queued child that 404s is still
 *   `loading` — Core answers 404 until the child has a session id of its own
 *   (R1-4a) — and the gateway's unknown-tunnel 404 is a transport failure, not
 *   absence (R1-4b).
 * - `failed`: a transport failure with nothing to draw. Retryable; never the
 *   empty line, which would tell the reader a running child did nothing.
 */
export type SubagentTranscriptState =
	| "loading"
	| "rows"
	| "empty"
	| "unavailable"
	| "failed";

export interface SubagentTranscriptSource {
	/** The child's detail (`GET …/agents/{job}`); `null` when it could not be read. */
	loadDetail: () => Promise<SubagentDetail | null>;
	/** One page of the child's own journal (`GET …/agents/{job}/history`).
	 *  Throws on failure, so a 404 can be told apart from a dropped link. */
	loadPage: (before?: string) => Promise<HistoryResponse>;
}

export interface SubagentTranscriptView {
	detail: SubagentDetail | null;
	/** The detail could not be read on the FIRST attempt (the screen's
	 *  "no longer available" empty and the badge's `unavailable`). */
	missing: boolean;
	entries: TranscriptEntry[];
	state: SubagentTranscriptState;
	/** The child's run is still open (running or queued). */
	live: boolean;
	/** The list's paging props — the main view's (`use-session.ts`) names and
	 *  semantics, `undefined` while the rows are the inline fallback, which has
	 *  no journal behind it to page. */
	paging: {
		loadOlder: () => Promise<void>;
		hasOlder: boolean;
		loadingOlder: boolean;
		historyError: string | null;
		historyErrorScope: "newest" | "older" | null;
		retryHistory: () => Promise<void>;
		healHistory: () => Promise<void>;
		historyGap: boolean;
		historyGapBefore: string | null;
	} | null;
	/** Re-read the newest page after a `failed` state. */
	retry: () => void;
}

const isLive = (detail: SubagentDetail | null): boolean =>
	detail?.status === "running" || detail?.status === "queued";

const EMPTY_ROWS: TranscriptEntry[] = [];

/**
 * One subagent's detail and transcript, kept fresh while it runs.
 *
 * WHY THE TRANSCRIPT IS FETCHED SEPARATELY. Core never puts a child's
 * transcript on the wire any more: the detail route's `transcript` is left
 * empty on purpose (Core `mobile/projection.py`, "transcript is intentionally
 * left empty here" — inlined transcripts blew past the daemon's control-frame
 * cap), and the rows are served lazily by the lineage-checked
 * `GET /api/sessions/{sid}/agents/{job}/history`, which answers the SAME
 * `{entries, has_more}` shape and `before`/`limit` paging as the root
 * `/history`. A screen that drew only `detail.transcript` therefore said
 * "This subagent has no transcript rows of its own" under a child that had
 * been running for 24 minutes (TestFlight report).
 *
 * WHY `HistoryWindow`. The child's journal pages exactly like the root's, so the
 * main view's own reader is reused rather than a second pager: newest-page
 * refreshes merge by row identity without discarding paged-in history, older
 * pages walk the `before` cursor, a refresh that no longer overlaps opens a
 * hole the auto-heal fills, and the list's anchoring rules (the reader's scroll
 * is never fought) apply unchanged because `TranscriptList` sees the same props
 * the main view gives it.
 *
 * FALLBACKS. An older Core still inlines the rows on the detail; when the
 * history read has produced nothing (404 or empty) those inline rows are drawn
 * instead, without paging. The "no rows" state is reserved for a SUCCESSFUL
 * empty read; a 404 with nothing inline is `unavailable`; a dropped link with
 * nothing to draw is `failed` and retryable.
 *
 * `key` names the child (`<session>:<job>`); a new key is a new reader, so a
 * sibling's rows can never paint under the child just opened, and every async
 * answer (history page, detail read) checks that its key is still the current
 * one before it touches the shared per-child flags, so a previous child's late
 * 404 or empty page cannot set the new child's state either. `source` is
 * `null` until the relay endpoints exist: nothing is read (and nothing is
 * declared missing or failed) before there is a link to read over, and the
 * reads run as soon as it arrives.
 */
export function useSubagentTranscript(
	key: string,
	source: SubagentTranscriptSource | null,
	pollMs: number = SUBAGENT_POLL_MS,
): SubagentTranscriptView {
	// The source's closures follow the relay endpoints, which can be re-minted
	// without the child changing; reading them through a ref keeps one reader
	// (and its paged rows) for the life of the child.
	const sourceRef = useRef(source);
	sourceRef.current = source;
	const ready = source !== null;

	const [detail, setDetail] = useState<SubagentDetail | null>(null);
	const [missing, setMissing] = useState(false);
	/** The last newest-page read answered 404 / answered zero rows. Kept beside
	 *  the reader because it folds both into a generic failure: a cold
	 *  page with no addressable row cannot seed its cursor, which the main view
	 *  rightly treats as an error — but for a child it is the honest "nothing
	 *  yet" answer. */
	const [notFound, setNotFound] = useState(false);
	const [emptyRead, setEmptyRead] = useState(false);
	const [, changed] = useState(0);
	/** The child the hook is CURRENTLY showing. The per-child flags above are
	 *  hook state shared across keys, while a retired reader's page (or an old
	 *  detail read) can still be in flight when the screen is reused for a
	 *  sibling; every async answer checks its own key against this before it
	 *  writes anything (R1-5). Assigned during render, as `sourceRef` is. */
	const keyRef = useRef(key);
	keyRef.current = key;
	/** Consecutive failed newest-page reads, and the last such failure's
	 *  message: what lets a running child's footer wait out one dropped tick and
	 *  then hold steady instead of blinking (R1-2). Reset on success and per child. */
	const newestFailures = useRef(0);
	const lastNewestError = useRef<string | null>(null);
	/** Single-flight for the detail read (R1-1). `agentDetail` has no dedupe and a
	 *  20 s deadline, so an unguarded 1.5 s poll kept ~13 GETs open on a stalled
	 *  tunnel, all competing with the history read the screen needs; and answers
	 *  could land out of order, a late "running" reviving a child that had just
	 *  "completed". `detailPending` skips a tick while a read is open;
	 *  `detailSeq` numbers every read so only the LATEST one may write — a new
	 *  child, an unmount or a fresh opening read makes older answers inert. */
	const detailSeq = useRef(0);
	const detailPending = useRef(false);

	const reader = useMemo(() => {
		// `key` is the reader's identity: the effect below retires the old one.
		const own = key;
		const current = () => keyRef.current === own;
		return new HistoryWindow(
			async (before) => {
				try {
					const source = sourceRef.current;
					if (source === null) throw new Error("History is unavailable.");
					const page = await source.loadPage(before);
					if (before === undefined && current()) {
						newestFailures.current = 0;
						setNotFound(false);
						// Counted as the list will draw them (R1-3): a page of hidden
						// harness notices only is, to the reader, an empty one.
						setEmptyRead(visibleTranscriptEntries(page.entries).length === 0);
					}
					return page;
				} catch (error) {
					if (before === undefined && current()) {
						newestFailures.current += 1;
						// The relay's own 404 only: the gateway's unknown-tunnel 404 is
						// a dead link (retryable), not proof the transcript is gone.
						setNotFound(isRelayMissing(error));
						setEmptyRead(false);
					}
					throw error;
				}
			},
			() => changed((n) => n + 1),
			{ autoHeal: true },
		);
	}, [key]);

	useEffect(() => {
		reader.activate();
		return () => reader.retire();
	}, [reader]);

	// Reset the per-child flags when the child changes, so a stale verdict never
	// flashes under a newly-opened sibling before its own reads land.
	useEffect(() => {
		void key;
		setDetail(null);
		setMissing(false);
		setNotFound(false);
		setEmptyRead(false);
		newestFailures.current = 0;
		lastNewestError.current = null;
	}, [key]);

	/**
	 * One detail read. The OPENING read (`opening`) decides `missing` and always
	 * runs, superseding whatever an earlier child left in flight; a poll refresh
	 * is skipped while any read is still open, and one that fails keeps the
	 * detail already shown rather than blanking a child the reader is in.
	 */
	const readDetail = useCallback((opening: boolean) => {
		const source = sourceRef.current;
		if (source === null) return;
		if (!opening && detailPending.current) return;
		detailSeq.current += 1;
		const seq = detailSeq.current;
		const latest = () => seq === detailSeq.current;
		detailPending.current = true;
		source
			.loadDetail()
			.then((loaded) => {
				if (!latest()) return;
				detailPending.current = false;
				if (opening) {
					setDetail(loaded);
					// A `null` detail is either a transport failure or a child the daemon
					// no longer has; both read the same to the reader, and inventing a
					// difference they cannot act on would be noise.
					setMissing(loaded === null);
					return;
				}
				// Only the latest read writes, and at most one refresh is open, so a
				// late "running" can no longer land after a "completed" and revive
				// the poll; a refresh that answers nothing keeps what is shown.
				if (loaded !== null) setDetail(loaded);
			})
			.catch(() => {
				if (!latest()) return;
				detailPending.current = false;
				if (opening) setMissing(true);
			});
	}, []);

	useEffect(() => {
		void key;
		if (!ready) return;
		readDetail(true);
		return () => {
			// Unmount or a new child: whatever is still in flight is answered into
			// nothing, and the next opening read is not blocked by it.
			detailSeq.current += 1;
			detailPending.current = false;
		};
	}, [key, ready, readDetail]);

	const live = isLive(detail);
	useEffect(() => {
		// One newest read on open and again whenever the run state flips (a child
		// that just settled gets its final tail).
		if (!ready) return;
		void reader.load(true);
		if (!live) return;
		const timer = setInterval(() => {
			// Both reads are single-flight, so a slow link never stacks requests:
			// `load(true)` joins a history read already in flight, and `readDetail`
			// skips the tick while a detail read is open. The detail refreshes
			// status/elapsed/result so the badge stops saying "running" once the
			// child settles, which also ends this interval.
			void reader.load(true);
			readDetail(false);
		}, pollMs);
		return () => clearInterval(timer);
	}, [reader, live, pollMs, ready, readDetail]);

	const retry = useCallback(() => {
		void reader.load(true);
	}, [reader]);
	// Stable identities, as the main view's are (`use-session.ts`), so the
	// list's memoised header/footer do not rebuild on every poll tick.
	const loadOlder = useCallback(() => reader.load(), [reader]);
	const retryHistory = useCallback(() => reader.retry(), [reader]);
	const healHistory = useCallback(() => reader.heal(), [reader]);

	const historyRows = reader.visibleRows;
	const inline = detail?.transcript ?? EMPTY_ROWS;
	const fromHistory = historyRows.length > 0;
	const entries = fromHistory
		? historyRows
		: inline.length > 0
			? inline
			: EMPTY_ROWS;

	// What the list will actually draw: it drops hidden harness notices before
	// anything else (`transcript-list.tsx`), so a child whose rows are ONLY such
	// notices must not count as "rows" — the list would show its empty slot, and
	// with `state === "rows"` that slot is the loading skeleton, forever (R1-3).
	const drawable = visibleTranscriptEntries(entries).length > 0;
	// The status is known once the opening detail read has answered either way.
	const settledKnown = !live && (detail !== null || missing);

	let state: SubagentTranscriptState;
	if (drawable) state = "rows";
	else if (notFound) state = settledKnown ? "unavailable" : "loading";
	else if (emptyRead) state = "empty";
	else if (reader.read === "failed") state = "failed";
	else state = "loading";

	// A running child keeps a newest-edge failure quiet until it is sustained,
	// then holds the last message steady through the ticks that clear and re-set
	// the reader's own error (R1-2). An older-page failure is the reader's own
	// action and always shows; a settled child is not polled, so it shows as is.
	if (reader.errorScope === "newest" && reader.error !== null)
		lastNewestError.current = reader.error;
	let historyError = reader.error;
	let historyErrorScope = reader.errorScope;
	if (live && historyErrorScope !== "older") {
		const sustained =
			newestFailures.current >= SUBAGENT_NEWEST_FAILURES_BEFORE_NOTICE &&
			lastNewestError.current !== null;
		historyError = sustained ? lastNewestError.current : null;
		historyErrorScope = sustained ? "newest" : null;
	}

	const paging = fromHistory
		? {
				loadOlder,
				hasOlder: reader.hasMore,
				loadingOlder: reader.loading && reader.loadingScope === "older",
				historyError,
				historyErrorScope,
				retryHistory,
				healHistory,
				historyGap: reader.hasGap && reader.healState !== "healing",
				historyGapBefore: reader.gapBefore,
			}
		: null;

	return { detail, missing, entries, state, live, paging, retry };
}
