import { useEffect } from "react";
import { useStore } from "zustand";

import { deviceStore } from "@/features/session/device-storage";
import type { SidebarView } from "@/features/sessions/sidebar-view";
import { createSidebarViewStore } from "@/features/sessions/sidebar-view-store";

/**
 * The app's one sidebar-view store, bound to the device store. One instance so
 * the drawer's quick sheet, the drawer itself and the Settings section all read
 * and write the same value — a second instance would be a second answer.
 */
export const sidebarViewStore = createSidebarViewStore(() => deviceStore);

/** The reader's drawer view and its setter; reads the stored view on mount. */
export function useSidebarView(): {
	view: SidebarView;
	setView: (next: SidebarView) => void;
} {
	const view = useStore(sidebarViewStore, (state) => state.view);
	const setView = useStore(sidebarViewStore, (state) => state.setView);
	useEffect(() => {
		void sidebarViewStore.getState().hydrate();
	}, []);
	return { view, setView };
}
