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
import {
	ModalScopeContext,
	useModalStackEntry,
} from "@/ui/components/modal-stack-entry";
import { useShadow } from "@/ui/elevation";
import { sidebarWidthFor } from "@/ui/layout";
import { effectiveDuration, parseCubicBezier } from "@/ui/motion";
import { TextScaleProvider } from "@/ui/text-scale-provider";
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
 * the overlay shadow, and the scoped `panel-edge` edge. It is a token decision,
 * not a colour hack here: in dark the fill's own step against the scrim ground
 * measured 1.38:1 (D-dark-1) and no scrim alpha fixed it. The drawer consumes
 * the role derived for exactly this pair — measured 4.53:1 against the scrim
 * ground and 3.28:1 against the panel (`design/tokens/contrast-contract.mjs`
 * § 'the overlay panel edge'). Light was already clean (its fill ≈ 8.2:1) and
 * keeps the soft hairline step.
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
	/* The designed panel width PLUS the left inset — the inset is added to the
	 *  panel's OUTER geometry, never spent out of its content column.
	 *
	 *  Widening is what makes the inset free for the content. With the width left
	 *  alone and only padding added, the panel's column takes the whole hit:
	 *  measured at iphone-15-landscape (insets 59/59, env() resolved by the capture
	 *  rig) the empty state's column went 247 → 188 pt, the copy reflowed one line
	 *  and the drawer's own "New chat" CTA fell from 27 of its 48 pt visible to
	 *  6.5 — its label out of view at 100 % text in both themes — while the
	 *  header's host label ellipsized at the DEFAULT text size. The widened panel
	 *  restores the column to its designed width (247 pt) and the CTA to its
	 *  before position, at every scale.
	 *
	 *  The `SIDEBAR_SLIVER` cap inside `sidebarWidthFor` binds only below 336 pt of
	 *  viewport, where no side inset exists (a side inset this large implies a
	 *  landscape phone 844 pt wide, whose sliver is 505 pt of the 844), so adding
	 *  the inset cannot eat the page behind the panel. */
	const panelWidth = sidebarWidthFor(width) + insets.left;
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

	/* The drawer is a THIRD `Modal` renderer, and the stack rule is the primitive's:
	 *  it stands down if a newer modal is mounted over it rather than painting two
	 *  full-viewport surfaces over each other (`@/ui/modal-stack`). It was the
	 *  renderer that made that module's "only two callers" claim false. */
	const { covered, scope } = useModalStackEntry(visible);

	return (
		/* The scope is what keeps this fix and R13's together: the pane's long-press
		 *  menu is a `Sheet` rendered INSIDE this `Modal`, so the scope tells the
		 *  primitive that the menu is this drawer's CONTENT — a modal nested in
		 *  another is not a second full-viewport layer, and standing this drawer down
		 *  would unmount the pane, the menu and the reader's press with it (measured:
		 *  a ~9 ms flicker and no menu). */
		<ModalScopeContext.Provider value={scope}>
			<Modal
				visible={visible && !covered}
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
							className="flex-1 border-panel-edge border-r bg-elevated"
							style={{
								paddingTop: insets.top,
								paddingBottom: insets.bottom,
								/* The panel is anchored to the viewport's LEFT edge, so its own left inset is
								 *  the horizontal safe area that applies to it — and it has to carry it
								 *  itself: a Modal portals onto `document.body` (the note below), which puts
								 *  the panel OUTSIDE the `Screen` that applies `paddingLeft` for every other
								 *  surface, so its rows painted inside the unsafe band on anything with a
								 *  side inset. Measured at iphone-15-landscape (insets 59/59, the env() value
								 *  resolved by the capture rig): the header's host label painted at x=16 and
								 *  the footer tabs at x=35.9, both inside the 59 pt band.
								 *
								 *  The padding goes on the panel's own content view, and the panel ITSELF is
								 *  widened by the same inset (see `panelWidth` above): together they spend the
								 *  inset out of the panel's OUTER geometry while the fill stays full-bleed
								 *  behind the band and the content column keeps its designed width — the same
								 *  shape as the `Screen`, which pads its root rather than its children.
								 *
								 *  LEFT ONLY. The panel is anchored to the left edge and never reaches the
								 *  right one (339 pt of an 844 pt landscape phone, a 505 pt sliver behind),
								 *  so `insets.right` describes a screen edge the panel does not touch;
								 *  reserving it would cost another 59 pt for nothing. `left` is the one that
								 *  moves when the notch (or a rounded corner) is on the side the drawer
								 *  slides in from. */
								paddingLeft: insets.left,
							}}
						>
							{/* The type scale is re-published INSIDE the Modal because a modal is a
							 *  PORTAL: react-native-web appends its node to `document.body`, OUTSIDE the
							 *  `ScopedVariables` div the app's provider renders, so the pane's
							 *  `var(--text-*)` fell back to the stylesheet's fixed px values and the
							 *  drawer was the one surface that ignored the reader's text size —
							 *  measured by the capture: at iphone-se / 200 % the drawer's cells scaled
							 *  1.0-1.17x while every surface beside them scaled 2.00x (PR #34 review
							 *  round 2, F1). On native the provider is context-only, so this
							 *  re-declares the same values rather than computing a second scale. */}
							<TextScaleProvider>
								<ConversationsPane
									onClose={close}
									onNavigate={close}
									onNewChat={onNewChat}
									notice={notice}
									homeDirectory={homeDirectory}
								/>
							</TextScaleProvider>
						</View>
					</Animated.View>
				</View>
			</Modal>
		</ModalScopeContext.Provider>
	);
};
