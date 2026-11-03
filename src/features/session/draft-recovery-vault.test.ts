import { describe, expect, it } from "vitest";
import { DraftRecoveryVault } from "./draft-recovery-vault";

function fixture() {
	const disk = new Map<string, string>();
	let now = 1000;
	const store = {
		get: async (key: string) => disk.get(key) ?? null,
		set: async (key: string, value: string) => {
			disk.set(key, value);
		},
		remove: async (key: string) => {
			disk.delete(key);
		},
	};
	let erasures = 0;
	const create = () =>
		new DraftRecoveryVault(
			store,
			async () => {
				disk.clear();
				erasures++;
			},
			() => now,
			100,
		);
	return {
		disk,
		store,
		create,
		advance: () => {
			now += 101;
		},
		erasures: () => erasures,
	};
}
describe("sealed draft authority lease", () => {
	it("retries an accepted failed checkpoint before ordinary-generation purge", async () => {
		const x = fixture();
		const vault = x.create();
		await vault.prepare("owner-a", () => true);
		await vault.write("draft", "older committed draft");
		const set = x.store.set;
		let failing = true;
		x.store.set = async (key, value) => {
			if (failing) throw new Error("disk unavailable");
			await set(key, value);
		};
		await expect(vault.write("draft", "latest accepted edit")).rejects.toThrow(
			"disk unavailable",
		);
		expect(vault.available()).toBe(false);
		await expect(vault.read("draft")).rejects.toThrow("disk unavailable");
		vault.withdraw();
		await expect(vault.drain()).rejects.toThrow("disk unavailable");
		await expect(vault.prepare("owner-a", () => true)).rejects.toThrow(
			"checkpoint",
		);
		failing = false;
		await vault.drain();
		await vault.prepare("owner-a", () => true);
		expect(await vault.read("draft")).toBe("latest accepted edit");
	});
	it("quarantines across expiry/restart, then restores only after same fresh proof", async () => {
		const x = fixture();
		const first = x.create();
		await first.prepare("owner-a/tenant-a/backend-a", () => true);
		await first.write("draft", "unfinished");
		first.withdraw();
		expect(await first.read("draft")).toBeNull();
		const restarted = x.create();
		expect(await restarted.read("draft")).toBeNull();
		await restarted.prepare("owner-a/tenant-a/backend-a", () => true);
		expect(await restarted.read("draft")).toBe("unfinished");
	});
	it.each([
		"owner-b/tenant-a/backend-a",
		"owner-a/tenant-b/backend-a",
		"owner-a/tenant-a/backend-b",
	])("erases before admitting changed authority %s", async (authority) => {
		const x = fixture();
		const vault = x.create();
		await vault.prepare("owner-a/tenant-a/backend-a", () => true);
		await vault.write("draft", "old private text");
		vault.withdraw();
		await vault.prepare(authority, () => true);
		expect(x.erasures()).toBe(1);
		expect(await vault.read("draft")).toBeNull();
		expect([...x.disk.values()].join("")).not.toContain("old private text");
	});
	it("never publishes a late proof or read after withdrawal", async () => {
		const x = fixture();
		const vault = x.create();
		const preparation = vault.prepare("owner-a", () => true);
		vault.withdraw();
		expect(await preparation).toBe(false);
		expect(await vault.read("draft")).toBeNull();
	});
	it("explicit discard and logout cannot resurrect an earlier draft", async () => {
		const x = fixture();
		const vault = x.create();
		await vault.prepare("owner-a", () => true);
		await vault.write("draft", "private");
		await vault.remove("draft");
		expect(await vault.read("draft")).toBeNull();
		await vault.write("draft", "new private");
		await vault.clear();
		const restarted = x.create();
		await restarted.prepare("owner-a", () => true);
		expect(await restarted.read("draft")).toBeNull();
	});
	it("expires recovery retention without interpreting auth expiry as deletion", async () => {
		const x = fixture();
		const vault = x.create();
		await vault.prepare("owner-a", () => true);
		await vault.write("draft", "private");
		x.advance();
		expect(await vault.read("draft")).toBeNull();
	});
	it("drains an accepted write, refuses later writes, and erases after draining", async () => {
		const x = fixture();
		let release = () => {};
		const original = x.store.set;
		const vault = x.create();
		await vault.prepare("owner-a", () => true);
		x.store.set = async (key, value) => {
			await new Promise<void>((resolve) => {
				release = resolve;
			});
			await original(key, value);
		};
		const accepted = vault.write("draft", "private");
		await Promise.resolve();
		await Promise.resolve();
		vault.withdraw();
		await vault.write("other", "not admitted");
		const clearing = vault.clear();
		release();
		await accepted;
		await clearing;
		expect(x.disk.size).toBe(0);
	});
	it("propagates key/ciphertext erasure failure instead of claiming logout", async () => {
		const vault = new DraftRecoveryVault(
			{ get: async () => null, set: async () => {}, remove: async () => {} },
			async () => {
				throw new Error("key deletion denied");
			},
		);
		await expect(vault.clear()).rejects.toThrow("key deletion denied");
		expect(await vault.read("draft")).toBeNull();
		await expect(vault.prepare("owner-b", () => true)).rejects.toThrow(
			"explicit retry",
		);
	});
});
