import { describe, expect, it, vi } from "vitest";

/**
 * The install identity's three prose promises, as behaviour:
 *
 *  1. **Mint once** — a second call reads the first's record back; the register
 *     contract is idempotent on this id, so a remint would register the same
 *     phone as a second device.
 *  2. **Survive `SecureStorage.clearAll()`** — sign-out is a revoke, and a
 *     revoke must stick for the same device: if sign-out destroyed the id, the
 *     next launch would mint a fresh one and quietly undo the revoke.
 *  3. **Web-ephemeral, and said so** — the web runtime has no keystore; the
 *     record lives for the session and `writeInstallRecord` reports it.
 *
 * `expo-crypto` is mocked: its native entry does not load under Node, and the
 * mint only needs a CSPRNG-shaped string. `react-native` resolves to the web
 * alias this suite always runs (`vitest.config.ts`), which is also what makes
 * promise 3 testable here.
 */

const mintState = vi.hoisted(() => ({ count: 0 }));
vi.mock("expo-crypto", () => ({
	randomUUID: () => {
		mintState.count += 1;
		return `00000000-0000-4000-8000-${String(mintState.count).padStart(12, "0")}`;
	},
}));

import { Platform } from "react-native";

import { memorySecureStore, SECURE_KEYS, SecureStorage } from "@/connection";
import {
	ensureInstallRecord,
	INSTALL_RECORD_KEY,
	readInstallRecord,
	recordRegistration,
	writeInstallRecord,
} from "@/notifications/install-id";

describe("the install record", () => {
	it("mints once — a second read returns the first record", async () => {
		const first = await ensureInstallRecord();
		const second = await ensureInstallRecord();
		expect(first.v).toBe(1);
		expect(first.install_id.startsWith("00000000-")).toBe(true);
		expect(second).toEqual(first);
		expect(mintState.count).toBe(1);
	});

	it("keeps the same install id through a registration", async () => {
		const before = await ensureInstallRecord();
		await recordRegistration("device-1", "device-key-1");
		const after = await readInstallRecord();
		expect(after?.install_id).toBe(before.install_id);
		expect(after?.device_id).toBe("device-1");
		expect(after?.device_key).toBe("device-key-1");
		expect(mintState.count).toBe(1);
	});

	it("reports the web record as ephemeral — the honest half of the fallback", async () => {
		expect(Platform.OS).toBe("web");
		const result = await writeInstallRecord({ v: 1, install_id: "web-1" });
		expect(result.persistent).toBe(false);
	});
});

describe("the sign-out contract", () => {
	it("does not live under a key SecureStorage.clearAll() clears", async () => {
		/* The principle as behaviour: seed ONE store with every key `clearAll`
		 * promises to clear AND the install record, run the clear, and watch
		 * only the record stand — the tombstone's "the revoke must stick for the
		 * same `install_id`" depends on exactly this. */
		const store = memorySecureStore();
		const storage = new SecureStorage(store);
		await store.setItemAsync(
			INSTALL_RECORD_KEY,
			JSON.stringify({ v: 1, install_id: "keep-me" }),
		);
		for (const key of Object.values(SECURE_KEYS)) {
			await store.setItemAsync(key, '"set"');
		}

		await storage.clearAll();

		for (const key of Object.values(SECURE_KEYS)) {
			expect(await store.getItemAsync(key)).toBeNull();
		}
		expect(await store.getItemAsync(INSTALL_RECORD_KEY)).toBe(
			JSON.stringify({ v: 1, install_id: "keep-me" }),
		);
	});
});
