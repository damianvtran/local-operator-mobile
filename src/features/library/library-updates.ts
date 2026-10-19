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
}

interface LibraryUpdatesState {
	revision: number;
	update: LibraryUpdate | null;
}

const store = createStore<LibraryUpdatesState>()(() => ({
	revision: 0,
	update: null,
}));

export function publishLibraryUpdate(update: LibraryUpdate): void {
	store.setState((state) => ({
		revision: state.revision + 1,
		update,
	}));
}

export function libraryUpdateState(): LibraryUpdatesState {
	return store.getState();
}

/** Tests only: the module store must not leak one case's save into the next. */
export function resetLibraryUpdates(): void {
	store.setState({ revision: 0, update: null });
}
