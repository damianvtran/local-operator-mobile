/**
 * The decisions the composer's keyboard-controller driver makes, as pure
 * functions, and the three handlers that carry them out (`keyboardMotionHandlers`):
 * what a per-frame keyboard height does to the lift (`rideOffset`), whether a
 * motion is a lift (`shouldHoldLift`), what the keyboard store's frame does while
 * a motion runs (`frameAction`) and where the lift rests when it ends
 * (`settleDecision`, `settleOffset`).
 *
 * WHY HERE. The handlers that call these run on reanimated's UI runtime, where
 * a call is legal only into another worklet (`composer-worklets.test.ts` is the
 * story of the launch crash a plain callee causes). `rideOffset` is called from
 * the UI-thread handlers, so it carries `"worklet"`. `settleOffset` runs on the
 * JS thread after `runOnJS`, but is marked too so a later move of that call into
 * a worklet cannot reproduce the crash. Both are free of imports and closures: a
 * worklet's closure is serialised, and a captured module has nothing to carry.
 */

/** Below this many points a finished motion and the settled overlap are the
 *  same frame measured twice (rounding of a native float against the integer
 *  overlap the store publishes), so landing on the overlap is invisible. At or
 *  above it, the two are DIFFERENT keyboards — see `settleOffset`. */
export const SETTLE_SNAP_LIMIT = 2;

/**
 * The lift for one keyboard frame. The native height is the lift verbatim; the
 * guard is for a frame that is not a height at all (the library reports
 * `NaN`-free numbers today, but an overshoot spring can dip a hair below 0 and a
 * negative lift would pull the composer DOWN through the safe-area padding).
 */
export const rideOffset = (height: number): number => {
	"worklet";
	return Number.isFinite(height) && height > 0 ? height : 0;
};

/**
 * Where the lift should rest once the library's motion has ended: the settled
 * overlap when `current` is within `SETTLE_SNAP_LIMIT` of it, otherwise `current`
 * untouched.
 *
 * NEVER SNAP A LARGE DELTA. On Android the keyboard store's `keyboardDidShow`
 * arrives AFTER the library's `onEnd` (the store has no `willShow` there), so at
 * `onEnd` the target is still the PREVIOUS keyboard's: 0 on a show, the old
 * height on a hide. Snapping to it would drop the composer to the floor and let
 * it climb back when the real frame lands. Leaving the offset alone is always
 * safe, since the store's own timed lift follows once its frame does, from where
 * the motion stopped.
 */
export const settleOffset = (current: number, target: number): number => {
	"worklet";
	const delta = Math.abs(current - target);
	return delta > 0 && delta < SETTLE_SNAP_LIMIT ? target : current;
};

/**
 * Whether a motion that is starting is a LIFT, so the screen must freeze its
 * transcript slack until the settled box is published (`onLift(true)`, PR #230
 * M2). `destination` is the `height` the library's `onStart` reports: the
 * DESTINATION of the motion, not where it is now.
 *
 * WHY THE DESTINATION AND NOT `liftTarget`. On Android the store's frame
 * (`keyboardDidShow`) lands AFTER the library's `onEnd`, so at `onStart` the
 * store's target is still the previous keyboard's and would equal the offset on
 * every show: the lift would never be reported and the screen's slack would
 * chase the composer's own height. The motion's own destination is known at its
 * start on both platforms. Whole points on both sides, as the box tag compares.
 */
export const shouldHoldLift = (
	offset: number,
	destination: number,
): boolean => {
	"worklet";
	return Math.round(rideOffset(destination)) !== Math.round(offset);
};

/** What the lift does with a keyboard-store frame. */
export type FrameAction = "snap" | "hold" | "tween";

/**
 * The store's frame, as the lift's driver sees it.
 *
 * - `tween`: no library motion runs, so the store's timed lift is the driver
 *   (a frame the library never reports, a platform without the module).
 * - `hold`: a library motion runs and owns the offset; the frame must not start
 *   a second tween over it. It is REMEMBERED, so the end of the motion can repair
 *   a divergence (`settleDecision`).
 * - `snap`: a hidden frame. It always applies, motion or not.
 *
 * WHY A HIDDEN FRAME ALWAYS APPLIES (the stuck-motion rule). The store emits a
 * hidden frame only from `keyboardDidHide` (iOS's hide `willChangeFrame` keeps
 * `visible`, `keyboard-frame.ts`), and a `did` event is the OS saying the
 * keyboard has left the screen. A `motionActive` that outlives it never got its
 * `onEnd` (an Android activity paused mid-animation), and holding the flag would
 * silence the timed fallback until the next library motion. The cost of being
 * wrong is bounded: if a last library frame still follows, `onMove` and `onEnd`
 * write the same near-zero height. A SHOW has no such settled event in the store
 * (iOS's `willChangeFrame` is a start event), so a stuck show is NOT recovered
 * here: `deferred — self-heals on the next library motion`.
 */
export const frameAction = (
	visible: boolean,
	motionActive: boolean,
): FrameAction => {
	"worklet";
	if (!visible) return "snap";
	return motionActive ? "hold" : "tween";
};

/**
 * Where the lift rests when the library's motion ended: the settled overlap
 * when a store frame was held during the motion (`frameAction` -> `hold`) or the
 * two are within `SETTLE_SNAP_LIMIT`, otherwise `current` untouched.
 *
 * A HELD FRAME IS AUTHORITATIVE. The library's final height is the keyboard
 * VIEW's frame and the store's overlap is `window.height - screenY`; on iPad
 * floating, split view and Stage Manager they differ by tens of points
 * (198 vs 168), and `publishBox` discards every box whose offset is not the
 * overlap (TestFlight 753 class). The frame arrived while the motion ran, so it
 * describes THIS motion's end and the offset is brought to it.
 *
 * A frame that has NOT been held is the stale Android case (`settleOffset`):
 * the target still belongs to the previous keyboard, so it is left alone and the
 * store's timed lift follows when its frame lands.
 */
export const settleDecision = ({
	current,
	target,
	frameSeenDuringMotion,
}: {
	current: number;
	target: number;
	frameSeenDuringMotion: boolean;
}): number => {
	"worklet";
	return frameSeenDuringMotion ? target : settleOffset(current, target);
};

type SharedNumber = { value: number };
type SharedFlag = { value: boolean };

/**
 * The three handlers `useKeyboardHandler` is given. Built here, with the shared
 * values and the reanimated calls INJECTED, so a Node test can drive a keyboard
 * motion against plain objects and read what each handler did (the component
 * cannot mount in Node). Each handler carries its own `"worklet"` directive: the
 * library does not workletize them (`composer-worklets.test.ts`). The injected
 * names are destructured into their own constants because a worklet's closure is
 * captured per variable, as the component's handlers captured them before.
 *
 * - `onStart`: the motion owns the offset: cancel a tween in flight, and report
 *   a lift when the motion will move the offset (`holdLift`, on JS).
 * - `onMove`: ride the frame's height.
 * - `onEnd`: land on the final height, release the offset, and settle on JS.
 */
export const keyboardMotionHandlers = <Offset extends SharedNumber>(deps: {
	keyboardOffset: Offset;
	motionActive: SharedFlag;
	cancelAnimation: (value: Offset) => void;
	runOnJS: (fn: () => void) => () => void;
	holdLift: () => void;
	settleLift: () => void;
}) => {
	const {
		keyboardOffset,
		motionActive,
		cancelAnimation,
		runOnJS,
		holdLift,
		settleLift,
	} = deps;
	return {
		onStart: (event: { height: number }) => {
			"worklet";
			motionActive.value = true;
			cancelAnimation(keyboardOffset);
			if (shouldHoldLift(keyboardOffset.value, event.height)) {
				runOnJS(holdLift)();
			}
		},
		onMove: (event: { height: number }) => {
			"worklet";
			keyboardOffset.value = rideOffset(event.height);
		},
		onEnd: (event: { height: number }) => {
			"worklet";
			keyboardOffset.value = rideOffset(event.height);
			motionActive.value = false;
			runOnJS(settleLift)();
		},
	};
};
