import { describe, expect, it, vi } from "vitest";
import { PickerPrivacy } from "@/features/session/picker-privacy";
import { scopedStore } from "@/features/session/scoped-storage";
import { runCommandOperation } from "@/relay/command-lifecycle";
import {
	getStartupAuthorization,
	StartupAuthorizationLifecycle,
} from "./startup-authorization";
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
	it("does not cancel an open picker on late same-owner proof or recovery readiness", async () => {
		const owner = fixture().lifecycle();
		const privacy = new PickerPrivacy();
		const withdraw = vi.fn(privacy.withdraw);
		owner.configureRecoveryBoundary({
			withdraw,
			admitted: privacy.reopen,
			drain: privacy.drain,
			clear: async () => {},
			checkpoint: async () => {},
		});
		const revision = owner.getRevision();
		await owner.admit("route", revision, undefined, null);
		const selection = deferred();
		let stillCurrent = false;
		const picked = privacy.run(async (isCurrent) => {
			await selection.promise;
			stillCurrent = isCurrent();
			return "image";
		});
		await owner.admit("route", revision, async () => {}, "owner-a");
		await owner.admit("route", revision, async () => {}, "owner-a");
		expect(withdraw).not.toHaveBeenCalled();
		selection.resolve();
		expect(await picked).toBe("image");
		expect(stillCurrent).toBe(true);
		owner.suspend();
		expect(withdraw).toHaveBeenCalledOnce();
	});
	it.each([
		["custom restart", "custom-route", null, null],
		["Radient offline restart", "radient-route", "owner-a", null],
		["Radient first offline then online", "radient-route", null, "owner-a"],
	] as const)(
		"retains ordinary draft/outbox across native-policy %s",
		async (_name, route, firstProof, nextProof) => {
			const f = fixture();
			const firstOwner = f.lifecycle();
			const first = await firstOwner.admit(
				route,
				firstOwner.getRevision(),
				undefined,
				firstProof,
			);
			const disk = new Map<string, string>();
			const raw = {
				get: async (key: string) => disk.get(key) ?? null,
				set: async (key: string, value: string) => {
					disk.set(key, value);
				},
				remove: async (key: string) => {
					disk.delete(key);
				},
				keys: async () => [...disk.keys()],
			};
			const old = scopedStore(raw, first?.scope ?? null);
			await old.set("draft", "ordinary unfinished");
			await old.set("outbox", "immutable ambiguous command");
			firstOwner.suspend();
			const restart = f.lifecycle();
			const purge = vi.fn(async () => {
				disk.clear();
			});
			restart.registerCleanup(purge);
			const next = await restart.admit(
				route,
				restart.getRevision(),
				undefined,
				nextProof,
			);
			expect(next?.scope).toBe(first?.scope);
			expect(purge).not.toHaveBeenCalled();
			const current = scopedStore(raw, next?.scope ?? null);
			expect(await current.get("draft")).toBe("ordinary unfinished");
			expect(await current.get("outbox")).toBe("immutable ambiguous command");
			const online = await restart.admit(
				route,
				restart.getRevision(),
				undefined,
				"owner-a",
			);
			expect(online).toBe(next);
			expect(purge).not.toHaveBeenCalled();
			const changed = await restart.admit(
				route,
				restart.getRevision(),
				undefined,
				"owner-b",
			);
			expect(changed?.scope).not.toBe(next?.scope);
			expect(purge).toHaveBeenCalledOnce();
			expect(disk.size).toBe(0);
		},
	);
	it("retains the ordinary last copy when sealed checkpoint draining fails during reauth", async () => {
		const owner = fixture().lifecycle();
		const cleanup = vi.fn(async () => {});
		const clear = vi.fn(async () => {});
		owner.registerCleanup(cleanup);
		owner.configureRecoveryBoundary({
			withdraw: () => {},
			drain: async () => {
				throw new Error("checkpoint unavailable");
			},
			clear,
		});
		await owner.retire(false, undefined, "reauthenticate");
		expect(cleanup).not.toHaveBeenCalled();
		expect(clear).toHaveBeenCalledWith("reauthenticate");
		expect(
			await owner.admit("route-a", owner.getRevision(), undefined, null),
		).not.toBeNull();
		expect(cleanup).not.toHaveBeenCalled();
		await owner.retire();
		expect(cleanup).toHaveBeenCalledOnce();
		expect(clear).toHaveBeenCalledWith("retire");
	});
	it("synchronously closes captured composer/store callbacks before asynchronous proof", async () => {
		const owner = fixture().lifecycle();
		const auth = await owner.admit(
			"route-a",
			owner.getRevision(),
			undefined,
			"owner-a",
		);
		const write = vi.fn(async () => {});
		const dispatch = vi.fn(async () => {});
		const captured = scopedStore(
			{
				get: async () => "old",
				set: write,
				remove: async () => {},
				keys: async () => [],
			},
			auth?.scope ?? null,
		);
		owner.suspend();
		await expect(captured.set("draft", "private")).rejects.toThrow("closed");
		await expect(runCommandOperation(dispatch)).rejects.toThrow("Sign-out");
		expect(write).not.toHaveBeenCalled();
		expect(dispatch).not.toHaveBeenCalled();
		await owner.admit("route-a", owner.getRevision(), undefined, "owner-b");
		await expect(captured.set("draft", "private")).rejects.toThrow(
			"no admitted",
		);
	});
	it("reuses native generation without optional proof and rotates only on proven mismatch", async () => {
		const f = fixture();
		const owner = f.lifecycle();
		const policies: string[] = [];
		owner.configureRecoveryBoundary({
			withdraw: () => {},
			drain: async () => {},
			clear: async (policy) => {
				policies.push(policy);
			},
		});
		const first = await owner.admit(
			"route-a",
			owner.suspend(),
			undefined,
			"account-a/tenant-a",
		);
		const same = await owner.admit(
			"route-a",
			owner.suspend(),
			undefined,
			"account-a/tenant-a",
		);
		expect(same?.scope).toBe(first?.scope);
		const unproven = await owner.admit(
			"route-a",
			owner.suspend(),
			undefined,
			null,
		);
		expect(unproven?.scope).toBe(first?.scope);
		expect(policies).toEqual([]);
		await owner.admit(
			"route-a",
			owner.suspend(),
			undefined,
			"account-a/tenant-a",
		);
		policies.length = 0;
		const changed = await owner.admit(
			"route-a",
			owner.suspend(),
			undefined,
			"account-b/tenant-a",
		);
		expect(changed?.scope).not.toBe(unproven?.scope);
		expect(policies).toEqual(["retire"]);
	});

	it("drains sealed writes before unchanged purge and retains only the reauth vault", async () => {
		const f = fixture();
		const owner = f.lifecycle();
		const events: string[] = [];
		const gate = deferred();
		owner.configureRecoveryBoundary({
			withdraw: () => {
				events.push("withdraw");
			},
			drain: async () => {
				events.push("drain");
				await gate.promise;
			},
			clear: async (policy) => {
				events.push(`vault-${policy}`);
			},
		});
		owner.registerCleanup(async () => {
			events.push("ordinary-purge");
		});
		await owner.admit("route-a", owner.getRevision());
		const old = owner.get()?.scope;
		const retiring = owner.retire(false, undefined, "reauthenticate");
		expect(owner.get()).toBeNull();
		expect(events[0]).toBe("withdraw");
		await Promise.resolve();
		await Promise.resolve();
		expect(events).not.toContain("ordinary-purge");
		gate.resolve();
		await retiring;
		expect(events.indexOf("drain")).toBeLessThan(
			events.indexOf("ordinary-purge"),
		);
		expect(events.at(-1)).toBe("vault-reauthenticate");
		expect(await f.store.readStartupAuthorization()).toEqual({
			version: 1,
			state: "reauthenticate",
		});
		const recovered = await owner.admit("route-a", owner.getRevision());
		expect(recovered?.scope).not.toBe(old);
		expect(events).not.toContain("vault-retire");
	});
	it("attempts vault erasure even when ordinary cleanup fails and refuses admission", async () => {
		const f = fixture();
		const owner = f.lifecycle();
		const erase = vi.fn(async () => {});
		owner.configureRecoveryBoundary({
			withdraw: () => {},
			drain: async () => {},
			clear: erase,
		});
		owner.registerCleanup(async () => {
			throw new Error("ordinary purge denied");
		});
		await expect(owner.retire()).rejects.toThrow("ordinary purge denied");
		expect(erase).toHaveBeenCalledWith("retire");
		await expect(owner.admit("route-a", owner.getRevision())).rejects.toThrow(
			"ordinary purge denied",
		);
	});
	it("finishes mandatory cleanup before proof import and never publishes a late import", async () => {
		const f = fixture();
		const owner = f.lifecycle();
		const events: string[] = [];
		await owner.retire();
		owner.registerCleanup(async () => {
			events.push("purge");
		});
		const gate = deferred();
		const started = deferred();
		const admitting = owner.admit("route-a", owner.getRevision(), async () => {
			events.push("proof-import");
			started.resolve();
			await gate.promise;
		});
		await started.promise;
		expect(events).toEqual(["purge", "proof-import"]);
		owner.suspend();
		gate.resolve();
		expect(await admitting).toBeNull();
		expect(owner.get()).toBeNull();
	});
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
		// Recovery is separately sealed; stale generation/outbox families are
		// retired on the next authenticated admission, never by the 401 itself.
		expect(cleanup).toHaveBeenCalledOnce();
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

/**
 * R1-5: a `401` revokes the generation, so nothing written under it can be read
 * after the same route authenticates again. This pins the CONTRACT as it now reads
 * — quarantine, no automatic recovery — rather than a recovery path StageB has
 * not been approved for.
 */
describe("401 quarantine is not silently recovered", () => {
	it("mints a new generation and exposes nothing of the old one", async () => {
		const { lifecycle } = fixture();
		const life = lifecycle();
		const bytes = new Map<string, string>();
		const store = {
			get: async (key: string) => bytes.get(key) ?? null,
			set: async (key: string, value: string) => {
				bytes.set(key, value);
			},
			remove: async (key: string) => {
				bytes.delete(key);
			},
			keys: async () => [...bytes.keys()],
		};

		// `suspend()` is how a real caller abandons the previous attempt and takes a
		// fresh revision; admission is refused for any revision that is not current.
		const first = await life.admit("https://relay.example", life.suspend());
		await scopedStore(store, first?.scope ?? null).set(
			"lo-mobile-draft:session-a",
			"typed before the expiry",
		);
		expect(bytes.size).toBe(1);

		// What the provider does on a 401: revoke, keep the quarantine.
		await life.revoke();
		expect(getStartupAuthorization()).toBeNull();
		expect(bytes.size).toBe(1);

		const second = await life.admit("https://relay.example", life.suspend());
		expect(second?.scope).not.toBe(first?.scope);
		expect(
			await scopedStore(store, second?.scope ?? null).get(
				"lo-mobile-draft:session-a",
			),
		).toBeNull();
	});
});
