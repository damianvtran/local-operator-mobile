/**
 * Where a bottom sheet sits, and how tall it may be, while the software
 * keyboard is up.
 *
 * WHY THIS EXISTS (operator, TestFlight 1295: "the search input doesn't move up
 * with the keyboard so I can't see what I'm typing or what the matched options
 * are"). `Sheet` renders inside a React Native `Modal`, and a native `Modal` is
 * NOT resized for the keyboard: on iOS its window keeps the full screen height,
 * and on Android the app is edge-to-edge, so the IME is an inset rather than a
 * resize. The sheet's cap came from its column's `onLayout`, on the assumption
 * that the column shrinks when a keyboard opens — true on the web (the visual
 * viewport shrinks), false on both native platforms. So the surface stayed
 * anchored to the screen bottom and the keyboard was drawn over its body.
 *
 * Plain module, no `react-native` import, so the arithmetic is unit-tested in
 * Node (`vitest.config.ts`); `sheet.tsx` feeds it the keyboard store's frame
 * (`@/features/session/keyboard-frame`, the ONE keyboard source the composers
 * already read) and its own measured column.
 */

/**
 * How far to lift the sheet's bottom edge so it sits on the keyboard's top.
 *
 * `overlap` is the store's `window height - keyboard top`. Normally that is
 * the lift. The exception is a host that DID resize for the keyboard (an
 * Android window under `adjustResize` that is not edge-to-edge, or any future
 * Modal that resizes): then the column this sheet measured is already shorter
 * than the window by about the keyboard's height, its bottom already sits on
 * the keyboard, and lifting by the overlap again would leave a keyboard-sized
 * gap under the sheet (the "double lift"). The shrink is subtracted, and a
 * shrink of under half the overlap is treated as chrome noise (a status or
 * navigation bar the column excludes), not as a resize.
 *
 * `columnHeight` 0 means "not measured yet": the column is the window.
 */
export const sheetKeyboardLift = ({
	overlap,
	columnHeight,
	windowHeight,
}: {
	overlap: number;
	columnHeight: number;
	windowHeight: number;
}): number => {
	if (overlap <= 0) return 0;
	const shrink =
		columnHeight > 0 ? Math.max(0, windowHeight - columnHeight) : 0;
	if (shrink * 2 < overlap) return overlap;
	return Math.max(0, overlap - shrink);
};

/**
 * The tallest the sheet's SURFACE may be with the keyboard up: the space
 * between the safe top and the keyboard's top, so the title, a pinned search
 * field and as many rows as fit stay visible and the body scrolls for the
 * rest. `capHeight` is the column (or the window before `onLayout`).
 */
export const sheetKeyboardRoom = ({
	capHeight,
	lift,
	safeTop,
}: {
	capHeight: number;
	lift: number;
	safeTop: number;
}): number => Math.max(0, capHeight - lift - safeTop);
