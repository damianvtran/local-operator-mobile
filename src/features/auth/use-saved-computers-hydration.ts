import { useEffect } from "react";

import { connectionStore } from "@/features/auth/connection-provider";
import { readHiddenTunnelIds } from "@/features/auth/tunnel-storage";

/**
 * Loads the computers the reader removed into the connection store, once per app
 * run.
 *
 * Mounted at the root rather than in the picker because every screen that reads
 * `state.computers` (home, settings, the deep-link label) must see a removed
 * computer as removed after a cold start, not only the picker. It lives outside
 * `connection-provider.tsx` on purpose: wiring the registry into the provider's
 * route lifecycle is a later slice.
 *
 * The loaded ids are UNIONED with what the store already holds: a Remove tapped
 * while this read is in flight has already hidden its computer in the store, and
 * replacing the set with the older read would show it again.
 */
export function useSavedComputersHydration(): void {
	useEffect(() => {
		let live = true;
		void readHiddenTunnelIds().then((loaded) => {
			if (!live || loaded.length === 0) return;
			const store = connectionStore.getState();
			store.setHiddenTunnelIds([...store.hiddenTunnelIds, ...loaded]);
		});
		return () => {
			live = false;
		};
	}, []);
}
