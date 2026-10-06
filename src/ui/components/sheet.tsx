import { X } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import {
	Animated,
	Easing,
	Modal,
	Pressable,
	ScrollView,
	useWindowDimensions,
	View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScopedVariables } from "uniwind";

import { CONTROL, ROLE } from "@/ui/a11y";
import { useReducedMotion, useTokenColor } from "@/ui/appearance";
import { Heading } from "@/ui/components/heading";
import { IconButton } from "@/ui/components/icon-button";
import { useShadow } from "@/ui/elevation";
import { effectiveDuration, parseCubicBezier } from "@/ui/motion";
import { useTextScale } from "@/ui/text-scale-provider";
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
	/* The home-indicator inset belongs to the SCROLL CONTENT, not the sheet's own
	 *  bottom edge: the surface stays anchored where flex puts it (screen bottom),
	 *  and the last row of content has to clear the indicator. Without it the last
	 *  row sat ~10 pt UNDER the indicator on a 34 pt-inset device — the rest of the
	 *  app already reads the insets (`screen.tsx`), so this was an inconsistency
	 *  of the primitive, not a policy (`E2` D1/U-05). */
	const insets = useSafeAreaInsets();
	/* The scaled type variables, republished INSIDE the modal — the why is at
	 *  the `ScopedVariables` call below. */
	const { variables } = useTextScale();
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
	/*
	 * THE CAP EXISTS FROM THE FIRST FRAME, and that is the whole reason for the
	 * window fallback.
	 *
	 * `columnHeight` comes from `onLayout`, which react-native-web answers from a
	 * `ResizeObserver` — a frame LATER. Until it lands, a bounded detent had no
	 * bound at all, so a tall sheet was painted at its full natural height for one
	 * frame and its own header row sat inside the device's top unsafe band.
	 * MEASURED, not reasoned about: this slice's audit re-drives the create cell,
	 * reads the geometry as soon as the sheet's marker appears, and reported
	 * `U-05 dialog content sits at 1pt, inside the 20pt unsafe top inset` — while
	 * the captured FRAME of the same cell (taken after the settle window, when
	 * `onLayout` had landed) was correctly capped. The window's height is the right
	 * seed rather than a guess: the column IS the window until a keyboard opens,
	 * which is the case `onLayout` exists to correct.
	 */
	const windowHeight = useWindowDimensions().height;
	const capHeight = columnHeight > 0 ? columnHeight : windowHeight;
	const maxContentHeight =
		fraction === null ? undefined : Math.round(capHeight * fraction);

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
			{/* The scaled type-scale variables are RE-PUBLISHED inside the modal:
			 *  a React Native `Modal` renders through its own root — on the web,
			 *  react-native-web portals it to a fresh node under `document.body` —
			 *  which sits outside the element `TextScaleProvider` writes the scaled
			 *  variables onto, so the sheet's own type kept the 100 % sizes while
			 *  everything around it scaled (measured: the sheet title stayed 20 px
			 *  at a 200 % setting — design D2). This is the provider's own mechanism
			 *  applied one level down; on native it merely re-provides the same
			 *  context. */}
			<ScopedVariables variables={variables}>
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
							/* THE SIDE BANDS, for the same reason the bottom one below is spent on
							 *  the scroll content: a bottom sheet is full-bleed, so the moment the notch
							 *  moves to an edge — landscape — its title AND its close control paint
							 *  inside the unsafe band. Measured at iphone-15-landscape (insets 59/59,
							 *  resolved by the capture rig): the title's left edge is x = 17, and the
							 *  close control's right edge reaches x = 828 of 844.
							 *
							 *  The padding rides on the SURFACE, which carries the fill, so the sheet
							 *  stays full-bleed behind the band and only its content is inset — the
							 *  shape `Screen` uses (it pads its root, not its children). It is NOT
							 *  `ConversationsDrawer`'s widen-and-pad: that spends the inset out of a
							 *  FIXED-width panel's outer geometry, and a full-viewport surface has no
							 *  outer geometry left to widen. */
							paddingLeft: insets.left,
							paddingRight: insets.right,
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
							<Heading level={2} className="flex-1 text-title text-ink">
								{title}
							</Heading>
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
							contentContainerClassName="px-4"
							/* `pb-6` (24) plus the safe-area inset, computed rather than spelled
							 *  as a class so the indicator's height rides the DEVICE, and the model /
							 *  effort / slash sheets are corrected by the same line. */
							contentContainerStyle={{ paddingBottom: 24 + insets.bottom }}
						>
							{children}
						</ScrollView>
					</Animated.View>
				</View>
			</ScopedVariables>
		</Modal>
	);
};
