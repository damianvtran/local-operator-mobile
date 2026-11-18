import { type Layout, sidebarFooterScrolls } from "@/ui/size-class";

/**
 * The conversations pane's loading state: the kit's three skeleton rows, or one
 * row on a short pane at large text (docs/ux/audits/2026-10-11-full-surface-pass.md,
 * the D3 loading variant).
 *
 * At large text on a pane whose routes footer scrolls with the list — a phone
 * held on its side — three rows (96 pt) and the footer compete for one short
 * viewport. The audit saw the bars clipped away, so the state read as an EMPTY
 * list (§ D2's symptom); on the f5498d3c export at 844 × 390 / 200 % the bars
 * stayed but pushed the footer's last row (More) off the bottom. One bar keeps
 * the loading cue AND the footer on screen. Everywhere else the three rows fit
 * (measured: 844 × 390 at 100 %, 320 × 568 at 200 %), so they stay.
 */
export type PaneLoadingVariant = "full" | "compact";

export const PANE_LOADING_BARS: Record<PaneLoadingVariant, number> = {
	full: 3,
	compact: 1,
};

/**
 * A predicate over the layout, not a measurement, so the first paint is the
 * form the reader keeps — measuring the list and then switching would move the
 * state on the second frame. "Short" reuses the pane's own rule for a footer
 * that cannot stay pinned (`sidebarFooterScrolls`) rather than a second
 * threshold, and large text is what makes that pane too short for three rows.
 */
export const paneLoadingVariant = (
	layout: Layout,
	options: { largeText: boolean; routes: number },
): PaneLoadingVariant =>
	options.largeText && sidebarFooterScrolls(layout, options)
		? "compact"
		: "full";
