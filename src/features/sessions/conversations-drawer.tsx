import { type ReactNode, useEffect, useRef } from "react";
import {
	AccessibilityInfo,
	BackHandler,
	findNodeHandle,
	Keyboard,
	Modal,
	Platform,
	Pressable,
	useWindowDimensions,
	View,
} from "react-native";
import Animated, {
	type SharedValue,
	useAnimatedStyle,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
	ConversationsPane,
	WorkspaceSidebarFooter,
} from "@/features/sessions/conversations-pane";
import {
	cancelDrawerNewChat,
	finishDrawerDismiss,
	requestDrawerNewChat,
} from "@/features/sessions/drawer-focus";
import { t } from "@/i18n";
import { CONTROL, ROLE, SURFACE } from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import {
	ModalScopeContext,
	useModalStackEntry,
} from "@/ui/components/modal-stack-entry";
import { useShadow } from "@/ui/elevation";
import { exitPointerEvents } from "@/ui/modal-exit";
import {
	guardScrimFocus,
	keyboardInput,
	PROGRAMMATIC_FOCUS_CLASS,
	scrimFocusRedirect,
	webPointerOnly,
} from "@/ui/programmatic-focus";
import { TextScaleProvider } from "@/ui/text-scale-provider";
import { cx } from "@/ui/variants";

/**
 * The conversations drawer: the temporary variant of Material's navigation
 * drawer, which is the one Material requires on a phone.
 *
 * **It is an overlay, not a route.** The panel is not a destination — closing it
 * returns the reader to the composer they were on, the draft included — so it
 * is an overlay over the route stack rather than a pushed screen. The panel
 * COVERs; the home beneath is never unmounted (a push would lose a draft and
 * re-run the home's cold-start effects).
 *
 * **NATIVE IS A ROOT OVERLAY; WEB KEEPS THE MODAL.** The drawer follows the
 * finger from the first frame (a `Modal` has to be presented before its panel
 * can move, which costs frames), so on native it is an absolute-fill view at
 * the layout root, rendered after the stack. Its a11y and back behaviour are
 * recreated here: `accessibilityViewIsModal` and the escape action, an Android
 * `BackHandler` while it is open, and focus moved to the panel on open. On web
 * a `Modal` still owns the focus trap and Escape (`onRequestClose`); the shell
 * is the same panel and the same curve.
 *
 * **FULL WIDTH, ONE CURVE (operator, 2026-11-26).** The drawer covers 100 % of
 * the screen, so there is no page beside it to tap: the panel slides in on
 * `cubic-bezier(.42,0,.58,1)`, 320 ms for a full travel with a 120 ms floor,
 * the same curve for open, close and tap-open (the release path resumes it from
 * the finger's position — `@/ui/drawer-motion`). The scrim still fades with the
 * travel, but at rest it sits entirely behind the panel.
 *
 * **The dim claim moves to the pane's own modals.** A full-width drawer never
 * shows the page, so the host does not claim a dim (`scrim: false`): a sheet
 * raised inside the drawer paints its own. The scrim element remains the
 * dismiss target while the panel is mid-travel.
 *
 * **Dismissal is threefold, and all three close the same way**: the scrim, the
 * pane's own close control, and Android's back gesture. Closing dismisses the
 * keyboard first when the composer had focus, so the reader sees the home they
 * were returning to rather than a keyboard over it.
 */
/** The panel's fill, named ONCE: it paints the panel AND is the surface the rows'
 *  corner badge rings itself in (`ConversationsPane`'s `surfaceClassName`). Two
 *  literals of one fact let the ring drift off the fill with a single edit — the
 *  R2-2 halo — so both sites read this (agent review round 3, R3-1). A full
 *  class literal, so the stylesheet compiler still sees the class. */
const PANEL_SURFACE = "bg-elevated";

export type ConversationsDrawerProps = {
	/** The reader's intent: open. False from the instant a close starts, which
	 *  is what makes the panel inert while it exits. */
	visible: boolean;
	/** Whether the shell is on screen. True from open until the close settle
	 *  ends, so the exit animation is visible rather than cut off at its start. */
	presented: boolean;
	/** 0 (closed) … 1 (full width) on the UI thread; `open()`/`close()` in the
	 *  provider settle it. The shell only reads it. */
	progress: SharedValue<number>;
	onClose: () => void;
	onNavigate?: () => void;
	onDismiss?: () => void;
	currentSessionId?: string;
	header?: ReactNode;
	content?: ReactNode;
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
	presented,
	progress,
	onClose,
	onNavigate,
	onDismiss,
	currentSessionId,
	header,
	content,
	onNewChat,
	notice,
	homeDirectory,
}: ConversationsDrawerProps) => {
	const insets = useSafeAreaInsets();
	const { width } = useWindowDimensions();
	const shadow = useShadow("overlay");
	const scrimColour = useTokenColor("scrim");

	const newChatIntent = useRef(false);
	// Changing the owning callback or unmounting cancels an old intent; reopening
	// and non-New-chat dismissals must never focus a different conversation.
	useEffect(() => {
		if (!onNewChat) cancelDrawerNewChat(newChatIntent);
		return () => cancelDrawerNewChat(newChatIntent);
	}, [onNewChat]);
	useEffect(() => {
		if (visible) cancelDrawerNewChat(newChatIntent);
	}, [visible]);
	const dismiss = () => {
		/* The keyboard yields first: the composer is where the reader came from,
		 * and a keyboard that outlives the drawer would sit over the home at the
		 * moment it is shown. */
		Keyboard.dismiss();
		onClose();
	};
	const close = () => {
		cancelDrawerNewChat(newChatIntent);
		dismiss();
	};
	const newChat = () => {
		if (onNewChat)
			requestDrawerNewChat(Platform.OS, newChatIntent, dismiss, onNewChat);
	};

	/* The drawer is a THIRD `Modal` renderer on web, and the stack rule is the
	 *  primitive's: it stands down if a newer root modal is mounted over it
	 *  rather than painting two full-viewport surfaces over each other
	 *  (`@/ui/modal-stack`). The native overlay is not a `Modal`, but it still
	 *  PUBLISHES its scope, because the pane's long-press `Sheet` can be raised
	 *  inside it. */
	const { covered, nested, scope } = useModalStackEntry(presented, {
		scrim: false,
	});

	/* The panel translates from one full width off-screen to 0, driven by the
	 *  provider's shared value. One path for the finger, tap-open, spring-back
	 *  and close. */
	const panelStyle = useAnimatedStyle(() => ({
		transform: [{ translateX: (progress.value - 1) * width }],
	}));
	const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.value }));

	/* Web only: react-native-web's modal trap focuses the first node that
	 *  ACCEPTS focus — on open, and whenever Tab wraps — and the scrim is first
	 *  in DOM order. `tabIndex={-1}` keeps it out of the tab sequence but not
	 *  out of the trap's reach, so each wrap landed on an unmarked stop named
	 *  "Close conversations" that Enter would act on (review round 1: R1 / D1 /
	 *  Q1). The guard moves KEYBOARD focus off the scrim, so the trap's walk
	 *  continues to the panel's first control on open and on every forward
	 *  wrap; a backward wrap reaches the last control (review round 2, R2-1). */
	const scrimRef = useRef<View>(null);
	useEffect(() => {
		if (!visible || nested || Platform.OS !== "web") return;
		const scrim = scrimRef.current as unknown as HTMLElement | null;
		if (!scrim) return;
		return guardScrimFocus(scrim, () =>
			scrimFocusRedirect(false, keyboardInput())
				? /* THIS modal's Close, scoped to the dialog the scrim sits in. A
					 *  trap walk does not stop here: it moves on to the panel's first
					 *  control, which is where a wrap lands. */
					scrim
						.closest<HTMLElement>('[aria-modal="true"]')
						?.querySelector<HTMLElement>(
							`[data-testid="${CONTROL.sidebarClose}"]`,
						)
				: null,
		);
	}, [visible, nested]);

	/* Android has no native stack entry to pop for the overlay: while it is
	 *  OPEN, back closes it. A `Modal` above it is a separate window and takes
	 *  back first, which is the §4.3 order. */
	useEffect(() => {
		if (Platform.OS !== "android" || !presented || !visible) return;
		const subscription = BackHandler.addEventListener(
			"hardwareBackPress",
			() => {
				onClose();
				return true;
			},
		);
		return () => subscription.remove();
	}, [presented, visible, onClose]);

	/* The panel takes VoiceOver's focus on open; the trigger is restored by the
	 *  provider's `returnFocus` on close. `setAccessibilityFocus` needs a native
	 *  tag, so this is a no-op on web (which has the Modal's own trap). */
	const panelRef = useRef<View>(null);
	useEffect(() => {
		if (!visible || Platform.OS === "web") return;
		const tag = findNodeHandle(panelRef.current);
		if (tag !== null) AccessibilityInfo.setAccessibilityFocus(tag);
	}, [visible]);

	const panel = (
		<Animated.View
			className="absolute inset-y-0 left-0"
			testID={SURFACE.sidebar}
			style={[{ width }, shadow, panelStyle]}
		>
			<View
				ref={panelRef}
				/* BORDERLESS (operator, TestFlight 578: "Make the conversation
				 *  sidebar borderless, I don't like the right border"). The
				 *  `panel-edge` hairline on the facing edge is gone; the panel's
				 *  edge is now drawn by the overlay shadow (`useShadow("overlay")`
				 *  on the sliding view above) and the scrim's dim on the page. */
				className={`flex-1 ${PANEL_SURFACE}`}
				style={{
					paddingTop: insets.top,
					paddingBottom: insets.bottom,
					/* The panel spans the whole viewport, but its CONTENT still has
					 *  to stay out of the horizontal safe area: the panel is anchored
					 *  to the physical left edge, so `insets.left` is the band that
					 *  applies to its first column (a landscape notch). LEFT ONLY,
					 *  because the panel never ends at the right edge. */
					paddingLeft: insets.left,
					paddingRight: insets.right,
				}}
			>
				{/* The type scale is re-published INSIDE the shell because the web
				 *  Modal is a PORTAL: react-native-web appends its node to
				 *  `document.body`, OUTSIDE the `ScopedVariables` div the app's
				 *  provider renders, so the pane's `var(--text-*)` fell back to the
				 *  stylesheet's fixed px values and the drawer was the one surface
				 *  that ignored the reader's text size (PR #34 review round 2, F1).
				 *  On native the provider is context-only, so this re-declares the
				 *  same values rather than computing a second scale. */}
				<TextScaleProvider>
					{header}
					{content ? (
						<View className="min-h-0 flex-1">
							{content}
							<WorkspaceSidebarFooter
								onNavigate={onNavigate ?? close}
								hasModeHeader={Boolean(header)}
							/>
						</View>
					) : (
						<ConversationsPane
							onClose={close}
							hideCloseButton={Boolean(header)}
							onNavigate={onNavigate ?? close}
							currentSessionId={currentSessionId}
							onNewChat={onNewChat ? newChat : undefined}
							notice={notice}
							homeDirectory={homeDirectory}
							/* The rows are painted on THIS panel's fill, not on the
							 *  screen's canvas: the corner badge's ring must be the same
							 *  colour or it reads as a halo (agent review round 2, R2-2). */
							surfaceClassName={PANEL_SURFACE}
						/>
					)}
				</TextScaleProvider>
			</View>
		</Animated.View>
	);

	if (Platform.OS === "web") {
		return (
			/* The scope is what keeps this fix and R13's together: the pane's
			 *  long-press menu is a `Sheet` rendered INSIDE this `Modal`, so the
			 *  scope tells the primitive that the menu is this drawer's CONTENT —
			 *  a modal nested in another is not a second full-viewport layer, and
			 *  standing this drawer down would unmount the pane, the menu and the
			 *  reader's press with it (measured: a ~9 ms flicker and no menu). */
			<ModalScopeContext.Provider value={scope}>
				<Modal
					visible={presented && !covered}
					transparent
					animationType="none"
					onRequestClose={close}
					onDismiss={() => {
						finishDrawerDismiss(newChatIntent, onNewChat);
						onDismiss?.();
					}}
					// The covered application is inert while the drawer is up:
					// `aria-modal` alone does not remove it from keyboard or
					// screen-reader navigation.
					accessibilityViewIsModal
				>
					{/* Inert from the close on: the exit keeps the drawer mounted, and a
					 *  second tap on a footer destination must not push its route twice
					 *  (review round 1, R2; the rule is `exitPointerEvents`). */}
					<View className="flex-1" pointerEvents={exitPointerEvents(visible)}>
						<Animated.View
							style={[scrimStyle, { backgroundColor: scrimColour }]}
							className="absolute inset-0"
							pointerEvents="box-none"
						>
							{/* Pointer-only on the web: the pane's own labelled Close is the
							 *  keyboard route, and react-native-web's focus trap lands on
							 *  this first focusable node on open — its browser ring drew a
							 *  1 px line down the drawer's edge (`@/ui/programmatic-focus`). */}
							<Pressable
								ref={scrimRef}
								className={cx("flex-1", PROGRAMMATIC_FOCUS_CLASS)}
								accessibilityRole={ROLE.button}
								accessibilityLabel={t("mobile.chrome.close_conversations")}
								{...webPointerOnly(Platform.OS)}
								onPress={close}
							/>
						</Animated.View>
						{panel}
					</View>
				</Modal>
			</ModalScopeContext.Provider>
		);
	}

	if (!presented || covered) return null;
	/* The native overlay root: the panel plus the scrim that receives a tap while
	 *  the panel is still travelling. It is `accessibilityViewIsModal` so
	 *  VoiceOver treats the page behind it as inert, and the two-finger escape
	 *  closes it. */
	return (
		<ModalScopeContext.Provider value={scope}>
			<View
				className="absolute inset-0"
				pointerEvents={visible ? "auto" : "none"}
				accessibilityViewIsModal
				onAccessibilityEscape={close}
			>
				<Animated.View
					style={[scrimStyle, { backgroundColor: scrimColour }]}
					className="absolute inset-0"
				>
					<Pressable
						className="flex-1"
						accessibilityRole={ROLE.button}
						accessibilityLabel={t("mobile.chrome.close_conversations")}
						onPress={close}
					/>
				</Animated.View>
				{panel}
			</View>
		</ModalScopeContext.Provider>
	);
};
