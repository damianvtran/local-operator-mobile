/**
 * The one cross-screen fact the inbox list needs: "a write from another inbox
 * screen has SETTLED".
 *
 * WHY THIS EXISTS. The list stays mounted under the detail route, so returning
 * to it re-runs nothing — QA round 7 (O2) and the audit scout both found the
 * list showing rows and a count the store had already moved past (a read via the
 * detail, a "dismiss all from conversation"). A refetch on focus fixes the plain
 * case, but not the one that matters most: the detail's read is awaited with its
 * own short budget, and a reader who presses Back while that PATCH (or a
 * dismiss-all batch) is still in flight would make the focus read land BEFORE
 * the write — newest-ticket-wins then correctly keeps an answer that is already
 * stale. So the detail publishes "a write settled" here, and the list re-reads
 * on that signal too, whether or not it is focused yet; its own ticket makes the
 * later read the one that paints.
 *
 * A module-level revision rather than a React context, for the reason
 * `library-updates.ts` gives: the two routes are siblings in the router, and a
 * provider would have to wrap the stack just to carry one number. Nothing else
 * rides along — the list re-reads the relay instead of patching rows from a
 * receipt (the hook's rule 2).
 */

import { createStore } from "zustand/vanilla";

const store = createStore<{ revision: number }>()(() => ({ revision: 0 }));

/** Call after an inbox write made OUTSIDE the list screen has settled (landed or
 *  failed — a failed write may still have moved some rows, and a re-read is the
 *  only honest way to find out). */
export function noteInboxWrite(): void {
	store.setState((state) => ({ revision: state.revision + 1 }));
}

export function inboxWriteRevision(): number {
	return store.getState().revision;
}

/** Subscribe to settled writes. Returns the unsubscribe. */
export function onInboxWrite(listener: () => void): () => void {
	return store.subscribe((next, previous) => {
		if (next.revision !== previous.revision) listener();
	});
}
