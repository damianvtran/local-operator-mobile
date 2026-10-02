import { Platform } from "react-native";

import {
	type CustomRouteSet,
	expoSecureStore,
	memorySecureStore,
	oauthSetFromTokens,
	type RadientTokens,
	SECURE_KEYS,
	SecureStorage,
	type SecureStoreAdapter,
	sessionFromTunnelSet,
	type TunnelSession,
	tokensFromOauthSet,
	tunnelSetFromSession,
} from "@/connection";

/**
 * Where the app keeps the reader's credentials.
 *
 * `src/connection/storage.ts` owns the *records* (their shapes, their parsers, their
 * size cap, and the platform keystore); this module owns the *app's* use of them, which
 * is three things that module deliberately does not do:
 *
 *  1. **One instance per app run.** `expoSecureStore()` is async and builds a
 *     platform adapter; building one per screen would open a second handle on the
 *     same keychain item for no reason.
 *  2. **A removal that is not a wipe.** The connection layer exposes `clearAll()`
 *     (every item, which is what sign-out means) and no per-item delete. Removing
 *     a saved tunnel must NOT take the Radient grant with it, and clearing a lapsed
 *     grant must not take the 30-day tunnel handle, so each delete goes through the
 *     adapter this module already holds — the adapter and `SECURE_KEYS` are both
 *     public, so this is composition, not a fork.
 *  3. **The web fallback, stated rather than hidden.** A browser runtime has no
 *     keystore; `memorySecureStore()` keeps values for the session only. The
 *     app therefore works on web, and does not pretend a password or a sign-in
 *     survived a reload — Settings says which of the two it is.
 *
 * The Radient records live here too, beside the tunnel's, because all three arrive
 * through the same `open()`: a second module would have to duplicate the adapter
 * singleton (and its web fallback) or import this one's, and the first is the mistake
 * the singleton exists to prevent. The FILE NAME is the older name, not the scope.
 *
 * No secret is ever logged, put in a URL, or handed to a store or a component: the
 * password leaves this module only into the field a reader is editing, and the tokens
 * only into the connection layer's own ref.
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

/* ----------------------------------------------------------- Radient records */

/**
 * The stored Radient grant, or null.
 *
 * Returned only to the connection layer, which is the one caller allowed to hold an
 * access token (`docs/architecture.md` principle 4): no screen reads this, so no screen
 * can show it. A corrupt or unreadable record reports `null`, which sends the reader to
 * the sign-in surface rather than into a request signed with half a token.
 */
export async function readStoredOauth(): Promise<RadientTokens | null> {
	try {
		const { storage: store } = await open();
		const record = await store.readOauth();
		return record ? tokensFromOauthSet(record) : null;
	} catch {
		return null;
	}
}

/** Persists the grant. Returns whether it can survive a restart, so a caller can tell
 *  "signed in and remembered" from "signed in for this run" instead of implying the
 *  first. */
export async function writeStoredOauth(
	tokens: RadientTokens,
): Promise<{ persistent: boolean }> {
	try {
		const { storage: store, persistent } = await open();
		await store.writeOauth(oauthSetFromTokens(tokens));
		return { persistent };
	} catch {
		/* No keystore (web), or a value over the platform's cap: the session still works
		 * for this run, and the caller learns it will not survive from `persistent`. */
		return { persistent: false };
	}
}

/**
 * Forgets the grant and NOTHING else.
 *
 * The tunnel handle stays: `ADR 0002` §3 keeps a still-valid 30-day session when the
 * short-lived access token lapses, and dropping the handle here would cost a re-mint
 * for a credential that was merely overdue for a refresh.
 */
export async function clearStoredOauth(): Promise<void> {
	try {
		const { storage: store } = await open();
		await store.clearOauthOnly();
	} catch {
		/* Nothing to forget, or nothing that can forget. */
	}
}

/** The stored tunnel session, or null. The CALLER verifies it before use: a record
 *  that exists is not a session that is still valid. */
export async function readStoredTunnelSession(): Promise<TunnelSession | null> {
	try {
		const { storage: store } = await open();
		const record = await store.readTunnelSession();
		return record ? sessionFromTunnelSet(record) : null;
	} catch {
		return null;
	}
}

/** Persists the tunnel session, so the next launch can reach the same computer without
 *  a mint round trip. */
export async function writeStoredTunnelSession(
	session: TunnelSession,
): Promise<void> {
	try {
		const { storage: store } = await open();
		await store.writeTunnelSession(tunnelSetFromSession(session));
	} catch {
		/* A session the platform cannot store still works for this run; it just costs a
		 * mint on the next launch. */
	}
}

/**
 * Sign-out: every item this app owns, in one call.
 *
 * Deliberately the ONLY full wipe, and deliberately here rather than duplicated at the
 * sign-out call site, so the three records cannot be cleared by three code paths and
 * drift apart.
 */
export async function clearStoredCredentials(): Promise<void> {
	try {
		const { storage: store } = await open();
		await store.clearAll();
	} catch {
		/* A keystore that refuses the delete leaves the reader signed in on this device,
		 * which is what the reader then sees; there is no honest alternative to report. */
	}
}
