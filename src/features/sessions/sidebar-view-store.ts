import { createStore, type StoreApi } from "zustand/vanilla";

import {
	DEFAULT_SIDEBAR_VIEW,
	parseSidebarView,
	SIDEBAR_VIEW_KEY,
	type SidebarView,
	serializeSidebarView,
} from "@/features/sessions/sidebar-view";

/**
 * The drawer's view preference, held in memory and written through to the
 * device store — the theme preference's pattern (`ui/appearance.tsx`), minus
 * the React effect: the setter persists, so the drawer's quick sheet and the
 * Settings section (two writers, one value) cannot race an effect for it.
 *
 * The storage port is INJECTED so this file stays importable from Node; the
 * app binds it to `deviceStore` in `use-sidebar-view.ts`.
 */
export type SidebarViewStorage = {
	get(key: string): Promise<string | null>;
	set(key: string, value: string): Promise<void>;
};

export type SidebarViewState = {
	view: SidebarView;
	/** Whether the stored view has been read. */
	hydrated: boolean;
	/** Read the stored view once. Safe to call from every mount. */
	hydrate: () => Promise<void>;
	/** Replace the whole view (the module's helpers build the next one). */
	setView: (next: SidebarView) => void;
};

export function createSidebarViewStore(
	storage: () => SidebarViewStorage,
): StoreApi<SidebarViewState> {
	let reading: Promise<void> | null = null;
	/* A tap made before the stored value arrives wins: hydration only fills the
	 *  default, it never undoes a choice (the same rule as `hydrateThemeSelection`).
	 *
	 *  Tracked PER FIELD, not as one flag (review round 1, M2): the tap's `next`
	 *  was built from the DEFAULT the reader saw, so keeping it whole would write
	 *  default values over every stored field the reader never touched. On
	 *  arrival the stored view is kept and only the touched fields override it. */
	const touched = new Set<keyof SidebarView>();
	const persist = (view: SidebarView) => {
		storage()
			.set(SIDEBAR_VIEW_KEY, serializeSidebarView(view))
			.catch(() => {
				// A failed write costs persistence across a relaunch, not the
				// arrangement on screen, and there is nobody to tell mid-tap.
			});
	};
	return createStore<SidebarViewState>((set, get) => ({
		view: DEFAULT_SIDEBAR_VIEW,
		hydrated: false,
		hydrate: () => {
			if (reading) return reading;
			reading = storage()
				.get(SIDEBAR_VIEW_KEY)
				.then(
					(raw) => parseSidebarView(raw),
					// An unreadable store keeps the default: a view preference is never
					// a reason not to draw the list.
					() => DEFAULT_SIDEBAR_VIEW,
				)
				.then((stored) => {
					if (touched.size === 0) {
						set({ view: stored, hydrated: true });
						return;
					}
					const current = get().view;
					const merged: SidebarView = { ...stored };
					for (const key of touched)
						Object.assign(merged, { [key]: current[key] });
					set({ view: merged, hydrated: true });
					// The early tap wrote `current`; the disk must hold the merge.
					persist(merged);
				});
			return reading;
		},
		setView: (next) => {
			const prev = get().view;
			if (next === prev) return;
			for (const key of Object.keys(next) as (keyof SidebarView)[]) {
				if (JSON.stringify(next[key]) !== JSON.stringify(prev[key]))
					touched.add(key);
			}
			set({ view: next });
			persist(next);
		},
	}));
}
