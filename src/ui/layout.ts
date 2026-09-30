import { Platform, useWindowDimensions } from "react-native";

import { LAYOUT, TOUCH_TARGET } from "@/ui/tokens.gen";

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

export type SizeClass = "compact" | "regular";

export type Orientation = "portrait" | "landscape";

export interface Layout {
	sizeClass: SizeClass;
	orientation: Orientation;
	/** The viewport, in CSS points. */
	width: number;
	height: number;
	/** The readable measure for a single-pane screen, or `null` when the screen is
	 *  already narrow enough that a cap would only add margins. */
	measure: number | null;
	/** Whether a two-pane layout has room to be worth it. */
	split: boolean;
}

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
export const TOUCH_FLOOR =
	Platform.OS === "ios" ? TOUCH_TARGET.ios : TOUCH_TARGET.android;

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
export const SPLIT_MIN_WIDTH = 900;

/** The left pane's width in a split layout — wide enough for a row's two lines
 *  and its marks, narrow enough to leave the detail a readable column. */
export const SPLIT_PANE_WIDTH = 360;

/** Below this height two panes are slivers, whatever the width. */
export const SPLIT_MIN_HEIGHT = 700;

export function useLayout(): Layout {
	const { width, height } = useWindowDimensions();
	return layoutFor(width, height);
}

/** The pure form, so the decision is testable and is not a rendering side effect. */
export function layoutFor(width: number, height: number): Layout {
	const orientation: Orientation = width > height ? "landscape" : "portrait";
	const sizeClass: SizeClass =
		width >= LAYOUT.tabletBreakpoint ? "regular" : "compact";
	/* Landscape and large portrait tablets get two panes; a landscape PHONE does
	 * not, however wide it is — at 844x390 the panes would be two slivers, and the
	 * keyboard takes half the height. */
	const roomForTwoPanes =
		width >= SPLIT_MIN_WIDTH && height >= SPLIT_MIN_HEIGHT;
	return {
		sizeClass,
		orientation,
		width,
		height,
		measure: measureFor(width, height),
		split: roomForTwoPanes,
	};
}

function measureFor(width: number, height: number): number | null {
	if (width >= LAYOUT.tabletBreakpoint) {
		return width > height
			? LAYOUT.contentMaxWidthTabletLandscape
			: LAYOUT.contentMaxWidthTablet;
	}
	if (width > height && width > LAYOUT.contentMaxWidthLandscapePhone) {
		return LAYOUT.contentMaxWidthLandscapePhone;
	}
	return null;
}
