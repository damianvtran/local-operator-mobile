import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type AppStateSeam, startGuardRefresh } from "./guard-refresh";

/** An AppState double the test can flip, with the listener bookkeeping a leak
 *  check needs (a removed subscription must not be called again). */
function appState(initial: string) {
	const listeners = new Set<(state: string) => void>();
	const seam: AppStateSeam = {
		currentState: initial,
		addEventListener: (_type, listener) => {
			listeners.add(listener);
			return { remove: () => void listeners.delete(listener) };
		},
	};
	return {
		seam,
		listeners,
		set: (state: string) => {
			seam.currentState = state;
			for (const listener of [...listeners]) listener(state);
		},
	};
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("the Guard refresh schedule", () => {
	it("ticks once per period while the app is in the foreground", () => {
		const refresh = vi.fn();
		const app = appState("active");
		const stop = startGuardRefresh(refresh, {
			appState: app.seam,
			intervalMs: 1000,
		});
		expect(refresh).not.toHaveBeenCalled(); // the first read is activate()'s
		vi.advanceTimersByTime(3500);
		expect(refresh).toHaveBeenCalledTimes(3);
		stop();
	});

	it("a re-start (screen refocused) reads once immediately", () => {
		const refresh = vi.fn();
		const stop = startGuardRefresh(refresh, {
			appState: appState("active").seam,
			intervalMs: 1000,
			immediate: true,
		});
		expect(refresh).toHaveBeenCalledTimes(1);
		stop();
	});

	it("does not poll in the background, and reads once when the app returns", () => {
		const refresh = vi.fn();
		const app = appState("background");
		const stop = startGuardRefresh(refresh, {
			appState: app.seam,
			intervalMs: 1000,
		});
		vi.advanceTimersByTime(10_000);
		expect(refresh).not.toHaveBeenCalled();
		app.set("active");
		expect(refresh).toHaveBeenCalledTimes(1); // the foreground read
		vi.advanceTimersByTime(2100);
		expect(refresh).toHaveBeenCalledTimes(3);
		app.set("inactive");
		vi.advanceTimersByTime(10_000);
		expect(refresh).toHaveBeenCalledTimes(3); // stopped again
		stop();
	});

	it("cleanup stops the timer and removes the listener (no leak, no late tick)", () => {
		const refresh = vi.fn();
		const app = appState("active");
		const stop = startGuardRefresh(refresh, {
			appState: app.seam,
			intervalMs: 1000,
		});
		stop();
		expect(app.listeners.size).toBe(0);
		vi.advanceTimersByTime(10_000);
		expect(refresh).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});
});
