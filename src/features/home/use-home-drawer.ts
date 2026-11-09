import { useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { useWorkspaceDrawer } from "@/features/sessions/workspace-drawer";

/** Home already renders the persistent conversations pane in split layout.
 * The Conversations alias requests that surface, not a second modal above it.
 * Reconcile both directions on rotation: dismiss any narrow-screen overlay
 * when its persistent owner appears, and reopen the alias only when narrow.
 * Ordinary Home does not acquire an overlay just because its width changed;
 * Reconcile only while Home owns the focused route: the stack can retain Home
 * behind a chat, whose hamburger must continue to own its shared overlay. */
export function useHomeDrawer(forcePanelOpen: boolean, split: boolean) {
	const { open, close } = useWorkspaceDrawer();
	useFocusEffect(
		useCallback(() => {
			if (split) close();
			else if (forcePanelOpen) open();
		}, [forcePanelOpen, split, open, close]),
	);
}
