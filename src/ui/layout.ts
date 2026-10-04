import { Platform, useWindowDimensions } from "react-native";

import { type Layout, layoutFor } from "@/ui/size-class";
import { touchFloorFor } from "@/ui/variants";

/**
 * The adaptive layout vocabulary, in ONE place.
 *
 * Two screen streams and a review round have to agree about what "regular width"
 * means, so the numbers live here (and behind `LAYOUT`, which the token build
 * generates) rather than in each screen. A second definition of the tablet
 * breakpoint is the defect this file exists to prevent.
 *
 * The classes are deliberately iOS-shaped — compact/regular — because the app is
 * a phone app that grows into a tablet, and those two names are what the layout
 * decisions in `docs/design/components.md` § 22 are written against:
 *
 *  - **compact**: a phone. One column, push navigation.
 *  - **regular**: a tablet, or a phone in landscape with room to spare. Two panes
 *    where a list and a detail genuinely exist, a readable column everywhere else.
 *
 * Width decides, never the device model: a 1366 pt iPad and a 1366 pt browser
 * window deserve the same layout, and a folded phone is simply a narrow one.
 */

/**
 * The touch floor for the platform.
 *
 * 44 pt on iOS and 48 dp on Android. Written as "iOS keeps 44, everything else
 * takes 48" rather than "Android takes 48", because on the WEB build
 * `Platform.OS` is neither: the web target serves the store screenshots and the
 * audit's Android viewports, and a control at 44 pt there failed the 48 dp floor
 * on every Android-sized cell (16 FAILs). 48 is above the floor on iOS too, so
 * choosing the larger value cannot be wrong — a control a thumb cannot miss is
 * not a platform violation.
 */
export const TOUCH_FLOOR = touchFloorFor(
	Platform.OS === "ios" ? "ios" : "other",
);

/**
 * The numbers the token build does not carry yet.
 *
 * `design/tokens/tokens.json` is owned by the design stream, and it already gives
 * the readable measures and `tabletBreakpoint` (which this module reads through
 * `LAYOUT`). These three are new layout decisions, so they are declared once here
 * — NOT copied into each screen — and the manager has been told they belong in
 * the token set so the next stream reads them from there instead of from this
 * file. Height matters as well as width: 844x390 landscape is wide and short, and
 * two panes there are two slivers.
 */
/** The width at which a list and a detail can share a screen. */

/** The left pane's width in a split layout — wide enough for a row's two lines
 *  and its marks, narrow enough to leave the detail a readable column. */

/** Below this height two panes are slivers, whatever the width. */

export function useLayout(): Layout {
	const { width, height } = useWindowDimensions();
	return layoutFor(width, height);
}

/* Re-exported so a screen imports the vocabulary from one place whether it needs
 *  the hook or only a constant. */
export {
	type Layout,
	layoutFor,
	type Orientation,
	SIDEBAR_MIN_WIDTH,
	SIDEBAR_MOBILE_MAX,
	SIDEBAR_SLIVER,
	type SizeClass,
	SPLIT_MIN_HEIGHT,
	SPLIT_MIN_WIDTH,
	SPLIT_PANE_WIDTH,
	sidebarWidthFor,
} from "@/ui/size-class";
