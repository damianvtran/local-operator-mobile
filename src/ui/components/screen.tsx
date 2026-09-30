import type { ReactNode } from "react";
import { ScrollView, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { maxColumnWidth } from "@/ui/column";
import { Heading } from "@/ui/components/heading";

/**
 * A screen: the canvas ground, the safe-area insets, and an opaque header
 * (docs/design/components.md § 22).
 *
 * It exists so that safe-area handling is decided ONCE. The kit's rules —
 * `top` on the header, `left`/`right` in landscape, `bottom` on the composer —
 * are easy to apply per screen and impossible to apply consistently per screen,
 * and the failure mode is content under a notch on one device only.
 *
 * The header is opaque on purpose: a translucent header over a scrolling
 * transcript is unreadable at 14pt, and this app's transcript is the whole point.
 * The `canvas` fill behind it is the same ground the content scrolls on.
 */
export type ScreenProps = {
	/** The screen title, in the `display` step. */
	title: string;
	children: ReactNode;
	/** Right-aligned header control (a settings affordance, a new-session button). */
	headerAction?: ReactNode;
	/** Left-aligned header control (a back affordance). */
	headerLeading?: ReactNode;
	/** Screens that own their own scrolling (the transcript) pass false. */
	scroll?: boolean;
	testID?: string;
};

export const Screen = ({
	title,
	children,
	headerAction,
	headerLeading,
	scroll = true,
	testID,
}: ScreenProps) => {
	const insets = useSafeAreaInsets();
	const viewport = useWindowDimensions();
	// The column cap, and the centring that comes with it: a capped column pinned
	// to the left is a ragged page, and the kit's rule is cap AND centre
	// (components.md § 22). `width: 100%` is load-bearing rather than decoration:
	// with `alignSelf: center` alone the container shrink-wraps its children, so the
	// column measures the prose instead of the cap and rows stop filling it
	// (measured at 844 wide: 497 px of 620).
	const columnWidth = maxColumnWidth(viewport);
	const column = columnWidth
		? {
				width: "100%" as const,
				maxWidth: columnWidth,
				alignSelf: "center" as const,
			}
		: undefined;
	return (
		<View
			className="flex-1 bg-canvas"
			style={{
				// A hardcoded inset is a defect: the same rules are `env(safe-area-inset-*)`
				// on the web build and `useSafeAreaInsets()` natively, and both must be
				// applied (tokens.json § safeArea).
				paddingTop: insets.top,
				paddingLeft: insets.left,
				paddingRight: insets.right,
				paddingBottom: scroll ? insets.bottom : 0,
			}}
			testID={testID}
		>
			<View className="h-14 flex-row items-center gap-2 px-4">
				{headerLeading}
				<Heading
					level={1}
					className="flex-1 text-display text-ink"
					numberOfLines={1}
				>
					{title}
				</Heading>
				{headerAction}
			</View>
			{scroll ? (
				<ScrollView
					className="flex-1"
					// `grow` on the CONTENT container, not the ScrollView: without it a screen
					// whose only content is an empty state renders it pinned under the header
					// with the rest of the phone blank, and the empty state's own
					// `justify-center` has nothing to centre within. A list that is taller
					// than the viewport is unaffected.
					// `pt-2` is `space.screen.top` (8): without it the first content box sits
					// flush against the 56 px header, so a page title reads as a bar label and
					// crowds the first section heading (measured gap: 0 px).
					contentContainerClassName="grow px-4 pt-2 pb-6"
					contentContainerStyle={column}
					keyboardShouldPersistTaps="handled"
				>
					{children}
				</ScrollView>
			) : (
				<View className="flex-1" style={column}>
					{children}
				</View>
			)}
		</View>
	);
};
