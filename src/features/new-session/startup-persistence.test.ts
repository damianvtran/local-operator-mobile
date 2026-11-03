import { describe, expect, it } from "vitest";
import { type RevisionFiles, RevisionStore } from "./startup-persistence";

function fixture() {
	const files = new Map<string, string>();
	let failWrite = false;
	let failRemove = false;
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
			if (failRemove) throw new Error("remove denied");
			files.delete(name);
		},
	};
	return {
		files,
		store: new RevisionStore(adapter),
		restart: () => new RevisionStore(adapter),
		denyRemoval: () => {
			failRemove = true;
		},
		fail: () => {
			failWrite = true;
		},
	};
}
describe("native startup revision commits", () => {
	it("commits discard before an undeletable older committed predecessor can block pruning", async () => {
		const x = fixture();
		await x.store.set("first private value");
		await x.store.set("second private value");
		x.denyRemoval();
		await expect(x.store.discard("discarded")).rejects.toThrow("remove denied");
		expect(await x.restart().get()).toBe("discarded");
		expect(
			[...x.files.keys()].filter((name) => name.endsWith(".json")),
		).toHaveLength(3);
	});
	it("keeps a committed discard tombstone when predecessor deletion is interrupted", async () => {
		const x = fixture();
		await x.store.set("old private value");
		x.denyRemoval();
		await expect(x.store.discard("discarded")).rejects.toThrow("remove denied");
		expect(await x.restart().get()).toBe("discarded");
		expect(
			[...x.files.keys()].filter((name) => name.endsWith(".json")),
		).toHaveLength(2);
	});
	it("explicit discard retires corrupt/unknown history without reading or rolling back to it", async () => {
		const x = fixture();
		await x.store.set("old private value");
		x.files.set(
			"000000000001.json",
			JSON.stringify({ version: 2, value: "old private value" }),
		);
		await expect(x.store.get()).rejects.toThrow("corrupt");
		await x.store.discard("discarded");
		expect(await x.restart().get()).toBe("discarded");
		expect([...x.files.values()].join("")).not.toContain("old private value");
		expect([...x.files.keys()]).toEqual(["000000000002.json"]);
	});
	it("retains the last complete version after a partial write, never overwriting it", async () => {
		const x = fixture();
		await x.store.set("first committed");
		x.fail();
		await expect(x.store.set("second must not replace first")).rejects.toThrow(
			"disk full",
		);
		expect(await x.store.get()).toBe("first committed");
	});
	it("ignores an interrupted pending revision after process restart", async () => {
		const x = fixture();
		await x.store.set("committed encrypted envelope");
		// A process can die after writing the pending file but before rename. A
		// fresh adapter must not treat those incomplete bytes as recoverable work.
		x.files.set("000000000002.pending", '{"version":1,"value":"partial');
		expect(await x.restart().get()).toBe("committed encrypted envelope");
		await x.restart().set("next committed encrypted envelope");
		expect(await x.restart().get()).toBe("next committed encrypted envelope");
		expect([...x.files.keys()].some((name) => name.endsWith(".pending"))).toBe(
			false,
		);
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
