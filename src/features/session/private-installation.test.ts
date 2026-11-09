import { describe, expect, it } from "vitest";
import { type PrivateDataKey, SecureStorageError } from "@/connection/storage";
import { openPrivateInstallation } from "./private-installation";

const saved: PrivateDataKey = {
	installId: "00000000-0000-4000-8000-000000000001",
	keyHex: "ab".repeat(32),
};
const next: PrivateDataKey = {
	installId: "00000000-0000-4000-8000-000000000002",
	keyHex: "cd".repeat(32),
};
function fixture(marker: string | null, key: PrivateDataKey | null = saved) {
	const events: string[] = [];
	return {
		events,
		deps: {
			marker: {
				read: async () => marker,
				write: async (value: string) => {
					events.push("marker-write");
					marker = value;
				},
				clear: async () => {
					events.push("marker-clear");
					marker = null;
				},
			},
			keys: {
				read: async () => key,
				write: async (value: PrivateDataKey) => {
					events.push("key-write");
					key = value;
				},
				clear: async () => {
					events.push("key-clear");
					key = null;
				},
			},
			purgeCiphertext: async () => {
				events.push("ciphertext-purge");
			},
			create: async () => {
				events.push("create");
				return next;
			},
		},
	};
}
describe("native installation sentinel", () => {
	it("quarantines transient marker/key read failures without erasing recoverable work", async () => {
		for (const target of ["marker", "keys"] as const) {
			const x = fixture(saved.installId);
			x.deps[target].read = async () => {
				throw new Error("platform locked");
			};
			await expect(openPrivateInstallation(x.deps)).rejects.toThrow(
				"platform locked",
			);
			expect(x.events).toEqual([]);
		}
	});
	it("resets positively identified corrupt key metadata before fresh creation", async () => {
		const x = fixture(saved.installId);
		const read = x.deps.keys.read;
		let first = true;
		x.deps.keys.read = async () => {
			if (first) {
				first = false;
				throw new SecureStorageError("corrupt key", "synthetic-key");
			}
			return read();
		};
		expect(await openPrivateInstallation(x.deps)).toEqual(next);
		expect(x.events.indexOf("key-clear")).toBeLessThan(
			x.events.indexOf("create"),
		);
	});
	it("uses a surviving key only with its exact existing sandbox sentinel", async () => {
		const x = fixture(saved.installId);
		expect(await openPrivateInstallation(x.deps)).toEqual(saved);
		expect(x.events).toEqual([]);
	});
	it.each([null, "corrupt", next.installId])(
		"erases surviving Keychain/ciphertext before creating after reinstall or eviction (%s)",
		async (marker) => {
			const x = fixture(marker);
			expect(await openPrivateInstallation(x.deps)).toEqual(next);
			expect(x.events.indexOf("key-clear")).toBeLessThan(
				x.events.indexOf("create"),
			);
			expect(x.events.indexOf("ciphertext-purge")).toBeLessThan(
				x.events.indexOf("create"),
			);
			expect(x.events.indexOf("marker-write")).toBeLessThan(
				x.events.indexOf("key-write"),
			);
		},
	);
	it("attempts all erasures and never mints after a failed key deletion", async () => {
		const x = fixture(null);
		x.deps.keys.clear = async () => {
			x.events.push("key-clear-failed");
			throw new Error("denied");
		};
		await expect(openPrivateInstallation(x.deps)).rejects.toThrow("denied");
		expect(x.events).toContain("ciphertext-purge");
		expect(x.events).toContain("marker-clear");
		expect(x.events).not.toContain("create");
	});
	it("refuses an interrupted marker write instead of trusting the key header", async () => {
		const x = fixture(null);
		x.deps.marker.write = async () => {};
		await expect(openPrivateInstallation(x.deps)).rejects.toThrow(
			"marker could not be confirmed",
		);
		expect(x.events).not.toContain("key-write");
	});
	it("refuses a key write that was not durably read back", async () => {
		const x = fixture(null);
		x.deps.keys.write = async () => {};
		await expect(openPrivateInstallation(x.deps)).rejects.toThrow(
			"key could not be confirmed",
		);
	});
});
