/**
 * The props every horizontal `ScrollView` in the app carries.
 *
 * WHY. `directionalLockEnabled` is the iOS scroller's own promise that once it
 * has chosen an axis it stays on it. The page's drawer swipe (`drawer-pan.ts`)
 * is an ancestor recogniser that fails after 12 pt of vertical travel; a table
 * dragged diagonally at its left end would otherwise let the scroller pick the
 * horizontal component up late, after the page pan had already claimed the
 * axis. The claim (`@/ui/drawer-swipe-claim`) covers the START of the touch;
 * this covers its middle.
 *
 * Spread it, do not re-derive it: `drawer-swipe-ledger.test.ts` fails a
 * horizontal scroller that lacks it and has no claiming ancestor, so a new
 * table or chip row cannot silently become a drawer gesture.
 */
import { Platform, type ScrollViewProps } from "react-native";

export const HORIZONTAL_SCROLL_PROPS: Pick<
	ScrollViewProps,
	"directionalLockEnabled"
> = Platform.OS === "ios" ? { directionalLockEnabled: true } : {};
