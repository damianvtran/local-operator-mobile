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

	const seq = useRef(0);
	/** The request body for the debounced browse. Kept in a ref so `loadMore`
	 *  reads the browse the rows were loaded with, not the one being typed. */
	const loadedBrowse = useRef<LibraryBrowse>(browse);

	const fetchPage = useCallback(
		async (
			target: LibraryBrowse,
			cursor: string | undefined,
			mode: "first" | "more" | "refresh",
		) => {
			if (client === null) return;
			const ticket = seq.current + 1;
			seq.current = ticket;
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
				if (seq.current !== ticket) return;
				/* Only a cursor page APPENDS. A focus refresh replaces: appending a fresh
				 *  first page onto the rows it repeats would double every tile. */
				const merged = applyLibraryPage(rows, answer, mode === "more");
				setRows(merged.rows);
				setPage(answer);
				setLoadedWith(target);
				setError(null);
				loadedBrowse.current = target;
			} catch (failure) {
				if (seq.current !== ticket) return;
				// Only the relay's own sentence is displayable; a transport failure
				// gets the screen's retry sentence, never a status code.
				setError(
					isDisplayable(failure)
						? failure.displayableMessage
						: "We couldn't read your library just now.",
				);
			} finally {
				if (seq.current === ticket) {
					setLoading(false);
					setLoadingMore(false);
					setRefreshing(false);
				}
			}
		},
		[client, rows],
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
		const ticket = seq.current + 1;
		seq.current = ticket;
		setLoading(true);
		setError(null);
		const timer = setTimeout(() => {
			if (seq.current !== ticket) return;
			void (async () => {
				try {
					const answer = await client.libraryList({
						...libraryListRequest(browse, undefined, LIBRARY_PAGE_SIZE),
					});
					if (seq.current !== ticket) return;
					setRows(answer.rows);
					setPage(answer);
					setLoadedWith(browse);
					loadedBrowse.current = browse;
					setError(null);
				} catch (failure) {
					if (seq.current !== ticket) return;
					setRows([]);
					setPage(null);
					setError(
						isDisplayable(failure)
							? failure.displayableMessage
							: "We couldn't read your library just now.",
					);
				} finally {
					if (seq.current === ticket) setLoading(false);
				}
			})();
		}, SEARCH_DEBOUNCE_MS);
		return () => clearTimeout(timer);
		// `browse` is replaced only when a real filter changes (the screen memoises
		// it); `client` is stable for a connection; `enabled` is the capability.
	}, [browse, client, enabled]);

	const refresh = useCallback(() => {
		void fetchPage(loadedBrowse.current, undefined, "refresh");
	}, [fetchPage]);

	const loadMore = useCallback(() => {
		const cursor = page?.next_cursor;
		if (cursor === null || cursor === undefined || loadingMore) return;
		void fetchPage(loadedBrowse.current, cursor, "more");
	}, [fetchPage, page?.next_cursor, loadingMore]);

	const retry = useCallback(() => {
		void fetchPage(browse, undefined, "first");
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
