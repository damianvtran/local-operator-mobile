import { describe, expect, it, vi } from "vitest";
import type { RadientTokens } from "@/connection/radient-oauth";
import { createRadientAccess, RadientAccessError } from "./radient-access";

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}
const grant = (access = "old", expires_at = 0): RadientTokens => ({
	access,
	refresh: "rolling",
	expires_at,
	scope: "openid",
	token_type: "Bearer",
	account_label: null,
});
const invalid = new Error("invalid_grant");
function fixture(
	options: {
		refresh?: (tokens: RadientTokens) => Promise<RadientTokens>;
		write?: (tokens: RadientTokens) => Promise<void>;
	} = {},
) {
	// This is the provider's single grant owner, not a second copy in the accessor.
	let current: RadientTokens | null = grant();
	let durable: RadientTokens | null = current;
	let tail = Promise.resolve();
	const refresh = vi.fn(options.refresh ?? (async () => grant("fresh", 100)));
	const write = vi.fn(async (tokens: RadientTokens) => {
		await options.write?.(tokens);
		durable = tokens;
	});
	const clear = vi.fn(async () => {
		durable = null;
	});
	const serialize = (operation: () => Promise<void>) => {
		const next = tail.then(operation);
		tail = next;
		return next;
	};
	const manager = createRadientAccess({
		current: () => current,
		publish: (tokens) => {
			current = tokens;
		},
		refresh,
		write,
		clear,
		invalidGrant: (error) => error === invalid,
		serialize,
		now: () => 10,
	});
	return {
		manager,
		serialize,
		refresh,
		write,
		clear,
		current: () => current,
		durable: () => durable,
	};
}

describe("Radient access ownership", () => {
	it("spends one rolling refresh token for simultaneous callers", async () => {
		const pending = deferred<RadientTokens>();
		const f = fixture({ refresh: () => pending.promise });
		const one = f.manager.access();
		const two = f.manager.access();
		expect(f.refresh).toHaveBeenCalledTimes(1);
		pending.resolve(grant("fresh", 100));
		expect(await Promise.all([one, two])).toEqual(["fresh", "fresh"]);
		expect(f.write).toHaveBeenCalledTimes(1);
		expect(f.durable()?.access).toBe("fresh");
	});

	it.each(["success", "invalid_grant"])(
		"a late %s after sign-out cannot resurrect or clear a newer sign-in",
		async (result) => {
			const pending = deferred<RadientTokens>();
			const f = fixture({ refresh: () => pending.promise });
			const request = f.manager.access();
			await f.manager.retire();
			const next = grant("new-account", 100);
			f.manager.replace(next);
			await f.manager.persist(next);
			if (result === "success") pending.resolve(grant("old-rotation", 100));
			else pending.reject(invalid);
			expect(await request).toBeNull();
			expect(f.current()).toBe(next);
			expect(f.durable()).toBe(next);
			expect(f.clear).toHaveBeenCalledTimes(1);
		},
	);

	it("an invalid_grant from the previous sign-in never clears its replacement", async () => {
		const pending = deferred<RadientTokens>();
		const f = fixture({ refresh: () => pending.promise });
		const request = f.manager.access();
		const next = grant("new-account", 100);
		f.manager.replace(next);
		await f.manager.persist(next);
		pending.reject(invalid);
		expect(await request).toBeNull();
		expect(f.clear).not.toHaveBeenCalled();
		expect(f.durable()).toBe(next);
	});

	it("serializes a sign-out clear after an already-entered refresh write", async () => {
		const entered = deferred<void>();
		const finish = deferred<void>();
		const f = fixture({
			write: async () => {
				entered.resolve();
				await finish.promise;
			},
		});
		const request = f.manager.access();
		await entered.promise;
		const retired = f.manager.retire();
		expect(f.current()).toBeNull();
		expect(f.clear).not.toHaveBeenCalled();
		finish.resolve();
		await retired;
		expect(await request).toBeNull();
		expect(f.durable()).toBeNull();
	});

	it("queues a new sign-in after a pending refresh write and sign-out clear", async () => {
		const entered = deferred<void>();
		const finish = deferred<void>();
		let writes = 0;
		const f = fixture({
			write: async () => {
				if (++writes === 1) {
					entered.resolve();
					await finish.promise;
				}
			},
		});
		const request = f.manager.access();
		await entered.promise;
		const retired = f.manager.retire();
		const next = grant("new-account", 100);
		f.manager.replace(next);
		const saved = f.manager.persist(next);
		finish.resolve();
		await Promise.all([request, retired, saved]);
		expect(f.current()).toBe(next);
		expect(f.durable()).toBe(next);
	});

	it("retiring an active invalid grant clears memory and storage", async () => {
		const f = fixture({
			refresh: async () => {
				throw invalid;
			},
		});
		expect(await f.manager.access()).toBeNull();
		expect(f.current()).toBeNull();
		expect(f.durable()).toBeNull();
	});

	it("classifies transient failure, retains the grant and permits retry", async () => {
		const f = fixture({
			refresh: vi
				.fn()
				.mockRejectedValueOnce(new Error("offline"))
				.mockResolvedValueOnce(grant("fresh", 100)),
		});
		const held = f.current();
		await expect(f.manager.access()).rejects.toBeInstanceOf(RadientAccessError);
		expect(f.current()).toBe(held);
		expect(f.durable()).toBe(held);
		expect(f.clear).not.toHaveBeenCalled();
		expect(await f.manager.access()).toBe("fresh");
	});

	it("never returns expired grants without refresh, while a live grant needs no refresh", async () => {
		const f = fixture();
		f.manager.replace({ ...grant(), refresh: null });
		expect(await f.manager.access()).toBeNull();
		expect(await f.manager.access({ force: true })).toBeNull();
		f.manager.replace(grant("live", 100));
		expect(await f.manager.access()).toBe("live");
		expect(f.refresh).not.toHaveBeenCalled();
	});

	it("an old request's finally cannot evict the new account's single-flight", async () => {
		const old = deferred<RadientTokens>();
		const fresh = deferred<RadientTokens>();
		const f = fixture({
			refresh: vi
				.fn()
				.mockImplementationOnce(() => old.promise)
				.mockImplementationOnce(() => fresh.promise),
		});
		const first = f.manager.access();
		f.manager.replace(grant("new-account"));
		const second = f.manager.access();
		old.resolve(grant("stale", 100));
		await first;
		const third = f.manager.access();
		expect(f.refresh).toHaveBeenCalledTimes(2);
		fresh.resolve(grant("new-fresh", 100));
		expect(await Promise.all([second, third])).toEqual([
			"new-fresh",
			"new-fresh",
		]);
	});
});

describe("retirement bearer access", () => {
	it("refreshes an expired grant without publishing or writing it", async () => {
		const f = fixture();
		const held = f.current();
		expect(await f.manager.retirementAccess()).toBe("fresh");
		expect(f.current()).toBe(held);
		expect(f.durable()).toBe(held);
		expect(f.write).not.toHaveBeenCalled();
		expect(f.clear).not.toHaveBeenCalled();
	});

	it("finishes removal while the real serial retirement barrier awaits it, sharing the normal raw refresh", async () => {
		const refreshed = deferred<RadientTokens>();
		const entered = deferred<void>();
		const f = fixture({ refresh: () => refreshed.promise });
		// Normal HTTP refresh starts first, but its persistence will queue behind
		// sign-out's slot, exactly as NativeCredentialRetirement does in production.
		const normal = f.manager.access();
		const removing = f.manager.retirementAccess();
		const retired = f.serialize(async () => {
			entered.resolve();
			expect(await removing).toBe("fresh");
			f.manager.replace(null);
			await f.clear();
		});
		await entered.promise;
		refreshed.resolve(grant("fresh", 100));
		await retired;
		expect(await normal).toBeNull();
		expect(f.refresh).toHaveBeenCalledTimes(1);
		expect(f.write).not.toHaveBeenCalled();
		expect(f.clear).toHaveBeenCalledTimes(1);
		expect(f.durable()).toBeNull();
	});

	it("never queues invalid-grant clearing behind the retirement slot that awaits it", async () => {
		const pending = deferred<RadientTokens>();
		const entered = deferred<void>();
		const f = fixture({ refresh: () => pending.promise });
		const removing = f.manager.retirementAccess();
		const retired = f.serialize(async () => {
			entered.resolve();
			expect(await removing).toBeNull();
			expect(f.clear).not.toHaveBeenCalled();
			f.manager.replace(null);
			await f.clear();
		});
		await entered.promise;
		pending.reject(invalid);
		await retired;
		expect(f.clear).toHaveBeenCalledTimes(1);
		expect(f.write).not.toHaveBeenCalled();
	});

	it.each(["success", "invalid_grant"])(
		"disowns a retirement %s when a replacement account signs in",
		async (result) => {
			const pending = deferred<RadientTokens>();
			const f = fixture({ refresh: () => pending.promise });
			const removing = f.manager.retirementAccess();
			const replacement = grant("new-account", 100);
			f.manager.replace(replacement);
			await f.manager.persist(replacement);
			if (result === "success")
				pending.resolve(grant("old-account-fresh", 100));
			else pending.reject(invalid);
			expect(await removing).toBeNull();
			expect(f.current()).toBe(replacement);
			expect(f.durable()).toBe(replacement);
			expect(f.clear).not.toHaveBeenCalled();
			expect(f.write).toHaveBeenCalledTimes(1);
		},
	);

	it("does not spend a retired rolling token again when normal access follows removal refresh", async () => {
		const f = fixture();
		expect(await f.manager.retirementAccess()).toBe("fresh");
		expect(await f.manager.access()).toBe("fresh");
		expect(f.refresh).toHaveBeenCalledTimes(1);
		expect(f.write).toHaveBeenCalledTimes(1);
	});

	it("does not hand retirement a refreshed bearer that has already expired", async () => {
		const f = fixture({ refresh: async () => grant("expired-rotation", 5) });
		expect(await f.manager.retirementAccess()).toBeNull();
		expect(f.write).not.toHaveBeenCalled();
		expect(f.clear).not.toHaveBeenCalled();
	});

	it("returns only a live non-refreshable bearer and classifies transient refresh failures", async () => {
		const f = fixture({
			refresh: async () => {
				throw new Error("offline");
			},
		});
		await expect(f.manager.retirementAccess()).rejects.toBeInstanceOf(
			RadientAccessError,
		);
		f.manager.replace({ ...grant(), refresh: null });
		expect(await f.manager.retirementAccess()).toBeNull();
		f.manager.replace({ ...grant("live", 100), refresh: null });
		expect(await f.manager.retirementAccess()).toBe("live");
		expect(await f.manager.retirementAccess({ force: true })).toBeNull();
		expect(f.clear).not.toHaveBeenCalled();
		expect(f.write).not.toHaveBeenCalled();
	});
});
