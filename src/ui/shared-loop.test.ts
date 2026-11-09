import { describe, expect, it, vi } from "vitest";

import { createSharedLoop } from "@/ui/shared-loop";

/**
 * The skeleton's pulse is ONE loop for every bar on screen (performance audit
 * P6): the counting is what decides whether N skeletons cost one animation or
 * N, and whether the last one to unmount leaves a loop running for nobody.
 */
describe("a shared loop", () => {
	const driver = () => ({ start: vi.fn(), stop: vi.fn() });

	it("starts once for any number of users and stops with the last", () => {
		const d = driver();
		const loop = createSharedLoop(d);
		const releaseA = loop.retain();
		const releaseB = loop.retain();
		const releaseC = loop.retain();
		expect(d.start).toHaveBeenCalledTimes(1);
		expect(loop.users()).toBe(3);

		releaseA();
		releaseB();
		expect(d.stop).not.toHaveBeenCalled();
		releaseC();
		expect(d.stop).toHaveBeenCalledTimes(1);
		expect(loop.users()).toBe(0);
	});

	it("does not stop a loop others still use when one cleanup runs twice", () => {
		// A strict-mode double invoke or a fast refresh runs a cleanup again.
		const d = driver();
		const loop = createSharedLoop(d);
		const releaseA = loop.retain();
		loop.retain();
		releaseA();
		releaseA();
		expect(loop.users()).toBe(1);
		expect(d.stop).not.toHaveBeenCalled();
	});

	it("starts again after it has fully stopped", () => {
		const d = driver();
		const loop = createSharedLoop(d);
		loop.retain()();
		loop.retain();
		expect(d.start).toHaveBeenCalledTimes(2);
		expect(d.stop).toHaveBeenCalledTimes(1);
	});
});
