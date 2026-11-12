/**
 * The production binding of the warm cache (`src/state/warm-cache.ts`).
 *
 * - **Native:** the sealed `warm` family of the native private store, so a cached
 *   transcript is AES-GCM ciphertext at rest like every draft and envelope. Every
 *   write goes through `runPrivateWrite`, so the sign-out / 401 barrier fences a
 *   cache save exactly as it fences a draft save: a save already running when
 *   retirement starts is drained and then purged, and one that starts after it is
 *   refused (the cache swallows that refusal — a cold cache is not an error).
 * - **Web:** memory only, by design (see `memoryWarmStore`). A web reload starts
 *   cold; a tab switch keeps the in-memory copy, which is all the resume needs.
 *
 * The purge is `clearWarmCache`, called from `clearAuthorizationData`, which the
 * startup authorization lifecycle runs on every explicit sign-out, every rejected
 * login (`401` → reauthenticate) and every proven owner change.
 */

import { Platform } from "react-native";
import {
	createWarmCache,
	memoryWarmStore,
	WARM_KEY_PREFIX,
	type WarmStorePort,
} from "@/state/warm-cache";
import { nativePrivateStore } from "./native-private-store";
import { runPrivateWrite } from "./scoped-storage";

const sealedWarm = nativePrivateStore("warm");

const nativePort: WarmStorePort = {
	get: (key) => sealedWarm.get(key),
	set: (key, value) => runPrivateWrite(() => sealedWarm.set(key, value)),
	remove: (key) => runPrivateWrite(() => sealedWarm.remove(key)),
	keys: () => sealedWarm.keys(),
};

const webPort = memoryWarmStore();
/* Memory or not, a web save is fenced by the same barrier: a save racing a
 * sign-out must not repopulate what the purge just emptied. */
const fencedWebPort: WarmStorePort = {
	get: (key) => webPort.get(key),
	set: (key, value) => runPrivateWrite(() => webPort.set(key, value)),
	remove: (key) => runPrivateWrite(() => webPort.remove(key)),
	keys: () => webPort.keys(),
};

export const warmCache = createWarmCache(
	Platform.OS === "web" ? fencedWebPort : nativePort,
);

/**
 * Erases every warm entry. Runs after the private-write barrier has drained
 * (inside `clearAuthorizationData`), so it must not route through
 * `runPrivateWrite` — the barrier is closed by then and would refuse it.
 */
export async function clearWarmCache(): Promise<void> {
	if (Platform.OS === "web") {
		for (const key of await webPort.keys())
			if (key.startsWith(WARM_KEY_PREFIX)) await webPort.remove(key);
		return;
	}
	await sealedWarm.clear();
}
