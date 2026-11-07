import { describe, expect, it, vi } from "vitest";

import {
	createMeterStore,
	LEVEL_BARS,
	METER_FLOOR_DB,
	meterFraction,
	peakLevel,
	pushLevel,
	STATIC_PEAK_WINDOW,
	waveformBars,
} from "@/stt/levels";

describe("meterFraction", () => {
	it("maps the meter's window onto [0, 1]", () => {
		expect(meterFraction(0)).toBe(1);
		expect(meterFraction(METER_FLOOR_DB)).toBe(0);
		expect(meterFraction(METER_FLOOR_DB / 2)).toBeCloseTo(0.5, 5);
	});

	it("clamps beyond either end rather than extrapolating", () => {
		// A positive reading is over full scale, not 1.16 bars.
		expect(meterFraction(6)).toBe(1);
		expect(meterFraction(-120)).toBe(0);
	});

	it("reads a missing or broken instrument as silence, not as a mid level", () => {
		// The failure mode this guards: a reader speaking too quietly gets a full
		// meter because the reading was `undefined`, and the empty transcript that
		// follows reads as a bug in the app.
		expect(meterFraction(null)).toBe(0);
		expect(meterFraction(undefined)).toBe(0);
		expect(meterFraction(Number.NaN)).toBe(0);
		expect(meterFraction(Number.NEGATIVE_INFINITY)).toBe(0);
	});
});

describe("pushLevel", () => {
	it("keeps the last `bars` readings, oldest first", () => {
		expect(pushLevel([0.1, 0.2], 0.3, 3)).toEqual([0.1, 0.2, 0.3]);
		// A fourth reading drops the oldest, so the row scrolls instead of growing.
		expect(pushLevel([0.1, 0.2, 0.3], 0.4, 3)).toEqual([0.2, 0.3, 0.4]);
	});

	it("defaults to the meter's own bar count", () => {
		const full = Array.from({ length: LEVEL_BARS }, (_, i) => i / LEVEL_BARS);
		const next = pushLevel(full, 1);
		expect(next).toHaveLength(LEVEL_BARS);
		expect(next[LEVEL_BARS - 1]).toBe(1);
	});

	it("returns nothing for a zero-width meter", () => {
		expect(pushLevel([0.5], 0.5, 0)).toEqual([]);
	});
});

describe("createMeterStore", () => {
	it("hands out the SAME array identity until it changes", () => {
		// `useSyncExternalStore` compares snapshots by identity; a fresh array per
		// read is an infinite render loop, which is the whole hazard of this shape.
		const store = createMeterStore(4);
		const first = store.get();
		expect(store.get()).toBe(first);
		store.push(0.5);
		expect(store.get()).not.toBe(first);
	});

	it("notifies subscribers on every write, and stops after unsubscribe", () => {
		const store = createMeterStore(4);
		const listener = vi.fn();
		const unsubscribe = store.subscribe(listener);
		store.push(0.2);
		store.set([0.5]);
		expect(listener).toHaveBeenCalledTimes(2);
		unsubscribe();
		store.push(0.9);
		expect(listener).toHaveBeenCalledTimes(2);
	});

	it("bounds the history it keeps", () => {
		const store = createMeterStore(3);
		for (const level of [0.1, 0.2, 0.3, 0.4]) store.push(level);
		expect(store.get()).toEqual([0.2, 0.3, 0.4]);
	});
});

/* The rolling waveform (TestFlight 578, item 9). The meter draws exactly these
 * arrays; the roll itself is a UI-thread translate the Node runner cannot see. */
describe("waveformBars", () => {
	it("right-anchors a short history: the newest reading is always the last slot", () => {
		expect(waveformBars([0.2, 0.9], 4)).toEqual([0, 0, 0.2, 0.9]);
		expect(waveformBars([], 3)).toEqual([0, 0, 0]);
	});

	it("decimates a long history to the newest window — older speech has scrolled off", () => {
		expect(waveformBars([0.1, 0.2, 0.3, 0.4, 0.5], 3)).toEqual([0.3, 0.4, 0.5]);
	});

	it("draws one slot past the window (the bar sliding out) from the same history", () => {
		const history = Array.from(
			{ length: LEVEL_BARS },
			(_, i) => i / LEVEL_BARS,
		);
		const drawn = waveformBars(history, LEVEL_BARS + 1);
		expect(drawn).toHaveLength(LEVEL_BARS + 1);
		expect(drawn[0]).toBe(0);
		expect(drawn.slice(1)).toEqual(history);
	});

	it("clamps junk to the floor rather than painting it", () => {
		expect(waveformBars([Number.NaN, 2, -1], 3)).toEqual([0, 1, 0]);
		expect(waveformBars([0.5], 0)).toEqual([]);
	});
});

describe("peakLevel (the reduce-motion bar)", () => {
	it("holds the loudest of the newest readings, so the static bar does not flicker", () => {
		expect(peakLevel([0.9, 0.1, 0.2, 0.3, 0.4], 4)).toBe(0.4);
		expect(peakLevel([0.1, 0.7, 0.2], STATIC_PEAK_WINDOW)).toBe(0.7);
	});

	it("rests at 0 for silence, an empty take, or junk", () => {
		expect(peakLevel([])).toBe(0);
		expect(peakLevel([Number.NaN, Number.POSITIVE_INFINITY])).toBe(0);
		expect(peakLevel([0.5], 0)).toBe(0);
	});
});
