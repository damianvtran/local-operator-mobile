import { LAYOUT } from "@/ui/tokens.gen";
/**
 * How wide the content column may get, and therefore whether it has to be
 * centred.
 *
 * A phone held in portrait needs no cap — the gutter is the constraint, and a cap
 * there would only narrow the transcript. A landscape phone and a tablet do: prose
 * at 844 px is a line length nobody can track back to the next line, and
 * `tokens.json § space.maxContentWidth` names the three widths this returns.
 *
 * The device class comes from the SHORTER side, never the width: a phone on its
 * side is 844 wide and is still a phone, so testing width alone would hand it the
 * tablet landscape width (640) instead of `landscapePhone` (620) — measured on a
 * 844×390 viewport, which is the case this exists for. The kit makes the same
 * distinction: `space.maxContentWidth` is a table of DEVICE shapes, not of widths.
 *
 * Deliberately pure and viewport-agnostic: `Screen` is the only caller today, and
 * the tablet pass (#11) refines the layout AROUND the column rather than changing
 * the column itself.
 */
export type Viewport = { width: number; height: number };

export const maxColumnWidth = ({ width, height }: Viewport): number | null => {
	const landscape = width > height;
	const minor = Math.min(width, height);
	const tablet = minor >= LAYOUT.tabletBreakpoint;
	if (!tablet) return landscape ? LAYOUT.contentMaxWidthLandscapePhone : null;
	return landscape
		? LAYOUT.contentMaxWidthTabletLandscape
		: LAYOUT.contentMaxWidthTablet;
};

/**
 * The content column's width, estimated from the window alone: the viewport,
 * capped by `maxColumnWidth`'s device shapes, less the gutter on each side
 * (the derivation `theme-picker.tsx` spells out for its grid).
 *
 * Exists so a markdown table can paint its FIRST frame at its settled width
 * (PR #224 review m1 / design D2): without it the table's `available` was 0
 * until `onLayout` reported, so a table that fits painted at its priced width
 * (171 px) and snapped to the column (356 px at 390) 10–27 ms later on every
 * mount. It is an ESTIMATE: the caller's measured width wins the moment layout
 * reports, so a host narrower than the session column (a tool row's nested
 * reply, a notification body) still corrects on its first layout. Horizontal
 * safe-area insets are not read — `Markdown` mounts on surfaces without a
 * `SafeAreaProvider`, and on a phone in portrait (the reported case) the
 * insets are 0, so there the estimate equals the measurement.
 */
export const estimatedColumnWidth = (viewport: Viewport): number => {
	const capped = Math.min(
		viewport.width,
		maxColumnWidth(viewport) ?? viewport.width,
	);
	return Math.max(0, capped - 2 * LAYOUT.gutter);
};
