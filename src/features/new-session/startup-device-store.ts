import { Platform } from "react-native";
import { RevisionStore } from "./startup-persistence";

/** Startup records contain private text/image bytes. No memory fallback: a Send
 * cannot outrun durable admission merely because Safari storage is unavailable.
 * Auth lifecycle must withdraw writers and await their tails before purge. */
export const STARTUP_PREFIX = "lo-mobile-startup:";
const DIRECTORY = "lo-mobile-startup";
const MAX_CHARS = 16 * 1024 * 1024;
const serial = new Map<string, Promise<void>>();

async function nativeStore(key: string): Promise<RevisionStore> {
	const { Directory, File, Paths } = await import("expo-file-system");
	const directory = new Directory(
		Paths.document,
		DIRECTORY,
		encodeURIComponent(key),
	);
	if (!directory.exists) directory.create({ intermediates: true });
	return new RevisionStore({
		list: async () =>
			directory
				.list()
				.filter((entry) => entry instanceof File)
				.map((entry) => entry.name),
		read: async (name) => {
			const file = new File(directory, name);
			return file.exists ? file.text() : null;
		},
		write: async (name, value) => {
			const file = new File(directory, name);
			file.create();
			file.write(value);
		},
		move: async (from, to) => {
			const file = new File(directory, from);
			file.move(new File(directory, to));
		},
		remove: async (name) => {
			const file = new File(directory, name);
			if (file.exists) file.delete();
		},
	});
}
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
			: (await nativeStore(key)).get();
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
				else await (await nativeStore(key)).set(value);
			});
		serial.set(key, write);
		try {
			await write;
		} finally {
			if (serial.get(key) === write) serial.delete(key);
		}
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
			const { Directory, Paths } = await import("expo-file-system");
			const directory = new Directory(Paths.document, DIRECTORY);
			if (directory.exists) directory.delete();
		}
	},
};
