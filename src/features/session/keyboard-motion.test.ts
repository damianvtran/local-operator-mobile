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
	const interactive = { value: false };
	/* `runOnJS` defers: the JS function runs after the worklet, never inside it. */
	const queued: (() => void)[] = [];
	const handlers = keyboardMotionHandlers({
		keyboardOffset,
		motionActive,
		interactive,
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
	return { handlers, keyboardOffset, motionActive, interactive, log, flush };
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

	describe("onInteractive (a finger drags the keyboard)", () => {
		it("rides the frame's height, owns the offset and raises the lift once", () => {
			const {
				handlers,
				keyboardOffset,
				motionActive,
				interactive,
				log,
				flush,
			} = rig(336);
			/* The first frame is within a point of the offset: the lift must still be
			 *  raised, which `shouldHoldLift` alone would not do. */
			handlers.onInteractive({ height: 335.5 });
			expect(keyboardOffset.value).toBe(335.5);
			expect(motionActive.value).toBe(true);
			expect(interactive.value).toBe(true);
			handlers.onInteractive({ height: 280 });
			handlers.onInteractive({ height: 120.25 });
			expect(keyboardOffset.value).toBe(120.25);
			flush();
			expect(log).toEqual(["cancel@336", "hold"]);
		});

		it("never writes a height that is not one", () => {
			const { handlers, keyboardOffset } = rig(336);
			handlers.onInteractive({ height: -8 });
			expect(keyboardOffset.value).toBe(0);
			handlers.onInteractive({ height: Number.NaN });
			expect(keyboardOffset.value).toBe(0);
		});

		it("takes the offset from a tween already running (cancel, then write)", () => {
			const { handlers, log } = rig(250);
			handlers.onInteractive({ height: 240 });
			expect(log[0]).toBe("cancel@250");
		});

		it("a library motion supersedes the drag: a dismissal's onStart ends `interactive`", () => {
			const { handlers, motionActive, interactive } = rig(336);
			handlers.onInteractive({ height: 90 });
			handlers.onStart({ height: 0 });
			expect(interactive.value).toBe(false);
			expect(motionActive.value).toBe(true);
		});

		it("onEnd clears both flags (Android: the gesture's own end)", () => {
			const { handlers, motionActive, interactive, keyboardOffset } = rig(336);
			handlers.onStart({ height: 336 });
			handlers.onInteractive({ height: 100 });
			handlers.onEnd({ height: 0 });
			expect(interactive.value).toBe(false);
			expect(motionActive.value).toBe(false);
			expect(keyboardOffset.value).toBe(0);
		});

		it("a new drag after a finished one raises the lift again", () => {
			const { handlers, log, flush } = rig(336);
			handlers.onInteractive({ height: 300 });
			handlers.onEnd({ height: 336 });
			handlers.onInteractive({ height: 310 });
			flush();
			expect(log.filter((entry) => entry === "hold")).toHaveLength(2);
		});
	});
});

describe("a motion with the keyboard store's frames, end to end", () => {
	/* The component's subscriber and `settleLift`, reduced to the pure decisions
	 *  they make, over the same handlers. */
	const run = (
		events: (
			| "start"
			| "move"
			| "end"
			| "show"
			| "hide"
			| "drag"
			| "dragUp"
			| "dismissStart"
			| "release"
			| "releaseDown"
		)[],
		/** The keyboard's offset when the sequence begins. */
		begin = 0,
	) => {
		const { handlers, keyboardOffset, motionActive, interactive } = rig(begin);
		let seen = false;
		let target = begin;
		/* The component's store subscriber, reduced to the decisions it makes. */
		const storeFrame = (visible: boolean, overlap: number) => {
			target = visible ? overlap : 0;
			const action = frameAction(
				visible,
				motionActive.value,
				interactive.value,
			);
			if (action === "snap") {
				motionActive.value = false;
				interactive.value = false;
				seen = false;
				keyboardOffset.value = 0;
				return;
			}
			if (action === "hold") {
				seen = true;
				return;
			}
			if (interactive.value) {
				interactive.value = false;
				motionActive.value = false;
			}
			keyboardOffset.value = target;
		};
		for (const event of events) {
			if (event === "start") handlers.onStart({ height: 198 });
			if (event === "move") handlers.onMove({ height: 100 });
			if (event === "drag") handlers.onInteractive({ height: 100 });
			if (event === "dragUp") handlers.onInteractive({ height: 320 });
			/* iOS: the system's `keyboardWillChangeFrame` at release. A cancel ends
			 *  at the open keyboard, a dismissal at 0 (the store keeps `visible`). */
			if (event === "release") storeFrame(true, 336);
			if (event === "releaseDown") storeFrame(true, 0);
			/* The library's own hide motion after a dismissal's release. */
			if (event === "dismissStart") handlers.onStart({ height: 0 });
			if (event === "end") {
				handlers.onEnd({ height: 198 });
				keyboardOffset.value = settleDecision({
					current: keyboardOffset.value,
					target,
					frameSeenDuringMotion: seen,
				});
				seen = false;
			}
			if (event === "show") storeFrame(true, 168);
			if (event === "hide") storeFrame(false, 0);
		}
		return {
			offset: keyboardOffset.value,
			active: motionActive.value,
			interactive: interactive.value,
		};
	};

	it("iOS iPad: the frame lands during the motion and the 198 vs 168 gap is repaired", () => {
		expect(run(["start", "show", "move", "end"])).toEqual({
			offset: 168,
			active: false,
			interactive: false,
		});
	});

	it("Android: the frame lands after onEnd, so the library's end is left to the tween", () => {
		/* At end the target is the previous keyboard's (0): untouched at 198; the
		 *  store's tween then carries the offset to the frame's overlap. */
		expect(run(["start", "move", "end"])).toEqual({
			offset: 198,
			active: false,
			interactive: false,
		});
		expect(run(["start", "move", "end", "show"])).toEqual({
			offset: 168,
			active: false,
			interactive: false,
		});
	});

	it("a stuck motion (onStart, no onEnd) is freed by the next hidden frame", () => {
		expect(run(["start", "move"]).active).toBe(true);
		expect(run(["start", "move", "hide"])).toEqual({
			offset: 0,
			active: false,
			interactive: false,
		});
	});

	describe("a finger drag (PR C)", () => {
		it("a drag holds the offset at the finger's keyboard, flags set", () => {
			expect(run(["drag"], 336)).toEqual({
				offset: 100,
				active: true,
				interactive: true,
			});
		});

		it("release back up (cancel): no library event follows, the store's frame carries the offset home", () => {
			/* The strand this prevents: iOS emits no `onEnd` for a spring-back, so a
			 *  held frame would leave the composer at the last drag height. */
			expect(run(["drag", "dragUp", "release"], 336)).toEqual({
				offset: 336,
				active: false,
				interactive: false,
			});
		});

		it("release past the threshold: the frame starts the way down, onStart takes it over, onEnd lands on 0", () => {
			expect(run(["drag", "releaseDown", "dismissStart"], 336)).toEqual({
				offset: 0,
				active: true,
				interactive: false,
			});
			expect(
				run(["drag", "releaseDown", "dismissStart", "move", "end"], 336).active,
			).toBe(false);
		});

		it("the hidden frame after a dismissal snaps to 0 and frees every flag", () => {
			expect(run(["drag", "releaseDown", "dismissStart", "hide"], 336)).toEqual(
				{ offset: 0, active: false, interactive: false },
			);
		});

		it("a drag whose release never arrives is freed by the hidden frame", () => {
			expect(run(["drag", "hide"], 336)).toEqual({
				offset: 0,
				active: false,
				interactive: false,
			});
		});

		it("a drag cancelled and re-dragged keeps riding, flags consistent", () => {
			expect(run(["drag", "release", "drag"], 336)).toEqual({
				offset: 100,
				active: true,
				interactive: true,
			});
		});

		it("without `interactive` a store frame would be held: the very strand", () => {
			expect(frameAction(true, true, false)).toBe("hold");
			expect(frameAction(true, true, true)).toBe("tween");
			expect(frameAction(false, true, true)).toBe("snap");
			expect(frameAction(true, false, true)).toBe("tween");
		});
	});
});
