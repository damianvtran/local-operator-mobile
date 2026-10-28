/**
 * The saved-computers registry: CRUD, the bound, sign-out's clear, the custom slot
 * it deliberately does NOT copy, and the removal that discovery must not undo
 * (bug B4).
 *
 * Everything runs over `memorySecureStore`, the same adapter the app's web target
 * uses, so the assertions read the raw keystore items a phone would hold.
 */
import { describe, expect, it, vi } from "vitest";
import { createConnectionStore } from "../../state";
import type { DiscoveredComputer } from "../discovery";
import {
	MAX_SAVED_COMPUTERS,
	RegistryWriteFenced,
	SAVED_COMPUTER_KEY_PREFIX,
	SAVED_COMPUTERS_INDEX_KEY,
	SavedComputers,
} from "../saved-computers";
import {
	MAX_SECURE_VALUE_CHARS,
	memorySecureStore,
	SECURE_KEYS,
} from "../storage";

/** Placeholder addresses only: this repository is public. */
const HOST_A = "0123456789abcdef0123456789abcdef-lop.example.com";
const HOST_B = "fedcba9876543210fedcba9876543210-lop.example.com";
const SECRET_FIELD = /password|grant|refresh|access/;
const EMAIL_SHAPED = /@/;

/** The adapter a fixture's registry was built over, for a "restart" read. */
const adapters = new WeakMap<
	SavedComputers,
	ReturnType<typeof memorySecureStore>
>();
function fixtureAdapter(registry: SavedComputers) {
	const adapter = adapters.get(registry);
	if (!adapter) throw new Error("not a fixture registry");
	return adapter;
}

function fixture(seed: Record<string, string> = {}) {
	const adapter = memorySecureStore(seed);
	let clock = 1_000;
	let next = 0;
	const registry = new SavedComputers(adapter, {
		now: () => clock,
		newId: () => `id${(next++).toString().padStart(2, "0")}`,
	});
	adapters.set(registry, adapter);
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

	it("treats an address change as the same computer: id, timestamps, hidden and identity survive it", async () => {
		const { registry, tick } = fixture();
		const saved = await registry.rememberCustom({
			baseUrl: "https://relay.example.com",
			allowInsecure: false,
			name: "Home",
		});
		expect(saved.identity).toBeNull();
		await registry.hide(saved.id);
		tick(50);

		/* A VPN / network change re-points the URL. Same computer. */
		const moved = await registry.updateAddress(saved.id, {
			baseUrl: "https://relay-vpn.example.com/",
		});
		expect(moved).toEqual({
			...saved,
			hidden: true,
			baseUrl: "https://relay-vpn.example.com",
		});
		const reread = await new SavedComputers(fixtureAdapter(registry)).list();
		expect(reread).toEqual([moved]);

		/* Re-saving by id under yet another address updates in place, never forks. */
		await registry.rememberCustom({
			id: saved.id,
			baseUrl: "https://10.0.0.5:8443",
			allowInsecure: true,
		});
		const after = await registry.list();
		expect(after).toHaveLength(1);
		expect(after[0]).toMatchObject({
			id: saved.id,
			addedAt: saved.addedAt,
			lastUsedAt: saved.lastUsedAt,
			hidden: true,
			name: "Home",
			baseUrl: "https://10.0.0.5:8443",
			allowInsecure: true,
			identity: null,
		});

		/* Unknown id, or a Radient entry: no address to move. */
		expect(
			await registry.updateAddress("nope", { baseUrl: "https://x.example" }),
		).toBeNull();
		const radient = await registry.rememberRadient({
			tunnelId: "t1",
			hostname: HOST_A,
			name: "Studio",
		});
		expect(
			await registry.updateAddress(radient.id, {
				baseUrl: "https://x.example",
			}),
		).toBeNull();
	});

	it("reads a reserved key fingerprint back and keeps it across refreshes, without verifying it", async () => {
		const { adapter, registry } = fixture();
		const saved = await registry.rememberCustom({
			baseUrl: "https://relay.example.com",
			allowInsecure: false,
		});
		/* Nothing in this slice writes a fingerprint; a later build will. Seed it
		 *  the way that build would, then check this one carries it through. */
		const key = `${SAVED_COMPUTER_KEY_PREFIX}${saved.id}`;
		const stored = JSON.parse(adapter.items.get(key) ?? "{}");
		adapter.items.set(
			key,
			JSON.stringify({
				...stored,
				identity: { key_fingerprint: "sha256:00ff" },
			}),
		);
		await registry.updateAddress(saved.id, {
			baseUrl: "https://relay-2.example.com",
		});
		await registry.rememberCustom({
			id: saved.id,
			baseUrl: "https://relay-3.example.com",
			allowInsecure: false,
		});
		expect((await registry.list())[0]?.identity).toEqual({
			key_fingerprint: "sha256:00ff",
		});
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

describe("the custom slot is not copied (R1)", () => {
	const legacy = JSON.stringify({
		base_url: "https://relay.example.com/",
		password: "placeholder-password",
		allow_insecure: true,
	});

	it("seeds nothing from lop.mobile.custom, writes no marker, and leaves the slot as it was", async () => {
		const { adapter, registry } = fixture({ [SECURE_KEYS.custom]: legacy });

		expect(await registry.list()).toEqual([]);
		expect(await registry.hiddenTunnelIds()).toEqual([]);
		/* A read writes nothing: no index (the old migration marker), no entry. */
		expect([...adapter.items.keys()]).toEqual([SECURE_KEYS.custom]);
		expect(adapter.items.get(SECURE_KEYS.custom)).toBe(legacy);

		/* A first write lists only what was written, never the slot's address. */
		await registry.rememberRadient({
			tunnelId: "t1",
			hostname: HOST_A,
			name: "a",
		});
		expect((await registry.list()).map((entry) => entry.transport)).toEqual([
			"radient",
		]);
	});
});

describe("clear (sign-out)", () => {
	it("deletes every entry and leaves an empty index, even past an unreadable entry", async () => {
		const { adapter: base } = fixture();
		let failing: string | null = null;
		const adapter = {
			...base,
			getItemAsync: async (key: string) => {
				if (key === failing) throw new Error("keystore read failed");
				return base.getItemAsync(key);
			},
		};
		const registry = new SavedComputers(adapter, {
			newId: (() => {
				let next = 0;
				return () => `id${(next++).toString().padStart(2, "0")}`;
			})(),
		});
		await registry.hideRadient({ tunnelId: "t1", hostname: HOST_A, name: "a" });
		await registry.rememberCustom({
			baseUrl: "https://relay.example.com",
			allowInsecure: false,
		});
		failing = `${SAVED_COMPUTER_KEY_PREFIX}id00`;

		await registry.clear();

		failing = null;
		expect(base.items.get(SAVED_COMPUTERS_INDEX_KEY)).toBe(
			JSON.stringify({ v: 1, ids: [] }),
		);
		expect(
			[...base.items.keys()].filter((key) =>
				key.startsWith(SAVED_COMPUTER_KEY_PREFIX),
			),
		).toEqual([]);
		expect(await registry.list()).toEqual([]);
		expect(await new SavedComputers(base).hiddenTunnelIds()).toEqual([]);
	});
});

describe("a keystore read that throws is not a corrupt entry (R2)", () => {
	it("fails the write and keeps the hidden entry, instead of dropping it from the index", async () => {
		const { adapter: base } = fixture();
		let failOnce: string | null = null;
		const adapter = {
			...base,
			getItemAsync: async (key: string) => {
				if (key === failOnce) {
					failOnce = null;
					throw new Error("keystore read failed");
				}
				return base.getItemAsync(key);
			},
		};
		let next = 0;
		const registry = new SavedComputers(adapter, {
			newId: () => `id${(next++).toString().padStart(2, "0")}`,
		});
		await registry.hideRadient({ tunnelId: "t1", hostname: HOST_A, name: "a" });
		const indexBefore = base.items.get(SAVED_COMPUTERS_INDEX_KEY);

		failOnce = `${SAVED_COMPUTER_KEY_PREFIX}id00`;
		await expect(
			registry.rememberRadient({ tunnelId: "t2", hostname: HOST_B, name: "b" }),
		).rejects.toThrow("keystore read failed");

		/* Untouched: the index still names the hidden entry, so it stays hidden. */
		expect(base.items.get(SAVED_COMPUTERS_INDEX_KEY)).toBe(indexBefore);
		expect(await registry.hiddenTunnelIds()).toEqual(["t1"]);

		/* The retry, once the keystore answers, keeps both. */
		await registry.rememberRadient({
			tunnelId: "t2",
			hostname: HOST_B,
			name: "b",
		});
		expect(await registry.hiddenTunnelIds()).toEqual(["t1"]);
		expect(
			(await registry.list()).map((entry) =>
				entry.transport === "radient" ? entry.tunnelId : entry.id,
			),
		).toEqual(expect.arrayContaining(["t1", "t2"]));
	});
});

describe("one unreadable entry costs that entry, not the registry (N1)", () => {
	/** Two hidden computers and a visible one; `id00`'s keystore read throws on
	 *  every attempt — the permanent `DecryptException` case — until reset. */
	async function withUnreadableEntry() {
		const { adapter: base } = fixture();
		let failing: string | null = null;
		const adapter = {
			...base,
			getItemAsync: async (key: string) => {
				if (key === failing) throw new Error("keystore read failed");
				return base.getItemAsync(key);
			},
		};
		let next = 0;
		const registry = new SavedComputers(adapter, {
			newId: () => `id${(next++).toString().padStart(2, "0")}`,
		});
		await registry.hideRadient({ tunnelId: "t1", hostname: HOST_A, name: "a" });
		await registry.hideRadient({ tunnelId: "t2", hostname: HOST_B, name: "b" });
		await registry.rememberRadient({
			tunnelId: "t3",
			hostname: HOST_B,
			name: "c",
		});
		failing = `${SAVED_COMPUTER_KEY_PREFIX}id00`;
		const warnings: unknown[][] = [];
		const warn = vi
			.spyOn(console, "warn")
			.mockImplementation((...args: unknown[]) => {
				warnings.push(args);
			});
		return {
			base,
			registry,
			warnings,
			heal: () => {
				failing = null;
				warn.mockRestore();
			},
		};
	}

	it("still returns the other hidden ids, and logs the skip without the entry's value", async () => {
		const { registry, warnings, heal } = await withUnreadableEntry();

		expect(await registry.hiddenTunnelIds()).toEqual(["t2"]);
		expect(
			(await registry.visible()).map((entry) =>
				entry.transport === "radient" ? entry.tunnelId : entry.id,
			),
		).toEqual(["t3"]);
		expect(warnings.length).toBeGreaterThan(0);
		const logged = JSON.stringify(warnings);
		expect(logged).toContain("id00");
		expect(logged).not.toContain(HOST_A);
		expect(logged).not.toContain("t1");
		heal();
	});

	it("persists a Remove of a different computer and keeps the unreadable id in the index", async () => {
		const { base, registry, heal } = await withUnreadableEntry();

		await registry.hideRadient({ tunnelId: "t3", hostname: HOST_B, name: "c" });
		/* A different, readable entry is hidden/un-hidden/forgotten past it too. */
		await registry.unhide("id01");
		await registry.hide("id01");

		expect(
			JSON.parse(base.items.get(SAVED_COMPUTERS_INDEX_KEY) ?? "null"),
		).toEqual({ v: 1, ids: ["id00", "id01", "id02"] });
		heal();
		/* Once the keystore answers again, every removal is there — nothing lost. */
		expect((await registry.hiddenTunnelIds()).sort()).toEqual([
			"t1",
			"t2",
			"t3",
		]);
	});

	it("forgets a different computer without dropping the unreadable id", async () => {
		const { base, registry, heal } = await withUnreadableEntry();

		await registry.forget("id02");

		expect(
			JSON.parse(base.items.get(SAVED_COMPUTERS_INDEX_KEY) ?? "null"),
		).toEqual({ v: 1, ids: ["id00", "id01"] });
		heal();
		expect((await registry.hiddenTunnelIds()).sort()).toEqual(["t1", "t2"]);
	});

	it("still refuses a write that would need the unreadable entry itself", async () => {
		const { base, registry, heal } = await withUnreadableEntry();
		const indexBefore = base.items.get(SAVED_COMPUTERS_INDEX_KEY);

		await expect(registry.unhide("id00")).rejects.toThrow(
			"keystore read failed",
		);
		await expect(
			registry.rememberRadient({ tunnelId: "t4", hostname: HOST_A, name: "d" }),
		).rejects.toThrow("keystore read failed");

		expect(base.items.get(SAVED_COMPUTERS_INDEX_KEY)).toBe(indexBefore);
		heal();
		expect((await registry.hiddenTunnelIds()).sort()).toEqual(["t1", "t2"]);
	});
});

describe("clear (sign-out) past an unreadable index (N2)", () => {
	it("writes the empty index first, then surfaces the read error", async () => {
		const { adapter: base, registry } = fixture();
		await registry.hideRadient({ tunnelId: "t1", hostname: HOST_A, name: "a" });
		const adapter = {
			...base,
			getItemAsync: async (key: string) => {
				if (key === SAVED_COMPUTERS_INDEX_KEY)
					throw new Error("keystore read failed");
				return base.getItemAsync(key);
			},
		};

		await expect(new SavedComputers(adapter).clear()).rejects.toThrow(
			"keystore read failed",
		);

		expect(base.items.get(SAVED_COMPUTERS_INDEX_KEY)).toBe(
			JSON.stringify({ v: 1, ids: [] }),
		);
		expect(await new SavedComputers(base).hiddenTunnelIds()).toEqual([]);
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

describe("PR #122 round-1 remediation", () => {
	it("keeps the saved name when a remember carries none, never overwriting it with the hostname (Q2/m2)", async () => {
		const { registry } = fixture();
		await registry.rememberRadient({
			tunnelId: "t1",
			hostname: HOST_A,
			name: "Studio Mac",
		});
		const again = await registry.rememberRadient({
			tunnelId: "t1",
			hostname: HOST_A,
		});
		expect(again.name).toBe("Studio Mac");
		/* A computer never named still gets its hostname, the one name it has. */
		const fresh = await registry.rememberRadient({
			tunnelId: "t2",
			hostname: HOST_B,
		});
		expect(fresh.name).toBe(HOST_B);
		/* And a real new name still wins. */
		expect(
			(
				await registry.rememberRadient({
					tunnelId: "t1",
					hostname: HOST_A,
					name: "Renamed",
				})
			).name,
		).toBe("Renamed");
	});

	it("stamps a Radient entry with its account, keeps the stamp when the caller does not know it, and survives a restart (M2)", async () => {
		const { registry, adapter } = fixture();
		await registry.rememberRadient({
			tunnelId: "t1",
			hostname: HOST_A,
			name: "a",
			account: "acct-A",
		});
		const kept = await registry.rememberRadient({
			tunnelId: "t1",
			hostname: HOST_A,
		});
		expect(kept).toMatchObject({ account: "acct-A" });
		/* A Remove carries no account either, and must not erase it. */
		await registry.hideRadient({ tunnelId: "t1", hostname: HOST_A, name: "a" });
		const restarted = new SavedComputers(adapter);
		expect((await restarted.list())[0]).toMatchObject({
			account: "acct-A",
			hidden: true,
		});
		/* The stamp is the opaque id, never anything that looks like an email. */
		expect(JSON.stringify(await restarted.list())).not.toMatch(EMAIL_SHAPED);
	});

	it("reads an entry written before the account key existed as account null", async () => {
		const { adapter } = fixture({
			[SAVED_COMPUTERS_INDEX_KEY]: JSON.stringify({ v: 1, ids: ["old1"] }),
			[`${SAVED_COMPUTER_KEY_PREFIX}old1`]: JSON.stringify({
				v: 1,
				id: "old1",
				transport: "radient",
				tunnelId: "t1",
				hostname: HOST_A,
				name: "Legacy",
				addedAt: 1,
				lastUsedAt: 1,
				hidden: false,
				identity: null,
			}),
		});
		const entries = await new SavedComputers(adapter).list();
		expect(entries[0]).toMatchObject({ name: "Legacy", account: null });
	});

	it("drops a remember whose route ended while its write was queued, as sign-out ends it (m3)", async () => {
		const { registry } = fixture();
		let routeCurrent = true;
		/* Called while the route is current — the old fence checked here, and passed. */
		const remembered = registry.rememberRadient(
			{ tunnelId: "t1", hostname: HOST_A, name: "a" },
			{ onlyIf: () => routeCurrent },
		);
		/* Sign-out ends the route synchronously, then clears the registry. */
		routeCurrent = false;
		const cleared = registry.clear();
		await expect(remembered).rejects.toBeInstanceOf(RegistryWriteFenced);
		await cleared;
		expect(await registry.list()).toEqual([]);
		/* The same for an own address. */
		await expect(
			registry.rememberCustom(
				{ baseUrl: "https://home.example.com", allowInsecure: false },
				{ onlyIf: () => false },
			),
		).rejects.toBeInstanceOf(RegistryWriteFenced);
		expect(await registry.list()).toEqual([]);
	});
});
