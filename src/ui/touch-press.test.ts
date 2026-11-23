import { describe, expect, it, vi } from "vitest";

import {
	createTouchPress,
	LONG_PRESS_DELAY_MS,
	LONG_PRESS_SLOP_PT,
	type TimerApi,
} from "@/ui/touch-press";

/** A fake clock: `tick` runs every timer that is due, in order. */
function clock() {
	let now = 0;
	let next = 1;
	const pending = new Map<number, { at: number; run: () => void }>();
	const timers: TimerApi = {
		set: (run, ms) => {
			const id = next++;
			pending.set(id, { at: now + ms, run });
			return id;
		},
		clear: (id) => {
			pending.delete(id as number);
		},
	};
	const tick = (ms: number) => {
		now += ms;
		for (const [id, timer] of [...pending]) {
			if (timer.at <= now) {
				pending.delete(id);
				timer.run();
			}
		}
	};
	return { timers, tick, pending };
}

const setup = (options: { press?: boolean; long?: boolean } = {}) => {
	const { timers, tick, pending } = clock();
	const onPress = vi.fn();
	const onLongPress = vi.fn();
	const machine = createTouchPress(
		() => ({
			onPress: options.press === false ? undefined : onPress,
			onLongPress: options.long === false ? undefined : onLongPress,
		}),
		timers,
	);
	return { machine, tick, pending, onPress, onLongPress };
};

describe("touch press: a hold read from raw touches, never a responder claim", () => {
	it("fires the long press once after the delay, and not the press on release", () => {
		const { machine, tick, onPress, onLongPress } = setup();
		machine.start(10, 10, 1);
		tick(LONG_PRESS_DELAY_MS - 1);
		expect(onLongPress).not.toHaveBeenCalled();
		tick(1);
		expect(onLongPress).toHaveBeenCalledTimes(1);
		machine.end();
		expect(onPress).not.toHaveBeenCalled();
		tick(5000);
		expect(onLongPress).toHaveBeenCalledTimes(1);
	});

	it("a short tap is a press and never a long press", () => {
		const { machine, tick, pending, onPress, onLongPress } = setup();
		machine.start(10, 10, 1);
		tick(100);
		machine.end();
		expect(onPress).toHaveBeenCalledTimes(1);
		expect(pending.size).toBe(0);
		tick(5000);
		expect(onLongPress).not.toHaveBeenCalled();
	});

	it("a drag past the slop is a scroll: no long press, no press", () => {
		const { machine, tick, pending, onPress, onLongPress } = setup();
		machine.start(10, 10, 1);
		machine.move(10 + LONG_PRESS_SLOP_PT + 1, 10, 1);
		expect(pending.size).toBe(0);
		tick(5000);
		machine.end();
		expect(onLongPress).not.toHaveBeenCalled();
		expect(onPress).not.toHaveBeenCalled();
	});

	it("drift inside the slop keeps the hold alive", () => {
		const { machine, tick, onLongPress } = setup();
		machine.start(10, 10, 1);
		machine.move(10 + LONG_PRESS_SLOP_PT, 10, 1);
		tick(LONG_PRESS_DELAY_MS);
		expect(onLongPress).toHaveBeenCalledTimes(1);
	});

	it("touchCancel (a scroll took the touch) ends the hold and the press", () => {
		const { machine, tick, pending, onPress, onLongPress } = setup();
		machine.start(10, 10, 1);
		machine.cancel();
		expect(pending.size).toBe(0);
		tick(5000);
		machine.end();
		expect(onLongPress).not.toHaveBeenCalled();
		expect(onPress).not.toHaveBeenCalled();
	});

	it("a second finger is a pinch or scroll, never a hold", () => {
		const first = setup();
		first.machine.start(10, 10, 2);
		first.tick(5000);
		expect(first.onLongPress).not.toHaveBeenCalled();

		const second = setup();
		second.machine.start(10, 10, 1);
		second.machine.move(10, 10, 2);
		second.tick(5000);
		expect(second.onLongPress).not.toHaveBeenCalled();
	});

	it("a new touch restarts the clock rather than inheriting the old one", () => {
		const { machine, tick, onLongPress } = setup();
		machine.start(10, 10, 1);
		tick(400);
		machine.cancel();
		machine.start(10, 10, 1);
		tick(400);
		expect(onLongPress).not.toHaveBeenCalled();
		tick(100);
		expect(onLongPress).toHaveBeenCalledTimes(1);
	});

	it("arms no timer when nobody listens for a long press", () => {
		const { machine, pending, onPress } = setup({ long: false });
		machine.start(10, 10, 1);
		expect(pending.size).toBe(0);
		machine.end();
		expect(onPress).toHaveBeenCalledTimes(1);
	});

	it("reads the CURRENT handlers when the timer fires", () => {
		const { timers, tick } = clock();
		const first = vi.fn();
		const second = vi.fn();
		let current = first;
		const machine = createTouchPress(() => ({ onLongPress: current }), timers);
		machine.start(0, 0, 1);
		current = second;
		tick(LONG_PRESS_DELAY_MS);
		expect(first).not.toHaveBeenCalled();
		expect(second).toHaveBeenCalledTimes(1);
	});
});
