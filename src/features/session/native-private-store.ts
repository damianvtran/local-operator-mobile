import { privateDataKeys } from "@/connection/private-data-key";
import { RevisionStore } from "@/features/new-session/startup-persistence";
import { nativePrivateCipher } from "./native-private-cipher";
import { openPrivateInstallation } from "./private-installation";
import { SealedValue } from "./sealed-value";

const ROOT = "lo-mobile-sealed-v1";
const SENTINEL = "lo-mobile-private-installation-v1";
const HASH_NAME = /^[a-f0-9]{64}$/i;
/* `warm` is the conversation/list cache (`state/warm-cache.ts`): its own family
 * so the authorization purge can drop it whole without touching drafts. */
type Family = "device" | "startup" | "recovery" | "warm";
type StorageStage = "installation" | "encryption" | "commit";

/** Fixed, content-free diagnostic metadata. Preserve the underlying exception
 * internally for debugging without interpolating native messages (which may
 * contain file paths or private values) into UI/log output. */
export class NativePrivateStorageError extends Error {
	override readonly name = "NativePrivateStorageError";
	constructor(
		readonly stage: StorageStage,
		cause: unknown,
	) {
		super(`Native private storage failed: ${stage}`, { cause });
	}
}
async function storageStage<T>(
	stage: StorageStage,
	operation: () => Promise<T>,
): Promise<T> {
	try {
		return await operation();
	} catch (cause) {
		throw new NativePrivateStorageError(stage, cause);
	}
}
/** Ports mirror the existing injectable persistence contracts. The singleton
 * below supplies real Expo adapters; isolated Node tests supply filesystem and
 * cryptography ports without loading or pretending to exercise native bridges. */
export interface NativePrivatePlatform {
	filesystem(): Promise<typeof import("expo-file-system")>;
	installId(): Promise<string>;
	generateKey(): Promise<string>;
	hash(key: string): Promise<string>;
	cipher(
		key: string,
		installation: string,
	): Promise<import("./sealed-value").PrivateCipher>;
}
const platform: NativePrivatePlatform = {
	filesystem: () => import("expo-file-system"),
	installId: async () => (await import("expo-crypto")).randomUUID(),
	generateKey: async () =>
		(await (await import("expo-crypto")).AESEncryptionKey.generate()).encoded(
			"hex",
		),
	hash: async (key) => {
		const crypto = await import("expo-crypto");
		return crypto.digestStringAsync(crypto.CryptoDigestAlgorithm.SHA256, key);
	},
	cipher: nativePrivateCipher,
};
export function createNativePrivateStores(platform: NativePrivatePlatform) {
	const tails = new Map<string, Promise<unknown>>();
	let opening: Promise<SealedValue> | null = null;

	const filesystem = platform.filesystem;
	async function root() {
		const { Directory, Paths } = await filesystem();
		return new Directory(Paths.document, ROOT);
	}
	async function purgeRoot(): Promise<void> {
		const directory = await root();
		if (directory.info().exists) directory.delete();
		if (directory.info().exists)
			throw new Error("private ciphertext removal could not be confirmed");
	}
	async function marker() {
		const { File, Paths } = await filesystem();
		return new File(Paths.cache, SENTINEL);
	}
	async function codec(): Promise<SealedValue> {
		if (!opening) {
			opening = (async () => {
				const key = await openPrivateInstallation({
					keys: privateDataKeys(),
					marker: {
						read: async () => {
							const file = await marker();
							return file.info().exists ? file.text() : null;
						},
						write: async (id) => {
							const file = await marker();
							file.create({ overwrite: true, intermediates: true });
							file.write(id);
						},
						clear: async () => {
							const file = await marker();
							if (file.info().exists) file.delete();
							if (file.info().exists)
								throw new Error("installation marker removal failed");
						},
					},
					purgeCiphertext: purgeRoot,
					create: async () => ({
						installId: await platform.installId(),
						keyHex: await platform.generateKey(),
					}),
				});
				// Legacy plaintext has no authenticated ownership. Never migrate it into
				// a proven account or leave it behind as a hidden plaintext backup.
				const { Directory, Paths } = await filesystem();
				for (const name of ["lo-mobile-store", "lo-mobile-startup"]) {
					const legacy = new Directory(Paths.document, name);
					if (legacy.info().exists) legacy.delete();
					if (legacy.info().exists)
						throw new Error("legacy private storage removal failed");
				}
				return new SealedValue(
					await platform.cipher(key.keyHex, key.installId),
				);
			})();
			void opening.catch(() => {
				opening = null;
			});
		}
		return opening;
	}
	const hash = platform.hash;
	async function directory(family: Family, name?: string) {
		const { Directory } = await filesystem();
		const base = new Directory(await root(), family);
		const result = name ? new Directory(base, name) : base;
		if (!result.info().exists) result.create({ intermediates: true });
		return result;
	}
	async function revisions(
		family: Family,
		name: string,
	): Promise<RevisionStore> {
		const { File } = await filesystem();
		const dir = await directory(family, name);
		return new RevisionStore({
			list: async () =>
				dir
					.list()
					.filter((entry) => entry instanceof File)
					.map((entry) => entry.name),
			read: async (name) => {
				const file = new File(dir, name);
				return file.info().exists ? file.text() : null;
			},
			write: async (name, value) => {
				const file = new File(dir, name);
				// A stranded staging file is replaceable; committed .json files are
				// installed only by move and are never overwritten by this port.
				file.create({ overwrite: true });
				file.write(value);
			},
			move: async (from, to) => {
				// SDK 57's native move is asynchronous. This promise IS the commit:
				// dropping it acknowledges an uncommitted envelope and loses failures.
				await new File(dir, from).move(new File(dir, to));
			},
			remove: async (name) => {
				const file = new File(dir, name);
				if (file.info().exists) file.delete();
			},
		});
	}
	async function readEntry(
		family: Family,
		name: string,
	): Promise<{ key: string; value: string | null } | null> {
		const cipher = await storageStage("installation", codec);
		const raw = await (await revisions(family, name)).get();
		if (raw === null) return null;
		const entry: unknown = JSON.parse(
			await cipher.decode(`${family}/${name}`, raw),
		);
		if (
			typeof entry !== "object" ||
			entry === null ||
			!("key" in entry) ||
			typeof entry.key !== "string" ||
			!("value" in entry) ||
			(entry.value !== null && typeof entry.value !== "string") ||
			(await hash(entry.key)) !== name
		)
			throw new Error("private record authentication failed");
		return { key: entry.key, value: entry.value };
	}
	function serialize<T>(key: string, operation: () => Promise<T>): Promise<T> {
		const next = (tails.get(key) ?? Promise.resolve())
			.catch(() => undefined)
			.then(operation);
		tails.set(key, next);
		const settled = () => {
			if (tails.get(key) === next) tails.delete(key);
		};
		void next.then(settled, settled);
		return next;
	}

	/** Every committed revision contains ciphertext only, including temporary writes
	 * and the encrypted key index. Immutable numbered commits retain the last whole
	 * ciphertext across interruption; they never write plaintext to a staging file. */
	function nativePrivateStore(family: Family) {
		return {
			async get(key: string): Promise<string | null> {
				await tails.get(`${family}/${key}`);
				const entry = await readEntry(family, await hash(key));
				return entry?.key === key ? entry.value : null;
			},
			set(key: string, value: string): Promise<void> {
				return serialize(`${family}/${key}`, async () => {
					const cipher = await storageStage("installation", codec);
					const name = await hash(key);
					const sealed = await storageStage("encryption", () =>
						cipher.encode(`${family}/${name}`, JSON.stringify({ key, value })),
					);
					await storageStage("commit", async () =>
						(await revisions(family, name)).set(sealed),
					);
				});
			},
			remove(key: string): Promise<void> {
				return serialize(`${family}/${key}`, async () => {
					const cipher = await codec();
					const name = await hash(key);
					// Never recursively delete newest state ahead of its predecessors:
					// retain an authenticated empty marker through interrupted discard.
					const tombstone = await cipher.encode(
						`${family}/${name}`,
						JSON.stringify({ key, value: null }),
					);
					await (await revisions(family, name)).discard(tombstone);
				});
			},
			async keys(): Promise<string[]> {
				await codec();
				const { Directory } = await filesystem();
				const keys: string[] = [];
				for (const entry of (await directory(family)).list()) {
					if (!(entry instanceof Directory) || !HASH_NAME.test(entry.name))
						continue;
					const saved = await readEntry(family, entry.name);
					if (saved && saved.value !== null) keys.push(saved.key);
				}
				return keys;
			},
			async clear(): Promise<void> {
				await Promise.allSettled([...tails.values()]);
				const { Directory } = await filesystem();
				const dir = new Directory(await root(), family);
				if (dir.info().exists) dir.delete();
				if (dir.info().exists) throw new Error("private family removal failed");
			},
		};
	}

	/** Called only after publication closes and writers drain. No bootstrap here:
	 * cleanup must never create a key just to delete it or adopt a surviving key. */
	async function eraseNativePrivateInstallation(): Promise<void> {
		await Promise.allSettled([...tails.values()]);
		await opening?.catch(() => undefined);
		const results = await Promise.allSettled([
			purgeRoot(),
			privateDataKeys().clear(),
			(async () => {
				const file = await marker();
				if (file.info().exists) file.delete();
				if (file.info().exists)
					throw new Error("installation marker removal failed");
			})(),
		]);
		opening = null;
		for (const result of results)
			if (result.status === "rejected") throw result.reason;
	}

	return { nativePrivateStore, eraseNativePrivateInstallation };
}
const native = createNativePrivateStores(platform);
export const nativePrivateStore = native.nativePrivateStore;
export const eraseNativePrivateInstallation =
	native.eraseNativePrivateInstallation;
