/**
 * The Library listing's data path: one debounced browse, one cursor walk.
 *
 * Three rules carried from the rest of the app:
 *
 *  1. **The sequence is the authority.** A slow first request must not paint
 *     over a fast second one — the failure looks like a search that "forgot"
 *     the query for a second. Every load takes a ticket and only the holder of
 *     the latest ticket may set state.
 *  2. **Debounce is the reader's phone bill.** This is a server round trip over
 *     a tunnel; a request per character is a request per character. 300 ms is
 *     the same gesture-to-request bar the rest of the app uses.
 *  3. **`cursor_reset` replaces, never appends.** The relay mints cursors
 *     against a catalog revision; a scan that moved mid-walk restarts at the
 *     top. Appending the restarted page would duplicate rows and show the list
 *     twice — `applyLibraryPage` is the one place that rule lives.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { LibraryListResponse } from "@/contracts";
import {
	applyLibraryPage,
	type LibraryBrowse,
	libraryListRequest,
} from "@/features/library/library-model";
import { createLibraryRequestGate } from "@/features/library/library-request-gate";
import type { RelayEndpoints } from "@/relay";

export const LIBRARY_PAGE_SIZE = 24;
const SEARCH_DEBOUNCE_MS = 300;

export interface LibraryListState {
	page: LibraryListResponse | null;
	rows: LibraryListResponse["rows"];
	/** A first page is in flight and there is nothing to paint under it. */
	loading: boolean;
	/** A cursor page is in flight; the grid stays interactive. */
	loadingMore: boolean;
	/** A focus refresh is in flight; the rows on screen are still valid. */
	refreshing: boolean;
	error: string | null;
	/** The browse that produced the current rows, so a marker can name it. */
	loadedWith: LibraryBrowse | null;
	refresh: () => void;
	loadMore: () => void;
	retry: () => void;
}

export function useLibraryList(
	client: RelayEndpoints | null,
	browse: LibraryBrowse,
	enabled: boolean,
): LibraryListState {
	const [page, setPage] = useState<LibraryListResponse | null>(null);
	const [rows, setRows] = useState<LibraryListResponse["rows"]>([]);
	const [loading, setLoading] = useState(true);
	const [loadingMore, setLoadingMore] = useState(false);
	const [refreshing, setRefreshing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [loadedWith, setLoadedWith] = useState<LibraryBrowse | null>(null);

	const gate = useRef(createLibraryRequestGate()).current;
	/** The browse this render is showing. A response for an older object must not
	 *  paint, even if its ticket somehow survived: the screen replaces `browse`
	 *  on every real filter change, so object identity is the narrowest proof
	 *  that the answer still belongs to the field the reader sees. */
	const browseRef = useRef(browse);
	browseRef.current = browse;
	/** The browse the CURRENT rows were loaded with. `loadMore` is refused unless
	 *  this is still the live browse (review round 1, major 1). */
	const loadedBrowse = useRef<LibraryBrowse>(browse);

	const fetchPage = useCallback(
		async (
			target: LibraryBrowse,
			cursor: string | undefined,
			mode: "first" | "more" | "refresh",
		) => {
			if (client === null) return;
			const ticket = gate.begin();
			if (mode === "first") {
				setLoading(true);
				setError(null);
			} else if (mode === "more") {
				setLoadingMore(true);
			} else {
				setRefreshing(true);
			}
			try {
				const answer = await client.libraryList({
					...libraryListRequest(target, cursor, LIBRARY_PAGE_SIZE),
				});
				if (!gate.accepts(ticket) || browseRef.current !== target) return;
				/* Only a cursor page APPENDS. A focus refresh replaces: appending a fresh
				 *  first page onto the rows it repeats would double every tile. */
				const merged = applyLibraryPage(rows, answer, mode === "more");
				setRows(merged.rows);
				setPage(answer);
				setLoadedWith(target);
				setError(null);
				loadedBrowse.current = target;
			} catch (failure) {
				if (!gate.accepts(ticket) || browseRef.current !== target) return;
				// Only the relay's own sentence is displayable; a transport failure
				// gets the screen's retry sentence, never a status code.
				setError(
					isDisplayable(failure)
						? failure.displayableMessage
						: "We couldn't read your library just now.",
				);
			} finally {
				if (gate.accepts(ticket)) {
					setLoading(false);
					setLoadingMore(false);
					setRefreshing(false);
				}
			}
		},
		[client, gate, rows],
	);

	/** The debounced first page. `rows` is deliberately not a dependency: it
	 *  changes on every page and would restart the search loop. */
	useEffect(() => {
		if (!enabled) return;
		if (client === null) {
			/* The connection is still being restored. A skeleton is the honest
			 *  frame here; the empty state would claim "no assets" before the
			 *  first request was ever made. */
			setLoading(true);
			return;
		}
		const generation = gate.queryChanged();
		setLoading(true);
		/* A borrow from the previous browse must not keep its flag on screen: its
		 *  own `finally` is rejected by the new generation, so the new browse owns
		 *  resetting `loadingMore`/`refreshing` (review round 2). */
		setLoadingMore(false);
		setRefreshing(false);
		setError(null);
		const timer = setTimeout(() => {
			/* The browse moved while the debounce was pending: this start belongs
			 *  to a query the reader has already left. */
			if (gate.currentQuery() !== generation) return;
			const ticket = gate.begin();
			void (async () => {
				try {
					const answer = await client.libraryList({
						...libraryListRequest(browse, void 0, LIBRARY_PAGE_SIZE),
					});
					if (!gate.accepts(ticket) || browseRef.current !== browse) return;
					setRows(answer.rows);
					setPage(answer);
					setLoadedWith(browse);
					loadedBrowse.current = browse;
					setError(null);
				} catch (failure) {
					if (!gate.accepts(ticket) || browseRef.current !== browse) return;
					setRows([]);
					setPage(null);
					setError(
						isDisplayable(failure)
							? failure.displayableMessage
							: "We couldn't read your library just now.",
					);
				} finally {
					if (gate.accepts(ticket)) {
						/* The first page owns the whole listing. Any cursor or
						 *  refresh ticket from the previous browse was rejected and
						 *  will never clear its own flag; clear all three here or a
						 *  stale `loadingMore` blocks every future page. */
						setLoading(false);
						setLoadingMore(false);
						setRefreshing(false);
					}
				}
			})();
		}, SEARCH_DEBOUNCE_MS);
		return () => clearTimeout(timer);
		// `browse` is replaced only when a real filter changes (the screen memoises
		// it); `client` is stable for a connection; `enabled` is the capability.
	}, [browse, client, enabled, gate]);

	const refresh = useCallback(() => {
		void fetchPage(browse, void 0, "refresh");
	}, [fetchPage, browse]);

	const loadMore = useCallback(() => {
		const cursor = page?.next_cursor;
		if (cursor === null || cursor === void 0 || loadingMore) return;
		/* A debounced search is pending or a different browse is on screen: the
		 *  cursor belongs to rows the reader has left, and appending it would
		 *  paint the old query under the new field. The debounced start owns the
		 *  listing until it lands (review round 1, major 1). */
		if (loadedBrowse.current !== browse) return;
		void fetchPage(browse, cursor, "more");
	}, [fetchPage, browse, page?.next_cursor, loadingMore]);

	const retry = useCallback(() => {
		void fetchPage(browse, void 0, "first");
	}, [fetchPage, browse]);

	return useMemo(
		() => ({
			page,
			rows,
			loading,
			loadingMore,
			refreshing,
			error,
			loadedWith,
			refresh,
			loadMore,
			retry,
		}),
		[
			page,
			rows,
			loading,
			loadingMore,
			refreshing,
			error,
			loadedWith,
			refresh,
			loadMore,
			retry,
		],
	);
}

/** True for the relay's own refusal shape. Kept local so this hook does not
 *  grow a dependency on the error taxonomy beyond the one displayable field. */
function isDisplayable(
	value: unknown,
): value is { displayableMessage: string } {
	return (
		typeof value === "object" &&
		value !== null &&
		"displayableMessage" in value &&
		typeof (value as { displayableMessage?: unknown }).displayableMessage ===
			"string"
	);
}
