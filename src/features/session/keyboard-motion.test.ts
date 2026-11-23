import { describe, expect, it } from "vitest";
import {
	frameAction,
	keyboardMotionHandlers,
	rideOffset,
	SETTLE_SNAP_LIMIT,
	settleDecision,
	settleOffset,
	shouldHoldLift,
} from "@/features/session/keyboard-motion";

describe("rideOffset", () => {
	it("is the native height verbatim, fractions included", () => {
		expect(rideOffset(336)).toBe(336);
		expect(rideOffset(0.5)).toBe(0.5);
	});

	it("never goes negative or non-finite", () => {
		/* A spring overshoot below rest, or a frame that is not a height. */
		expect(rideOffset(-1.5)).toBe(0);
		expect(rideOffset(Number.NaN)).toBe(0);
		expect(rideOffset(Number.POSITIVE_INFINITY)).toBe(0);
	});
});

describe("settleOffset", () => {
	it("snaps a sub-2 pt mismatch to the settled overlap", () => {
		expect(settleOffset(335.4, 336)).toBe(336);
		expect(settleOffset(336.6, 336)).toBe(336);
		expect(settleOffset(1.99 + 100, 100)).toBe(100);
	});

	it("does not snap at the 2 pt boundary or beyond", () => {
		expect(SETTLE_SNAP_LIMIT).toBe(2);
		expect(settleOffset(334, 336)).toBe(334);
		expect(settleOffset(338, 336)).toBe(338);
		expect(settleOffset(100, 336)).toBe(100);
	});

	it("keeps an exact match exactly", () => {
		expect(settleOffset(336, 336)).toBe(336);
	});

	it("leaves a stale target alone (Android: didShow lands after onEnd)", () => {
		/* Show: the motion ended at 336 while the store still holds 0. */
		expect(settleOffset(336, 0)).toBe(336);
		/* Hide: the motion ended at 0 while the store still holds the old 336. */
		expect(settleOffset(0, 336)).toBe(0);
	});
});

describe("shouldHoldLift", () => {
	it("holds when the motion's destination is another whole point", () => {
		expect(shouldHoldLift(0, 336)).toBe(true);
		expect(shouldHoldLift(336, 0)).toBe(true);
		expect(shouldHoldLift(336, 291)).toBe(true);
	});

	it("does not hold a motion that ends where the lift already is", () => {
		expect(shouldHoldLift(336, 336)).toBe(false);
		expect(shouldHoldLift(335.6, 336)).toBe(false);
		expect(shouldHoldLift(0, 0)).toBe(false);
		/* A destination that is not a height is a 0 lift (`rideOffset`). */
		expect(shouldHoldLift(0, Number.NaN)).toBe(false);
		expect(shouldHoldLift(0, -1)).toBe(false);
	});
});

describe("frameAction", () => {
	it("tweens when no library motion runs, holds while one does", () => {
		expect(frameAction(true, false)).toBe("tween");
		expect(frameAction(true, true)).toBe("hold");
	});

	it("always applies a hidden frame, so a motion that never ended is freed", () => {
		expect(frameAction(false, false)).toBe("snap");
		expect(frameAction(false, true)).toBe("snap");
	});
});

describe("settleDecision", () => {
	it("brings the offset to a held frame's overlap whatever the delta", () => {
		/* iPad floating keyboard: the library's final height is the keyboard
		 *  VIEW's frame (198), the store's overlap is window - screenY (168). */
		expect(
			settleDecision({
				current: 198,
				target: 168,
				frameSeenDuringMotion: true,
			}),
		).toBe(168);
		expect(
			settleDecision({ current: 0, target: 336, frameSeenDuringMotion: true }),
		).toBe(336);
	});

	it("without a held frame it is `settleOffset`: snaps under 2 pt, else leaves it", () => {
		const unheld = (current: number, target: number) =>
			settleDecision({ current, target, frameSeenDuringMotion: false });
		expect(unheld(335.4, 336)).toBe(336);
		expect(unheld(198, 168)).toBe(198);
		/* The stale Android target: show ended at 336 while the store holds 0. */
		expect(unheld(336, 0)).toBe(336);
		expect(unheld(0, 336)).toBe(0);
	});
});

/** The handlers, driven against plain objects: what the UI runtime would do with
 *  shared values, `cancelAnimation` and `runOnJS`, recorded in order. */
const rig = (offset = 0) => {
	const log: string[] = [];
	const keyboardOffset = { value: offset };
	const motionActive = { value: false };
	/* `runOnJS` defers: the JS function runs after the worklet, never inside it. */
	const queued: (() => void)[] = [];
	const handlers = keyboardMotionHandlers({
		keyboardOffset,
		motionActive,
		cancelAnimation: (value) => {
			log.push(`cancel@${value.value}`);
		},
		runOnJS: (fn) => () => {
			queued.push(fn);
		},
		holdLift: () => {
			log.push("hold");
		},
		settleLift: () => {
			log.push("settle");
		},
	});
	const flush = () => {
		for (const fn of queued.splice(0)) fn();
	};
	return { handlers, keyboardOffset, motionActive, log, flush };
};

describe("keyboardMotionHandlers", () => {
	it("a show: owns the offset, rides each frame, lands, then settles on JS", () => {
		const { handlers, keyboardOffset, motionActive, log, flush } = rig();
		handlers.onStart({ height: 336 });
		expect(motionActive.value).toBe(true);
		expect(log).toEqual(["cancel@0"]);
		flush();
		expect(log).toEqual(["cancel@0", "hold"]);
		handlers.onMove({ height: 120.5 });
		expect(keyboardOffset.value).toBe(120.5);
		handlers.onMove({ height: 301 });
		expect(keyboardOffset.value).toBe(301);
		handlers.onEnd({ height: 336 });
		expect(keyboardOffset.value).toBe(336);
		expect(motionActive.value).toBe(false);
		/* The settle is deferred to the JS thread, after the worklet returned. */
		expect(log).toEqual(["cancel@0", "hold"]);
		flush();
		expect(log).toEqual(["cancel@0", "hold", "settle"]);
	});

	it("a hide: reports the lift from the destination and lands on 0", () => {
		const { handlers, keyboardOffset, motionActive, log, flush } = rig(336);
		handlers.onStart({ height: 0 });
		flush();
		expect(log).toEqual(["cancel@336", "hold"]);
		handlers.onMove({ height: 40 });
		handlers.onEnd({ height: 0 });
		flush();
		expect(keyboardOffset.value).toBe(0);
		expect(motionActive.value).toBe(false);
		expect(log.at(-1)).toBe("settle");
	});

	it("a cancelled motion: a second start takes the offset where the first left it", () => {
		const { handlers, keyboardOffset, motionActive, log, flush } = rig();
		handlers.onStart({ height: 336 });
		handlers.onMove({ height: 200 });
		/* The user dismisses mid-show: the library starts the hide, no onEnd between. */
		handlers.onStart({ height: 0 });
		flush();
		expect(log).toEqual(["cancel@0", "cancel@200", "hold", "hold"]);
		expect(motionActive.value).toBe(true);
		handlers.onMove({ height: 90 });
		handlers.onEnd({ height: 0 });
		flush();
		expect(keyboardOffset.value).toBe(0);
		expect(motionActive.value).toBe(false);
	});

	it("Android order: the lift is reported at onStart, before onEnd and any store frame", () => {
		/* The store's `keyboardDidShow` has not landed, so nothing here can see a
		 *  target; the destination alone raises the lift, and only once per
		 *  motion even if the offset already equals it by onEnd. */
		const { handlers, keyboardOffset, log, flush } = rig();
		handlers.onStart({ height: 336 });
		flush();
		handlers.onMove({ height: 336 });
		handlers.onEnd({ height: 336 });
		flush();
		expect(keyboardOffset.value).toBe(336);
		expect(log.filter((entry) => entry === "hold")).toHaveLength(1);
		expect(log.indexOf("hold")).toBeLessThan(log.indexOf("settle"));
	});

	it("a motion that ends where it began raises no lift", () => {
		const { handlers, log, flush } = rig(336);
		handlers.onStart({ height: 336 });
		handlers.onEnd({ height: 336 });
		flush();
		expect(log).toEqual(["cancel@336", "settle"]);
	});

	it("never writes a height that is not one", () => {
		const { handlers, keyboardOffset } = rig(100);
		handlers.onMove({ height: -3 });
		expect(keyboardOffset.value).toBe(0);
		handlers.onMove({ height: 50 });
		handlers.onEnd({ height: Number.NaN });
		expect(keyboardOffset.value).toBe(0);
	});
});

describe("a motion with the keyboard store's frames, end to end", () => {
	/* The component's subscriber and `settleLift`, reduced to the pure decisions
	 *  they make, over the same handlers. */
	const run = (events: ("start" | "move" | "end" | "show" | "hide")[]) => {
		const { handlers, keyboardOffset, motionActive } = rig();
		let seen = false;
		let target = 0;
		for (const event of events) {
			if (event === "start") handlers.onStart({ height: 198 });
			if (event === "move") handlers.onMove({ height: 100 });
			if (event === "end") {
				handlers.onEnd({ height: 198 });
				keyboardOffset.value = settleDecision({
					current: keyboardOffset.value,
					target,
					frameSeenDuringMotion: seen,
				});
				seen = false;
			}
			if (event === "show" || event === "hide") {
				target = event === "show" ? 168 : 0;
				const action = frameAction(event === "show", motionActive.value);
				if (action === "snap") {
					motionActive.value = false;
					seen = false;
					keyboardOffset.value = 0;
				}
				if (action === "hold") seen = true;
				if (action === "tween") keyboardOffset.value = target;
			}
		}
		return { offset: keyboardOffset.value, active: motionActive.value };
	};

	it("iOS iPad: the frame lands during the motion and the 198 vs 168 gap is repaired", () => {
		expect(run(["start", "show", "move", "end"])).toEqual({
			offset: 168,
			active: false,
		});
	});

	it("Android: the frame lands after onEnd, so the library's end is left to the tween", () => {
		/* At end the target is the previous keyboard's (0): untouched at 198; the
		 *  store's tween then carries the offset to the frame's overlap. */
		expect(run(["start", "move", "end"])).toEqual({
			offset: 198,
			active: false,
		});
		expect(run(["start", "move", "end", "show"])).toEqual({
			offset: 168,
			active: false,
		});
	});

	it("a stuck motion (onStart, no onEnd) is freed by the next hidden frame", () => {
		expect(run(["start", "move"]).active).toBe(true);
		expect(run(["start", "move", "hide"])).toEqual({
			offset: 0,
			active: false,
		});
	});
});
