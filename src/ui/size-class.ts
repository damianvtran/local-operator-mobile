import { maxColumnWidth } from "@/ui/column";
import { LAYOUT } from "@/ui/tokens.gen";

/**
 * The adaptive layout vocabulary, in ONE place, and FREE OF `react-native`.
 *
 * Two screen streams and a review round have to agree about what "regular width"
 * means, so the numbers live here (and behind `LAYOUT`, which the token build
 * generates) rather than in each screen. A second definition of the tablet
 * breakpoint is the defect this file exists to prevent.
 *
 * It is a plain module rather than part of `layout.ts` because of this repo's own
 * test rule (`vitest.config.ts`): units run in Node, and anything a test touches
 * must not import `react-native`. The hook and the platform touch floor — which
 * genuinely need the platform — live in `layout.ts` and delegate the decision to
 * `layoutFor()` here, so the rules are asserted in a unit test and the platform
 * binding is not faked anywhere.
 *
 * The classes are deliberately iOS-shaped — compact/regular — because the app is a
 * phone app that grows into a tablet, and those two names are what the layout
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
 * The numbers the token build does not carry yet.
 *
 * `design/tokens/tokens.json` already gives the readable measures and
 * `tabletBreakpoint` (read through `LAYOUT` below). These three are new layout
 * decisions, so they are declared once here — NOT copied into each screen — and the
 * manager has been told they belong in the token set.
 */
/** The width at which a list and a detail can share a screen. */
export const SPLIT_MIN_WIDTH = 900;

/** The list pane's width — wide enough for a row's two lines and its marks,
 *  narrow enough to leave the detail a readable column. */
export const SPLIT_PANE_WIDTH = 360;

/** Below this height two panes are slivers, whatever the width: 844x390 landscape
 *  is wide and short, and the keyboard covers half of it. */
export const SPLIT_MIN_HEIGHT = 700;

/* --- the conversations panel's geometry (the home + sidebar slice). No token
 *  carries these yet, and by this file's own rule new layout numbers live HERE
 *  once and the manager is told they belong in the token set — proposed as
 *  `layout.sidebar = { mobileMax: 280, tablet: 320, sliver: 56 }`. --- */

/** Material's own temporary-drawer width rule: max 280 on mobile, 320 on tablet. */
export const SIDEBAR_MOBILE_MAX = 280;

/** The floor, so a narrow phone's panel still fits its rows' skeletons. */
export const SIDEBAR_MIN_WIDTH = 240;

/** What stays visible of the page behind the panel at the 320 pt floor — the
 *  same sliver Material's own example leaves at the right edge. */
export const SIDEBAR_SLIVER = 56;

/**
 * The panel's width for a viewport: `min(280, vw − 56)`, floored at 240.
 *
 * 390 pt phone → 280 (sliver 110); 320 pt phone → 264 (sliver 56). The sliver is
 * what keeps the page behind the panel legible enough to read as "darkened",
 * not gone — the temporary-drawer rule, not a sizing preference.
 */
export const sidebarWidthFor = (viewportWidth: number): number =>
	Math.max(
		SIDEBAR_MIN_WIDTH,
		Math.min(SIDEBAR_MOBILE_MAX, viewportWidth - SIDEBAR_SLIVER),
	);

/** The pure decision, so it is testable and is not a rendering side effect. */
export function layoutFor(width: number, height: number): Layout {
	const orientation: Orientation = width > height ? "landscape" : "portrait";
	const sizeClass: SizeClass =
		width >= LAYOUT.tabletBreakpoint ? "regular" : "compact";
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
	/* Delegated, not re-derived. This was a second implementation of the same rule
	 *  and it disagreed with the first at exactly the size the rule exists for:
	 *  `column.ts` classifies a device by its SHORTER side (a phone on its side is
	 *  still a phone) and returns 620 for 844x390, while this returned 640 by looking
	 *  at the width. `Screen` renders through `column.ts` and `ReadableColumn` through
	 *  `layout.measure`, so the disagreement was one screen away from putting a 640 pt
	 *  column inside a 620 pt cap. One implementation now, and this one is a call. */
	return maxColumnWidth({ width, height });
}
