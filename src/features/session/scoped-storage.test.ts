import { describe, expect, it } from "vitest";
import { scopedStore } from "./scoped-storage";

it("quarantines legacy keys and isolates the same SID on different authorizations", async () => {
	const values = new Map([["lo-mobile-draft:same", "legacy unknown owner"]]);
	const raw = {
		get: async (key: string) => values.get(key) ?? null,
		set: async (key: string, value: string) => {
			values.set(key, value);
		},
		remove: async (key: string) => {
			values.delete(key);
		},
		keys: async () => [...values.keys()],
	};
	const a = scopedStore(raw, "account-a/route-a");
	const b = scopedStore(raw, "account-b/route-b");
	expect(await a.get("lo-mobile-draft:same")).toBeNull();
	await a.set("lo-mobile-draft:same", "A only");
	await a.set("lo-mobile-command:same", "immutable-A");
	expect(await b.get("lo-mobile-draft:same")).toBeNull();
	expect(await b.get("lo-mobile-command:same")).toBeNull();
	expect(await a.keys()).toEqual([
		"lo-mobile-draft:same",
		"lo-mobile-command:same",
	]);
	expect(values.get("lo-mobile-draft:same")).toBe("legacy unknown owner");
});

describe("inactive authorization", () => {
	it("cannot read or write durable private data", async () => {
		const raw = {
			get: async () => "private",
			set: async () => undefined,
			remove: async () => undefined,
			keys: async () => ["private"],
		};
		const store = scopedStore(raw, null);
		expect(await store.get("anything")).toBeNull();
		await expect(store.set("anything", "text")).rejects.toThrow();
		expect(await store.keys()).toEqual([]);
	});
});
