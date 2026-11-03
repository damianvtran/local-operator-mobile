import { describe, expect, it, vi } from "vitest";
import { memorySecureStore, SECURE_KEYS, SecureStorage } from "./storage";

const synthetic = {
	installId: "00000000-0000-4000-8000-000000000001",
	keyHex: "ab".repeat(32),
};
describe("private encryption key lifecycle", () => {
	it("writes with the singleton's device-only accessibility and verifies erasure", async () => {
		const adapter = memorySecureStore();
		const write = vi.spyOn(adapter, "setItemAsync");
		const store = new SecureStorage(adapter, {
			keychainAccessible: "device-only-test",
		});
		await store.writePrivateDataKey(synthetic);
		expect(write).toHaveBeenCalledWith(
			SECURE_KEYS.privateDataKey,
			expect.any(String),
			{ keychainAccessible: "device-only-test" },
		);
		expect(await store.readPrivateDataKey()).toEqual(synthetic);
		await store.clearPrivateDataKey();
		expect(await store.readPrivateDataKey()).toBeNull();
	});
	it("never treats malformed key bytes as missing or overwrites them during read", async () => {
		const adapter = memorySecureStore();
		const store = new SecureStorage(adapter);
		adapter.items.set(SECURE_KEYS.privateDataKey, "{interrupted");
		await expect(store.readPrivateDataKey()).rejects.toThrow("unreadable");
		expect(adapter.items.get(SECURE_KEYS.privateDataKey)).toBe("{interrupted");
		await expect(
			store.writePrivateDataKey({ ...synthetic, keyHex: "short" }),
		).rejects.toThrow("invalid");
	});
	it("refuses cleanup success if the keystore silently keeps a key", async () => {
		const adapter = memorySecureStore();
		const store = new SecureStorage(adapter);
		await store.writePrivateDataKey(synthetic);
		adapter.deleteItemAsync = async () => {};
		await expect(store.clearPrivateDataKey()).rejects.toThrow(
			"could not be confirmed",
		);
	});
	it("includes encryption keys in ordinary full signout", async () => {
		const store = new SecureStorage(memorySecureStore());
		await store.writePrivateDataKey(synthetic);
		await store.clearAll();
		expect(await store.readPrivateDataKey()).toBeNull();
	});
});
