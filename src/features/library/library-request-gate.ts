/**
 * The Library listing's in-flight authority.
 *
 * A debounced search is a request that has not STARTED yet, while a cursor page
 * is a request that has. One shared counter cannot police both: a `loadMore`
 * arriving during the debounce window would take the next ticket, cancel the
 * search that has not fired, and leave the old rows under the new query forever
 * (review round 1, major 1).
 *
 * So there are two generations:
 *
 *  - `query` moves the instant the browse changes — before any request is sent.
 *    A cursor ticket minted under the previous query can never be accepted.
 *  - `request` moves when a request actually starts. A newer first page
 *    supersedes an older cursor page for the SAME query, which is what keeps a
 *    refresh from appending under a page that is already stale.
 *
 * This module is pure and React-free so the delayed-page case can be tested in
 * the Node suite without a renderer.
 */

export interface LibraryRequestTicket {
	query: number;
	request: number;
}

export interface LibraryRequestGate {
	/** Call when the browse changes. Returns the new query generation. */
	queryChanged: () => number;
	/** The generation a debounced start should still belong to. */
	currentQuery: () => number;
	/** Mint a ticket for a request that is starting now. */
	begin: () => LibraryRequestTicket;
	/** True only for the newest request of the newest query. */
	accepts: (ticket: LibraryRequestTicket) => boolean;
}

export function createLibraryRequestGate(): LibraryRequestGate {
	let query = 0;
	let request = 0;
	return {
		queryChanged() {
			query += 1;
			return query;
		},
		currentQuery() {
			return query;
		},
		begin() {
			request += 1;
			return { query, request };
		},
		accepts(ticket) {
			return ticket.query === query && ticket.request === request;
		},
	};
}
