/**
 * When Settings moves the reader to its refusal, and where (PR #122 UX round 3,
 * U16 and U18).
 *
 * The switcher CLOSES on a failed pick so the reason behind it is readable. On
 * Settings that reason is inserted under Status, ABOVE the "Switch computer" the
 * reader opened it from, and the layout keeps that opener where it was: the new
 * ~330 pt panel pushed the scroll offset down by its own height and landed off the
 * top of the screen — at 375×667 from the top, after any scroll, at 150 % text, at
 * 320×640 and with the keyboard up (measured: refusal at −246…86 of 667). The live
 * region still spoke, so only sighted readers lost the reason, which is the whole
 * point of closing the sheet. So the screen scrolls to it, once, when it appears.
 *
 * Pure, so the Node suite can assert the decisions; the measuring and scrolling
 * live in `settings.tsx`.
 */

/** Space kept above the refusal once it is scrolled to, so its top edge does not
 *  sit flush under the header and read as clipped. One `gap-4` step. */
export const REFUSAL_SCROLL_MARGIN = 16;

/**
 * True on the render where a refusal FIRST appears. Only then: a refusal that is
 * already showing is one the reader has seen, and scrolling back to it on every
 * re-render would yank them away from wherever they went to fix it.
 */
export function refusalAppeared(before: boolean, now: boolean): boolean {
	return !before && now;
}

/** A vertical extent in window coordinates, as `measureInWindow` reports it. */
export type WindowBand = { top: number; height: number };

/**
 * True when the refusal is not wholly inside the scroll viewport, so scrolling is
 * needed. A refusal that already shows top to bottom (390×844 from the top: 162…494
 * of 844) is left alone — moving a screen the reader can already read is motion
 * for nothing. A panel taller than the viewport is never "wholly inside", so it is
 * brought to the top, headline first.
 */
export function refusalOutOfView(
	refusal: WindowBand,
	viewport: WindowBand,
): boolean {
	return (
		refusal.top < viewport.top ||
		refusal.top + refusal.height > viewport.top + viewport.height
	);
}

/**
 * The scroll offset that puts a refusal measured at `layoutY` (its top, relative
 * to the scroll content) at the top of the viewport, with `REFUSAL_SCROLL_MARGIN`
 * above it. The top, not the centre: the panel is taller than half a 640 pt screen
 * at 150 % text, and its headline is what has to be read first. Never negative —
 * a refusal already near the top scrolls to the top.
 */
export function refusalScrollY(layoutY: number): number {
	return Math.max(0, Math.round(layoutY - REFUSAL_SCROLL_MARGIN));
}

/**
 * True when a "Try now" pressed on THIS screen has just worked: the refusal is
 * gone and the route is live. The button unmounts with the refusal, and focus fell
 * to the document body, so a keyboard reader's next Tab started at the top (U18).
 * A refusal cleared any other way — a switch from the sheet, a route ended — is
 * not this screen's retry, and focus is left where the reader put it.
 */
export function retryLanded(input: {
	retriedHere: boolean;
	refused: boolean;
	live: boolean;
}): boolean {
	return input.retriedHere && !input.refused && input.live;
}
