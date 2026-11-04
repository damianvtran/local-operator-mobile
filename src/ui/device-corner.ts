/**
 * The device-corner model: how round the DISPLAY is at the bottom, and the
 * composer geometry that follows from it.
 *
 * WHY THIS EXISTS. The composer is the one surface that sits in the display's
 * bottom corners. With the shipped 12 pt side margin, 8 pt gap and a 12 pt
 * corner, its arc poked 3.8 pt outside a 55 pt display corner and 6.6 pt
 * outside a 62 pt one — the operator's "it's cutting off" on TestFlight 365
 * (decision record D-H4/D-S6). A surface is visually concentric with the
 * display when its inset is the same on both axes (side margin = bottom gap
 * = m) and its radius is R − m; this module owns that rule so the composer,
 * the chips above it and any future bottom sheet agree about it.
 *
 * WHY A TABLE AND NOT AN API. iOS has no public display-corner API. The only
 * reading is the private `_displayCornerRadius` (the ScreenCorners approach),
 * an App Review risk this app will not take. So the radius is looked up from
 * the screen size in points plus whether the device has a home indicator
 * (`insets.bottom > 0`). The values are community-measured and should be
 * confirmed per family on device; the rule is built so a WRONG R never clips:
 * an R under-estimated by 7 pt still sits ~5 pt inside the display, it only
 * reads slightly less concentric.
 *
 * ANDROID. API 31+ exposes `WindowInsets.getRoundedCorner(...).radius`, which
 * needs a native module this repository does not ship yet. Until then Android
 * takes the fallback: a phone with a navigation inset is treated as rounded
 * with the 16 pt floor radius, which is always inside the display. See the
 * PR description for the deferral.
 *
 * Pure on purpose (no `react-native` import): the unit tests run in Node
 * (`vitest.config.ts`), so the rules are asserted rather than argued.
 */

/** The composer's side margin AND its outer bottom gap, in pt. Equal on both
 *  axes is what makes the composer's bottom arc concentric with the display's. */
export const COMPOSER_EDGE_INSET = 8;

/** The smallest bottom radius the composer ever takes — `radius.frame`, the
 *  kit's composer radius, so a square-cornered phone (SE) still gets the
 *  composer's own shape rather than a sharper one. */
export const COMPOSER_MIN_BOTTOM_RADIUS = 16;

/** The composer's TOP radius on every device (`radius.composer`). A concentric
 *  top corner would be ~54 pt and indent the placeholder 16.7 pt at 15 pt down;
 *  20 pt indents it 0.6 pt. The top corners are not near the display's corners
 *  anyway, so concentricity buys nothing there. */
export const COMPOSER_TOP_RADIUS = 20;

/** The bottom padding a composer never goes below, even with the keyboard up
 *  or on a home-button phone: the controls row keeps a hairline of shell under
 *  it rather than sitting flush on the edge. */
export const COMPOSER_MIN_INNER_BOTTOM = 2;

/** An unrecognised phone that has a home indicator: the most common current
 *  radius. Over-estimating is the risk direction that can clip, so the table's
 *  middle value is chosen, not its largest. */
export const UNKNOWN_ROUNDED_RADIUS = 55;

export type Platform = "ios" | "android" | "web" | (string & {});

export type CornerInput = {
	platform: Platform;
	/** The window, in points — portrait or landscape, the short side decides. */
	width: number;
	height: number;
	/** `useSafeAreaInsets().bottom`. 0 means no home indicator / no nav inset. */
	insetBottom: number;
};

/**
 * One family of iPhone displays: its short side in points and its display
 * corner radius. A lookup matches the short side (the iPhone widths are
 * discrete, so ±1 pt tolerance is ample).
 *
 * 375 pt is ambiguous: X/XS/11 Pro (R 39) and 12/13 mini (R 44) both report
 * 375×812. The smaller value is taken, because over-estimating R is the
 * direction that clips; the mini then reads 5 pt less concentric, never cut.
 *
 * Sources: community measurements of `_displayCornerRadius` (ScreenCorners,
 * kylebshr/ScreenCorners README and issues, read 2026-11-04) — recorded rather
 * than read at runtime for the App Review reason above.
 */
const IPHONE_FAMILIES: ReadonlyArray<{ width: number; radius: number }> = [
	// X / XS / 11 Pro and 12/13 mini (see above); SE/8 are 375 too but inset 0.
	{ width: 375, radius: 39 },
	// 12/13/14
	{ width: 390, radius: 47.33 },
	// 14 Pro / 15 / 15 Pro / 16
	{ width: 393, radius: 55 },
	// 16 Pro / 17 / 17 Pro
	{ width: 402, radius: 62 },
	// XR / 11 / XS Max / 11 Pro Max
	{ width: 414, radius: 41.5 },
	// 12/13 Pro Max, 14 Plus
	{ width: 428, radius: 47.33 },
	// 14 Pro Max / 15 Plus / 15 Pro Max / 16 Plus
	{ width: 430, radius: 55 },
	// 16 Pro Max / 17 Pro Max
	{ width: 440, radius: 62 },
];

/**
 * The display's bottom corner radius R, in points, for this device — or 0 for
 * a square-cornered display (home-button iPhone, an Android phone with no
 * navigation inset, the web).
 */
export const displayCornerRadius = ({
	platform,
	width,
	height,
	insetBottom,
}: CornerInput): number => {
	// A home-button phone (SE 2/3, 8) reports no bottom inset: square corners.
	if (insetBottom <= 0) return 0;
	if (platform === "ios") {
		const short = Math.min(width, height);
		const family = IPHONE_FAMILIES.find(
			(entry) => Math.abs(entry.width - short) <= 1,
		);
		// An iPad, or a phone newer than the table: the safe middle value.
		return family?.radius ?? UNKNOWN_ROUNDED_RADIUS;
	}
	if (platform === "android") {
		/* No native reading yet (see the module comment): the floor radius plus
		 * the edge inset, so the concentric radius lands on the floor and never
		 * reaches past a display that is less round than assumed. */
		return COMPOSER_MIN_BOTTOM_RADIUS + COMPOSER_EDGE_INSET;
	}
	return 0;
};

export type ComposerGeometry = {
	/** Side margin, pt. */
	marginX: number;
	/** Outer gap between the composer's bottom edge and the window's, pt. */
	marginBottom: number;
	radiusTop: number;
	radiusBottom: number;
	/** Padding inside the shell under the last row, pt: the shell fills the band
	 *  under the home indicator, while no control's box sits inside that band. */
	paddingBottom: number;
};

/**
 * The composer's outer geometry for a device and keyboard state.
 *
 * Resting: margin m = gap g = 8, bottom radius max(R − 8, 16), and inner
 * bottom padding max(inset − 8, 2) — the outer gap already pays 8 of the
 * inset, the padding pays the rest, so every control's box ends at least
 * `insets.bottom` above the window's edge.
 *
 * Keyboard up: the keyboard covers the display corner, so the bottom corners
 * match the top (20) and the inset is not paid (the keyboard is the edge).
 */
export const composerGeometry = (
	input: CornerInput & { keyboardVisible?: boolean },
): ComposerGeometry => {
	if (input.keyboardVisible === true) {
		return {
			marginX: COMPOSER_EDGE_INSET,
			marginBottom: COMPOSER_EDGE_INSET,
			radiusTop: COMPOSER_TOP_RADIUS,
			radiusBottom: COMPOSER_TOP_RADIUS,
			paddingBottom: COMPOSER_MIN_INNER_BOTTOM,
		};
	}
	const display = displayCornerRadius(input);
	return {
		marginX: COMPOSER_EDGE_INSET,
		marginBottom: COMPOSER_EDGE_INSET,
		radiusTop: COMPOSER_TOP_RADIUS,
		radiusBottom: Math.max(
			display - COMPOSER_EDGE_INSET,
			COMPOSER_MIN_BOTTOM_RADIUS,
		),
		paddingBottom: Math.max(
			input.insetBottom - COMPOSER_EDGE_INSET,
			COMPOSER_MIN_INNER_BOTTOM,
		),
	};
};

/**
 * How far (pt) the composer's bottom arc reaches OUTSIDE the display's corner,
 * using the circle model: positive means clipped pixels. Used by the tests to
 * prove the rule, and by nothing at runtime.
 *
 * Both corners are quarter circles sharing the 45° diagonal. The display arc's
 * centre sits at (R, R) from the corner, the composer's at (m + r, g + r); the
 * composer's arc point farthest out along the diagonal is at distance
 * (centre distance + r) from the display's centre when the centres differ, and
 * clipping is that distance minus R.
 */
export const cornerOverhang = (
	displayRadius: number,
	margin: number,
	gap: number,
	radius: number,
): number => {
	if (displayRadius <= 0) return 0;
	const cx = margin + radius - displayRadius;
	const cy = gap + radius - displayRadius;
	// Only the part of the composer's arc that faces the display corner matters;
	// a centre further from the corner than the display's moves the arc inward.
	const towardCorner = Math.hypot(Math.min(cx, 0), Math.min(cy, 0));
	return radius + towardCorner - displayRadius;
};
