import { Platform } from "react-native";

import {
	type CustomRouteSet,
	expoSecureStore,
	memorySecureStore,
	SECURE_KEYS,
	SecureStorage,
	type SecureStoreAdapter,
} from "@/connection";

/**
 * Where the app keeps the reader's own tunnel.
 *
 * `src/connection/storage.ts` owns the *record* (its shape, its parser, its size
 * cap, and the platform keystore); this module owns the *app's* use of it, which is
 * three things that module deliberately does not do:
 *
 *  1. **One instance per app run.** `expoSecureStore()` is async and builds a
 *     platform adapter; building one per screen would open a second handle on the
 *     same keychain item for no reason.
 *  2. **A removal that is not a wipe.** The connection layer exposes `clearAll()`
 *     (every item, which is what sign-out means) and no per-item delete. Removing
 *     a saved tunnel must NOT take the Radient grant with it, so the delete goes
 *     through the adapter this module already holds — the adapter and
 *     `SECURE_KEYS` are both public, so this is composition, not a fork.
 *  3. **The web fallback, stated rather than hidden.** A browser runtime has no
 *     keystore; `memorySecureStore()` keeps the tunnel for the session only. The
 *     app therefore works on web, and does not pretend the password survived a
 *     reload — Settings says which of the two it is.
 *
 * The password is never logged, never put in a URL, and never leaves this module
 * except into the password field a reader is editing.
 */

let adapter: SecureStoreAdapter | null = null;
let storage: SecureStorage | null = null;

/**
 * The reader's own tunnel, as this layer stores it.
 *
 * It lives here rather than in `src/state/connection-store.ts` because the merged
 * store (PR #7) describes a ROUTE, and a saved tunnel is a credential plus an
 * address that outlives any route. Keeping it out of the store also keeps this
 * slice's addition out of a file another stream owns.
 */
export interface SavedTunnel {
	baseUrl: string;
	password: string | null;
	allowInsecure: boolean;
}

export type TunnelStorage = {
	storage: SecureStorage;
	adapter: SecureStoreAdapter;
	/** True when values survive a restart — the native keystore, not the web
	 *  fallback. Settings states this instead of implying persistence everywhere. */
	persistent: boolean;
};

async function open(): Promise<TunnelStorage> {
	if (storage && adapter) {
		return { storage, adapter, persistent: Platform.OS !== "web" };
	}
	const persistent = Platform.OS !== "web";
	adapter = persistent ? await expoSecureStore() : memorySecureStore();
	storage = new SecureStorage(adapter);
	return { storage, adapter, persistent };
}

/** The stored tunnel, or null. A runtime whose keystore refuses reads (a locked
 *  keychain, an unavailable platform module) reports "nothing saved" rather than
 *  failing a screen the reader cannot fix. */
export async function readSavedTunnel(): Promise<SavedTunnel | null> {
	try {
		const { storage: store } = await open();
		const record = await store.readCustomRoute();
		if (!record) return null;
		return {
			baseUrl: record.base_url,
			password: record.password,
			allowInsecure: record.allow_insecure,
		};
	} catch {
		return null;
	}
}

/** Persists a tunnel. Returns whether it can survive a restart, so the caller can
 *  say so plainly. */
export async function writeSavedTunnel(
	tunnel: SavedTunnel,
): Promise<{ persistent: boolean }> {
	const { storage: store, persistent } = await open();
	const record: CustomRouteSet = {
		base_url: tunnel.baseUrl,
		password: tunnel.password,
		allow_insecure: tunnel.allowInsecure,
	};
	try {
		await store.writeCustomRoute(record);
	} catch {
		/* A platform that cannot store it (no keystore, a value over the cap) still
		 * gets a working session: the route lives in the store for this run. */
		return { persistent: false };
	}
	return { persistent };
}

/** Forgets the saved tunnel and nothing else — the Radient grant, the tunnel
 *  session and the app's own state are other items and other concerns. */
export async function removeSavedTunnel(): Promise<void> {
	try {
		const { adapter: store } = await open();
		await store.deleteItemAsync(SECURE_KEYS.custom);
	} catch {
		/* Nothing to forget, or nothing that can forget: both leave the app in the
		 *  state the reader asked for. */
	}
}
