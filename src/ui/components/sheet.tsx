import { X } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import {
	Animated,
	Easing,
	Modal,
	Pressable,
	ScrollView,
	Text,
	View,
} from "react-native";

import { CONTROL, ROLE } from "@/ui/a11y";
import { useReducedMotion, useTokenColor } from "@/ui/appearance";
import { IconButton } from "@/ui/components/icon-button";
import { useShadow } from "@/ui/elevation";
import { effectiveDuration, parseCubicBezier } from "@/ui/motion";
import { DURATIONS, EASINGS } from "@/ui/tokens.gen";
import {
	SHEET_DETENTS,
	SHEET_SURFACE_CLASS,
	type SheetDetent,
} from "@/ui/variants";

/**
 * A bottom sheet: bottom-anchored, never centred — a centred dialog on a phone is
 * under neither thumb (docs/design/components.md § 8).
 *
 * The detent cap is a fraction of the SCROLL COLUMN this sheet lives in, not of
 * the viewport. That distinction is the reason the height is measured with
 * `onLayout`: the two numbers are identical until a keyboard opens, which is
 * exactly when the mistake bites — the shipped web client measured a `60dvh` card
 * putting its own send button under the column's clipped foot at 360×780.
 *
 * **No drag gesture.** A drag handle with no drag is worse than no handle, so
 * dismissal is the scrim, the Close control, or Escape.
 *
 * Focus: on a phone the platform moves focus into a modal for us, and the
 * platform's own behaviour is what a screen reader follows. What the kit asks for
 * that is NOT automatic — returning focus to the opener on close — is left to the
 * caller, because only the caller holds the opener's ref.
 */
export type SheetProps = {
	visible: boolean;
	onClose: () => void;
	/** The sheet's accessible name; also its visible title. */
	title: string;
	detent?: SheetDetent;
	children: React.ReactNode;
	testID?: string;
};

export const Sheet = ({
	visible,
	onClose,
	title,
	detent = "content",
	children,
	testID,
}: SheetProps) => {
	const reduceMotion = useReducedMotion();
	const shadow = useShadow("overlay");
	const scrimColour = useTokenColor("scrim");
	const [columnHeight, setColumnHeight] = useState(0);
	const rise = useRef(new Animated.Value(0)).current;
	const scrimFade = useRef(new Animated.Value(0)).current;

	useEffect(() => {
		if (!visible) {
			rise.setValue(0);
			scrimFade.setValue(0);
			return;
		}
		// `duration.slow` / `ease-out-expo` for the rise, `duration.fast` for the
		// scrim. Both pass through `effectiveDuration`, so reduced motion caps the
		// durations instead of removing the feedback that a press is a press.
		Animated.parallel([
			Animated.timing(rise, {
				toValue: 1,
				duration: effectiveDuration(DURATIONS.slow, reduceMotion),
				easing: Easing.bezier(...parseCubicBezier(EASINGS["out-expo"])),
				useNativeDriver: true,
			}),
			Animated.timing(scrimFade, {
				toValue: 1,
				duration: effectiveDuration(DURATIONS.fast, reduceMotion),
				useNativeDriver: true,
			}),
		]).start();
	}, [visible, rise, scrimFade, reduceMotion]);

	const fraction = SHEET_DETENTS[detent];
	const maxContentHeight =
		fraction === null || columnHeight === 0
			? undefined
			: Math.round(columnHeight * fraction);

	return (
		<Modal
			visible={visible}
			transparent
			animationType="none"
			onRequestClose={onClose}
			// The covered application is inert while the sheet is up: `aria-modal`
			// alone does not remove it from keyboard or screen-reader navigation.
			accessibilityViewIsModal
			testID={testID}
		>
			<View
				className="flex-1 justify-end"
				onLayout={(event) => setColumnHeight(event.nativeEvent.layout.height)}
			>
				<Animated.View
					style={{ opacity: scrimFade }}
					className="absolute inset-0"
				>
					<Pressable
						className="flex-1"
						style={{ backgroundColor: scrimColour }}
						accessibilityRole={ROLE.button}
						accessibilityLabel="Close"
						testID={CONTROL.sheetScrim}
						onPress={onClose}
					/>
				</Animated.View>

				<Animated.View
					className={SHEET_SURFACE_CLASS}
					style={{
						...shadow,
						transform: [
							{
								translateY: rise.interpolate({
									inputRange: [0, 1],
									outputRange: [40, 0],
								}),
							},
						],
					}}
				>
					<View className="flex-row items-center gap-2 px-4 py-3">
						<Text
							className="flex-1 text-title text-ink"
							accessibilityRole={ROLE.header}
						>
							{title}
						</Text>
						<IconButton
							accessibilityLabel="Close"
							testID={CONTROL.sheetClose}
							onPress={onClose}
							icon={({ color, size }) => <X color={color} size={size} />}
						/>
					</View>
					<ScrollView
						style={
							maxContentHeight === undefined
								? undefined
								: { maxHeight: maxContentHeight }
						}
						contentContainerClassName="px-4 pb-6"
					>
						{children}
					</ScrollView>
				</Animated.View>
			</View>
		</Modal>
	);
};
