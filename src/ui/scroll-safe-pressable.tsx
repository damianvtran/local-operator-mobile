/**
 * A pressable that wraps a horizontal `ScrollView` without stopping it.
 *
 * On iOS a `Pressable` claims the JS responder when a touch lands in it, and
 * the native scroll recognizer inside never starts its drag: a wide code block
 * or diagram could not be scrolled sideways, and the swipe that tried ended as a
 * tap (the code block read "copied"). Here the press and the long-press are
 * read from raw touch events (`@/ui/touch-press`) so the scroller keeps its
 * drag; a drag past the slop is neither a press nor a hold.
 *
 * Everywhere else this IS a `Pressable`: Android's native touch interception
 * already lets a nested scroller take the drag, and the web has no touch
 * events for a mouse.
 */
import type { ReactNode } from "react";
import {
	Platform,
	Pressable,
	type StyleProp,
	View,
	type ViewStyle,
} from "react-native";

import { useTouchPress } from "@/ui/touch-press";

export type ScrollSafePressableProps = {
	children: ReactNode;
	onPress?: () => void;
	onLongPress?: () => void;
	accessibilityRole?: "button";
	accessibilityLabel?: string;
	accessibilityHint?: string;
	"aria-valuetext"?: string;
	testID?: string;
	style?: StyleProp<ViewStyle>;
};

export function ScrollSafePressable(props: ScrollSafePressableProps) {
	const { onPress, onLongPress, children, ...rest } = props;
	const touches = useTouchPress({ onPress, onLongPress });
	if (Platform.OS !== "ios") {
		return (
			<Pressable onPress={onPress} onLongPress={onLongPress} {...rest}>
				{children}
			</Pressable>
		);
	}
	return (
		<View
			{...touches}
			{...rest}
			// One accessibility element that VoiceOver can activate, as the
			// Pressable it replaces was.
			accessible
			onAccessibilityTap={onPress}
		>
			{children}
		</View>
	);
}
