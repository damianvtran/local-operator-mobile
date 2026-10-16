import { afterEach, expect, it, vi } from "vitest";
import { createResponseGate } from "./account-routing-gate.ts";

afterEach(() => vi.useRealTimers());
it("keeps real in-flight responses until the owner observes B, then releases all", async () => {
	vi.useFakeTimers();
	const gate = createResponseGate();
	const a = gate.wait(),
		b = gate.wait();
	expect(gate.pending).toBe(2);
	await vi.advanceTimersByTimeAsync(89999);
	expect(gate.pending).toBe(2);
	gate.release();
	expect(await a).toBe(true);
	expect(await b).toBe(true);
	expect(gate.pending).toBe(0);
	expect(vi.getTimerCount()).toBe(0);
});
it("expires at the exact90s boundary with no rejection or lease renewal", async () => {
	vi.useFakeTimers();
	const gate = createResponseGate();
	const result = gate.wait();
	await vi.advanceTimersByTimeAsync(90000);
	expect(await result).toBe(false);
	expect(gate.pending).toBe(0);
	expect(vi.getTimerCount()).toBe(0);
	gate.release();
	expect(gate.pending).toBe(0);
});
