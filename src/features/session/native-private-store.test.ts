import type { webcrypto as CryptoTypes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { configurePrivateDataKeys } from "@/connection/private-data-key";
import type { PrivateDataKey } from "@/connection/storage";
import { createNativePrivateStores } from "./native-private-store";

const state = {
	files: new Map<string, string>(),
	dirs: new Set<string>(),
	failWrite: false,
};
function filesystemFixture() {
	const path = (parts: unknown[]) =>
		parts
			.map((part) =>
				typeof part === "string" ? part : (part as { uri: string }).uri,
			)
			.join("/");
	class Directory {
		uri: string;
		constructor(...parts: unknown[]) {
			this.uri = path(parts);
		}
		get name() {
			return this.uri.split("/").at(-1) ?? "";
		}
		get exists() {
			return state.dirs.has(this.uri);
		}
		info() {
			return { exists: this.exists };
		}
		create() {
			const parts = this.uri.split("/");
			for (let i = 1; i <= parts.length; i++)
				state.dirs.add(parts.slice(0, i).join("/"));
		}
		delete() {
			for (const name of state.files.keys())
				if (name.startsWith(`${this.uri}/`)) state.files.delete(name);
			for (const name of state.dirs)
				if (name === this.uri || name.startsWith(`${this.uri}/`))
					state.dirs.delete(name);
		}
		list() {
			const prefix = `${this.uri}/`;
			return [
				...[...state.dirs]
					.filter(
						(name) =>
							name.startsWith(prefix) &&
							!name.slice(prefix.length).includes("/"),
					)
					.map((name) => new Directory(name)),
				...[...state.files.keys()]
					.filter(
						(name) =>
							name.startsWith(prefix) &&
							!name.slice(prefix.length).includes("/"),
					)
					.map((name) => new File(name)),
			];
		}
	}
	class File {
		uri: string;
		constructor(...parts: unknown[]) {
			this.uri = path(parts);
		}
		get name() {
			return this.uri.split("/").at(-1) ?? "";
		}
		get exists() {
			return state.files.has(this.uri);
		}
		info() {
			return { exists: this.exists };
		}
		create() {
			state.files.set(this.uri, "");
		}
		write(value: string) {
			state.files.set(this.uri, value.slice(0, 3));
			if (state.failWrite && this.uri.endsWith(".pending"))
				throw new Error("interrupted ciphertext write");
			state.files.set(this.uri, value);
		}
		text() {
			return Promise.resolve(state.files.get(this.uri) ?? "");
		}
		delete() {
			state.files.delete(this.uri);
		}
		move(target: File) {
			if (target.exists) throw new Error("replace forbidden");
			state.files.set(target.uri, state.files.get(this.uri) ?? "");
			state.files.delete(this.uri);
			this.uri = target.uri;
		}
	}
	return { Directory, File, Paths: { document: "document", cache: "cache" } };
}
async function cryptoFixture() {
	const { webcrypto, createHash, randomUUID } = await import("node:crypto");
	class Key {
		constructor(readonly value: CryptoTypes.CryptoKey) {}
		static async generate() {
			return new Key(
				await webcrypto.subtle.generateKey(
					{ name: "AES-GCM", length: 256 },
					true,
					["encrypt", "decrypt"],
				),
			);
		}
		static async import(hex: string) {
			return new Key(
				await webcrypto.subtle.importKey(
					"raw",
					Buffer.from(hex, "hex"),
					"AES-GCM",
					true,
					["encrypt", "decrypt"],
				),
			);
		}
		async encoded() {
			return Buffer.from(
				await webcrypto.subtle.exportKey("raw", this.value),
			).toString("hex");
		}
	}
	class Data {
		constructor(readonly bytes: Uint8Array) {}
		static fromCombined(value: string) {
			return new Data(Buffer.from(value, "base64"));
		}
		async combined() {
			return Buffer.from(this.bytes).toString("base64");
		}
	}
	return {
		randomUUID,
		AESEncryptionKey: Key,
		AESSealedData: Data,
		CryptoDigestAlgorithm: { SHA256: "sha256" },
		digestStringAsync: async (_: string, input: string) =>
			createHash("sha256").update(input).digest("hex"),
		aesEncryptAsync: async (
			value: Uint8Array,
			key: Key,
			options: { additionalData: Uint8Array },
		) => {
			const iv = webcrypto.getRandomValues(new Uint8Array(12));
			const cipher = await webcrypto.subtle.encrypt(
				{ name: "AES-GCM", iv, additionalData: options.additionalData },
				key.value,
				value,
			);
			return new Data(Buffer.concat([iv, Buffer.from(cipher)]));
		},
		aesDecryptAsync: async (
			data: Data,
			key: Key,
			options: { additionalData: Uint8Array },
		) =>
			webcrypto.subtle.decrypt(
				{
					name: "AES-GCM",
					iv: data.bytes.slice(0, 12),
					additionalData: options.additionalData,
				},
				key.value,
				data.bytes.slice(12),
			),
	};
}
const fakeFilesystem = filesystemFixture();
let key: PrivateDataKey | null = null;
async function restart() {
	configurePrivateDataKeys({
		read: async () => key,
		write: async (value) => {
			key = value;
		},
		clear: async () => {
			key = null;
		},
	});
	const crypto = await cryptoFixture();
	return createNativePrivateStores({
		filesystem: async () =>
			fakeFilesystem as unknown as typeof import("expo-file-system"),
		installId: async () => crypto.randomUUID(),
		generateKey: async () =>
			(await crypto.AESEncryptionKey.generate()).encoded(),
		hash: (input) => crypto.digestStringAsync("sha256", input),
		cipher: async (hex, installId) => {
			const key = await crypto.AESEncryptionKey.import(hex);
			const aad = (context: string) =>
				new TextEncoder().encode(JSON.stringify([installId, context]));
			return {
				seal: async (plaintext, context) =>
					(
						await crypto.aesEncryptAsync(
							new TextEncoder().encode(plaintext),
							key,
							{ additionalData: aad(context) },
						)
					).combined(),
				open: async (sealed, context) =>
					new TextDecoder().decode(
						await crypto.aesDecryptAsync(
							crypto.AESSealedData.fromCombined(sealed),
							key,
							{ additionalData: aad(context) },
						),
					),
			};
		},
	});
}
beforeEach(() => {
	state.files.clear();
	state.dirs.clear();
	state.failWrite = false;
	key = null;
});

/** Node ports exercise the production adapter + real AES-GCM, not native OS
 * bridges. Native FileSystem/Keychain/reinstall evidence remains a separate gate. */
describe("native private adapter with Node platform ports", () => {
	it("retires a native key with an authenticated compact tombstone, never a resurrectable delete", async () => {
		const store = (await restart()).nativePrivateStore("recovery");
		await store.set("draft", "private text");
		await store.set("draft", "edited private text");
		await store.remove("draft");
		expect(await store.get("draft")).toBeNull();
		expect(await store.keys()).toEqual([]);
		const commits = [...state.files.keys()].filter((name) =>
			name.endsWith(".json"),
		);
		expect(commits).toHaveLength(1);
		const next = (await restart()).nativePrivateStore("recovery");
		expect(await next.get("draft")).toBeNull();
	});
	it("writes only ciphertext/index ciphertext and survives source process restart", async () => {
		const first = await restart();
		const store = first.nativePrivateStore("device");
		await store.set("private-account/draft-key", "private text canary");
		expect(state.files.size).toBeGreaterThan(0);
		expect([...state.files.values()].join("\n")).not.toContain(
			"private text canary",
		);
		expect([...state.files.values()].join("\n")).not.toContain(
			"private-account",
		);
		const second = (await restart()).nativePrivateStore("device");
		expect(await second.get("private-account/draft-key")).toBe(
			"private text canary",
		);
		expect(await second.keys()).toEqual(["private-account/draft-key"]);
	});
	it("keeps the last complete ciphertext after interrupted pending write and refuses corrupt latest", async () => {
		const store = (await restart()).nativePrivateStore("recovery");
		await store.set("draft", "first committed");
		state.failWrite = true;
		await expect(store.set("draft", "uncommitted")).rejects.toThrow(
			"interrupted",
		);
		state.failWrite = false;
		const restarted = (await restart()).nativePrivateStore("recovery");
		expect(await restarted.get("draft")).toBe("first committed");
		const committed = [...state.files.keys()]
			.filter((name) => name.endsWith(".json"))
			.sort()
			.at(-1);
		if (!committed) throw new Error("no ciphertext commit");
		state.files.set(committed, "{broken");
		await expect(restarted.get("draft")).rejects.toThrow();
	});
	it("destroys surviving key and ciphertext after sentinel loss, never reconstructing install authority", async () => {
		await (await restart())
			.nativePrivateStore("recovery")
			.set("draft", "old install private");
		const oldKey = key;
		state.files.delete("cache/lo-mobile-private-installation-v1");
		const next = (await restart()).nativePrivateStore("recovery");
		expect(await next.get("draft")).toBeNull();
		expect(key).not.toEqual(oldKey);
	});
	it("deletes legacy plaintext rather than adopting it into an authenticated install", async () => {
		state.dirs.add("document/lo-mobile-store");
		state.files.set("document/lo-mobile-store/legacy.json", "legacy-private");
		await (await restart()).nativePrivateStore("device").get("draft");
		expect([...state.files.values()].join("")).not.toContain("legacy-private");
	});
	it("explicit installation erase removes all ciphertext and fixed-service key", async () => {
		const api = await restart();
		await api.nativePrivateStore("recovery").set("draft", "private");
		await api.nativePrivateStore("device").set("command", "private envelope");
		await api.eraseNativePrivateInstallation();
		expect(key).toBeNull();
		expect(state.files.size).toBe(0);
	});
});
