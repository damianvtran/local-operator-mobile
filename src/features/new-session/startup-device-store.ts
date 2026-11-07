import { Platform } from "react-native";
import { nativePrivateStore } from "@/features/session/native-private-store";

/** Startup records contain private text/image bytes. No memory fallback: a Send
 * cannot outrun durable admission merely because Safari storage is unavailable.
 * Auth lifecycle must withdraw writers and await their tails before purge. */
export const STARTUP_PREFIX = "lo-mobile-startup:";
const DIRECTORY = "lo-mobile-startup";
const MAX_CHARS = 16 * 1024 * 1024;
const serial = new Map<string, Promise<void>>();

const sealedStartupStore = nativePrivateStore("startup");
function webStorage(): Storage {
	if (!globalThis.localStorage)
		throw new Error("durable startup storage is unavailable");
	return globalThis.localStorage;
}
export const startupDeviceStore = {
	async get(key: string): Promise<string | null> {
		await serial.get(key);
		return Platform.OS === "web"
			? webStorage().getItem(STARTUP_PREFIX + key)
			: sealedStartupStore.get(key);
	},
	async set(key: string, value: string): Promise<void> {
		if (value.length > MAX_CHARS)
			throw new Error("startup storage capacity reached");
		const previous = serial.get(key) ?? Promise.resolve();
		const write = previous
			.catch(() => undefined)
			.then(async () => {
				if (Platform.OS === "web")
					webStorage().setItem(STARTUP_PREFIX + key, value);
				else await sealedStartupStore.set(key, value);
			});
		serial.set(key, write);
		try {
			await write;
		} finally {
			if (serial.get(key) === write) serial.delete(key);
		}
	},
	async keys(): Promise<string[]> {
		await Promise.allSettled([...serial.values()]);
		if (Platform.OS !== "web") return sealedStartupStore.keys();
		const storage = webStorage();
		const keys: string[] = [];
		for (let i = 0; i < storage.length; i++) {
			const key = storage.key(i);
			if (key?.startsWith(STARTUP_PREFIX))
				keys.push(key.slice(STARTUP_PREFIX.length));
		}
		return keys;
	},
	async clear(): Promise<void> {
		// The auth owner revokes coordinators first; this barrier covers writes that
		// already entered the adapter so none can repopulate a completed purge.
		await Promise.allSettled([...serial.values()]);
		if (Platform.OS === "web") {
			const storage = webStorage();
			const keys: string[] = [];
			for (let i = 0; i < storage.length; i++) {
				const key = storage.key(i);
				if (key?.startsWith(STARTUP_PREFIX)) keys.push(key);
			}
			for (const key of keys) storage.removeItem(key);
		} else {
			await sealedStartupStore.clear();
			const { Directory, Paths } = await import("expo-file-system");
			const directory = new Directory(Paths.document, DIRECTORY);
			if (directory.exists) directory.delete();
		}
	},
};
