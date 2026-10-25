/**
 * The inbox's data path: one read, and the four writes a reader can make.
 *
 * Three rules, each of which has already cost another screen a defect:
 *
 *  1. **The latest read wins.** A filter switch while the first page is in flight
 *     must not paint the unread pile over the All pile — the screen would show
 *     the wrong rows under the right control. Every load takes a ticket and only
 *     the holder may set state.
 *  2. **A write reports what MOVED.** The relay answers `changed`/`skipped`, so
 *     the screen re-reads after a write instead of assuming the whole selection
 *     landed: an update that arrived between render and gesture is exactly the
 *     row the contract says must survive, and pretending otherwise is the bug
 *     the revision token exists to prevent.
 *  3. **A read that failed is not an empty inbox.** `refused` (the relay's own
 *     sentence) and `unreachable` (no answer at all) are separate from `response
 *     === null`; neither may render as "All caught up".
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type {
	NotificationsResponse,
	NotificationWriteResponse,
} from "@/contracts";
import {
	DETAIL_UNREACHABLE,
	READ_FAILED,
	READ_UNREACHABLE,
	SKIPPED_SENTENCE,
} from "@/features/notifications/notifications-model";
import type {
	NotificationPatchRequest,
	NotificationSeenRequest,
	NotificationTarget,
	RelayEndpoints,
} from "@/relay";
import { isRelayError } from "@/relay";

/** A hung read is itself a failure the screen must show rather than a blank
 *  list — the asks sheet's rule, reused here. */
const READ_TIMEOUT_MS = 8_000;

/** The list filter. `unread` is the pile to work through; `all` keeps what has
 *  already been read readable (durable read history is a contract requirement —
 *  a cleared item is never discarded). */
export type InboxFilter = "unread" | "all";

export interface InboxWriteOutcome {
	ok: boolean;
	/** The ids the store actually moved, so a caller can settle exactly what the
	 *  relay accepted rather than what it asked for. */
	changed: string[];
	/** Rows the relay refused, with its reason. Empty on a clean write. */
	skipped: NotificationWriteResponse["skipped"];
}

export interface InboxState {
	response: NotificationsResponse | null;
	/** A first read is in flight and there is nothing to paint under it. */
	loading: boolean;
	/** A write or a silent refresh is in flight: the rows on screen are still
	 *  the relay's last answer, so they stay. */
	busy: boolean;
	/** A cursor page is in flight. The list stays interactive. */
	loadingMore: boolean;
	filter: InboxFilter;
	setFilter: (filter: InboxFilter) => void;
	/** The relay's own sentence for a refused read, when it sent one. */
	refused: string | null;
	/** A read that failed with no sentence: the connection's own surface owns it. */
	unreachable: boolean;
	/** The minute clock the relative labels and the time buckets read. */
	nowMs: number;
	/** The last write's refusals, for the line under the toolbar. */
	skipped: NotificationWriteResponse["skipped"];
	reload: (options?: { silent?: boolean }) => void;
	/** Load the next cursor page, appending to what is on screen. Absent (no
	 *  `next_cursor`) means the last page is already here. */
	loadMore: () => void;
	/** One explicit act over the given rows. */
	write: (
		op: NotificationPatchRequest["op"],
		targets: NotificationTarget[],
	) => Promise<InboxWriteOutcome>;
	/** Mark everything this answer held as read. Names the answer's own
	 *  `high_water`, so an item that arrived after the render stays unread. */
	markAllRead: () => Promise<InboxWriteOutcome>;
	/** The evidenced in-view receipt. Deliberately the ONLY automatic path, and
	 *  it carries the platform's own gesture as evidence. */
	seen: (
		targets: NotificationTarget[],
		evidence: NotificationSeenRequest["evidence"],
	) => Promise<InboxWriteOutcome>;
}

export function useNotifications(
	client: RelayEndpoints | null,
	enabled: boolean,
): InboxState {
	const [response, setResponse] = useState<NotificationsResponse | null>(null);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [loadingMore, setLoadingMore] = useState(false);
	const [filter, setFilterState] = useState<InboxFilter>("unread");
	const [refused, setRefused] = useState<string | null>(null);
	const [unreachable, setUnreachable] = useState(false);
	const [nowMs, setNowMs] = useState(() => Date.now());
	const [skipped, setSkipped] = useState<NotificationWriteResponse["skipped"]>(
		[],
	);
	/** The newest load's ticket. A response for an older ticket is dropped. */
	const ticketRef = useRef(0);
	/** The newest answer, for `loadMore` to read without re-creating its callback
	 *  on every page. */
	const responseRef = useRef<NotificationsResponse | null>(null);
	responseRef.current = response;
	/** The filter the CURRENT rows were loaded with, so a silent refresh asks the
	 *  same question the screen is showing. */
	const filterRef = useRef<InboxFilter>(filter);

	const load = useCallback(
		async (options?: { silent?: boolean }) => {
			if (client === null || !enabled) return;
			const ticket = ++ticketRef.current;
			const asked = filterRef.current;
			if (options?.silent !== true) {
				setLoading(true);
				setRefused(null);
				setUnreachable(false);
			}
			try {
				const answer = await client.notifications(
					{ state: asked === "all" ? "all" : "unread" },
					AbortSignal.timeout(READ_TIMEOUT_MS),
				);
				if (ticket !== ticketRef.current) return;
				setResponse(answer);
				setRefused(null);
				setUnreachable(false);
				setNowMs(Date.now());
			} catch (error) {
				if (ticket !== ticketRef.current) return;
				if (options?.silent === true) return;
				const sentence = refusalSentence(error);
				if (sentence !== null) setRefused(sentence);
				else setUnreachable(true);
				/* The failure is stated; the previous answer is NOT cleared. A screen
				 * that blanked its rows on a failed refresh would look like an inbox
				 * that was emptied. */
			} finally {
				if (ticket === ticketRef.current && options?.silent !== true) {
					setLoading(false);
				}
			}
		},
		[client, enabled],
	);

	useEffect(() => {
		void load();
	}, [load]);

	/* The minute clock: relative labels and the "Today"/"Yesterday" buckets are
	 * both read off `nowMs`, so a frame left open must age rather than freeze at
	 * the moment it loaded. */
	useEffect(() => {
		const timer = setInterval(() => setNowMs(Date.now()), 60_000);
		return () => clearInterval(timer);
	}, []);

	/**
	 * The next page, APPENDED.
	 *
	 * `waiting` is first-page-only by contract, so the appended answer's waiting
	 * list is ignored and the held one is kept: asking again would put the same
	 * pinned rows at the top of a page that is about updates further down. The
	 * counts come from the newest answer (they are store-wide, not page-wide), and
	 * `high_water` with them.
	 */
	const loadMore = useCallback(() => {
		const held = responseRef.current;
		const clientNow = client;
		if (clientNow === null || !enabled) return;
		if (held === null || held.next_cursor === null) return;
		const asking = filterRef.current;
		const ticket = ++ticketRef.current;
		void (async () => {
			setLoadingMore(true);
			try {
				const answer = await clientNow.notifications({
					state: asking === "all" ? "all" : "unread",
					cursor: held.next_cursor ?? undefined,
				});
				if (ticket !== ticketRef.current) return;
				setResponse({
					...answer,
					waiting: held.waiting,
					items: [...held.items, ...answer.items],
				});
				setNowMs(Date.now());
			} catch {
				/* A failed page is not a failed list: what is on screen stays, and the
				 * reader can ask again by pulling to refresh. */
			} finally {
				if (ticket === ticketRef.current) setLoadingMore(false);
			}
		})();
	}, [client, enabled]);

	const setFilter = useCallback(
		(next: InboxFilter) => {
			if (filterRef.current === next) return;
			filterRef.current = next;
			setFilterState(next);
			/* The rows under the new control must not be the old answer while the
			 * new one is in flight — but they also must not vanish (rule 3). The
			 * ticket refuses the stale answer; the rows stay until it lands. */
			void load();
		},
		[load],
	);

	const settle = useCallback(
		async (
			call: (client: RelayEndpoints) => Promise<NotificationWriteResponse>,
		): Promise<InboxWriteOutcome> => {
			if (client === null || !enabled) {
				return { ok: false, changed: [], skipped: [] };
			}
			setBusy(true);
			try {
				const answer = await call(client);
				setSkipped(answer.skipped);
				/* Re-read rather than patch the rows locally: the relay's answer is
				 * the store's state, and a local edit would drift from it the first
				 * time a write was skipped. */
				await load({ silent: true });
				return { ok: true, changed: answer.changed, skipped: answer.skipped };
			} catch {
				setSkipped([]);
				return { ok: false, changed: [], skipped: [] };
			} finally {
				setBusy(false);
			}
		},
		[client, enabled, load],
	);

	const write = useCallback(
		(op: NotificationPatchRequest["op"], targets: NotificationTarget[]) =>
			settle((live) => live.patchNotifications({ op, ids: targets })),
		[settle],
	);

	const markAllRead = useCallback(() => {
		const answer = response;
		if (answer === null || answer.high_water <= 0) {
			return Promise.resolve({ ok: true, changed: [], skipped: [] });
		}
		return settle((live) =>
			/* `all` + `through_seq`: token-bound to what this screen held, never a
			 * session-wide sweep (R10 — no automatic path clears in bulk, and an
			 * explicit one clears only what it enumerated). */
			live.patchNotifications({
				op: "read",
				all: true,
				through_seq: answer.high_water,
			}),
		);
	}, [response, settle]);

	const seen = useCallback(
		(
			targets: NotificationTarget[],
			evidence: NotificationSeenRequest["evidence"],
		) =>
			settle((live) =>
				live.markNotificationsSeen({ items: targets, evidence }),
			),
		[settle],
	);

	return {
		response,
		loading,
		busy,
		loadingMore,
		filter,
		setFilter,
		refused,
		unreachable,
		nowMs,
		skipped,
		reload: load,
		loadMore,
		write,
		markAllRead,
		seen,
	};
}

/** The relay's own sentence for a refused read, or `null` when the failure was a
 *  transport drop (which the connection's surface owns rather than this screen
 *  re-wording). */
export function refusalSentence(error: unknown): string | null {
	if (!isRelayError(error)) return null;
	if (error.kind !== "rejected") return null;
	const sentence = error.displayableMessage.trim();
	return sentence === "" ? null : sentence;
}

/** The line a write's refusals earn. One sentence for the whole line: the reader
 *  does not need a per-row reason when the row is still in front of them. */
export function skippedSentence(
	skipped: NotificationWriteResponse["skipped"],
): string | null {
	return skipped.length === 0 ? null : SKIPPED_SENTENCE;
}

export const INBOX_FAILED_READ = READ_FAILED;
export const INBOX_UNREACHABLE = READ_UNREACHABLE;
export const INBOX_DETAIL_UNREACHABLE = DETAIL_UNREACHABLE;
