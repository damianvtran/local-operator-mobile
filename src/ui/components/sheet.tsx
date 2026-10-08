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
import {
	ModalScopeContext,
	useModalStackEntry,
} from "@/ui/components/modal-stack-entry";
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
 * What the header and the pinned footer are assumed to cost on the FIRST frame,
 * before `onLayout` has answered.
 *
 * Deliberately generous (a 56 pt title row and a 104 pt action region at 100 %,
 * against 56 + 52 measured on the narrowest phone): these only shrink the body
 * for one frame, and the failure they guard against is a surface drawn taller
 * than the column — which is the shape that puts a sheet's own title in the
 * device's top unsafe band.
 */
const CHROME_SEED_HEADER = 64;
const CHROME_SEED_FOOTER = 112;
/** The body never collapses to nothing, however tall the reader's type is. */
const MIN_CONTENT_HEIGHT = 120;

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
	/**
	 * The pinned region: what answers the sheet, and the surface that reports why
	 * it refused, OUTSIDE the scroll region (docs/design/components.md § 8/§ 13).
	 *
	 * Why this exists rather than "make the sheet taller". A form whose answering
	 * control scrolls with its fields can put that control out of reach — measured
	 * on this slice's own create form at the `content` detent: on a 320 pt phone at
	 * 100 % the visible band ended at the Status chips, so `Create` and the relay's
	 * refusal were both below the fold, and at 200 % they were on EVERY phone; the
	 * refusal element was in the DOM in 27 of 28 captured combinations and painted
	 * in 11. Raising the detent does not fix it (the form is taller than the window
	 * at every detent), which is why the kit's rule is the three-region one: the
	 * header, the scrolling body, and a pinned action region that never scrolls.
	 */
	footer?: React.ReactNode;
	testID?: string;
};

export const Sheet = ({
	visible,
	onClose,
	title,
	detent = "content",
	children,
	footer,
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
	/*
	 * THE CAP IS SPENT ACROSS THREE REGIONS, not on the body alone.
	 *
	 * The detent bounds the SURFACE — header, scrolling body, pinned footer — so the
	 * body gets the cap MINUS the two rows that never scroll. Bounding only the body
	 * (what this did before the footer existed) drew a surface as tall as the cap
	 * PLUS the header, and with a footer it would have been the cap plus both: the
	 * header could pass the column's own top and land in the unsafe band, which is
	 * the `U-05` shape this file already carries a fix for. Bounding the surface
	 * itself (`maxHeight` on it, with `flexShrink` on the body) was tried first and
	 * measured WRONG: react-native-web does not shrink a `ScrollView` inside a
	 * max-constrained column, so the surface was bounded while its content spilled
	 * past the sheet's own edge over the scrim — the audit's `U-08` reported the
	 * spill as a 318x238pt overlap on every scale, and the pinned action was drawn
	 * below the viewport rather than above it.
	 *
	 * The two measured rows are what they are only after `onLayout`, so the first
	 * frame uses `CHROME_SEED` — deliberately generous, because the failure it
	 * guards against is a surface that is too tall rather than too short.
	 */
	const [headerHeight, setHeaderHeight] = useState(0);
	const [footerHeight, setFooterHeight] = useState(0);
	const measuredChrome = headerHeight + footerHeight;
	const chrome =
		measuredChrome > 0
			? measuredChrome
			: footer === undefined
				? CHROME_SEED_HEADER
				: CHROME_SEED_HEADER + CHROME_SEED_FOOTER;
	const maxContentHeight =
		fraction === null
			? undefined
			: Math.max(MIN_CONTENT_HEIGHT, Math.round(capHeight * fraction) - chrome);
	/* A modal that mounts while another is up stands down rather than painting a
	 *  second full-viewport surface over it — the rule and its reasoning are in
	 *  `@/ui/modal-stack`, and the registration lives here because this is where the
	 *  `Modal` is rendered. */
	const { covered, dims: drawsDim, scope } = useModalStackEntry(visible);

	return (
		/* The scope publishes this sheet as the HOST of anything a modal is raised
		 *  inside it — the conversations pane's menu is the app's nested case. */
		<ModalScopeContext.Provider value={scope}>
			<Modal
				visible={visible && !covered}
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
						onLayout={(event) =>
							setColumnHeight(event.nativeEvent.layout.height)
						}
					>
						{/*
						 * THE SCRIM IS DRAWN ONLY WHEN THIS SHEET IS THE ONE DIM. Hosted
						 * by a surface that already dims the screen (the conversations
						 * drawer), this stays exactly what it also always was — the
						 * topmost PRESS LAYER, so a tap outside still closes the sheet —
						 * and paints no dim of its own (design round 5, D7/D8/D9: the
						 * hand-over between two dimmers flashed the strip undimmed for
						 * 40-89 ms on close, dipped to 0.570 on open and pulsed to 0.91).
						 * `opacity` stays 1 rather than animating: there is no dim here
						 * to fade, and a faded press layer would swallow presses while
						 * invisible.
						 *
						 * What keeps the audit's overlap rule quiet is NOT this layer's
						 * transparency — round 6 claimed that and CI disproved it (six
						 * `U-08` FAILs on `S15/menu-open`). `isGhost` is
						 * `clippedAway || (ariaHidden && !ownInk)`, so an interactive,
						 * non-aria-hidden box stays in the pair set however transparent it
						 * is; the host's layer leaves it instead, by stopping being a
						 * control while this modal owns the dismiss.
						 */}
						<Animated.View
							style={{ opacity: drawsDim ? scrimFade : 1 }}
							className="absolute inset-0"
						>
							<Pressable
								className="flex-1"
								style={{
									backgroundColor: drawsDim ? scrimColour : "transparent",
								}}
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
							<View
								className="flex-row items-center gap-2 px-4 py-3"
								onLayout={(event) =>
									setHeaderHeight(event.nativeEvent.layout.height)
								}
							>
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
								 *  effort / slash sheets are corrected by the same line. With a pinned
								 *  footer the inset belongs to the FOOTER (it is the last thing drawn),
								 *  so the body keeps only the gutters — double-spending it would leave a
								 *  dead band between the last field and the action. */
								contentContainerStyle={{
									paddingBottom: footer === undefined ? 24 + insets.bottom : 16,
								}}
							>
								{children}
							</ScrollView>
							{footer === undefined ? null : (
								<View
									className="px-4 pt-3"
									onLayout={(event) =>
										setFooterHeight(event.nativeEvent.layout.height)
									}
									style={{ paddingBottom: 24 + insets.bottom }}
								>
									{footer}
								</View>
							)}
						</Animated.View>
					</View>
				</ScopedVariables>
			</Modal>
		</ModalScopeContext.Provider>
	);
};
