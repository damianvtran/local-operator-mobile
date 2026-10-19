/**
 * The one cross-screen fact the Library list needs: a save made on the detail
 * screen.
 *
 * The list stays mounted under the detail route, so its cursor pages and search
 * are still there when the reader comes Back. Refetching the listing would throw
 * that position away, so the detail publishes the saved row instead and the list
 * patches the rows it already has. Tag counts ride along when the detail could
 * re-read the vocabulary; `null` means "the row changed, the counts did not".
 *
 * A module-level revision rather than a React context: both routes are siblings
 * in the router, and a provider would have to wrap the stack just to carry one
 * value. The list records the revision it mounted with, so a remount does not
 * replay an old save onto freshly fetched rows.
 */

import { createStore } from "zustand/vanilla";

import type { LibraryAsset, LibraryTag } from "@/contracts";

export interface LibraryUpdate {
	asset: LibraryAsset;
	tags: LibraryTag[] | null;
	/** Logical save time, shared with request starts via `nextEpoch`. A fetch
	 *  that STARTED after this value may retire this row's override; one that
	 *  started before it must not. */
	epoch: number;
}

export type LibraryUpdateInput = Omit<LibraryUpdate, "epoch">;

/**
 * One monotonic clock for saves and request starts.
 *
 * Timestamps in milliseconds are too coarse: a refresh issued immediately after
 * Save can share its millisecond, and `>` would then preserve an override an
 * authoritative answer had already replaced. A counter has no tie.
 */
let epoch = 0;
export const nextEpoch = (): number => {
	epoch += 1;
	return epoch;
};

interface LibraryUpdatesState {
	revision: number;
	/** The latest save, used for the global tag vocabulary. */
	update: LibraryUpdate | null;
	/** Every saved row by asset id: page 2 appending must not drop asset A's
	 *  rename, and a second save must not replace the first. */
	updates: Record<string, LibraryUpdate>;
	/** The latest tag vocabulary a save re-read, kept across metadata-only
	 *  saves so a later rename cannot erase the earlier tag-count refresh. */
	vocabulary: LibraryTag[] | null;
}

const store = createStore<LibraryUpdatesState>()(() => ({
	revision: 0,
	update: null,
	updates: {},
	vocabulary: null,
}));

export function publishLibraryUpdate(update: LibraryUpdateInput): void {
	const stamped: LibraryUpdate = { ...update, epoch: nextEpoch() };
	store.setState((state) => ({
		revision: state.revision + 1,
		update: stamped,
		updates: { ...state.updates, [stamped.asset.id]: stamped },
		vocabulary: stamped.tags ?? state.vocabulary,
	}));
}

export function libraryUpdateState(): LibraryUpdatesState {
	return store.getState();
}

/** Tests only: the module store must not leak one case's save into the next. */
export function resetLibraryUpdates(): void {
	epoch = 0;
	store.setState({ revision: 0, update: null, updates: {}, vocabulary: null });
}
