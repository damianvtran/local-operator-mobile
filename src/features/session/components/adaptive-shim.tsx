import { type ReactNode, useCallback, useState } from "react";
import {
	type LayoutChangeEvent,
	useWindowDimensions,
	View,
} from "react-native";

import { type SessionLayout, sessionLayout } from "@/features/session/layout";

/**
 * A THIN LOCAL SHIM for the adaptive layout primitives D1 owns in `src/ui/`.
 *
 * The manager's ruling (QA round 2, Q10) is that `src/ui/` ships ONE adaptive
 * layout system — a size-class hook, a `ReadableColumn` and a `SplitView` — and that
 * this screen builds against a shim with the SAME INTERFACE until they land, then
 * swaps. So this file is deliberately small and deliberately shaped like theirs:
 *
 *   - `useContainerLayout()` → the size-class hook, measured on the view itself.
 *   - `ReadableColumn`   → a centred, measure-capped column.
 *
 * It is NOT a second layout system: nothing outside `src/features/session/` imports
 * it, it contains no breakpoint of its own (those live in `layout.ts`, which D1's
 * hook replaces), and the swap is an import change in the two session routes. The
 * `SplitView` half is not shimmed at all: the session view is the DETAIL pane, and
 * the list/detail composition belongs to the route layout D1 owns
 * (`app/(app)/_layout.tsx`), so faking it here would be exactly the fork the ruling
 * forbids.
 *
 * TODO(swap when D1's primitives land): replace both exports with the `src/ui/`
 * ones and delete this file.
 */

/**
 * The layout for the space this view is actually GIVEN, not the window.
 *
 * The window is the first guess, so a phone — where the two agree — never paints
 * a frame that the measurement then moves. Inside a split view's detail pane the
 * `onLayout` measurement replaces it, which is the only way a view can know it is
 * narrower than the screen it is on.
 */
export const useContainerLayout = (): {
	layout: SessionLayout;
	onLayout: (event: LayoutChangeEvent) => void;
} => {
	const window = useWindowDimensions();
	const [box, setBox] = useState<{ width: number; height: number } | null>(
		null,
	);
	const onLayout = useCallback((event: LayoutChangeEvent) => {
		const { width, height } = event.nativeEvent.layout;
		// Only a real change re-renders: `onLayout` fires on every layout pass, and a
		// same-size update would re-render the whole transcript for nothing.
		setBox((current) =>
			current !== null && current.width === width && current.height === height
				? current
				: { width, height },
		);
	}, []);
	const width = box?.width ?? window.width;
	const height = box?.height ?? window.height;
	return { layout: sessionLayout(width, height), onLayout };
};

export const ReadableColumn = ({
	children,
	maxWidth,
	testID,
}: {
	children: ReactNode;
	/** The measure, in points. From the layout policy, never a literal. */
	maxWidth: number;
	testID?: string;
}) => (
	// `items-center` on the outer view and `w-full` + `maxWidth` on the inner is
	// the shape that centres a capped column WITHOUT shrinking it on a phone: a
	// narrower screen simply fills, a wider one gets even margins.
	<View className="flex-1 items-center" testID={testID}>
		<View className="w-full flex-1" style={{ maxWidth }}>
			{children}
		</View>
	</View>
);
