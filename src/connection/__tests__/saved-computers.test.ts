/**
 * The saved-computers registry: CRUD, the bound, migration from the single custom
 * slot, and the removal that discovery must not undo (bug B4).
 *
 * Everything runs over `memorySecureStore`, the same adapter the app's web target
 * uses, so the assertions read the raw keystore items a phone would hold.
 */
import { describe, expect, it } from "vitest";
import { createConnectionStore } from "../../state";
import type { DiscoveredComputer } from "../discovery";
import {
	MAX_SAVED_COMPUTERS,
	SAVED_COMPUTER_KEY_PREFIX,
	SAVED_COMPUTERS_INDEX_KEY,
	SavedComputers,
} from "../saved-computers";
import {
	MAX_SECURE_VALUE_CHARS,
	memorySecureStore,
	SECURE_KEYS,
	SecureStorage,
} from "../storage";

/** Placeholder addresses only: this repository is public. */
const HOST_A = "0123456789abcdef0123456789abcdef-lop.example.com";
const HOST_B = "fedcba9876543210fedcba9876543210-lop.example.com";
const SECRET_FIELD = /password|grant|refresh|access/;

function fixture(seed: Record<string, string> = {}) {
	const adapter = memorySecureStore(seed);
	let clock = 1_000;
	let next = 0;
	const registry = new SavedComputers(adapter, {
		now: () => clock,
		newId: () => `id${(next++).toString().padStart(2, "0")}`,
	});
	return {
		adapter,
		registry,
		tick: (ms = 1) => {
			clock += ms;
		},
	};
}

function discovered(
	tunnelId: string,
	hostname: string,
	name = "laptop",
): DiscoveredComputer {
	return {
		tunnelId,
		name,
		deviceId: `device-${tunnelId}`,
		hostname,
		status: "ready",
		rawStatus: "active",
		supportsLocalOperator: true,
		billing: { eligible: null, message: null },
		updatedAt: 0,
	};
}

describe("the saved-computers registry", () => {
	it("adds, refreshes, hides, un-hides and forgets a mix of Radient and custom computers", async () => {
		const { adapter, registry, tick } = fixture();

		const radient = await registry.rememberRadient({
			tunnelId: "t1",
			hostname: HOST_A,
			name: "Studio",
		});
		tick();
		const custom = await registry.rememberCustom({
			baseUrl: "https://relay.example.com/",
			allowInsecure: false,
		});
		expect(radient).toMatchObject({
			id: "id00",
			transport: "radient",
			name: "Studio",
			hidden: false,
		});
		expect(custom).toMatchObject({
			id: "id01",
			transport: "custom",
			baseUrl: "https://relay.example.com",
			name: "relay.example.com",
		});
		expect((await registry.list()).map((entry) => entry.id)).toEqual([
			"id01",
			"id00",
		]);

		/* Re-reporting is a refresh, not a duplicate, and the trailing slash is the
		 *  same address. */
		tick();
		await registry.rememberRadient({
			tunnelId: "t1",
			hostname: HOST_A,
			name: "Studio (renamed)",
		});
		await registry.rememberCustom({
			baseUrl: "https://relay.example.com",
			allowInsecure: true,
		});
		const afterRefresh = await registry.list();
		expect(afterRefresh).toHaveLength(2);
		expect(afterRefresh.find((entry) => entry.id === "id00")?.name).toBe(
			"Studio (renamed)",
		);

		await registry.markUsed("id00");
		expect((await registry.list())[0]?.id).toBe("id00");

		await registry.hide("id00");
		expect(await registry.hiddenTunnelIds()).toEqual(["t1"]);
		expect((await registry.visible()).map((entry) => entry.id)).toEqual([
			"id01",
		]);
		await registry.unhide("id00");
		expect(await registry.hiddenTunnelIds()).toEqual([]);

		await registry.forget("id01");
		expect((await registry.list()).map((entry) => entry.id)).toEqual(["id00"]);
		expect(adapter.items.has(`${SAVED_COMPUTER_KEY_PREFIX}id01`)).toBe(false);

		/* Metadata only: no item the registry wrote carries a secret field. */
		for (const [key, value] of adapter.items) {
			if (!key.startsWith("lop.mobile.computer")) continue;
			expect(value).not.toMatch(SECRET_FIELD);
		}
	});

	it("keeps a refreshed computer hidden: discovery reporting it is not the reader asking for it back", async () => {
		const { registry } = fixture();
		await registry.hideRadient({ tunnelId: "t1", hostname: HOST_A, name: "x" });
		await registry.rememberRadient({
			tunnelId: "t1",
			hostname: HOST_A,
			name: "x",
		});
		const [entry] = await registry.list();
		expect(entry?.hidden).toBe(true);
		expect(entry && SavedComputers.mayAutoReconnect(entry)).toBe(false);
	});

	it(`holds at most ${MAX_SAVED_COMPUTERS}, evicting the least recently used visible entry and never a hidden one`, async () => {
		const { adapter, registry, tick } = fixture();
		/* The oldest entry is hidden: evicting it would resurrect a removal. */
		await registry.hideRadient({
			tunnelId: "t-removed",
			hostname: HOST_B,
			name: "removed",
		});
		for (let index = 1; index < MAX_SAVED_COMPUTERS; index += 1) {
			tick();
			await registry.rememberRadient({
				tunnelId: `t${index}`,
				hostname: HOST_A,
				name: `computer ${index}`,
			});
		}
		expect(await registry.list()).toHaveLength(MAX_SAVED_COMPUTERS);

		tick();
		await registry.rememberCustom({
			baseUrl: "https://relay.example.com",
			allowInsecure: false,
		});
		const entries = await registry.list();
		expect(entries).toHaveLength(MAX_SAVED_COMPUTERS);
		expect(await registry.hiddenTunnelIds()).toEqual(["t-removed"]);
		expect(
			entries.some(
				(entry) => entry.transport === "radient" && entry.tunnelId === "t1",
			),
		).toBe(false);

		/* Every item, the index included, stays under the keystore's cap even with a
		 *  full list and the longest name an entry accepts. */
		await registry.rememberRadient({
			tunnelId: "t2",
			hostname: HOST_A,
			name: "n".repeat(10_000),
		});
		for (const [key, value] of adapter.items) {
			if (key.startsWith("lop.mobile.computer"))
				expect(value.length).toBeLessThanOrEqual(MAX_SECURE_VALUE_CHARS);
		}
	});

	it("survives a corrupt entry by losing that one computer, not the list", async () => {
		const { adapter, registry } = fixture();
		await registry.rememberRadient({
			tunnelId: "t1",
			hostname: HOST_A,
			name: "a",
		});
		await registry.rememberRadient({
			tunnelId: "t2",
			hostname: HOST_B,
			name: "b",
		});
		adapter.items.set(`${SAVED_COMPUTER_KEY_PREFIX}id00`, "{not json");
		expect((await registry.list()).map((entry) => entry.id)).toEqual(["id01"]);
	});
});

describe("migration from the single custom slot", () => {
	const legacy = JSON.stringify({
		base_url: "https://relay.example.com/",
		password: "placeholder-password",
		allow_insecure: true,
	});

	it("seeds one custom entry and leaves the slot byte-for-byte unchanged", async () => {
		const { adapter, registry } = fixture({ [SECURE_KEYS.custom]: legacy });

		const entries = await registry.list();
		expect(entries).toEqual([
			{
				transport: "custom",
				id: "id00",
				baseUrl: "https://relay.example.com",
				allowInsecure: true,
				name: "relay.example.com",
				addedAt: 1_000,
				lastUsedAt: 1_000,
				hidden: false,
			},
		]);
		expect(adapter.items.get(SECURE_KEYS.custom)).toBe(legacy);
		/* The password stays where `storage.ts` owns it, and only there. */
		expect(adapter.items.get(`${SAVED_COMPUTER_KEY_PREFIX}id00`)).not.toContain(
			"placeholder-password",
		);
		expect(await new SecureStorage(adapter).readCustomRoute()).toEqual({
			base_url: "https://relay.example.com/",
			password: "placeholder-password",
			allow_insecure: true,
		});
	});

	it("is idempotent: a re-run, and a fresh instance after a restart, seed nothing more", async () => {
		const { adapter, registry } = fixture({ [SECURE_KEYS.custom]: legacy });
		await registry.list();
		await registry.list();
		const restarted = new SavedComputers(adapter, { newId: () => "other" });
		expect((await restarted.list()).map((entry) => entry.id)).toEqual(["id00"]);

		/* Forgetting the migrated entry sticks: the index's presence is the
		 *  migration marker, so the slot (still there) is not re-seeded. */
		await restarted.forget("id00");
		expect(await new SavedComputers(adapter).list()).toEqual([]);
		expect(adapter.items.get(SECURE_KEYS.custom)).toBe(legacy);
	});

	it("never deletes an unparseable custom slot, unlike the credential reader", async () => {
		const { adapter, registry } = fixture({ [SECURE_KEYS.custom]: "{broken" });
		expect(await registry.list()).toEqual([]);
		expect(adapter.items.get(SECURE_KEYS.custom)).toBe("{broken");
	});

	it("does not mark the migration done when the keystore refuses the read", async () => {
		const adapter = memorySecureStore({ [SECURE_KEYS.custom]: legacy });
		let locked = true;
		const flaky = {
			...adapter,
			getItemAsync: async (key: string) => {
				if (locked) throw new Error("keystore locked");
				return adapter.getItemAsync(key);
			},
		};
		const registry = new SavedComputers(flaky, { newId: () => "id00" });
		await expect(registry.list()).rejects.toThrow("keystore locked");
		expect(adapter.items.has(SAVED_COMPUTERS_INDEX_KEY)).toBe(false);
		locked = false;
		expect(await registry.list()).toHaveLength(1);
	});
});

describe("a removed Radient computer stays removed (B4)", () => {
	it("stays out of the list across a discovery refresh, a route change and a restart", async () => {
		const { adapter, registry } = fixture();
		const store = createConnectionStore();
		store.getState().startRoute({
			mode: "radient",
			hostname: HOST_A,
			tunnelId: "t1",
		});
		const feed = [discovered("t1", HOST_A, "Studio"), discovered("t2", HOST_B)];
		store.getState().setComputers(feed);

		/* What the screen's Remove does. */
		store.getState().hideComputer("t1");
		await registry.hideRadient({
			tunnelId: "t1",
			hostname: HOST_A,
			name: "Studio",
		});

		/* Discovery answers again with the same account's computers. On origin/main
		 *  this put t1 straight back: Remove only filtered the in-memory list. */
		store.getState().setComputers(feed);
		expect(store.getState().computers.map((c) => c.tunnelId)).toEqual(["t2"]);

		/* A route change resets the snapshot, not this phone's removals. */
		store.getState().endRoute();
		store.getState().startRoute({
			mode: "radient",
			hostname: HOST_B,
			tunnelId: "t2",
		});
		store.getState().setComputers(feed);
		expect(store.getState().computers.map((c) => c.tunnelId)).toEqual(["t2"]);

		/* A restart: a new store hydrated from the keystore, after discovery has
		 *  already answered — hydration re-filters what is on screen. */
		const coldStore = createConnectionStore();
		coldStore.getState().startRoute({
			mode: "radient",
			hostname: HOST_A,
			tunnelId: "t1",
		});
		coldStore.getState().setComputers(feed);
		coldStore
			.getState()
			.setHiddenTunnelIds(await new SavedComputers(adapter).hiddenTunnelIds());
		expect(coldStore.getState().computers.map((c) => c.tunnelId)).toEqual([
			"t2",
		]);
		coldStore.getState().setComputers(feed);
		expect(coldStore.getState().computers.map((c) => c.tunnelId)).toEqual([
			"t2",
		]);
	});

	it("comes back on the next discovery refresh once un-hidden", async () => {
		const { registry } = fixture();
		const store = createConnectionStore();
		store.getState().startRoute({
			mode: "radient",
			hostname: HOST_A,
			tunnelId: "t1",
		});
		const entry = await registry.hideRadient({
			tunnelId: "t1",
			hostname: HOST_A,
			name: "Studio",
		});
		store.getState().setHiddenTunnelIds(await registry.hiddenTunnelIds());
		store.getState().setComputers([discovered("t1", HOST_A)]);
		expect(store.getState().computers).toEqual([]);

		await registry.unhide(entry.id);
		store.getState().unhideComputer("t1");
		store.getState().setComputers([discovered("t1", HOST_A)]);
		expect(store.getState().computers.map((c) => c.tunnelId)).toEqual(["t1"]);
		expect(await registry.hiddenTunnelIds()).toEqual([]);
	});
});
