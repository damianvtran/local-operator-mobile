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
