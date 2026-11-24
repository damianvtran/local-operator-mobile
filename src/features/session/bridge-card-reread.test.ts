import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BridgeCardBody } from "@/contracts";
import {
	BRIDGE_BODY_REREAD_STEADY_MS,
	bridgeBodyAnswerSettled,
	bridgeBodyRereadDelay,
	startBridgeBodyReread,
} from "@/features/session/bridge-card-reread";

/**
 * The card body's re-read policy (`bridge-card-reread.ts`). The defect it
 * fixes: a card read once while `pending` never showed the body that arrived
 * later. These pin which answers keep the card reading, the backoff, and the
 * three ways it stops (final answer, unmount, stale read).
 */
const answer = (...items: BridgeCardBody["items"]): BridgeCardBody => ({
	v: 1,
	items,
	more: 0,
});

describe("bridgeBodyAnswerSettled", () => {
	it.each([
		["a failed read", null],
		["pending", answer({ state: "pending" })],
		[
			"a transient hold",
			answer({ state: "held", hold: { class: "transient" } }),
		],
		[
			"a review hold",
			answer({ state: "held", hold: { class: "awaiting_review" } }),
		],
		["offline", answer({ state: "unavailable", reason: "offline" })],
		["not loaded", answer({ state: "unavailable", reason: "not_loaded" })],
		[
			"one pending item among admitted ones",
			answer({ state: "admitted", body: "a" }, { state: "pending" }),
		],
	])("keeps reading after %s", (_label, value) => {
		expect(bridgeBodyAnswerSettled(value)).toBe(false);
	});

	it.each([
		["admitted", answer({ state: "admitted", body: "hi" })],
		["refused", answer({ state: "refused" })],
		["not admitted", answer({ state: "not_admitted" })],
		["deleted", answer({ state: "unavailable", reason: "deleted" })],
		[
			"other account",
			answer({ state: "unavailable", reason: "other_account" }),
		],
		["signed out", answer({ state: "unavailable", reason: "signed_out" })],
		["not a member", answer({ state: "unavailable", reason: "not_member" })],
		[
			"hub unsupported",
			answer({ state: "unavailable", reason: "hub_unsupported" }),
		],
		// Fail quiet: an unknown state from a newer core never polls forever.
		["an unknown state", answer({ state: "quarantined_v9" })],
		["no items", answer()],
	])("stops after %s", (_label, value) => {
		expect(bridgeBodyAnswerSettled(value)).toBe(true);
	});
});

describe("bridgeBodyRereadDelay", () => {
	it("backs off 5, 10, 20, 30 s and then holds 60 s with no give-up", () => {
		expect([0, 1, 2, 3, 4, 5, 500].map(bridgeBodyRereadDelay)).toEqual([
			5_000, 10_000, 20_000, 30_000, 60_000, 60_000, 60_000,
		]);
		expect(BRIDGE_BODY_REREAD_STEADY_MS).toBe(60_000);
	});
});

describe("startBridgeBodyReread", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	const pending = answer({ state: "pending" });
	const admitted = answer({ state: "admitted", body: "the body" });

	it("re-reads a pending answer on the backoff until it is admitted, then stops", async () => {
		const queue: BridgeCardBody[] = [pending, pending, pending, admitted];
		const read = vi.fn(async () => queue.shift() ?? admitted);
		const seen: (BridgeCardBody | null)[] = [];
		startBridgeBodyReread(read, (a) => seen.push(a));
		await vi.advanceTimersByTimeAsync(0);
		expect(read).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(4_999);
		expect(read).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(read).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(10_000);
		expect(read).toHaveBeenCalledTimes(3);
		await vi.advanceTimersByTimeAsync(20_000);
		expect(read).toHaveBeenCalledTimes(4);
		expect(seen.at(-1)).toBe(admitted);
		// Final: no further reads however long the card stays mounted.
		await vi.advanceTimersByTimeAsync(10 * 60_000);
		expect(read).toHaveBeenCalledTimes(4);
	});

	it("keeps reading every 60 s past the backoff (no overall give-up)", async () => {
		const read = vi.fn(async () => pending);
		startBridgeBodyReread(read, () => {});
		await vi.advanceTimersByTimeAsync(0);
		await vi.advanceTimersByTimeAsync(5_000 + 10_000 + 20_000 + 30_000);
		expect(read).toHaveBeenCalledTimes(5);
		await vi.advanceTimersByTimeAsync(8 * 60 * 60_000);
		expect(read).toHaveBeenCalledTimes(5 + 8 * 60);
	});

	it("retries a failed read and a thrown read", async () => {
		const read = vi
			.fn<() => Promise<BridgeCardBody | null>>()
			.mockResolvedValueOnce(null)
			.mockRejectedValueOnce(new Error("link dropped"))
			.mockResolvedValue(admitted);
		const seen: (BridgeCardBody | null)[] = [];
		startBridgeBodyReread(read, (a) => seen.push(a));
		await vi.advanceTimersByTimeAsync(0);
		await vi.advanceTimersByTimeAsync(5_000 + 10_000);
		expect(seen).toEqual([null, null, admitted]);
	});

	it("stops on stop() and drops a read that settles afterwards", async () => {
		let resolve: (value: BridgeCardBody) => void = () => {};
		const read = vi.fn(
			() =>
				new Promise<BridgeCardBody>((r) => {
					resolve = r;
				}),
		);
		const onAnswer = vi.fn();
		const reread = startBridgeBodyReread(read, onAnswer);
		reread.stop();
		resolve(admitted);
		await vi.advanceTimersByTimeAsync(10 * 60_000);
		expect(onAnswer).not.toHaveBeenCalled();
		expect(read).toHaveBeenCalledTimes(1);
	});

	it("stops a pending backoff on stop()", async () => {
		const read = vi.fn(async () => pending);
		const reread = startBridgeBodyReread(read, () => {});
		await vi.advanceTimersByTimeAsync(0);
		reread.stop();
		await vi.advanceTimersByTimeAsync(10 * 60_000);
		expect(read).toHaveBeenCalledTimes(1);
	});

	it("wake() re-reads at once while non-final, and is a no-op once final", async () => {
		const queue: BridgeCardBody[] = [pending, admitted];
		const read = vi.fn(async () => queue.shift() ?? admitted);
		const reread = startBridgeBodyReread(read, () => {});
		await vi.advanceTimersByTimeAsync(0);
		reread.wake();
		await vi.advanceTimersByTimeAsync(0);
		expect(read).toHaveBeenCalledTimes(2);
		reread.wake();
		await vi.advanceTimersByTimeAsync(10 * 60_000);
		expect(read).toHaveBeenCalledTimes(2);
	});
});
