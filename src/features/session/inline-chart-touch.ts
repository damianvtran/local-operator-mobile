/**
 * Who owns a pinned inline-chart mark, for "tap outside the chart dismisses"
 * (spec §5 Touch, cross-surface decision X7).
 *
 * Kept free of React Native imports on purpose: the transcript list calls
 * `inlineChartsContainerTouch` from its own `onTouchStart`, and its tests load
 * it without the native renderer.
 *
 * One chart at a time owns a pinned mark. Touch events bubble child-first,
 * so a chart's own `onTouchStart` (`noteChartTouch`) runs before the transcript list's for the same touch
 * (`inlineChartsContainerTouch`); the list then knows the touch was inside a
 * chart and keeps it, and any other touch clears the owner. The same pattern
 * as `text-selection.ts`'s tap-outside exit.
 */
export const touchOwner = { clear: null as (() => void) | null, inside: false };
export const noteChartTouch = (clear: () => void) => {
	// A touch on another chart dismisses the one that was pinned.
	const previous = touchOwner.clear;
	if (previous && previous !== clear) {
		touchOwner.clear = null;
		previous();
	}
	touchOwner.inside = true;
	// Outside a transcript (the visual fixture) no list consumes the flag; it
	// must not survive past this touch's synchronous dispatch.
	queueMicrotask(() => {
		touchOwner.inside = false;
	});
};
/** The transcript list's `onTouchStart`: a touch that began outside every
 * chart dismisses the pinned one. */
export const inlineChartsContainerTouch = (): void => {
	if (touchOwner.inside) {
		touchOwner.inside = false;
		return;
	}
	const clear = touchOwner.clear;
	touchOwner.clear = null;
	clear?.();
};
