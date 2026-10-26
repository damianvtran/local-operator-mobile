import { describe, expect, it, vi } from "vitest";
import { StartupAuthorizationLifecycle } from "./startup-authorization";
import { memorySecureStore, SecureStorage } from "./storage";

/**
 * The generation's job is to keep one identity's drafts away from the next
 * identity WITHOUT destroying a reader's unfinished sentence on a token blip.
 * These cases pin both halves of that, plus the fail-closed ordering that makes
 * a half-completed purge safe.
 */
function fixture() {
	const adapter = memorySecureStore();
	const store = new SecureStorage(adapter);
	const persistence = {
		read: () => store.readStartupAuthorization(),
		write: (
			record: Parameters<SecureStorage["writeStartupAuthorization"]>[0],
		) => store.writeStartupAuthorization(record),
	};
	let next = 0;
	const lifecycle = () =>
		new StartupAuthorizationLifecycle(
			persistence,
			async () => `generation-${++next}`,
		);
	return { adapter, store, persistence, lifecycle };
}

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

describe("startup authorization privacy boundary", () => {
	it("sign-out removes the persisted generation alongside credentials", async () => {
		const adapter = memorySecureStore();
		await adapter.setItemAsync(
			"lop.mobile.startup-authorization",
			JSON.stringify({
				version: 1,
				state: "active",
				generation: "g",
				route: "r",
			}),
		);
		await new SecureStorage(adapter).clearAll();
		expect(
			await adapter.getItemAsync("lop.mobile.startup-authorization"),
		).toBeNull();
	});

	it("reuses the generation across an authorized restart and rotates it on a server change", async () => {
		const f = fixture();
		const first = f.lifecycle();
		const before = await first.admit(
			"custom:https://relay.example.com/a",
			first.suspend(),
		);
		const restarted = f.lifecycle();
		expect(
			await restarted.admit(
				"custom:https://relay.example.com/a",
				restarted.suspend(),
			),
		).toEqual(before);
		const cleanup = vi.fn(async () => undefined);
		restarted.registerCleanup(cleanup);
		const changed = await restarted.admit(
			"custom:https://relay.example.com/b",
			restarted.suspend(),
		);
		expect(changed?.scope).not.toBe(before?.scope);
		expect(cleanup).toHaveBeenCalledOnce();
	});

	it("a 401 keeps the drafts but gives the next login a different generation", async () => {
		const f = fixture();
		const lifecycle = f.lifecycle();
		const before = await lifecycle.admit("route-a", lifecycle.suspend());
		const cleanup = vi.fn(async () => undefined);
		lifecycle.registerCleanup(cleanup);
		await lifecycle.revoke();
		expect(lifecycle.get()).toBeNull();
		expect(cleanup).not.toHaveBeenCalled();
		expect(await f.store.readStartupAuthorization()).toEqual({
			version: 1,
			state: "revoked",
		});
		const after = await lifecycle.admit("route-a", lifecycle.suspend());
		expect(after?.scope).not.toBe(before?.scope);
		expect(cleanup).not.toHaveBeenCalled();
	});

	it("quarantines first-upgrade unscoped data without deleting it, but explicit signout purges", async () => {
		const lifecycle = fixture().lifecycle();
		const cleanup = vi.fn(async () => undefined);
		lifecycle.registerCleanup(cleanup);
		await lifecycle.retire(true);
		await lifecycle.admit(
			"custom:https://relay.example.com",
			lifecycle.suspend(),
		);
		expect(cleanup).not.toHaveBeenCalled();
		await lifecycle.retire();
		expect(cleanup).toHaveBeenCalledOnce();
	});

	it("closes dispatch synchronously, waits all privacy owners and blocks after failure", async () => {
		const f = fixture();
		const lifecycle = f.lifecycle();
		await lifecycle.admit("route-a", lifecycle.suspend());
		const held = deferred();
		const unhook = lifecycle.registerCleanup(async () => {
			await held.promise;
			throw new Error("privacy cleanup refused");
		});
		const other = vi.fn(async () => undefined);
		lifecycle.registerCleanup(other);
		const observed: unknown[] = [];
		lifecycle.subscribe(() => observed.push(lifecycle.get()));
		const retired = lifecycle.retire();
		expect(lifecycle.get()).toBeNull();
		expect(observed).toEqual([null]);
		const admitted = lifecycle.admit("route-b", lifecycle.getRevision());
		held.resolve();
		await expect(retired).rejects.toThrow("privacy cleanup refused");
		await expect(admitted).rejects.toThrow("privacy cleanup refused");
		expect(other).toHaveBeenCalledOnce();
		expect(await f.store.readStartupAuthorization()).toEqual({
			version: 1,
			state: "tombstone",
		});
		unhook();
		await lifecycle.retire();
		expect(
			await lifecycle.admit("route-b", lifecycle.getRevision()),
		).not.toBeNull();
	});

	it("a purge tombstone is completed before a restart may admit", async () => {
		const f = fixture();
		await f.store.writeStartupAuthorization({ version: 1, state: "tombstone" });
		const restarted = f.lifecycle();
		const cleanup = vi.fn(async () => {
			throw new Error("still refused");
		});
		restarted.registerCleanup(cleanup);
		await expect(
			restarted.admit("route-a", restarted.suspend()),
		).rejects.toThrow("still refused");
		expect(restarted.get()).toBeNull();
		expect(cleanup).toHaveBeenCalledOnce();
	});

	it("fences a late scope write and serializes its tombstone after that write", async () => {
		const f = fixture();
		const started = deferred();
		const held = deferred();
		const lifecycle = new StartupAuthorizationLifecycle(
			{
				...f.persistence,
				write: async (record) => {
					if (record.state === "active") {
						started.resolve();
						await held.promise;
					}
					await f.persistence.write(record);
				},
			},
			async () => "generation",
		);
		const revision = lifecycle.suspend();
		const pending = lifecycle.admit("route-a", revision);
		await started.promise;
		const retired = lifecycle.retire();
		held.resolve();
		expect(await pending).toBeNull();
		await retired;
		expect(lifecycle.get()).toBeNull();
		expect(await f.store.readStartupAuthorization()).toEqual({
			version: 1,
			state: "tombstone",
		});
	});

	it("a late credential write cannot resurrect after signout or run under a stale revision", async () => {
		const lifecycle = fixture().lifecycle();
		const revision = lifecycle.suspend();
		const started = deferred();
		const held = deferred();
		const effects: string[] = [];
		const writing = lifecycle.runIfCurrent(revision, async () => {
			started.resolve();
			await held.promise;
			effects.push("write");
		});
		await started.promise;
		const retired = lifecycle.retire(false, async () => {
			effects.push("clear");
		});
		const late = lifecycle.runIfCurrent(revision, async () => {
			effects.push("stale");
		});
		held.resolve();
		await Promise.all([writing, retired, late]);
		expect(effects).toEqual(["write", "clear"]);
	});

	it.each(["corrupt", "locked", "silent-delete"])(
		"does not mistake %s secure storage for successful privacy work",
		async (failure) => {
			const f = fixture();
			if (failure === "corrupt") {
				await f.adapter.setItemAsync(
					"lop.mobile.startup-authorization",
					"not json",
				);
				await expect(f.store.readStartupAuthorization()).rejects.toThrow(
					"unreadable",
				);
			} else if (failure === "locked") {
				vi.spyOn(f.adapter, "getItemAsync").mockRejectedValue(
					new Error("locked"),
				);
				await expect(f.store.readStartupAuthorization()).rejects.toThrow(
					"locked",
				);
			} else {
				await f.store.writeStartupAuthorization({
					version: 1,
					state: "tombstone",
				});
				vi.spyOn(f.adapter, "deleteItemAsync").mockResolvedValue(undefined);
				await expect(f.store.clearAll()).rejects.toThrow(
					"removal could not be confirmed",
				);
			}
		},
	);
});
