import type { DiscoveredComputer } from "@/connection";
import {
	hideRadientComputer,
	onSavedComputersCleared,
	readHiddenTunnelIds,
} from "@/features/auth/tunnel-storage";
import type { ConnectionStoreApi } from "@/state";

/**
 * The two moves between the saved-computers registry and the connection store,
 * with the store passed in.
 *
 * They live here rather than in the Computers screen and the root hook because
 * both are ordering rules that only a test can hold steady, and neither the screen
 * nor `connection-provider.tsx` (which owns the app's store instance) loads in the
 * Node test host. Callers pass `connectionStore`; tests pass a fresh store.
 */

/**
 * The Computers screen's Remove. Removing is local to this phone and must OUTLAST
 * discovery: the account still has the computer, so the next refresh reports it
 * again. The store's hidden set filters every later `setComputers`, and the
 * registry keeps it across restarts. The store is updated FIRST so the row leaves
 * at once, whatever the keystore write does.
 */
export function removeComputer(
	store: ConnectionStoreApi,
	computer: Pick<DiscoveredComputer, "tunnelId" | "hostname" | "name">,
): Promise<{ persistent: boolean }> {
	store.getState().hideComputer(computer.tunnelId);
	return hideRadientComputer({
		tunnelId: computer.tunnelId,
		hostname: computer.hostname,
		name: computer.name,
	});
}

/**
 * Loads the removed set into the store and empties it whenever sign-out clears
 * the registry. Returns the cleanup.
 *
 * - The loaded ids are UNIONED with what the store already holds: a Remove tapped
 *   while the read is in flight has already hidden its computer in the store, and
 *   replacing the set with the older read would show it again.
 * - A sign-out that lands while the read is in flight wins: the read predates the
 *   wipe, so applying it afterwards would restore removals the reader just forgot.
 *
 * `read` and `onCleared` default to the app's registry; a test may substitute
 * them to hold a read in flight.
 */
export function startSavedComputersHydration(
	store: ConnectionStoreApi,
	read: () => Promise<string[]> = readHiddenTunnelIds,
	onCleared: (listener: () => void) => () => void = onSavedComputersCleared,
): () => void {
	let live = true;
	let readIsCurrent = true;
	const stopListening = onCleared(() => {
		readIsCurrent = false;
		store.getState().setHiddenTunnelIds([]);
	});
	void read().then((loaded) => {
		if (!live || !readIsCurrent || loaded.length === 0) return;
		const state = store.getState();
		state.setHiddenTunnelIds([...state.hiddenTunnelIds, ...loaded]);
	});
	return () => {
		live = false;
		stopListening();
	};
}
