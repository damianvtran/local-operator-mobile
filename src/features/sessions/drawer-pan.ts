/**
 * The page swipe's numbers and its one pure gate, apart from the component that
 * mounts the gesture so both are readable from Node.
 *
 * THE MODEL (docs/design/navigation-gestures.md): on a TOP-LEVEL route a
 * rightward swipe opens the drawer; on a nested one the native stack owns the
 * gesture, and Android's in-content swipe does not exist at all. A drag that
 * starts inside a sideways scroller, the composer, or a text selection belongs
 * to that surface.
 *
 * WHY `activeOffsetX` ALONE DOES NOT ARBITRATE. A recognition threshold only
 * says when THIS recogniser may start; it says nothing about the RN
 * `ScrollView` under the finger, which is not an RNGH handler at all. The
 * arbitration is a RELATION: every surface that owns a horizontal touch wraps
 * itself in `DrawerSwipeClaim` (`@/ui/drawer-swipe-claim`), and that claim
 * `blocksExternalGesture`s this page pan — RNGH makes the pan wait for the
 * claim to fail, so a touch that begins in the scroller never reaches the pan
 * however far it travels. `drawer-swipe-ledger.test.ts` is what keeps a new
 * scroller from shipping without one of the two.
 *
 * WHY 16 / 12 pt. 16 pt of rightward travel is a deliberate gesture rather than
 * the first wobble of a tap, and it clears the ~10 pt a UIScrollView needs
 * before it takes a touch. A 12 pt vertical offset fails the pan first, so a
 * transcript scroll that drifts sideways still scrolls.
 */

import type { PanGesture } from "react-native-gesture-handler";
import type { RouteClass } from "@/features/sessions/top-level-routes";

export const DRAWER_PAN = {
	/** Rightward travel (pt) that activates the page pan. */
	activateRightPt: 16,
	/** Leftward travel (pt) that fails it: that direction is "back", not "open". */
	failLeftPt: -16,
	/** Vertical travel (pt) that fails it: the transcript's scroll owns that axis. */
	failVerticalPt: 12,
	/** Android system back strips (dp): the pan never starts inside them. */
	androidEdgeInsetPt: 24,
} as const;

/** When the page pan is allowed to recognise at all. Pure, so the table is a
 *  test: a nested route's rightward swipe is the stack's (or nothing, on
 *  Android), an open drawer has its own close gesture, and a live text
 *  selection's handles drag inside a message (`E5`). */
export const panEnabled = ({
	routeClass,
	drawerVisible,
	selecting,
}: {
	routeClass: RouteClass | null;
	drawerVisible: boolean;
	selecting: boolean;
}): boolean => routeClass === "top-level" && !drawerVisible && !selecting;

/**
 * Apply the thresholds to a pan. Separate from the component so a test can
 * build the gesture through the recording mock and read every number back —
 * the wiring, not a copy of the constants.
 *
 * Android shrinks the pan's start region by the system back-strip width on both
 * edges (`hitSlop` with negative insets): the strip must stay the OS's. There
 * is no `setSystemGestureExclusionRects` and no race, because this is a
 * UI-thread region cut rather than a decision at touch time.
 */
export const applyPagePanConfig = <T extends PanGesture>(
	pan: T,
	os: string,
): T => {
	const configured = pan
		.activeOffsetX(DRAWER_PAN.activateRightPt)
		.failOffsetX(DRAWER_PAN.failLeftPt)
		.failOffsetY([-DRAWER_PAN.failVerticalPt, DRAWER_PAN.failVerticalPt]);
	if (os !== "android") return configured;
	return configured.hitSlop({
		left: -DRAWER_PAN.androidEdgeInsetPt,
		right: -DRAWER_PAN.androidEdgeInsetPt,
	}) as T;
};

/**
 * The panel's close drag, mirrored: a LEFTWARD pull closes, so the activation
 * and failure offsets swap sign and the same 12 pt vertical loss keeps the
 * drawer's own list scrolling.
 */
export const applyClosePanConfig = <T extends PanGesture>(pan: T): T =>
	pan
		.activeOffsetX(-DRAWER_PAN.activateRightPt)
		.failOffsetX(DRAWER_PAN.activateRightPt)
		.failOffsetY([-DRAWER_PAN.failVerticalPt, DRAWER_PAN.failVerticalPt]);
