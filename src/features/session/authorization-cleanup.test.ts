import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Platform: { OS: "web" } }));

import { clearAuthorizationData } from "./device-storage";
import {
	type PrivateStore,
	reopenPrivateWrites,
	runPrivateWrite,
	scopedStore,
	withdrawPrivateWrites,
} from "./scoped-storage";

afterEach(() => {
	vi.unstubAllGlobals();
});
describe("explicit private-data retirement", () => {
	it("refuses success when enumeration is blocked", async () => {
		vi.stubGlobal("localStorage", {
			get length() {
				throw new Error("enumeration denied");
			},
		});
		await expect(clearAuthorizationData()).rejects.toThrow(
			"enumeration denied",
		);
	});
	it("refuses success when a private key cannot be deleted", async () => {
		vi.stubGlobal("localStorage", {
			length: 1,
			key: () => "lo-mobile-draft:legacy",
			removeItem: () => {
				throw new Error("deletion denied");
			},
		});
		await expect(clearAuthorizationData()).rejects.toThrow("deletion denied");
	});
	it("purges legacy and scoped private families only on the explicit cleanup call", async () => {
		const values = new Map([
			["lo-mobile-draft:legacy", "unknown owner"],
			["lo-mobile-command:same:authorization:a", "private"],
			["appearance", "light"],
		]);
		vi.stubGlobal("localStorage", {
			get length() {
				return values.size;
			},
			key: (n: number) => [...values.keys()][n] ?? null,
			removeItem: (key: string) => values.delete(key),
		});
		expect(values.get("lo-mobile-draft:legacy")).toBe("unknown owner");
		await clearAuthorizationData();
		expect([...values.keys()]).toEqual(["appearance"]);
	});
});

/**
 * R1-4: a write that was already in flight when retirement began must not be able
 * to recreate the scope after the purge said it was gone. Reproduced with a
 * delayed `set` — before the fix the key reappeared after cleanup resolved.
 */
describe("private writers are withdrawn and drained before purge", () => {
	it("cannot repopulate the scope from a write that was already running", async () => {
		const values = new Map<string, string>();
		vi.stubGlobal("localStorage", {
			get length() {
				return values.size;
			},
			key: (index: number) => [...values.keys()][index] ?? null,
			setItem: (key: string, value: string) => values.set(key, value),
			removeItem: (key: string) => values.delete(key),
		});
		const gate: { release?: () => void } = {};
		// A private write that reached the adapter before retirement began and is
		// parked there, exactly as a filesystem call can be.
		const delayed = runPrivateWrite(
			() =>
				new Promise<void>((resolve) => {
					gate.release = () => {
						values.set("lo-mobile-draft:session-a:authorization:a", "private");
						resolve();
					};
				}),
		);
		const purge = clearAuthorizationData();
		await Promise.resolve();
		gate.release?.();
		await delayed;
		await purge;
		expect([...values.keys()]).toEqual([]);
	});

	it("rejects new private writes while the barrier is closed", async () => {
		const store: PrivateStore = {
			get: async () => null,
			set: async () => undefined,
			remove: async () => undefined,
			keys: async () => [],
		};
		withdrawPrivateWrites();
		await expect(
			scopedStore(store, "generation-a").set("lo-mobile-draft:session-a", "x"),
		).rejects.toThrow(/closed/);
		reopenPrivateWrites();
	});
});
