import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
	HistoryResponse,
	SubagentDetail,
	TranscriptEntry,
} from "@/contracts";
import { RelayError } from "@/relay/errors";
import { HistoryWindow } from "./history-window";

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
 * What the transcript body should be, beyond its rows.
 *
 * - `loading`: the first read has not answered yet.
 * - `rows`: there is something to draw (history rows, or the inline fallback).
 * - `empty`: a read SUCCEEDED and the child genuinely has no rows of its own —
 *   the only state allowed to say so.
 * - `unavailable`: the history route answered 404 (an older Core without the
 *   route, or a child whose session directory it can no longer resolve) and the
 *   detail carried no inline rows either. Terminal: retrying cannot change it.
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
 * sibling's rows can never paint under the child just opened. `source` is
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

	const reader = useMemo(() => {
		// `key` is the reader's identity: the effect below retires the old one.
		void key;
		return new HistoryWindow(
			async (before) => {
				try {
					const current = sourceRef.current;
					if (current === null) throw new Error("History is unavailable.");
					const page = await current.loadPage(before);
					if (before === undefined) {
						setNotFound(false);
						setEmptyRead(page.entries.length === 0);
					}
					return page;
				} catch (error) {
					if (before === undefined) {
						setNotFound(error instanceof RelayError && error.status === 404);
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
	}, [key]);

	/** The first detail read decides `missing`; a later refresh that fails keeps
	 *  the detail already shown rather than blanking a child the reader is in. */
	useEffect(() => {
		void key;
		if (!ready) return;
		let cancelled = false;
		sourceRef.current
			?.loadDetail()
			.then((loaded) => {
				if (cancelled) return;
				setDetail(loaded);
				// A `null` detail is either a transport failure or a child the daemon no
				// longer has; both read the same to the reader, and inventing a difference
				// they cannot act on would be noise.
				setMissing(loaded === null);
			})
			.catch(() => {
				if (!cancelled) setMissing(true);
			});
		return () => {
			cancelled = true;
		};
	}, [key, ready]);

	const live = isLive(detail);
	useEffect(() => {
		// One newest read on open and again whenever the run state flips (a child
		// that just settled gets its final tail).
		if (!ready) return;
		void reader.load(true);
		if (!live) return;
		let cancelled = false;
		const timer = setInterval(() => {
			// `load(true)` joins a read already in flight, so a slow link never
			// stacks requests; the detail read refreshes status/elapsed/result so
			// the badge stops saying "running" once the child settles, which also
			// ends this interval.
			void reader.load(true);
			sourceRef.current
				?.loadDetail()
				.then((loaded) => {
					if (!cancelled && loaded !== null) setDetail(loaded);
				})
				.catch(() => undefined);
		}, pollMs);
		return () => {
			cancelled = true;
			clearInterval(timer);
		};
	}, [reader, live, pollMs, ready]);

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

	let state: SubagentTranscriptState;
	if (entries.length > 0) state = "rows";
	else if (notFound) state = "unavailable";
	else if (emptyRead) state = "empty";
	else if (reader.read === "failed") state = "failed";
	else state = "loading";

	const paging = fromHistory
		? {
				loadOlder,
				hasOlder: reader.hasMore,
				loadingOlder: reader.loading && reader.loadingScope === "older",
				historyError: reader.error,
				historyErrorScope: reader.errorScope,
				retryHistory,
				healHistory,
				historyGap: reader.hasGap && reader.healState !== "healing",
				historyGapBefore: reader.gapBefore,
			}
		: null;

	return { detail, missing, entries, state, live, paging, retry };
}
