/**
 * The props every horizontal `ScrollView` in the app carries.
 *
 * WHY. `directionalLockEnabled` is the iOS scroller's own promise that once it
 * has chosen an axis it stays on it, so a diagonal drag cannot change axis
 * halfway through. The page's drawer swipe (`drawer-pan.ts`) is an ancestor
 * recogniser that fails after 12 pt of vertical travel; on iOS the scroller's
 * own pan is what wins the touch when it started inside the scroller, and this
 * lock is what keeps that drag on the axis it began on.
 *
 * WHAT THIS IS NOT. It does not claim the touch, and no `DrawerSwipeClaim`
 * wraps these scrollers: the competition with the page pan is the platform's
 * (declared here, proven only on a device). `drawer-swipe-ledger.test.ts`
 * fails a horizontal scroller that lacks this prop and has no claiming
 * ancestor, so a new table or chip row cannot silently become a drawer gesture
 * without at least the declaration.
 */
import { Platform, type ScrollViewProps } from "react-native";

export const HORIZONTAL_SCROLL_PROPS: Pick<
	ScrollViewProps,
	"directionalLockEnabled"
> = Platform.OS === "ios" ? { directionalLockEnabled: true } : {};
