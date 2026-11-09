import { useEffect } from "react";

import { connectionStore } from "@/features/auth/connection-provider";
import { startSavedComputersHydration } from "@/features/auth/saved-computers-sync";

/**
 * Loads the computers the reader removed into the connection store, once per app
 * run, and empties that set again whenever sign-out clears the registry (the
 * ordering rules are on `startSavedComputersHydration`).
 *
 * Mounted at the root rather than in the picker because every screen that reads
 * `state.computers` (home, settings, the deep-link label) must see a removed
 * computer as removed after a cold start, not only the picker. It lives outside
 * `connection-provider.tsx` on purpose: wiring the registry into the provider's
 * route lifecycle is a later slice.
 */
export function useSavedComputersHydration(): void {
	useEffect(() => startSavedComputersHydration(connectionStore), []);
}
