import { afterEach, describe, expect, it, vi } from "vitest";
import { createWarmSync, type WarmSyncScope } from "../warm-sync";

const deferred = <T>() => {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
};
const scope = (overrides: Partial<WarmSyncScope> = {}): WarmSyncScope => ({
	isActive: () => true,
	seed: vi.fn(async () => true),
	resolve: vi.fn(async () => "session-a"),
	...overrides,
});
afterEach(() => vi.useRealTimers());

describe("completion prefetch", () => {
	it("cold/locked and retired scopes make zero requests", async () => {
		const sync = createWarmSync();
		expect(await sync.received("handle")).toBe(false);
		expect(await sync.prefetch("session-a")).toBe(false);
		const live = scope({ isActive: () => false });
		sync.register(live);
		expect(await sync.received("handle")).toBe(false);
		expect(live.resolve).not.toHaveBeenCalled();
		expect(live.seed).not.toHaveBeenCalled();
	});
	it("single-flights a session and rate-limits successful seeds for 60 seconds", async () => {
		let now = 0;
		const pending = deferred<boolean>();
		const live = scope({ seed: vi.fn(() => pending.promise) });
		const sync = createWarmSync(() => now);
		sync.register(live);
		const first = sync.prefetch("session-a");
		expect(sync.prefetch("session-a")).toBe(first);
		pending.resolve(true);
		expect(await first).toBe(true);
		expect(live.seed).toHaveBeenCalledTimes(1);
		expect(await sync.prefetch("session-a")).toBe(false);
		now = 60_000;
		expect(await sync.prefetch("session-a")).toBe(true);
		expect(live.seed).toHaveBeenCalledTimes(2);
	});
	it("received and tap prefetch share one in-flight seed", async () => {
		const pending = deferred<boolean>();
		const live = scope({ seed: vi.fn(() => pending.promise) });
		const sync = createWarmSync();
		sync.register(live);
		const received = sync.received("handle");
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
		const tapped = sync.prefetch("session-a");
		pending.resolve(true);
		expect(await received).toBe(true);
		expect(await tapped).toBe(true);
		expect(live.seed).toHaveBeenCalledTimes(1);
	});
	it("failure is not rate limited", async () => {
		const live = scope({ seed: vi.fn(async () => false) });
		const sync = createWarmSync();
		sync.register(live);
		await sync.prefetch("session-a");
		await sync.prefetch("session-a");
		expect(live.seed).toHaveBeenCalledTimes(2);
	});
	it("onscreen sessions skip seeds and mounting supersedes a pending seed", async () => {
		let signal: AbortSignal | undefined;
		const live = scope({
			seed: vi.fn((_id, abort) => {
				signal = abort;
				return new Promise<boolean>(() => {});
			}),
		});
		const sync = createWarmSync();
		sync.register(live);
		const pending = sync.prefetch("session-a");
		await Promise.resolve();
		const close = sync.view("session-a");
		expect(signal?.aborted).toBe(true);
		expect(await pending).toBe(false);
		expect(await sync.prefetch("session-a")).toBe(false);
		close();
		expect(live.seed).toHaveBeenCalledTimes(1);
	});
	it("an onscreen token survives reconnect; its cleanup cannot remove a newer token", async () => {
		const sync = createWarmSync();
		const live = scope();
		sync.register(live);
		const old = sync.view("session-a");
		sync.register(scope());
		const current = sync.view("session-a");
		old();
		expect(await sync.prefetch("session-a")).toBe(false);
		current();
		expect(await sync.prefetch("session-a")).toBe(true);
	});
	it("budget times out without throwing and aborts the stream adapter", async () => {
		vi.useFakeTimers();
		let signal: AbortSignal | undefined;
		const sync = createWarmSync();
		sync.register(
			scope({
				seed: (_id, abort) => {
					signal = abort;
					return new Promise<boolean>(() => {});
				},
			}),
		);
		const pending = sync.prefetch("session-a", 25);
		await vi.advanceTimersByTimeAsync(25);
		expect(await pending).toBe(false);
		expect(signal?.aborted).toBe(true);
	});
	it("scope retirement aborts a seed and drops its late success without rate-limiting the next account", async () => {
		const saved = deferred<boolean>();
		let signal: AbortSignal | undefined;
		const sync = createWarmSync();
		const retire = sync.register(
			scope({
				seed: (_id, abort) => {
					signal = abort;
					return saved.promise;
				},
			}),
		);
		const pending = sync.prefetch("session-a");
		await Promise.resolve();
		retire();
		saved.resolve(true);
		expect(await pending).toBe(false);
		expect(signal?.aborted).toBe(true);
		const next = scope();
		sync.register(next);
		expect(await sync.prefetch("session-a")).toBe(true);
		expect(next.seed).toHaveBeenCalledTimes(1);
	});
	it("wrong-computer/unknown handles have no route or raw-session fallback", async () => {
		const live = scope({
			resolve: async () => {
				throw Error("404 unknown handle");
			},
		});
		const sync = createWarmSync();
		sync.register(live);
		expect(await sync.received("foreign-handle")).toBe(false);
		expect(live.seed).not.toHaveBeenCalled();
	});
	it("account switch during handle resolution never starts a seed", async () => {
		const resolved = deferred<string>();
		const live = scope({ resolve: () => resolved.promise });
		const sync = createWarmSync();
		sync.register(live);
		const pending = sync.received("handle");
		await Promise.resolve();
		sync.register(scope());
		resolved.resolve("session-a");
		expect(await pending).toBe(false);
		expect(live.seed).not.toHaveBeenCalled();
	});
	it("receipt resolution and seed share the 25 s total budget", async () => {
		vi.useFakeTimers();
		const resolved = deferred<string>();
		let signal: AbortSignal | undefined;
		const sync = createWarmSync();
		sync.register(
			scope({
				resolve: () => resolved.promise,
				seed: (_id, abort) => {
					signal = abort;
					return new Promise<boolean>(() => {});
				},
			}),
		);
		const pending = sync.received("handle");
		await vi.advanceTimersByTimeAsync(24_000);
		resolved.resolve("session-a");
		await vi.advanceTimersByTimeAsync(1_000);
		expect(await pending).toBe(false);
		expect(signal?.aborted).toBe(true);
	});
});

describe("attention warming on an admitted background route", () => {
	it("an onscreen skip can seed after backgrounding within the list's 60 s limit", async () => {
		const sync = createWarmSync();
		const refreshList = vi.fn(async () => true);
		const live = scope({
			background: {
				key: "account-a/route-a",
				matches: async () => true,
				refreshList,
			},
		});
		sync.register(live);
		const release = sync.view("last-viewed");
		const push = { reason: "attention" as const, computer: "opaque-computer" };
		expect(await sync.pushed(push)).toBe(true);
		expect(live.seed).not.toHaveBeenCalled();
		release();
		expect(await sync.pushed(push)).toBe(true);
		expect(refreshList).toHaveBeenCalledTimes(1);
		expect(live.seed).toHaveBeenCalledWith(
			"last-viewed",
			expect.any(AbortSignal),
		);
		expect(await sync.pushed(push)).toBe(false);
		expect(live.seed).toHaveBeenCalledTimes(1);
	});

	it("concurrent copies share the list/seed; a mismatched copy still fails the gate", async () => {
		const sync = createWarmSync();
		const held = deferred<boolean>();
		const refreshList = vi.fn(() => held.promise);
		const matches = vi.fn(async (computer: string) => computer === "correct");
		const live = scope({
			background: { key: "a/route", matches, refreshList },
		});
		sync.register(live);
		sync.view("last-viewed")();
		const first = sync.pushed({ reason: "attention", computer: "correct" });
		await vi.waitFor(() => expect(refreshList).toHaveBeenCalledTimes(1));
		const second = sync.pushed({ reason: "attention", computer: "correct" });
		expect(await sync.pushed({ reason: "attention", computer: "wrong" })).toBe(
			false,
		);
		held.resolve(true);
		expect(await first).toBe(true);
		expect(await second).toBe(true);
		expect(matches).toHaveBeenCalledTimes(3);
		expect(refreshList).toHaveBeenCalledTimes(1);
		expect(live.seed).toHaveBeenCalledTimes(1);
	});

	it("a new account cannot inherit the previous account's last-viewed conversation", async () => {
		const sync = createWarmSync();
		const background = {
			key: "account-a/route",
			matches: async () => true,
			refreshList: async () => true,
		};
		sync.register(scope({ background }));
		sync.view("private-to-a")();
		const b = scope({ background: { ...background, key: "account-b/route" } });
		sync.register(b);
		expect(
			await sync.pushed({ reason: "attention", computer: "b-handle" }),
		).toBe(true);
		expect(b.seed).not.toHaveBeenCalled();
	});
});
