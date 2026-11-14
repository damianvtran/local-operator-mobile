/**
 * The warm cache (`../warm-cache.ts`) on an injected port: the real module, no
 * React Native. Frames are real captures parsed through the wire schema, so a
 * round trip proves the stored shape still satisfies the contract.
 */
import { describe, expect, it, vi } from "vitest";

import type { SessionListFrame, SessionProjection } from "../../contracts";
import { parsePayload } from "../../contracts";
import { loadFixture } from "../../testing/fixtures";
import {
	createWarmCache,
	memoryWarmStore,
	utf8Bytes,
	WARM_KEY_PREFIX,
	type WarmScope,
	type WarmStorePort,
} from "../warm-cache";

const projection = (
	rel = "sse/sse-projection-live-idle.json",
): SessionProjection =>
	parsePayload("sessionProjection", loadFixture<{ data: unknown }>(rel).data);
const listFrame = (): SessionListFrame =>
	parsePayload(
		"sessionListFrame",
		loadFixture<{ data: unknown }>("sse/sse-list-frame.json").data,
	);

const A: WarmScope = {
	accountId: "acct-a",
	routeKey: '{"mode":"radient","hostname":"h1"}',
};
const quiet = () => vi.fn();

describe("warm cache", () => {
	it("round-trips a conversation with its version stripped", async () => {
		const store = memoryWarmStore();
		const cache = createWarmCache(store, { warn: quiet(), now: () => 1234 });
		const frame = { ...projection(), version: 41 };
		expect(await cache.saveSession(A, "s1", frame)).toBe(true);
		// Nothing persisted carries the per-connection version.
		for (const key of await store.keys()) {
			const raw = (await store.get(key)) ?? "";
			expect(raw.includes('"version":41')).toBe(false);
		}
		const back = await cache.loadSession(A, "s1");
		expect(back?.savedAt).toBe(1234);
		const { version: _a, ...want } = frame;
		const { version: _b, ...got } = back?.projection ?? frame;
		expect(got).toEqual(want);
	});

	it("round-trips the session list", async () => {
		const cache = createWarmCache(memoryWarmStore(), { warn: quiet() });
		const frame = listFrame();
		await cache.saveList(A, frame);
		expect((await cache.loadList(A))?.frame).toEqual(frame);
	});

	it("never returns another account's or another computer's entry", async () => {
		const cache = createWarmCache(memoryWarmStore(), { warn: quiet() });
		await cache.saveSession(A, "s1", projection());
		await cache.saveList(A, listFrame());
		const otherAccount: WarmScope = { ...A, accountId: "acct-b" };
		const otherComputer: WarmScope = {
			...A,
			routeKey: '{"mode":"radient","hostname":"h2"}',
		};
		const custom: WarmScope = { ...A, accountId: null };
		for (const scope of [otherAccount, otherComputer, custom]) {
			expect(await cache.loadSession(scope, "s1")).toBeNull();
			expect(await cache.loadList(scope)).toBeNull();
		}
		expect(await cache.loadSession(A, "s1")).not.toBeNull();
	});

	it("evicts the least recently saved conversation at the count bound, and the list is not counted", async () => {
		const store = memoryWarmStore();
		let t = 0;
		const cache = createWarmCache(store, {
			warn: quiet(),
			now: () => ++t,
			maxSessions: 5,
		});
		await cache.saveList(A, listFrame());
		for (const id of ["s1", "s2", "s3", "s4", "s5", "s6"])
			await cache.saveSession(A, id, projection());
		expect(await cache.loadSession(A, "s1")).toBeNull();
		for (const id of ["s2", "s3", "s4", "s5", "s6"])
			expect(await cache.loadSession(A, id)).not.toBeNull();
		expect(await cache.loadList(A)).not.toBeNull();
		// Re-saving makes an entry most recent: s2 survives the next eviction, s3 goes.
		await cache.saveSession(A, "s2", projection());
		await cache.saveSession(A, "s7", projection());
		expect(await cache.loadSession(A, "s2")).not.toBeNull();
		expect(await cache.loadSession(A, "s3")).toBeNull();
	});

	it("evicts at the byte budget, and refuses a single entry larger than the budget", async () => {
		const store = memoryWarmStore();
		const one = JSON.stringify({
			schema: 1,
			savedAt: 1,
			projection: projection(),
		}).length;
		const warn = quiet();
		const cache = createWarmCache(store, {
			warn,
			/* Two entries plus the index's own rows (the budget counts the index
			 * too, PR #246 R6) fit; a third does not. */
			budgetBytes: one * 2 + 1000,
			maxSessions: 99,
		});
		await cache.saveSession(A, "s1", projection());
		await cache.saveSession(A, "s2", projection());
		await cache.saveSession(A, "s3", projection());
		expect(await cache.loadSession(A, "s1")).toBeNull();
		expect(await cache.loadSession(A, "s2")).not.toBeNull();
		expect(await cache.loadSession(A, "s3")).not.toBeNull();
		const tiny = createWarmCache(memoryWarmStore(), { warn, budgetBytes: 100 });
		expect(await tiny.saveSession(A, "big", projection())).toBe(false);
		expect(await tiny.loadSession(A, "big")).toBeNull();
	});

	it("treats a schema-invalid entry as a miss and deletes it", async () => {
		const store = memoryWarmStore();
		const warn = quiet();
		const cache = createWarmCache(store, { warn });
		await cache.saveSession(A, "s1", projection());
		const key = (await store.keys()).find((k) => k.includes(":session:"));
		expect(key).toBeDefined();
		await store.set(
			key as string,
			JSON.stringify({
				schema: 1,
				savedAt: 1,
				projection: { transcript: "nope" },
			}),
		);
		expect(await cache.loadSession(A, "s1")).toBeNull();
		expect(await store.get(key as string)).toBeNull();
		expect(warn).toHaveBeenCalled();
		// An unknown schema is a miss too.
		await cache.saveList(A, listFrame());
		const listKey = (await store.keys()).find((k) =>
			k.endsWith(":list"),
		) as string;
		await store.set(
			listKey,
			JSON.stringify({ schema: 99, savedAt: 1, frame: listFrame() }),
		);
		expect(await cache.loadList(A)).toBeNull();
	});

	it("treats a read/decrypt failure as a miss, and a failed write as a cold cache, never a throw", async () => {
		const inner = memoryWarmStore();
		const broken: WarmStorePort = {
			...inner,
			get: async (key) => {
				if (key.includes(":session:")) throw new Error("decrypt failed");
				return inner.get(key);
			},
		};
		const cache = createWarmCache(broken, { warn: quiet() });
		await cache.saveSession(A, "s1", projection());
		await expect(cache.loadSession(A, "s1")).resolves.toBeNull();
		const refusing: WarmStorePort = {
			...inner,
			set: async () => {
				throw new Error("private storage is closed while sign-out completes");
			},
		};
		await expect(
			createWarmCache(refusing, { warn: quiet() }).saveSession(
				A,
				"s2",
				projection(),
			),
		).resolves.toBe(false);
	});

	it("clear() purges the whole family (sign-out) and leaves other keys alone", async () => {
		const store = memoryWarmStore();
		await store.set("lo-mobile-draft:x", "keep");
		const cache = createWarmCache(store, { warn: quiet() });
		await cache.saveSession(A, "s1", projection());
		await cache.saveList(A, listFrame());
		await cache.clear();
		expect(
			(await store.keys()).filter((k) => k.startsWith(WARM_KEY_PREFIX)),
		).toEqual([]);
		expect(await store.get("lo-mobile-draft:x")).toBe("keep");
		expect(await cache.loadSession(A, "s1")).toBeNull();
		expect(await cache.loadList(A)).toBeNull();
	});

	it("serialises racing saves so no entry escapes the index (and the budget)", async () => {
		const store = memoryWarmStore();
		const cache = createWarmCache(store, { warn: quiet(), maxSessions: 2 });
		await Promise.all(
			["s1", "s2", "s3", "s4"].map((id) =>
				cache.saveSession(A, id, projection()),
			),
		);
		const sessions = (await store.keys()).filter((k) =>
			k.includes(":session:"),
		);
		expect(sessions).toHaveLength(2);
	});
});

describe("warm cache: stored bytes and unchanged saves (PR #246 R6/R7)", () => {
	it("utf8Bytes counts UTF-8 bytes, not UTF-16 units", () => {
		expect(utf8Bytes("abc")).toBe(3);
		expect(utf8Bytes("é")).toBe(2);
		expect(utf8Bytes("€")).toBe(3);
		expect(utf8Bytes("😀")).toBe(4); // one surrogate pair, two UTF-16 units
		expect(utf8Bytes("\ud800")).toBe(3); // lone surrogate → U+FFFD
	});

	it("the budget counts what the port stores, so a sealing port evicts sooner", async () => {
		const plain = memoryWarmStore();
		const sealing = {
			...memoryWarmStore(),
			// A port that triples every value on disk (the native seal's shape).
			storedBytes: (_key: string, value: string) => utf8Bytes(value) * 3,
		};
		const one = utf8Bytes(
			JSON.stringify({ schema: 1, savedAt: 1, projection: projection() }),
		);
		const options = {
			warn: quiet(),
			budgetBytes: one * 2 + 1000,
			maxSessions: 99,
		};
		const a = createWarmCache(plain, options);
		const b = createWarmCache(sealing, options);
		expect(await a.saveSession(A, "s1", projection())).toBe(true);
		// Measured as stored (3×), one entry alone is over the budget.
		expect(await b.saveSession(A, "s1", projection())).toBe(false);
	});

	it("non-ASCII text counts its UTF-8 bytes against the budget", async () => {
		const store = memoryWarmStore();
		const frame = projection();
		const ascii = JSON.stringify({ schema: 1, savedAt: 1, projection: frame });
		// Budget sized to the UTF-16 length: a value whose UTF-8 is twice that
		// fits by `.length` but not by bytes.
		const cache = createWarmCache(store, {
			warn: quiet(),
			budgetBytes: ascii.length * 1.5,
		});
		const wide = {
			...frame,
			title: "é".repeat(ascii.length),
		} as SessionProjection;
		expect(await cache.saveSession(A, "wide", wide)).toBe(false);
	});

	it("an unchanged frame is not written again; a new frame is", async () => {
		const store = memoryWarmStore();
		const sets: string[] = [];
		const counting = {
			...store,
			set: async (key: string, value: string) => {
				sets.push(key);
				await store.set(key, value);
			},
		};
		const cache = createWarmCache(counting, { warn: quiet() });
		const frame = projection();
		expect(await cache.saveSession(A, "s1", frame)).toBe(true);
		const afterFirst = sets.length; // the value plus the index
		expect(afterFirst).toBe(2);
		// A quick flick out and back: the same frame object, nothing rewritten.
		expect(await cache.saveSession(A, "s1", frame)).toBe(true);
		expect(sets.length).toBe(afterFirst);
		// A new frame (stores replace, never mutate) is written.
		expect(await cache.saveSession(A, "s1", projection())).toBe(true);
		expect(sets.length).toBe(afterFirst + 2);
		// The list follows the same rule.
		const list = listFrame();
		await cache.saveList(A, list);
		const afterList = sets.length;
		await cache.saveList(A, list);
		expect(sets.length).toBe(afterList);
		// After a purge, the same object is written again.
		await cache.clear();
		await cache.saveList(A, list);
		expect(sets.length).toBe(afterList + 2);
	});
});
