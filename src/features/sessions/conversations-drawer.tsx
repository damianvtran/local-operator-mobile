import { useEffect, useRef } from "react";
import {
	Animated,
	Easing,
	Keyboard,
	Modal,
	Pressable,
	useWindowDimensions,
	View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ConversationsPane } from "@/features/sessions/conversations-pane";
import { ROLE, SURFACE } from "@/ui/a11y";
import { useReducedMotion, useTokenColor } from "@/ui/appearance";
import { useShadow } from "@/ui/elevation";
import { sidebarWidthFor } from "@/ui/layout";
import { effectiveDuration, parseCubicBezier } from "@/ui/motion";
import { DURATIONS, EASINGS } from "@/ui/tokens.gen";

/**
 * The conversations drawer: the temporary variant of Material's navigation
 * drawer, which is the one Material requires on a phone.
 *
 * **It is an overlay, not a route.** The panel is not a destination — closing it
 * returns the reader to the composer they were on, the draft included — so it is
 * a `Modal` over the home rather than a pushed screen. The panel COVERs; the home
 * beneath is never unmounted (a push would lose a draft and re-run the home's
 * cold-start effects). The panel itself, ruled by the spec: `elevated` ground,
 * the overlay shadow, a `hairline` edge — and the design round confirms the
 * dark-theme read of that edge on a captured frame, because the computed
 * scrim-to-panel contrast in dark is 1.38:1 and no alpha of the scrim role fixes
 * it (D-dark-1; the fix, if the frame confirms it, is a token decision, not a
 * colour hack here).
 *
 * **Dismissal is threefold, and all three close the same way**: the scrim, the
 * pane's own close control, and Android's back gesture (`onRequestClose` — the
 * flow § 11 rule that every modal surface is back-dismissible). Closing dismisses
 * the keyboard first when the composer had focus, so the reader sees the home
 * they were returning to rather than a keyboard over it.
 *
 * The slide is `duration.slow` through `effectiveDuration`, so reduced motion
 * caps it instead of killing it (a press is a press); the scrim fades on
 * `duration.fast`. Same pattern as `Sheet`, deliberately — one motion idiom.
 */
export type ConversationsDrawerProps = {
	visible: boolean;
	onClose: () => void;
	/** The home's staging slot: close, then focus the composer (the home owns
	 *  the field, so only it can do the second half). */
	onNewChat?: () => void;
	/** The programmatic notice line (ADR 0006 § 6.6). */
	notice?: string | null;
	/** The relay's home path, for the rows' `~`-shortened cwd. */
	homeDirectory?: string | null;
};

export const ConversationsDrawer = ({
	visible,
	onClose,
	onNewChat,
	notice,
	homeDirectory,
}: ConversationsDrawerProps) => {
	const insets = useSafeAreaInsets();
	const { width } = useWindowDimensions();
	const panelWidth = sidebarWidthFor(width);
	const reduceMotion = useReducedMotion();
	const shadow = useShadow("overlay");
	const scrimColour = useTokenColor("scrim");
	const slide = useRef(new Animated.Value(0)).current;
	const scrimFade = useRef(new Animated.Value(0)).current;

	useEffect(() => {
		if (!visible) {
			slide.setValue(0);
			scrimFade.setValue(0);
			return;
		}
		Animated.parallel([
			Animated.timing(slide, {
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
	}, [visible, slide, scrimFade, reduceMotion]);

	const close = () => {
		/* The keyboard yields first: the composer is where the reader came from,
		 * and a keyboard that outlives the drawer would sit over the home at the
		 * moment it is shown. */
		Keyboard.dismiss();
		onClose();
	};

	return (
		<Modal
			visible={visible}
			transparent
			animationType="none"
			onRequestClose={close}
			// The covered application is inert while the drawer is up: `aria-modal`
			// alone does not remove it from keyboard or screen-reader navigation.
			accessibilityViewIsModal
		>
			<View className="flex-1">
				<Animated.View
					style={{ opacity: scrimFade }}
					className="absolute inset-0"
				>
					<Pressable
						className="flex-1"
						style={{ backgroundColor: scrimColour }}
						accessibilityRole={ROLE.button}
						accessibilityLabel="Close conversations"
						onPress={close}
					/>
				</Animated.View>

				<Animated.View
					className="absolute inset-y-0 left-0"
					testID={SURFACE.sidebar}
					style={{
						width: panelWidth,
						...shadow,
						transform: [
							{
								translateX: slide.interpolate({
									inputRange: [0, 1],
									outputRange: [-panelWidth, 0],
								}),
							},
						],
					}}
				>
					<View
						className="flex-1 border-hairline border-r bg-elevated"
						style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
					>
						<ConversationsPane
							onClose={close}
							onNavigate={close}
							onNewChat={onNewChat}
							notice={notice}
							homeDirectory={homeDirectory}
						/>
					</View>
				</Animated.View>
			</View>
		</Modal>
	);
};
