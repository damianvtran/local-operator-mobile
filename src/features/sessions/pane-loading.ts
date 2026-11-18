import { type Layout, sidebarFooterScrolls } from "@/ui/size-class";

/**
 * The conversations pane's loading state: the kit's three skeleton rows, or one
 * row on a short pane (docs/ux/audits/2026-10-11-full-surface-pass.md, the D3
 * loading variant).
 *
 * Three rows are 96 pt of a pane that, on a phone held on its side or at large
 * text on a short phone, also carries the pill, the header and a footer that
 * scrolls with the list. The bars landed past the fold and the frame read as an
 * EMPTY list — the symptom the skeleton exists to prevent (§ D2). One bar keeps
 * the cue on screen.
 */
export type PaneLoadingVariant = "full" | "compact";

export const PANE_LOADING_BARS: Record<PaneLoadingVariant, number> = {
	full: 3,
	compact: 1,
};

/**
 * "Short" is the pane's existing definition rather than a second threshold: a
 * pane whose routes footer cannot stay pinned (`sidebarFooterScrolls`) is the
 * one with no room to spare. It is a predicate over the layout, so the first
 * paint is the form the reader keeps — measuring the list and then switching
 * would move the state on the second frame.
 */
export const paneLoadingVariant = (
	layout: Layout,
	options: { largeText: boolean; routes: number },
): PaneLoadingVariant =>
	sidebarFooterScrolls(layout, options) ? "compact" : "full";
