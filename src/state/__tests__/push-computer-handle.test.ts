import { describe, expect, it } from "vitest";
import {
	createPushHandleStore,
	type HandleStorePort,
} from "../push-computer-handle";
import { memoryWarmStore } from "../warm-cache";

const a = { accountId: "synthetic-a", routeKey: "radient:synthetic-computer" };
const b = { ...a, accountId: "synthetic-b" };

describe("authenticated push computer mapping", () => {
	it("persists per account/route, replaces a changed handle, and clears on omission", async () => {
		const port = memoryWarmStore();
		const handles = createPushHandleStore(port);
		await handles.record(a, "opaque-a");
		expect(await createPushHandleStore(port).lookup(a)).toBe("opaque-a");
		expect(await handles.lookup(b)).toBeNull();
		expect(
			await handles.lookup({ ...a, routeKey: "radient:other" }),
		).toBeNull();
		await handles.record(a, "replacement");
		expect(await handles.lookup(a)).toBe("replacement");
		await handles.record(a, undefined);
		expect(await createPushHandleStore(port).lookup(a)).toBeNull();
	});

	it("forgets every account's mapping for a removed route, not other routes", async () => {
		const handles = createPushHandleStore(memoryWarmStore());
		const other = { ...a, routeKey: "radient:other" };
		await handles.record(a, "a");
		await handles.record(b, "b");
		await handles.record(other, "other");
		await handles.forgetRoute(a.routeKey);
		expect(await handles.lookup(a)).toBeNull();
		expect(await handles.lookup(b)).toBeNull();
		expect(await handles.lookup(other)).toBe("other");
	});

	it("a cold locked read is a miss; a failed write preserves only warm memory", async () => {
		const port: HandleStorePort = {
			get: async () => {
				throw Error("locked");
			},
			set: async () => {
				throw Error("locked");
			},
			remove: async () => {
				throw Error("locked");
			},
			keys: async () => {
				throw Error("locked");
			},
		};
		const handles = createPushHandleStore(port);
		expect(await handles.lookup(a)).toBeNull();
		await handles.record(a, "warm-only");
		expect(await handles.lookup(a)).toBe("warm-only");
		await handles.forgetRoute(a.routeKey);
		expect(await handles.lookup(a)).toBeNull();
	});

	it("purge fences a queued registration and an account switch drops memory", async () => {
		const port = memoryWarmStore();
		const handles = createPushHandleStore(port);
		const pending = handles.record(a, "stale");
		handles.forgetMemory();
		await pending;
		expect(await handles.lookup(a)).toBeNull();
		expect(await port.keys()).toEqual([]);
		await handles.record(a, "held");
		handles.forgetMemory();
		for (const key of await port.keys()) await port.remove(key);
		expect(await handles.lookup(a)).toBeNull();
	});

	it("does not record a stale registration and fences queued writes on removal", async () => {
		const handles = createPushHandleStore(memoryWarmStore());
		await handles.record(a, "stale", () => false);
		expect(await handles.lookup(a)).toBeNull();
		const pending = handles.record(a, "queued-before-forget");
		await handles.forgetRoute(a.routeKey);
		await pending;
		expect(await handles.lookup(a)).toBeNull();
	});

	it("removing the custom slot fences a registration still queued before enumeration", async () => {
		const port = memoryWarmStore();
		const handles = createPushHandleStore(port);
		const custom = {
			accountId: null,
			routeKey: "custom:https://relay.example.com",
		};
		const pending = handles.record(custom, "must-not-return");
		await handles.forgetCustomRoutes();
		await pending;
		expect(await handles.lookup(custom)).toBeNull();
		expect(await port.keys()).toEqual([]);
	});

	it("removing the single custom slot forgets every custom URL, not Radient", async () => {
		const handles = createPushHandleStore(memoryWarmStore());
		const custom = {
			...a,
			accountId: null,
			routeKey: "custom:https://relay.example.com",
		};
		await handles.record(custom, "custom");
		await handles.record(a, "radient");
		await handles.forgetCustomRoutes();
		expect(await handles.lookup(custom)).toBeNull();
		expect(await handles.lookup(a)).toBe("radient");
	});
});
