/**
 * The options every native `Stack` in the app shares: back is the system's back
 * gesture and never a swipe of ours.
 *
 * WHAT iOS 26 CHANGED. On iOS 26 and later `react-native-screens` (4.26.2)
 * leaves the system's full-screen swipe-back ON when `fullScreenGestureEnabled`
 * is unset (`ios/RNSScreen.mm` `isFullScreenSwipeEffectivelyEnabled` answers YES
 * for an undefined value on iOS 26). That recogniser is a plain UIKit
 * `UIScreenEdgePanGestureRecognizer`-style one, and it competes with every
 * horizontally scrollable surface in the transcript (markdown tables, code
 * blocks, diagrams) — which is what #373 measured and answered with a 44 pt
 * left-edge limit (`gestureResponseDistance`).
 *
 * TWO SCOPES, ONE MEASURED ANSWER EACH.
 *
 *  - `nested`: the `(app)` stack's pushed screens. They ACCEPT the UIKit rule —
 *    no `gestureResponseDistance` (`E2`). UIKit's own failure rule already
 *    makes a scroller win: `RNSScreenStack.mm` `gestureRecognizerShouldBegin`
 *    asks the screen's scroll pans to fail, and a scroll pan at its left end in
 *    a scroll view wider than its frame answers NO (`RNSScreenStack.mm`
 *    `:1072-1075, :1163-1172`). So a table that overflows keeps scrolling, and a
 *    full-width pop is available everywhere else. That is the operator's P4.
 *  - `root`: the root stack and `(auth)`. They keep #373's edge limit. They are
 *    OUTSIDE the navigation model (`docs/design/navigation-gestures.md` §2.1):
 *    their screens have no sideways scrollers to compete with, nothing here
 *    measured them at full width, and moving them is a separate change with its
 *    own device evidence. `fullScreenGestureEnabled: false` is NOT the
 *    alternative: on the iOS 27.2 simulator it removed swipe-back altogether
 *    (an XCUITest drag from 0, 1, 2, 3 and 5 % of the width popped nothing,
 *    while the edge-limited recogniser popped every one of them).
 *
 * ON iOS BEFORE 26 only the system's edge swipe exists; the option is set to
 * `false` so no custom full-width recogniser is ever installed. Android and web
 * are unaffected: the options are read by the iOS native layer only, and
 * `gestureEnabled: false` on top-level routes is honoured on Android by the
 * navigator, never by the OS.
 *
 * `gestureEnabled` is left at its default on purpose: `false` would remove the
 * back swipe itself. Top-level routes take theirs per route from
 * `top-level-routes.ts`.
 */
import { Platform } from "react-native";

/** The width (pt) of the left-edge strip a root-scope back swipe may start in.
 *  screens measures the finger where the swipe BEGINS, after it has already
 *  travelled a few points, so this is wider than the system's ~20 pt edge zone
 *  (a 20 pt limit refused real edge swipes in the simulator) and is a touch
 *  target's width. */
export const BACK_SWIPE_EDGE_PT = 44;

/** The first iOS release whose native stack has the full-screen swipe-back. */
export const FULL_SCREEN_POP_IOS_MAJOR = 26;

/** Which stack the options are for: the app group's pushed screens accept
 *  UIKit's iOS 26 rule; the root and `(auth)` keep the measured edge limit. */
export type StackScope = "root" | "nested";

export type StackScreenOptions = {
	headerShown: false;
	fullScreenGestureEnabled: boolean;
	gestureResponseDistance?: { end: number };
};

/** Pure, so a test pins every platform without a device. */
export function stackScreenOptions(
	os: string,
	osVersion: string | number,
	scope: StackScope = "root",
): StackScreenOptions {
	const major = Number.parseInt(String(osVersion), 10);
	const hasFullScreenPop =
		os === "ios" &&
		Number.isFinite(major) &&
		major >= FULL_SCREEN_POP_IOS_MAJOR;
	if (!hasFullScreenPop) {
		return { headerShown: false, fullScreenGestureEnabled: false };
	}
	if (scope === "nested") {
		/* No distance: the nested screen wants the full-width pop, and the
		 *  scroller's own UIKit rule is what settles the competition. */
		return { headerShown: false, fullScreenGestureEnabled: true };
	}
	return {
		headerShown: false,
		fullScreenGestureEnabled: true,
		gestureResponseDistance: { end: BACK_SWIPE_EDGE_PT },
	};
}

/** Root stack and `(auth)`: the measured edge-limited recognizer. */
export const STACK_SCREEN_OPTIONS = stackScreenOptions(
	Platform.OS,
	Platform.Version,
);

/** The `(app)` stack's default (nested) screens: the iOS 26 full-width pop,
 *  arbitrated by UIKit against the screen's own scrollers. Top-level routes
 *  override this per route with `TOP_LEVEL_SCREEN_OPTIONS`. */
export const NESTED_STACK_SCREEN_OPTIONS = stackScreenOptions(
	Platform.OS,
	Platform.Version,
	"nested",
);
