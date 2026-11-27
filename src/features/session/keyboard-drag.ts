/**
 * How the transcript lets a finger drag the keyboard (PR C), per platform, as
 * one pure decision a Node test pins.
 *
 * - **iOS:** the scroll view's own `keyboardDismissMode="interactive"`. The
 *   library reports the drag as `onInteractive` frames
 *   (`keyboard-motion.ts`); there is no gesture area on iOS to add.
 * - **Android 11+ (API 30):** `KeyboardGestureArea` drives the system's
 *   `WindowInsetsAnimation`, and the scroll view must NOT also dismiss:
 *   `on-drag` closes the keyboard at drag start and fights the gesture area.
 * - **Android 10 and older (minSdk 24):** there is no controllable insets
 *   animation, so the fallback is the scroll view's own `on-drag`, a timed
 *   close at the start of the drag. No finger-following there.
 * - **Web:** unchanged (`interactive` is a no-op without a soft keyboard).
 *
 * The `interpolator` is `ios`: only a swipe that touches the keyboard moves it,
 * as on iOS itself, so the drag starts at the keyboard's top edge on both
 * platforms (v1: the composer-top start needs a `nativeID` on the field and an
 * iOS accessory view, which would break the single keyboard-frame source).
 */
export type KeyboardDragPlan = {
	/** Wrap the transcript in `KeyboardGestureArea`. */
	gestureArea: boolean;
	/** The scroll view's `keyboardDismissMode`. */
	dismissMode: "interactive" | "on-drag" | "none";
};

/** `WindowInsetsAnimation` controllers, the API the gesture area needs. */
export const GESTURE_AREA_MIN_ANDROID_API = 30;

export const keyboardDragPlan = (
	os: string,
	version: number | string,
): KeyboardDragPlan => {
	if (os === "android") {
		return typeof version === "number" &&
			version >= GESTURE_AREA_MIN_ANDROID_API
			? { gestureArea: true, dismissMode: "none" }
			: { gestureArea: false, dismissMode: "on-drag" };
	}
	return { gestureArea: false, dismissMode: "interactive" };
};
