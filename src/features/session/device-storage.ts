/**
 * Device storage: the one module that touches a platform filesystem, behind the
 * async key/value port the retry envelope and the draft store both need.
 *
 * **Why not the keystore.** `src/connection/storage.ts` is the app's only
 * `expo-secure-store` caller and it deliberately is not this: an instruction can
 * legitimately be megabytes once it carries images, and iOS rejects large
 * SecureStore values outright. Nothing stored here is a secret either — a draft
 * and an instruction the reader already typed — so the keystore would buy
 * confidentiality nobody asked for at the cost of the guarantee that matters,
 * which is that the bytes survive. `docs/relay-client.md` records the same
 * decision for the envelope.
 *
 * **Two backends, one contract.** On the web build the store is `localStorage`
 * (which is also where the capture harness drives the app, so the same code path
 * is exercised by every captured frame). On native it is a directory of small
 * files under `Paths.document`, written through `expo-file-system`. The two are
 * chosen per CALL rather than at import time, so importing this module never
 * touches a filesystem that may not exist — the web bundle evaluates the native
 * branch's import, never its body.
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
const NATIVE_FILE_SUFFIX = ".json";

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

/* ------------------------------------------------------------- native backend */

/**
 * The native file for a key.
 *
 * The import is inside the function, and deliberately: `expo-file-system`'s web
 * build is not the one this path uses, and a module-scope `Paths.document` read
 * would run on the web too, where there is no document directory.
 */
const nativeFilePath = async (key: string) => {
	const { Directory, File, Paths } = await import("expo-file-system");
	const directory = new Directory(Paths.document, NATIVE_DIRECTORY);
	if (!directory.exists) directory.create({ intermediates: true });
	return new File(directory, `${encodeURIComponent(key)}${NATIVE_FILE_SUFFIX}`);
};

const nativeGet = async (key: string): Promise<string | null> => {
	const file = await nativeFilePath(key);
	if (!file.exists) return null;
	return file.text();
};

const nativeSet = async (key: string, value: string): Promise<void> => {
	const file = await nativeFilePath(key);
	// `write` overwrites in place, but a file that does not exist yet has to be
	// created: the new API refuses a write to a missing path rather than creating
	// it, and a silent failure here is a lost instruction.
	if (!file.exists) file.create({ intermediates: true });
	file.write(value);
};

const nativeRemove = async (key: string): Promise<void> => {
	const file = await nativeFilePath(key);
	if (file.exists) file.delete();
};

/**
 * The key of every file this store owns.
 *
 * A key that does not decode is skipped rather than returned raw: it was not
 * written by this module, so returning it would hand a caller a key whose
 * `remove` could not find it again.
 */
const nativeKeys = async (): Promise<string[]> => {
	const { Directory, File, Paths } = await import("expo-file-system");
	const directory = new Directory(Paths.document, NATIVE_DIRECTORY);
	if (!directory.exists) return [];
	const keys: string[] = [];
	for (const entry of directory.list()) {
		if (!(entry instanceof File)) continue;
		const name = entry.name;
		if (!name.endsWith(NATIVE_FILE_SUFFIX)) continue;
		try {
			keys.push(
				decodeURIComponent(
					name.slice(0, name.length - NATIVE_FILE_SUFFIX.length),
				),
			);
		} catch {
			/* Not one of ours. */
		}
	}
	return keys;
};

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
		if (isWeb()) webSet(key, value);
		else await nativeSet(key, value);
	},
	async remove(key) {
		if (isWeb()) webRemove(key);
		else await nativeRemove(key);
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
 * purpose, because the two have DIFFERENT lifetimes on a `401`: the envelope is
 * scoped to the identity that has just gone and is cleared with it, while the
 * draft is the reader's own unfinished sentence and survives to be sent after they
 * sign back in (`docs/ux/flows.md` § `C5` — "Never clear drafts on an auth blip";
 * the web client's rule, kept).
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
	try {
		return (await deviceStore.get(HOME_DRAFT_KEY)) ?? "";
	} catch {
		/* An unreadable draft is an empty one for this screen; the store is
		 * best-effort here because a failed READ has lost nothing. */
		return "";
	}
};

export const writeHomeDraft = (text: string): Promise<void> =>
	deviceStore.set(HOME_DRAFT_KEY, text);

export const clearHomeDraft = (): Promise<void> =>
	deviceStore.remove(HOME_DRAFT_KEY);

export const readDraft = async (sessionId: string): Promise<string> => {
	try {
		return (await deviceStore.get(draftKey(sessionId))) ?? "";
	} catch {
		/* An unreadable draft is an empty one for this screen; the store is
		 * best-effort here because a failed READ has lost nothing. */
		return "";
	}
};

export const writeDraft = async (
	sessionId: string,
	text: string,
): Promise<void> => deviceStore.set(draftKey(sessionId), text);

export const clearDraft = async (sessionId: string): Promise<void> =>
	deviceStore.remove(draftKey(sessionId));

/**
 * Clears every draft. Called on an EXPLICIT sign-out and on an identity change —
 * the two cases the rule above names — and never on a `401`, which is the case
 * that reads like one but is not.
 */
export const clearAllDrafts = async (): Promise<void> => {
	for (const key of await deviceStore.keys()) {
		if (key.startsWith(DRAFT_KEY_PREFIX)) await deviceStore.remove(key);
	}
};
