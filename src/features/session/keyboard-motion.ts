/**
 * The two decisions the composer's keyboard-controller driver makes, as pure
 * functions: what a per-frame keyboard height does to the lift (`rideOffset`),
 * and whether the frame the motion ended on may be snapped to the settled
 * overlap (`settleOffset`).
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
