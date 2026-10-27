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
import type { RouteProfile } from "@/connection/profile";
import {
	type RadientComputerInput,
	type SavedComputer,
	SavedComputers,
} from "@/connection/saved-computers";
import { configureStartupAuthorizationStorage } from "@/connection/startup-authorization";

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
let opening: Promise<TunnelStorage> | null = null;
let registry: SavedComputers | null = null;
const savedComputersClearedListeners = new Set<() => void>();

// Lazy callbacks keep platform initialization out of module evaluation and the
// authorization owner independent of React/coordinator imports.
configureStartupAuthorizationStorage({
	read: async () => (await open()).storage.readStartupAuthorization(),
	write: async (record) =>
		(await open()).storage.writeStartupAuthorization(record),
});

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
	if (!opening) {
		opening = (async () => {
			const persistent = Platform.OS !== "web";
			adapter = persistent ? await expoSecureStore() : memorySecureStore();
			storage = new SecureStorage(adapter);
			return { storage, adapter, persistent };
		})();
		// Concurrent credential/generation reads must share one adapter, including
		// the memory-only web fallback. A failed platform open remains retryable.
		void opening.catch(() => {
			opening = null;
		});
	}
	return opening;
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

/** The Radient account id of the stored grant (`RadientTokens.account_id`), or
 *  `null` when there is none or it predates the field. The computer switcher reads
 *  it to scope saved Radient computers to the account that used them; a keystore
 *  that refuses the read reports none, which lists them (the "unknown" rule). */
export async function readStoredRadientAccount(): Promise<string | null> {
	return (await readStoredOauth())?.account_id ?? null;
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
 *
 * The saved-computers registry goes too, AFTER the credentials: the Sign out dialog
 * promises "forgetting it here", and Radient hostnames are account-linked personal
 * data the reader could no longer see or delete once signed out. Removals are keyed by
 * tunnel id, so a second account would only carry the first one's dead weight. The
 * registry comes second so a failure there still leaves the credentials gone, and it
 * fails the sign-out like a credential delete does — a retry runs both again, and
 * `clearAll()` is idempotent. Listeners hear about it only once the keystore agrees,
 * so the in-memory hidden set never claims a wipe that did not happen.
 */
export async function clearStoredCredentials(): Promise<void> {
	const { storage: store } = await open();
	// A failed delete is NOT successful sign-out. Let the provider retain a
	// closed admission gate and report failure instead of resurrecting at restart.
	await store.clearAll();
	await (await savedComputers()).clear();
	for (const listener of savedComputersClearedListeners) listener();
}

/**
 * Called after sign-out has cleared the saved-computers registry.
 *
 * A listener rather than a store call because this module must not import the
 * connection store's owner (`connection-provider.tsx` imports THIS module), and the
 * provider's sign-out path is a later slice's to rewire. The root hydration hook is
 * the subscriber: it already owns moving registry state into the store.
 */
export function onSavedComputersCleared(listener: () => void): () => void {
	savedComputersClearedListeners.add(listener);
	return () => {
		savedComputersClearedListeners.delete(listener);
	};
}

/* ------------------------------------------------------------ saved computers */

/**
 * The saved-computers registry over the SAME adapter singleton, for the reason
 * point 1 of the module note gives. One registry instance, too: it serialises its
 * own read-modify-writes, which only holds if every caller shares it.
 *
 * Cleared by `clearStoredCredentials` (sign-out), after `clearAll()`; see there.
 */
async function savedComputers(): Promise<SavedComputers> {
	const { adapter: store } = await open();
	registry ??= new SavedComputers(store);
	return registry;
}

/** The Radient computers the reader removed. A keystore that refuses the read
 *  reports none, which shows a removed computer again rather than failing a
 *  screen — the reader can remove it again, and nothing reconnects on its own. */
export async function readHiddenTunnelIds(): Promise<string[]> {
	try {
		return await (await savedComputers()).hiddenTunnelIds();
	} catch {
		return [];
	}
}

/** Remembers that the reader removed this computer. Returns whether that will
 *  survive a restart, so a caller can say so instead of implying it. The
 *  Computers screen does not say so yet: on web (`memorySecureStore`) a removal
 *  lasts for the session, and the copy for that belongs with the switcher's
 *  surface rather than a toast, which is never for a shortfall. */
export async function hideRadientComputer(
	computer: RadientComputerInput,
): Promise<{ persistent: boolean }> {
	try {
		const { persistent } = await open();
		await (await savedComputers()).hideRadient(computer);
		return { persistent };
	} catch {
		return { persistent: false };
	}
}

/** Every saved computer, hidden ones included, most recently used first: what the
 *  computer switcher sorts into its two sections. A keystore that refuses the read
 *  reports none, like `readHiddenTunnelIds` — the switcher then lists only what
 *  discovery reports, and nothing is lost on disk. */
export async function readSavedComputers(): Promise<SavedComputer[]> {
	try {
		return await (await savedComputers()).list();
	} catch {
		return [];
	}
}

/**
 * Records that this phone reached a computer: remembered (added or refreshed) and
 * then `markUsed`, so the switcher lists it under "On this phone" and orders it by
 * use. Called by the provider once a route is LIVE — never on a pick, because a
 * computer that refused or never answered is not one this phone has used.
 *
 * Radient computers are keyed by tunnel id; custom ones by their registry id when
 * the caller knows it (`computerId`, a tap on a switcher row), else by address,
 * which is `rememberCustom`'s own stopgap for the single custom slot. The address
 * never becomes the identity (operator decision a-2a8b): it only finds the entry.
 *
 * Returns the entry, or `null` when nothing could be stored — the route works
 * either way, and the switcher simply has nothing new to list.
 */
export async function rememberLiveComputer(
	route: RouteProfile,
	input: {
		name?: string;
		computerId?: string;
		account?: string;
		onlyIf?: () => boolean;
	} = {},
): Promise<SavedComputer | null> {
	try {
		const store = await savedComputers();
		const options = { onlyIf: input.onlyIf };
		const entry =
			route.mode === "radient"
				? await store.rememberRadient(
						{
							tunnelId: route.tunnelId,
							hostname: route.hostname,
							/* No name → the registry keeps the saved one (a never-named
							 *  computer still falls back to its hostname there). */
							...(input.name !== undefined ? { name: input.name } : {}),
							...(input.account !== undefined
								? { account: input.account }
								: {}),
						},
						options,
					)
				: await store.rememberCustom(
						{
							id: input.computerId,
							baseUrl: route.baseUrl,
							allowInsecure: route.allowInsecure,
						},
						options,
					);
		if (input.onlyIf && !input.onlyIf()) return null;
		return (await store.markUsed(entry.id)) ?? entry;
	} catch {
		return null;
	}
}

/** The switcher's way back for a computer in its "not connected" section, by
 *  registry id. Best effort, like the other registry writes here: the store's
 *  hidden set is what the screens read, and the caller updates it first. */
export async function unhideSavedComputer(id: string): Promise<void> {
	try {
		await (await savedComputers()).unhide(id);
	} catch {
		/* Nothing that can store it: the un-hide lasts for this run. */
	}
}

/** The way back from a removal, by tunnel id: the computer switcher's
 *  not-connected rows, for a removed computer it reached through discovery. */
export async function unhideRadientComputer(tunnelId: string): Promise<void> {
	try {
		const store = await savedComputers();
		const entry = (await store.list()).find(
			(candidate) =>
				candidate.transport === "radient" && candidate.tunnelId === tunnelId,
		);
		if (entry) await store.unhide(entry.id);
	} catch {
		/* Nothing saved to un-hide, or nothing that can store it. */
	}
}
