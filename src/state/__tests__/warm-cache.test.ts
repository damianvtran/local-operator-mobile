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
			budgetBytes: one * 2 + 10,
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
