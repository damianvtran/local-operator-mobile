import { useCallback, useEffect, useMemo, useState } from "react";

import type { TranscriptEntry } from "@/contracts";
import {
	type FindHit,
	findActiveIndex,
	findCursorMove,
	findDocs,
	searchConversation,
} from "@/features/session/find";

/**
 * The find session: one conversation's search state and the transitions between
 * its two visible modes.
 *
 * ## The two modes, and why one state
 *
 * The phone cannot show the desktop's overlay-and-transcript at once (a 320 pt
 * column has room for the results OR the conversation, not both), so the flow
 * is the iOS one split into two modes of ONE state:
 *
 *   - **browse** — the sheet, the field, the ranked results; the keyboard up;
 *     the reader is choosing a hit;
 *   - **navigate** — the sheet closed, the transcript showing the landed
 *     message with the wash, and the bar (`n of m`, prev/next, close) pinned
 *     above the composer.
 *
 * `activate` is the seam between them (tap a result or step from the sheet's
 * own rows), `reopen` goes back (the bar's count segment), `exit` ends it. The
 * transitions are a pure function so the flow is pinned by tests without a
 * renderer — the same split `completion-ack.ts` and the screenshot suite use.
 *
 * ## Why the nonce
 *
 * The transcript's reveal has to re-run when the reader steps onto the message
 * they are ALREADY on (one hit, `next` wraps to itself; or two presses before
 * the list re-renders). An id cannot express "again", so every landing bumps
 * `nonce` and the list's reveal effect is keyed on it.
 *
 * ## Why the state resets on a session switch
 *
 * Another conversation's hits are not this one's — the same rule the scroll
 * offsets and the condense latch follow. A query carried across a session
 * switch would point at messages that are not there.
 */

/** The find session's whole state, as one object: the sheet, the query, the
 *  landed hit's IDENTITY, and the landing counter. */
export interface FindState {
	/** The results sheet is up (browse mode). */
	open: boolean;
	query: string;
	/** The landed hit's message id, or `null`. An ID rather than an index: the
	 *  hits array is recomputed on every frame and the window slides under it, so
	 *  an index silently re-points at whatever message now occupies that rank —
	 *  the bar's `n of m` moves, the wash moves, and a step walks from a message
	 *  the reader never chose. The id re-resolves to the same message or clears. */
	activeId: string | null;
	/** Bumps on every landing so the reveal re-runs even for the same id. */
	nonce: number;
}

export const FIND_INITIAL: FindState = {
	open: false,
	query: "",
	activeId: null,
	nonce: 0,
};

export type FindEvent =
	/** The header's lever: a fresh search (a stale query is not the reader's). */
	| { type: "open" }
	/** The bar's count segment: back to the results, query and place kept. */
	| { type: "reopen" }
	/** The sheet's own close. With a landed hit the bar stays; without one,
	 *  find mode is over — there is nothing to navigate. */
	| { type: "closeSheet" }
	/** The bar's close: find mode over, everything cleared. */
	| { type: "exit" }
	| { type: "query"; query: string }
	/** A result was chosen: land on it (sheet closed, bar up). The hits array
	 *  rides along so the landing is recorded as an IDENTITY — the index alone
	 *  is a rank in a list that recomputes under it. */
	| { type: "activate"; hits: readonly FindHit[]; index: number }
	/** Step from the CURRENT position of the landed id (never from a stalely
	 *  ranked index — the same array rides along). */
	| { type: "step"; hits: readonly FindHit[]; delta: 1 | -1 };

export const findNextState = (
	state: FindState,
	event: FindEvent,
): FindState => {
	/* Every reset preserves `nonce`: it is the reveal effect's key, and reusing
	 * a value this screen has already burned would make the list skip the next
	 * landing (`reveal.nonce === seen` reads as "already revealed"). Monotone
	 * for the life of the screen, reset only by a session switch's remount-like
	 * effect in the hook — which the list also follows, since its ref lives
	 * beside the session. */
	switch (event.type) {
		case "open":
			return { ...FIND_INITIAL, open: true, nonce: state.nonce };
		case "reopen":
			return { ...state, open: true };
		case "closeSheet":
			return state.activeId !== null
				? { ...state, open: false }
				: { ...FIND_INITIAL, nonce: state.nonce };
		case "exit":
			return { ...FIND_INITIAL, nonce: state.nonce };
		case "query":
			// A new query is a new answer set: the old landing cannot describe
			// it, so the position resets rather than silently pointing at
			// whatever message now occupies that rank.
			return { ...state, query: event.query, activeId: null };
		case "activate": {
			const activeId = event.hits[event.index]?.id ?? null;
			return activeId === null
				? { ...state, open: false, activeId: null }
				: { ...state, open: false, activeId, nonce: state.nonce + 1 };
		}
		case "step": {
			const from = findActiveIndex(event.hits, state.activeId);
			const next = findCursorMove(from, event.delta, event.hits.length);
			const id = next < 0 ? null : (event.hits[next]?.id ?? null);
			return id === null
				? { ...state, activeId: null }
				: { ...state, activeId: id, nonce: state.nonce + 1 };
		}
	}
};

/** What the session screen and its sheet/bar consume. */
export interface FindSession {
	sheetOpen: boolean;
	barVisible: boolean;
	query: string;
	hits: FindHit[];
	truncated: boolean;
	/** The landed hit's index into the CURRENT hits — resolved from the landed
	 *  id, so it tracks a rank that shifted — or `-1` while nothing is landed. */
	active: number;
	activeHit: FindHit | null;
	/** How many messages the search covers — the scope line's own count. */
	messages: number;
	/** The jump the transcript should make, or `null` while nothing is landed. */
	reveal: { id: string; nonce: number } | null;
	open: () => void;
	reopen: () => void;
	closeSheet: () => void;
	exit: () => void;
	setQuery: (query: string) => void;
	activate: (index: number) => void;
	step: (delta: 1 | -1) => void;
}

export const useFind = (input: {
	sessionId: string;
	entries: readonly TranscriptEntry[];
}): FindSession => {
	const { sessionId, entries } = input;
	const [state, setState] = useState<FindState>(FIND_INITIAL);

	// A session switch starts over (see the module note). An effect rather than
	// a keyed remount because the screen does not remount per session id —
	// `sessionId` is a dependency the exhaustive-deps rule cannot justify from
	// the body, and it is exactly the trigger that matters (the transcript-list
	// precedent for the same reset).
	// biome-ignore lint/correctness/useExhaustiveDependencies: see the comment above
	useEffect(() => {
		setState(FIND_INITIAL);
	}, [sessionId]);

	const answer = useMemo(
		() => searchConversation(entries, state.query),
		[entries, state.query],
	);
	const messages = useMemo(() => findDocs(entries).length, [entries]);
	// The landing is an IDENTITY resolved against the CURRENT hits: a rank shift
	// under it keeps the same message selected ("n of m" re-reads the message's
	// new rank; the wash follows the id); a message that slid out of the frames
	// resolves to -1 and takes the bar with it rather than pointing at nothing.
	const active = findActiveIndex(answer.hits, state.activeId);
	const activeHit = active >= 0 ? (answer.hits[active] ?? null) : null;
	const barVisible = !state.open && activeHit !== null;

	const dispatch = useCallback((event: FindEvent) => {
		setState((current) => findNextState(current, event));
	}, []);

	const open = useCallback(() => dispatch({ type: "open" }), [dispatch]);
	const reopen = useCallback(() => dispatch({ type: "reopen" }), [dispatch]);
	const closeSheet = useCallback(
		() => dispatch({ type: "closeSheet" }),
		[dispatch],
	);
	const exit = useCallback(() => dispatch({ type: "exit" }), [dispatch]);
	const setQuery = useCallback(
		(query: string) => dispatch({ type: "query", query }),
		[dispatch],
	);
	const activate = useCallback(
		(index: number) => dispatch({ type: "activate", index, hits: answer.hits }),
		[dispatch, answer.hits],
	);
	const step = useCallback(
		(delta: 1 | -1) => dispatch({ type: "step", delta, hits: answer.hits }),
		[dispatch, answer.hits],
	);

	const reveal = useMemo(
		() =>
			activeHit === null ? null : { id: activeHit.id, nonce: state.nonce },
		[activeHit, state.nonce],
	);

	return {
		sheetOpen: state.open,
		barVisible,
		query: state.query,
		hits: answer.hits,
		truncated: answer.truncated,
		active: activeHit === null ? -1 : active,
		activeHit,
		messages,
		reveal,
		open,
		reopen,
		closeSheet,
		exit,
		setQuery,
		activate,
		step,
	};
};
