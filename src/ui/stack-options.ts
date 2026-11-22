/**
 * The options every native `Stack` in the app shares: back is the LEFT-EDGE
 * swipe on iOS and the system's back button or gesture on Android, and never a
 * swipe that starts in the middle of the screen.
 *
 * WHY. On iOS 26 and later, `react-native-screens` (4.26.2) leaves the system's
 * full-screen swipe-back ON when `fullScreenGestureEnabled` is unset
 * (`ios/RNSScreen.mm` `isFullScreenSwipeEffectivelyEnabled` answers YES for an
 * undefined value on iOS 26). A rightward drag that starts ANYWHERE on a pushed
 * screen then pops it, and it competes with every horizontally scrollable
 * surface in the transcript (markdown tables, code blocks, diagrams).
 *
 * WHAT WE DO ON iOS 26+: keep that native recognizer but restrict it to the
 * leading edge with `gestureResponseDistance: { end }` (screens only starts it
 * when the touch is within `end` pt of the leading edge, mirrored for RTL:
 * `RNSScreenStack.mm` `isInGestureResponseDistance` and its use in
 * `gestureRecognizerShouldBegin`). Turning the full-screen swipe OFF instead
 * (`fullScreenGestureEnabled: false`) removed swipe-back altogether on the
 * iOS 27.2 simulator: an XCUITest drag from 0, 1, 2, 3 and 5 % of the width
 * popped nothing, while the same drags popped with it on. So the edge-limited
 * native recognizer is the one that is measured to work.
 *
 * ON iOS BEFORE 26 only the system's edge swipe exists; the option is set to
 * `false` so no custom full-width recognizer is ever installed. Android is
 * unaffected: the options are read by the iOS native layer only, and the native
 * stack already hands Android's back gesture to the system.
 *
 * `gestureEnabled` is left at its default on purpose: `false` would remove the
 * back swipe itself.
 */
import { Platform } from "react-native";

/** The width (pt) of the leading-edge strip a back swipe may start in. The
 *  system's own edge swipe is about this wide, and the transcript keeps a 16 pt
 *  page margin so a scroller never sits under most of it. */
export const BACK_SWIPE_EDGE_PT = 20;

/** The first iOS release whose native stack has the full-screen swipe-back. */
export const FULL_SCREEN_POP_IOS_MAJOR = 26;

export type StackScreenOptions = {
	headerShown: false;
	fullScreenGestureEnabled: boolean;
	gestureResponseDistance?: { end: number };
};

/** Pure, so a test pins every platform without a device. */
export function stackScreenOptions(
	os: string,
	osVersion: string | number,
): StackScreenOptions {
	const major = Number.parseInt(String(osVersion), 10);
	const hasFullScreenPop =
		os === "ios" &&
		Number.isFinite(major) &&
		major >= FULL_SCREEN_POP_IOS_MAJOR;
	if (!hasFullScreenPop) {
		return { headerShown: false, fullScreenGestureEnabled: false };
	}
	return {
		headerShown: false,
		fullScreenGestureEnabled: true,
		gestureResponseDistance: { end: BACK_SWIPE_EDGE_PT },
	};
}

export const STACK_SCREEN_OPTIONS = stackScreenOptions(
	Platform.OS,
	Platform.Version,
);
