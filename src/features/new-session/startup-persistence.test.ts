import { describe, expect, it } from "vitest";
import { type RevisionFiles, RevisionStore } from "./startup-persistence";

function fixture() {
	const files = new Map<string, string>();
	let failWrite = false;
	const adapter: RevisionFiles = {
		list: async () => [...files.keys()],
		read: async (name) => files.get(name) ?? null,
		write: async (name, text) => {
			files.set(name, text.slice(0, 3));
			if (failWrite) throw new Error("disk full");
			files.set(name, text);
		},
		move: async (from, to) => {
			if (files.has(to)) throw new Error("replace forbidden");
			files.set(to, files.get(from) ?? "");
			files.delete(from);
		},
		remove: async (name) => {
			files.delete(name);
		},
	};
	return {
		files,
		store: new RevisionStore(adapter),
		fail: () => {
			failWrite = true;
		},
	};
}
describe("native startup revision commits", () => {
	it("retains the last complete version after a partial write, never overwriting it", async () => {
		const x = fixture();
		await x.store.set("first committed");
		x.fail();
		await expect(x.store.set("second must not replace first")).rejects.toThrow(
			"disk full",
		);
		expect(await x.store.get()).toBe("first committed");
	});
	it("keeps at most two committed revisions and refuses corrupt latest bytes", async () => {
		const x = fixture();
		for (let i = 0; i < 12; i++) await x.store.set(`value-${i}`);
		expect(await x.store.get()).toBe("value-11");
		expect(
			[...x.files.keys()].filter((name) => name.endsWith(".json")),
		).toHaveLength(2);
		const latest = [...x.files.keys()]
			.filter((name) => name.endsWith(".json"))
			.sort()
			.at(-1) as string;
		x.files.set(latest, "{corrupt");
		await expect(x.store.get()).rejects.toThrow();
	});
});
