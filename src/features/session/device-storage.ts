/**
 * Device storage: the one module that touches a platform filesystem, behind the
 * async key/value port the retry envelope and the draft store both need.
 *
 * Native private values are AES-GCM ciphertext on disk; only the small key is
 * in platform SecureStore. The cache sentinel binds that key to this installation,
 * so a surviving iOS Keychain item is not recovery authority after reinstall.
 * Web retains its existing localStorage behavior and has no cross-login recovery.
 *
 * **Failures are visible, never silent.** The port propagates a storage error to
 * its caller, because the alternative — swallowing it — is a command whose failure
 * the app could not have recovered (see `retry-envelope.ts`'s
 * `EnvelopeStorageError`). The one exception is `keys()`, whose only caller is
 * best-effort eviction: an unreadable directory must degrade to "nothing to evict"
 * rather than break a send.
 *
 * **The key ↔ filename map is reversible and total.** Keys are `prefix:session-id`
 * and a session id is hex, but a filename cannot contain `:` or `/` portably, so
 * the key is percent-encoded for the name and decoded for `keys()`. Encoding
 * rather than hashing is what lets the two directions agree without a side index.
 */

import { Platform } from "react-native";
import { getStartupAuthorization } from "@/connection/startup-authorization";
import {
	awaitCommandOperations,
	withdrawDispatch,
} from "@/relay/command-lifecycle";
import {
	discardRecoveryDraft,
	readRecoveryDraft,
	writeRecoveryDraft,
} from "./draft-recovery";
import { nativePrivateStore } from "./native-private-store";
import {
	awaitPrivateWrites,
	runPrivateWrite,
	scopedStore,
	withdrawPrivateWrites,
} from "./scoped-storage";

/** The port. Identical in shape to `retry-envelope.ts`'s `EnvelopeStore`, which
 *  is why the envelope store takes this object directly rather than an adapter. */
export interface DeviceStore {
	get(key: string): Promise<string | null>;
	set(key: string, value: string): Promise<void>;
	remove(key: string): Promise<void>;
	keys(): Promise<string[]>;
}

/** The directory the native backend owns, under the app's document root. */
const NATIVE_DIRECTORY = "lo-mobile-store";

const isWeb = (): boolean => Platform.OS === "web";

/* ---------------------------------------------------------------- web backend */

/**
 * An in-memory fallback, used only when `localStorage` is unavailable or refuses
 * a write (Safari's private mode has historically thrown on `setItem`).
 *
 * It is a real fallback rather than an error because the guarantee the reader
 * needs is "my text is not lost while I am looking at this screen": a
 * session-scoped slot keeps the retry envelope working for the life of the app
 * even when the durable one is unavailable, and the envelope's own storage error
 * still fires for the case that actually matters — where even memory is refused.
 */
const memory = new Map<string, string>();

const webGet = (key: string): string | null => {
	try {
		const value = globalThis.localStorage?.getItem(key);
		return value ?? memory.get(key) ?? null;
	} catch {
		return memory.get(key) ?? null;
	}
};

const webSet = (key: string, value: string): void => {
	try {
		globalThis.localStorage?.setItem(key, value);
		return;
	} catch {
		// Quota, or storage disabled. Keep it in memory so the instruction survives
		// the screen, and let the caller decide whether to say anything: from the
		// reader's point of view the send still works.
		memory.set(key, value);
	}
};

const webRemove = (key: string): void => {
	memory.delete(key);
	try {
		globalThis.localStorage?.removeItem(key);
	} catch {
		/* Nothing to do: the in-memory copy is already gone. */
	}
};

const webKeys = (): string[] => {
	const keys = new Set<string>(memory.keys());
	try {
		const storage = globalThis.localStorage;
		if (storage) {
			for (let index = 0; index < storage.length; index += 1) {
				const key = storage.key(index);
				if (key !== null) keys.add(key);
			}
		}
	} catch {
		/* Fall through with whatever memory holds. */
	}
	return [...keys];
};

/* Native bytes, including pending revisions, are encrypted before any write. */
const sealedDeviceStore = nativePrivateStore("device");
const nativeGet = sealedDeviceStore.get;
const nativeSet = sealedDeviceStore.set;
const nativeRemove = sealedDeviceStore.remove;
const nativeKeys = sealedDeviceStore.keys;

/* ------------------------------------------------------------------- the port */

/**
 * The device store. One object, two backends, chosen per call.
 *
 * `keys()` is the one method that swallows a failure, because it exists for
 * eviction: a store that cannot be listed has nothing to evict, and failing a
 * send over an unlistable directory would trade a small storage leak for a lost
 * instruction.
 */
export const deviceStore: DeviceStore = {
	async get(key) {
		return isWeb() ? webGet(key) : nativeGet(key);
	},
	async set(key, value) {
		return runPrivateWrite(async () => {
			if (isWeb()) webSet(key, value);
			else await nativeSet(key, value);
		});
	},
	async remove(key) {
		return runPrivateWrite(async () => {
			if (isWeb()) webRemove(key);
			else await nativeRemove(key);
		});
	},
	async keys() {
		if (isWeb()) return webKeys();
		try {
			return await nativeKeys();
		} catch {
			return [];
		}
	},
};

/* -------------------------------------------------------------------- drafts */

/**
 * Draft keys. A separate prefix from the envelope's (`lo-mobile-command:`) on
 * purpose: they are different FAMILIES with different clearance rules, and the
 * explicit purge names both.
 *
 * A 401 closes the authorization generation. Native cross-login recovery lives
 * only in the separately sealed draft vault and needs fresh same-authority proof;
 * command envelopes never acquire stable recovery scope. Explicit privacy cleanup
 * removes both ordinary families and, for logout/forget, the vault/key too.
 */
export const DRAFT_KEY_PREFIX = "lo-mobile-draft:";

export const draftKey = (sessionId: string): string =>
	`${DRAFT_KEY_PREFIX}${sessionId}`;

/**
 * The home composer's one staging slot.
 *
 * The home has no session id, so the key is fixed — deliberately inside the same
 * `lo-mobile-draft:` family, because its lifetime rule is a draft's: it survives a
 * `401` (`clearAllDrafts` clears the family only on an EXPLICIT sign-out or an
 * identity change), it is cleared when its text was genuinely delivered as a first
 * prompt, and never both (P-4).
 */
export const HOME_DRAFT_KEY = "lo-mobile-draft:home";

export const readHomeDraft = async (): Promise<string> => {
	const scope = getStartupAuthorization()?.scope ?? null;
	try {
		return (
			(await scopedStore(deviceStore, scope).get(HOME_DRAFT_KEY)) ??
			(await readRecoveryDraft(HOME_DRAFT_KEY, scope)) ??
			""
		);
	} catch {
		/* An unreadable draft is an empty one for this screen; the store is
		 * best-effort here because a failed READ has lost nothing. */
		return "";
	}
};

export const writeHomeDraft = async (text: string): Promise<void> => {
	const scope = getStartupAuthorization()?.scope ?? null;
	await Promise.all([
		scopedStore(deviceStore, scope).set(HOME_DRAFT_KEY, text),
		writeRecoveryDraft(HOME_DRAFT_KEY, text, scope),
	]);
};

export const clearHomeDraft = async (): Promise<void> => {
	const scope = getStartupAuthorization()?.scope ?? null;
	await Promise.all([
		scopedStore(deviceStore, scope).remove(HOME_DRAFT_KEY),
		discardRecoveryDraft(HOME_DRAFT_KEY, scope),
	]);
};

export const readDraft = async (
	sessionId: string,
	scope = getStartupAuthorization()?.scope ?? null,
): Promise<string> => {
	try {
		return (
			(await scopedStore(deviceStore, scope).get(draftKey(sessionId))) ??
			(await readRecoveryDraft(draftKey(sessionId), scope)) ??
			""
		);
	} catch {
		/* An unreadable draft is an empty one for this screen; the store is
		 * best-effort here because a failed READ has lost nothing. */
		return "";
	}
};

export const writeDraft = async (
	sessionId: string,
	text: string,
	scope = getStartupAuthorization()?.scope ?? null,
): Promise<void> => {
	await Promise.all([
		scopedStore(deviceStore, scope).set(draftKey(sessionId), text),
		writeRecoveryDraft(draftKey(sessionId), text, scope),
	]);
};

export const clearDraft = async (
	sessionId: string,
	scope = getStartupAuthorization()?.scope ?? null,
): Promise<void> => {
	await Promise.all([
		scopedStore(deviceStore, scope).remove(draftKey(sessionId)),
		discardRecoveryDraft(draftKey(sessionId), scope),
	]);
};

/**
 * Clears every draft. Called on an EXPLICIT sign-out and on an identity change —
 * the two cases the rule above names — and never on a `401`, which is the case
 * that reads like one but is not.
 */
/** Auth retirement is fail-closed, unlike ordinary best-effort draft reads.
 * Never turn blocked enumeration/deletion into a successful account switch.
 * This is invoked ONLY by an explicit auth boundary, not an upgrade migration:
 * legacy unknown-owner keys remain quarantined until that privacy boundary. */
export const clearAuthorizationData = async (): Promise<void> => {
	/* Withdraw first, drain second, delete third (review R1-4). A writer that was
	 * already past its admission check still runs to completion — its bytes are
	 * written and then removed, which is the only order that can promise the purge
	 * left nothing behind. */
	withdrawPrivateWrites();
	await awaitPrivateWrites();
	/* Dispatch is the second half of the same promise. An envelope is not just a
	 * key: `client.command` may still be on the wire, and deleting the envelope
	 * before its disposition is written loses an admitted command (success) or
	 * untracks ambiguity (lost reply). Withdraw refuses new sends; the await covers
	 * every accepted one through its final settle (review round 2, R1-4). */
	withdrawDispatch();
	await awaitCommandOperations();
	const privateKey = (key: string) =>
		key.startsWith(DRAFT_KEY_PREFIX) || key.startsWith("lo-mobile-command:");
	if (Platform.OS === "web") {
		const storage = globalThis.localStorage;
		if (!storage) throw new Error("private storage cannot be enumerated");
		const keys: string[] = [];
		for (let index = 0; index < storage.length; index++) {
			const key = storage.key(index);
			if (key !== null && privateKey(key)) keys.push(key);
		}
		for (const key of keys) storage.removeItem(key);
	} else {
		await sealedDeviceStore.clear();
		const { Directory, File, Paths } = await import("expo-file-system");
		const directory = new Directory(Paths.document, NATIVE_DIRECTORY);
		if (directory.exists) {
			for (const entry of directory.list()) {
				if (!(entry instanceof File) || !entry.name.endsWith(".json")) continue;
				const key = decodeURIComponent(entry.name.slice(0, -5));
				if (privateKey(key)) entry.delete();
			}
		}
	}
	/* A late writer can also have created the native directory after the listing
	 * above; removing it is safe because the barrier has already drained the tails
	 * and no new write may start. */
	if (Platform.OS !== "web") {
		const { Directory, Paths } = await import("expo-file-system");
		const directory = new Directory(Paths.document, NATIVE_DIRECTORY);
		if (directory.exists && directory.list().length === 0) directory.delete();
	}
	for (const key of memory.keys()) if (privateKey(key)) memory.delete(key);
	/* Stay closed until actual admission, including its fresh owner proof.
	 * Reopening here lets a stale captured scopedStore recreate old-generation
	 * bytes between the purge and the asynchronous recovery/identity check. */
};

export const clearAllDrafts = async (): Promise<void> => {
	for (const key of await deviceStore.keys()) {
		if (key.startsWith(DRAFT_KEY_PREFIX)) await deviceStore.remove(key);
	}
};
