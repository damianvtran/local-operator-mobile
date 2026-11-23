import { X } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	AccessibilityInfo,
	Animated,
	Easing,
	findNodeHandle,
	Keyboard,
	LayoutAnimation,
	Modal,
	Platform,
	Pressable,
	ScrollView,
	type Text,
	useWindowDimensions,
	View,
} from "react-native";
import {
	Gesture,
	GestureDetector,
	GestureHandlerRootView,
} from "react-native-gesture-handler";
import Animated2, {
	runOnJS,
	useAnimatedStyle,
	useSharedValue,
	withSpring,
	withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { ScopedVariables } from "uniwind";
import {
	KEYBOARD_HIDDEN,
	type KeyboardFrame,
	keyboardFrameNow,
	subscribeKeyboardFrame,
} from "@/features/session/keyboard-frame";
import { t } from "@/i18n";
import { haptic } from "@/lib/haptics";
import { CONTROL, ROLE, SURFACE } from "@/ui/a11y";
import { useReducedMotion, useTokenColor } from "@/ui/appearance";
import { Heading } from "@/ui/components/heading";
import { IconButton } from "@/ui/components/icon-button";
import {
	ModalScopeContext,
	useModalStackEntry,
} from "@/ui/components/modal-stack-entry";
import { SheetBodyScrollContext } from "@/ui/components/sheet-body-scroll";
import { DirectionView } from "@/ui/direction";
import { useShadow } from "@/ui/elevation";
import { useModalDismissal } from "@/ui/modal-dismissal-ledger";
import {
	createTransitionTick,
	exitPointerEvents,
	useModalExit,
} from "@/ui/modal-exit";
import { effectiveDuration, parseCubicBezier } from "@/ui/motion";
import { sheetKeyboardLift, sheetKeyboardRoom } from "@/ui/sheet-keyboard";
import {
	dragMode,
	openingResizeSize,
	recallResizeSize,
	rememberResizeSize,
	resistResizeDrag,
	type SheetResizeSize,
	settleResize,
	sheetResizeSizes,
} from "@/ui/sheet-resize";
import { focusScrollTarget } from "@/ui/sheet-scroll";
import { useTextScale } from "@/ui/text-scale-provider";
import { DURATIONS, EASINGS } from "@/ui/tokens.gen";
import {
	cx,
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
 * The cut-edge fade's height, in pt — the markdown table's own band width.
 *
 * WHY IT EXISTS (design D63-1): at 200 % on a 320 pt phone the sheet's fixed
 * chrome left a ~145 pt body, and the second result row was cut to a 5 pt
 * strip of ascender tops a hair above the pinned footer with NO cue between —
 * a partially drawn row reads as a rendering fault, not as content. The band
 * paints the sheet's own ground, transparent at the content edge and solid at
 * the footer edge, so a cut row fades INTO the chrome: the standard "there is
 * more below" of the app's own table scrollers. It is drawn only while that
 * is true (the body overflows and is not scrolled to its end).
 */
const SHEET_BODY_FADE = 24;

/**
 * How long the keyboard's own move of the sheet is given before a focused field's
 * reveal is re-computed. The platform's keyboard animation is ~250 ms; the surface
 * follows it on the same curve, so anything sooner measures a body that is still
 * moving.
 */
const KEYBOARD_SETTLE_MS = 350;

/**
 * Gradient ids must be unique per instance (two sheets can share one document,
 * and `url(#…)` resolves to the first id in it). A module counter, like the
 * markdown table's fades: the id must be stable across re-renders — a
 * recomputed id would drop the fill mid-frame.
 */
let sheetFadeSeq = 0;

/* ONE gate for every sheet in the app, at module scope on purpose: the two
 *  sheets of a hand-off are different component instances, and only a shared
 *  gate can see that their edges are one event (`createTransitionTick`). */
const sheetTransitionTick = createTransitionTick(() => haptic("selection"));

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
 * **No drag-to-dismiss.** A drag handle that dismisses is a trap on a surface
 * that holds a typed answer, so dismissal stays the scrim, the Close control and
 * Escape. A sheet may opt into `resizable`, which gives the grab bar a drag that
 * RESIZES between two heights (Medium and Large) and springs back past either
 * end — never a dismissal. Off by default: the handle exists only where the drag
 * does, which is the rule this primitive shipped with.
 *
 * Focus: on a phone the platform moves focus into a modal for us, and the
 * platform's own behaviour is what a screen reader follows. What the kit asks for
 * that is NOT automatic — returning focus to the opener on close — is left to the
 * caller, because only the caller holds the opener's ref.
 */
export type SheetProps = {
	visible: boolean;
	onClose: () => void;
	/** Web: after focus return. RN fires this after native dismissal on iOS,
	 * not Android (https://reactnative.dev/docs/modal#ondismiss). */
	onDismiss?: () => void;
	/**
	 * Close in ONE commit, with no exit animation. Set it in the SAME update
	 * that closes the sheet, for every hand-off close whose `onDismiss` starts
	 * the next step — a system picker, or the Paste read, which waits on the
	 * same dismissal (`@/features/session/attach-handoff`).
	 *
	 * WHY ("Photo Library / Files does nothing", TestFlight 1333). `useModalExit`
	 * sets `exiting` in a passive effect, so an animated close hands the native
	 * `Modal` `visible=false` for one commit and `visible=true` again on the next.
	 * The two reach native separately: React flushes passive effects at Default
	 * priority, not Sync (`ReactFabric-prod.js` `flushPassiveEffects`,
	 * `currentUpdatePriority = max(32, renderPriority)`), so the `setExiting`
	 * renders in a LATER scheduler task, and Fabric mounts once per JS task
	 * (`RuntimeScheduler_Modern.cpp` `updateRendering`) — the `false` revision
	 * is mounted on its own before the `true` one, never diffed away.
	 * iOS's modal host acts on every `visible` it is given (react-native 0.86
	 * `RCTModalHostViewComponentView.mm`, `updateProps` →
	 * `ensurePresentedOnlyIfNeeded`): it dismisses the controller, presents it
	 * AGAIN for the exit, and fires `onDismiss` from the FIRST dismissal's
	 * completion. A picker launched from that `onDismiss` is presented onto the
	 * re-presented sheet (expo-modules-core `currentViewController()` walks to
	 * it) and the exit's final dismissal takes it down with the sheet: no picker,
	 * no callback, no error. Without the exit there is one `visible` edge, one
	 * native dismissal, and `onDismiss` fires only once the controller is gone
	 * — the moment a presentation is safe. Pinned against an emulation of that
	 * host in `sheet-ios-picker-handoff.test.tsx`.
	 */
	exitInstantly?: boolean;
	/** Once per close, after the commit that stops holding the native Modal
	 * shown (after any exit animation): the earliest point a caller may start
	 * a fallback for an `onDismiss` that never arrives (#248). */
	onHidden?: () => void;
	/** The sheet's accessible name; also its visible title. */
	title: string;
	/** Opt-in for a picker whose first announcement is its purpose, not Close. */
	focusTitle?: boolean;
	/** Drawer openers unmount; return to the persistent Home chip after RNW has
	 * completed its own focus return, never during the closing animation.
	 * A LIST is a fallback order: the first candidate that actually takes focus
	 * wins. One id is not enough when the caller cannot know which screen will
	 * be underneath at dismissal (UX round 1, U2 — a session screen has no Home
	 * chip, so focus fell to `body`). */
	returnFocusTestID?: string | readonly string[];
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
	/**
	 * A pinned region UNDER the title and ABOVE the scrolling body: what must stay
	 * in view while the body scrolls — a search field above its results (the
	 * model picker). Measured into the chrome the cap is spent on, like the title
	 * row and the footer.
	 *
	 * Why a slot and not "put it first in the body": a field in the body scrolls
	 * away with the rows it filters, and with the keyboard up the body is a few
	 * rows tall — the reader typed into a field they could no longer see
	 * (TestFlight 1295).
	 */
	pinned?: React.ReactNode;
	/** How many lines the title may wrap to. ONE by default (the app's
	 *  truncation idiom, below); a sheet whose title IS its state — the session
	 *  health sheet's "Not answering" — passes 2, because an ellipsis there cuts
	 *  the one word the sheet exists to say ("Not answe…" at 320 pt / 200 %,
	 *  design round 1 D7). */
	titleLines?: 1 | 2;
	testID?: string;
	/**
	 * Two sizes, Medium and Large, dragged between from the header (the grab bar
	 * goes in with it). OFF by default: a sheet that opts in is the exception, so
	 * every other sheet keeps the height its detent gives it and the rule in
	 * docs/design/components.md § 8 holds for all of them.
	 *
	 * Resize, never dismiss: past either size the surface resists and springs
	 * back, because closing a sheet discards a typed answer (ADR 0005 § 2). Close
	 * stays the scrim, the Close control and Escape/back.
	 */
	resizable?: boolean;
	/**
	 * Which sheet's remembered size this is. Several resizable sheets would
	 * otherwise share one choice; the default suits the one sheet that opts in.
	 */
	resizeKey?: string;
	/**
	 * The first tap on the dim area HIDES THE KEYBOARD rather than closing the
	 * sheet, when the keyboard is up. Opt-in, because it is only a kindness where
	 * the reader is typing an answer: elsewhere the first tap closing the sheet is
	 * the behaviour the rest of the app already has.
	 */
	dismissKeyboardOnScrimTap?: boolean;
	/**
	 * A tap on the body's own space — the question text, the gap between cards —
	 * puts the keyboard away. Opt-in because it is about typing an answer: the
	 * scrolling body of a search sheet also *is* its control (spec 3.3 rule 3).
	 *
	 * `keyboardShouldPersistTaps="handled"` alone does not do this: a tap on a
	 * `Text` child is consumed by that child, so the body's copy — which is most
	 * of what a reader sees between controls — never reaches the scroller.
	 */
	dismissKeyboardOnBodyTap?: boolean;
	/**
	 * The platform's own way of putting the keyboard away from the scrolling
	 * body: iOS's `interactive` follows the finger, Android's `on-drag` waits for
	 * the drag to end. Opt-in, and only meaningful with `resizable` in practice —
	 * a sheet whose body is a short form has nothing to drag.
	 */
	keyboardDismissMode?: "none" | "on-drag" | "interactive";
};

export const Sheet = ({
	visible,
	onClose,
	onDismiss,
	exitInstantly = false,
	onHidden,
	title,
	focusTitle = false,
	returnFocusTestID,
	detent = "content",
	children,
	footer,
	pinned,
	titleLines = 1,
	testID,
	resizable = false,
	resizeKey = "sheet",
	dismissKeyboardOnScrimTap = false,
	dismissKeyboardOnBodyTap = false,
	keyboardDismissMode,
}: SheetProps) => {
	const titleRef = useRef<Text>(null);
	/* The scrim's DOM node, read only by the web focus guard below. */
	const scrimRef = useRef<View>(null);
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

	/* THE EXIT (perf audit P7; the rule and its limits are in `@/ui/modal-exit`).
	 *  Both values run back to 0 on the native driver over `duration.fast` — a
	 *  close should be quicker than an arrival — and the `Modal` stays mounted
	 *  (`exiting`) until they land. A skipped exit resets them, as before. */
	const exitMs = effectiveDuration(DURATIONS.fast, reduceMotion);
	const exiting = useModalExit({
		visible,
		reduceMotion,
		durationMs: exitMs,
		skip: exitInstantly,
		reset: () => {
			rise.setValue(0);
			scrimFade.setValue(0);
		},
		animateOut: (done) => {
			Animated.parallel([
				Animated.timing(rise, {
					toValue: 0,
					duration: exitMs,
					/* The kit's `in-out` token: there is no "in" curve in the
					 *  token set and an exit does not earn a new one. */
					easing: Easing.bezier(...parseCubicBezier(EASINGS["in-out"])),
					useNativeDriver: true,
				}),
				Animated.timing(scrimFade, {
					toValue: 0,
					duration: exitMs,
					useNativeDriver: true,
				}),
			]).start(done);
		},
		onHidden,
	});
	/* One tick when the sheet arrives and one when it leaves (P16) — on a real
	 *  transition only, never for a sheet that mounts closed. Through the shared
	 *  gate, so a sheet handing off to another in one press is ONE tick (R4). */
	const wasVisible = useRef(visible);
	useEffect(() => {
		if (wasVisible.current !== visible) sheetTransitionTick();
		wasVisible.current = visible;
	}, [visible]);

	useEffect(() => {
		/* Closed: `useModalExit` above owns the values (animated or reset). */
		if (!visible) return;
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
	 * which is the case `onLayout` exists to correct — ON THE WEB ONLY. A native
	 * `Modal` is not resized for the keyboard (iOS keeps the full window; Android
	 * is edge-to-edge, so the IME is an inset), so there the column never shrinks
	 * and the keyboard is handled from its own frame below (`keyboardLift`).
	 */
	const windowHeight = useWindowDimensions().height;
	const capHeight = columnHeight > 0 ? columnHeight : windowHeight;

	/*
	 * THE KEYBOARD (TestFlight 1295: the model sheet's search field sat under the
	 * keyboard, so the reader could see neither what they typed nor what matched).
	 *
	 * The frame is #216's ONE keyboard store, the source both composers already
	 * lift from — not a `KeyboardAvoidingView`, which measures its own frame
	 * against the keyboard and has already been taken out of the Team Bridge
	 * thread for being fragile (`composer-dock.tsx`). The store never subscribes
	 * on the web, where the column's `onLayout` above already shrinks with the
	 * visual viewport, so web keeps its old behaviour.
	 *
	 * Two effects, both from the same lift: the surface's bottom edge moves up to
	 * the keyboard's top (a spacer under it in the bottom-anchored column), and
	 * the cap becomes the space between the safe top and the keyboard top, so the
	 * header, a `pinned` field and as many rows as fit stay visible while the body
	 * scrolls. `sheetKeyboardLift` subtracts any resize the host already did, so a
	 * resizing Android window is not lifted twice.
	 *
	 * The change is committed under a `LayoutAnimation` — RN's own
	 * `KeyboardAvoidingView` technique — because it is the one API that can run a
	 * LAYOUT change on iOS's private keyboard curve (`Types.keyboard`) with the
	 * keyboard's own duration. Subscribed directly rather than through the hook so
	 * the animation is configured inside the native event, before the commit.
	 */
	const [keyboard, setKeyboard] = useState<KeyboardFrame>(KEYBOARD_HIDDEN);
	/* Keyed on the Modal being MOUNTED, not on `visible` (review R1-m1): a pick
	 *  closes the sheet while its focused field keeps the keyboard up, and the
	 *  Modal stays mounted through the exit. Dropping the frame at `visible=false`
	 *  pulled the surface down behind the still-open keyboard for the whole exit;
	 *  holding it until the exit lands lets the sheet leave from where it was. */
	const keyboardLive = visible || exiting;
	useEffect(() => {
		if (!keyboardLive) return;
		const unsubscribe = subscribeKeyboardFrame((frame) => {
			if (!reduceMotion && Platform.OS !== "web") {
				LayoutAnimation.configureNext({
					duration: frame.duration,
					update: {
						duration: frame.duration,
						type:
							Platform.OS === "ios"
								? LayoutAnimation.Types.keyboard
								: LayoutAnimation.Types.easeInEaseOut,
					},
				});
			}
			setKeyboard(frame);
		});
		/* A sheet opened over an already-open keyboard starts above it. */
		setKeyboard(keyboardFrameNow());
		return () => {
			unsubscribe();
			setKeyboard(KEYBOARD_HIDDEN);
		};
	}, [keyboardLive, reduceMotion]);
	const keyboardLift = keyboard.visible
		? sheetKeyboardLift({
				overlap: keyboard.overlap,
				columnHeight,
				windowHeight,
			})
		: 0;
	/* The surface's own ceiling with the keyboard up; `null` while it is down. */
	const keyboardRoom = keyboard.visible
		? sheetKeyboardRoom({ capHeight, lift: keyboardLift, safeTop: insets.top })
		: null;
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
	const [pinnedHeight, setPinnedHeight] = useState(0);
	const measuredChrome = headerHeight + footerHeight;
	const chrome =
		(measuredChrome > 0
			? measuredChrome
			: footer === undefined
				? CHROME_SEED_HEADER
				: CHROME_SEED_HEADER + CHROME_SEED_FOOTER) +
		(pinned === undefined ? 0 : pinnedHeight);
	const detentContentHeight =
		fraction === null
			? undefined
			: Math.max(MIN_CONTENT_HEIGHT, Math.round(capHeight * fraction) - chrome);
	/* With the keyboard up the body gets what the keyboard leaves, and no floor:
	 *  `MIN_CONTENT_HEIGHT` would push the title back above the safe top, which
	 *  is the one thing that must stay visible. */
	const maxContentHeight =
		keyboardRoom === null
			? detentContentHeight
			: Math.min(
					detentContentHeight ?? Number.POSITIVE_INFINITY,
					Math.max(0, keyboardRoom - chrome),
				);

	/* ── THE OPT-IN RESIZE (`resizable`) ─────────────────────────────────────
	 * Two sizes, Medium and Large, dragged between from the header. The body's
	 * HEIGHT is what animates and the footer never moves, so a taller sheet grows
	 * its content region instead of sliding Answer/Decline off the bottom edge
	 * (docs/design/components.md § 8; the arithmetic is in `@/ui/sheet-resize`).
	 *
	 * The gesture lives INSIDE the `Modal` and gets its own
	 * `GestureHandlerRootView`: a native `Modal` is a separate root view on iOS,
	 * so touches inside it never reach a handler root mounted at the app root
	 * (react-native-gesture-handler's "Usage with modals"). It is mounted per
	 * sheet and only when a sheet opts in — `app/_layout.tsx` is shared with other
	 * lanes, and a root there would not reach these touches anyway. */
	/* Medium hugs the content when the content is shorter than its ceiling, so a
	 *  one-line ask does not open as a half-empty slab (spec 3.1); the measured
	 *  content height is what decides that, and the OPENING size below. */
	const [contentHeight, setContentHeight] = useState(0);
	const bodyCeiling =
		keyboardRoom === null
			? Number.POSITIVE_INFINITY
			: Math.max(0, keyboardRoom - chrome);
	const resizeSizes = sheetResizeSizes({
		capHeight,
		chrome,
		/* Before the first measurement the content is unknown, and assuming it
		 *  FITS keeps Medium at its ceiling rather than collapsing it to the floor
		 *  for one frame. */
		contentHeight: contentHeight > 0 ? contentHeight : Number.POSITIVE_INFINITY,
		floor: MIN_CONTENT_HEIGHT,
		ceiling: bodyCeiling,
	});
	/* The size chosen THIS RUN survives a close: a sheet that forgot its size
	 *  between openings would ask the reader to drag it twice. In memory only —
	 *  nothing about an answer is stored durably (ADR 0005 § 2). */
	const [resizeSize, setResizeSize] = useState<SheetResizeSize>(
		() => recallResizeSize(resizeKey) ?? "medium",
	);
	const resizeBody = useSharedValue(resizeSizes.medium);
	const resizeDragStart = useSharedValue(0);
	const resizeMin = useSharedValue(resizeSizes.medium);
	const resizeMax = useSharedValue(resizeSizes.large);
	/* A SHARED value, not a ref: the pan's worklets write it on the UI thread, and
	 *  a React ref is not readable there. */
	const resizeDragging = useSharedValue(false);
	/* With the keyboard up the header drag HIDES THE KEYBOARD instead of resizing
	 *  (spec 3.3 rule 4): the sheet already fills the room the keyboard leaves, so
	 *  there is no size to pick and a drag that only resized would leave the
	 *  keyboard up over the reader's answer. `keyboardUp` and the once-per-drag
	 *  latch are shared values for the same reason as `resizeDragging`. */
	const keyboardUp = useSharedValue(keyboard.visible);
	const keyboardDismissedByDrag = useSharedValue(false);
	/* What the keyboard was doing when THIS drag began. The decision is taken once,
	 *  at the start: a drag that begins with the keyboard up hides it and does
	 *  nothing else, even though the keyboard is gone by the second half of the
	 *  same drag (measured: without this latch the rest of that drag resized the
	 *  sheet, so one gesture both dismissed the keyboard and changed the size). */
	const dragStartedWithKeyboard = useSharedValue(false);
	/* The JS side of a snap. A worklet cannot call `haptic` or set state, so the
	 *  release hands the settled size back here — and the tick fires only when the
	 *  size actually changed, once per snap. */
	const resizeSizeRef = useRef<SheetResizeSize>(resizeSize);
	/* The height a RELEASE is already springing to, so the sync effect below does
	 *  not start a second spring towards the same place (review r2-m1: the live
	 *  height is mid-flight for the frames that matter, so comparing it never
	 *  caught the echo). Consumed on the first pass that sees it. */
	const snappedTarget = useRef<number | null>(null);
	const remember = useCallback(
		(next: SheetResizeSize, springTarget?: number) => {
			snappedTarget.current = springTarget ?? null;
			rememberResizeSize(resizeKey, next);
			if (resizeSizeRef.current === next) return;
			resizeSizeRef.current = next;
			haptic("selection");
			setResizeSize(next);
		},
		[resizeKey],
	);
	const dismissKeyboard = useCallback(() => {
		Keyboard.dismiss();
	}, []);
	/* While the keyboard is up the body is the room between the safe top and the
	 *  keyboard's top, whatever size the reader chose with it down (spec D3). */
	const restingBodyHeight =
		keyboardRoom === null
			? resizeSize === "large"
				? resizeSizes.large
				: resizeSizes.medium
			: bodyCeiling;
	/* Put the body back on the size the sheet rests at (used when a drag was a
	 *  keyboard dismissal, so it must not leave the sheet mid-height). */
	const restingHeightRef = useRef(restingBodyHeight);
	restingHeightRef.current = restingBodyHeight;
	const settleToResting = useCallback(() => {
		resizeBody.value = reduceMotion
			? withTiming(restingHeightRef.current, { duration: 120 })
			: withSpring(restingHeightRef.current, { damping: 28, stiffness: 300 });
	}, [reduceMotion, resizeBody]);
	/* The opening size: hug the content if it fits Medium, otherwise open at Large
	 *  (spec 3.1) — a long question opened at Medium put its option cards below the
	 *  fold, which is the report this whole change answers.
	 *
	 *  There is deliberately NO "decided once" latch. A content size is measured
	 *  more than once while a sheet fills (the expanded ask lays out, a row
	 *  arrives, the keyboard closes), and a latch closed on an early partial
	 *  height opened this sheet at Medium although its content did not fit — the
	 *  exact defect. So the automatic size follows the measurement until a READER
	 *  chooses one (drag, bar tap, VoiceOver action — all of which write the
	 *  remembered size), and a remembered choice wins from then on. */
	useEffect(() => {
		if (!resizable || contentHeight <= 0) return;
		if (recallResizeSize(resizeKey) !== null) return;
		const opening = openingResizeSize({
			contentHeight,
			medium: resizeSizes.medium,
		});
		if (opening === resizeSizeRef.current) return;
		resizeSizeRef.current = opening;
		setResizeSize(opening);
	}, [resizable, contentHeight, resizeKey, resizeSizes.medium]);
	useEffect(() => {
		keyboardUp.value = keyboard.visible;
	}, [keyboard.visible, keyboardUp]);
	useEffect(() => {
		if (!resizable) return;
		resizeMin.value = resizeSizes.medium;
		resizeMax.value = resizeSizes.large;
		/* Mid-drag the finger owns the height: a measurement or a keyboard frame
		 *  landing between begin and end would otherwise jump the sheet under it. */
		if (resizeDragging.value) return;
		/* The release's own spring is already heading here: it ran WITH the finger's
		 *  velocity, and a second spring would drop that and re-settle the same
		 *  place (review r1 F7 / r2-m1). One pass consumes it, so a later change
		 *  (the keyboard going, a new drag) still animates normally. */
		const springingTo = snappedTarget.current;
		snappedTarget.current = null;
		if (springingTo !== null && Math.abs(springingTo - restingBodyHeight) < 0.5)
			return;
		if (Math.abs(resizeBody.value - restingBodyHeight) < 0.5) return;
		resizeBody.value = reduceMotion
			? withTiming(restingBodyHeight, { duration: 120 })
			: withSpring(restingBodyHeight, { damping: 28, stiffness: 300 });
	}, [
		resizable,
		restingBodyHeight,
		reduceMotion,
		resizeSizes.medium,
		resizeSizes.large,
		resizeBody,
		resizeMin,
		resizeMax,
		resizeDragging,
	]);
	const resizePan = Gesture.Pan()
		/* 8 pt of vertical travel starts it and 20 pt sideways cancels it, so a
		 *  chiefly-horizontal move never resizes the sheet (spec 3.2). */
		.minDistance(8)
		.failOffsetX([-20, 20])
		/* The latch is taken on BOTH begin and start: `onBegin` is the touch-down,
		 *  `onStart` the activation (after `minDistance`), and a platform that only
		 *  reports one of them would otherwise leave the latch at its initial
		 *  false and let the drag resize after the keyboard had gone. */
		.onBegin(() => {
			"worklet";
			resizeDragging.value = true;
			resizeDragStart.value = resizeBody.value;
			dragStartedWithKeyboard.value = keyboardUp.value;
		})
		.onStart(() => {
			"worklet";
			dragStartedWithKeyboard.value = keyboardUp.value;
		})
		.onUpdate((event) => {
			"worklet";
			if (
				dragMode({
					startedWithKeyboard: dragStartedWithKeyboard.value,
					keyboardUp: keyboardUp.value,
				}) === "dismiss"
			) {
				/* Downward only: an upward drag on a sheet that already fills its room
				 *  has nothing to grow into. Once per drag, so a long pull does not
				 *  re-dismiss repeatedly. */
				if (event.translationY > 8 && !keyboardDismissedByDrag.value) {
					keyboardDismissedByDrag.value = true;
					runOnJS(dismissKeyboard)();
				}
				return;
			}
			resizeBody.value = resistResizeDrag({
				height: resizeDragStart.value - event.translationY,
				min: resizeMin.value,
				max: resizeMax.value,
			});
		})
		.onEnd((event) => {
			"worklet";
			resizeDragging.value = false;
			keyboardDismissedByDrag.value = false;
			if (
				dragMode({
					startedWithKeyboard: dragStartedWithKeyboard.value,
					keyboardUp: keyboardUp.value,
				}) === "dismiss"
			) {
				/* A keyboard-dismissing drag never picks a size: put the body back on
				 *  the resting height, whatever the finger left it at. On the JS side,
				 *  because the resting height may have changed while the keyboard was
				 *  going (the sync effect skipped it mid-drag). */
				runOnJS(settleToResting)();
				return;
			}
			const settled = settleResize({
				height: resizeBody.value,
				velocityY: event.velocityY,
				min: resizeMin.value,
				max: resizeMax.value,
			});
			/* A release past an end still lands ON that end, never past it: past
			 *  Medium the sheet springs BACK, it does not close (spec 3.2, Ben's
			 *  answer to a-5712: "resist, stay open"). */
			const target = settled === "large" ? resizeMax.value : resizeMin.value;
			resizeBody.value = reduceMotion
				? withTiming(target, { duration: 120 })
				: withSpring(target, {
						damping: 28,
						stiffness: 300,
						velocity: -event.velocityY,
					});
			runOnJS(remember)(settled, target);
		})
		.onFinalize(() => {
			"worklet";
			resizeDragging.value = false;
			keyboardDismissedByDrag.value = false;
		});
	const resizeBodyStyle = useAnimatedStyle(() => ({
		height: resizeBody.value,
	}));
	/* The home indicator is behind the keyboard while it is up, so its inset is
	 *  not spent under the last row (the composer's #219 rule, `composerOuterGap`). */
	/*  Keyed on the OVERLAP, not `visible` (review R1-n1 / design D3): iOS's hide
	 *  reports overlap 0 on `keyboardWillChangeFrame` but keeps `visible` until
	 *  `didHide`, so keying on `visible` restored the inset in a second, later
	 *  animation after the sheet had already ridden down with the keyboard. */
	const bottomInset =
		keyboard.visible && keyboard.overlap > 0 ? 0 : insets.bottom;
	/* The body's scroll facts collapse to ONE boolean ("there is more below"):
	 * the raw numbers live in a ref because a state update per scroll tick would
	 * re-render the sheet's whole subtree to move a gradient; `syncBodyCue` is
	 * the only writer of the state, and it is called only from the ScrollView's
	 * own handlers. */
	const scrollFacts = useRef({ contentH: 0, viewportH: 0, y: 0 });
	/* Bring a focused field into view (see `@/ui/sheet-scroll` for the two
	 *  anchors and the arithmetic). Both nodes are measured with `measureLayout`
	 *  AGAINST THE SCROLL VIEW, so the numbers are content positions — the space
	 *  `scrollTo` takes — and no window frame or offset is involved. */
	const bodyRef = useRef<ScrollView>(null);
	/* The last field asked to be revealed, so the reveal can be repeated once the
	 *  keyboard has finished moving the sheet (see the effect below). */
	const lastReveal = useRef<{ block: View | null; field: View | null } | null>(
		null,
	);
	const revealField = useCallback(
		(target: { block: View | null; field: View | null }) => {
			const field = target.field;
			if (!resizable || field === null) return;
			lastReveal.current = target;
			const scroll = bodyRef.current;
			if (scroll === null) return;
			/* `measureLayout` against the scroll view, not `measureInWindow`: the
			 *  coordinates it yields are the CONTENT's, which is the space
			 *  `scrollTo` takes, so no window frame and no offset bookkeeping are
			 *  involved. (The window route was measured not to move the body at
			 *  all — see the evidence note in the PR.) */
			const measure = (
				node: View | null,
				then: (y: number, h: number) => void,
			) => {
				if (node === null) return;
				node.measureLayout(
					scroll as unknown as number,
					(_x, y, _w, h) => then(y, h),
					() => undefined,
				);
			};
			measure(field, (fieldY, fieldH) => {
				const viewportHeight = scrollFacts.current.viewportH;
				measure(target.block, (blockY, blockH) => {
					scroll.scrollTo({
						y: focusScrollTarget({
							viewportHeight,
							blockTop: blockY,
							blockHeight: blockH,
							fieldTop: fieldY,
							fieldHeight: fieldH,
						}),
						animated: !reduceMotion,
					});
				});
			});
		},
		[resizable, reduceMotion],
	);
	const bodyScroll = useMemo(() => ({ revealField }), [revealField]);
	/* A KEYBOARD THAT GOES AWAY CANCELS THE PENDING RE-REVEAL: the second pass
	 *  exists for the keyboard's own move, and a field the reader has left must
	 *  not drag the body under their next scroll when the keyboard is later put
	 *  away or the size is changed (review r1 F4). Declared BEFORE the settle
	 *  effect, so a dismissal's effect pass clears the target first. */
	useEffect(() => {
		if (!keyboard.visible) lastReveal.current = null;
	}, [keyboard.visible]);
	/* THE KEYBOARD MOVES THE TARGET AFTER FOCUS. `onFocus` fires while the sheet is
	 * still where it was with the keyboard down, and the keyboard then lifts the
	 * surface and SHRINKS the body over ~300 ms — so a reveal computed on the focus
	 * event lands the field where the body used to be, and the field the reader is
	 * typing into stays under the pinned footer (measured in the evidence run: the
	 * body did not move at all). Re-run the same reveal once that move has settled,
	 * and only once: a later manual scroll must not be undone.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: `restingBodyHeight` is the TRIGGER (the sheet has finished moving), not a value this reads — the same shape as the opening effect's `population`.
	useEffect(() => {
		if (!resizable) return;
		const target = lastReveal.current;
		if (target === null) return;
		const timer = setTimeout(() => {
			revealField(target);
			lastReveal.current = null;
		}, KEYBOARD_SETTLE_MS);
		return () => clearTimeout(timer);
	}, [resizable, restingBodyHeight, revealField]);
	const [bodyCue, setBodyCue] = useState(false);
	/* "Something has scrolled up under the pinned region" — the mirror of
	 *  `bodyCue`, drawn only under a `pinned` slot (design D1). */
	const [topCue, setTopCue] = useState(false);
	const syncBodyCue = () => {
		const { contentH, viewportH, y } = scrollFacts.current;
		setBodyCue(
			viewportH > 0 && contentH > viewportH + 1 && y + viewportH < contentH - 2,
		);
		setTopCue(y > 1);
	};
	const fadeId = useRef("");
	if (fadeId.current === "") {
		sheetFadeSeq += 1;
		fadeId.current = `sheet-body-fade-${sheetFadeSeq}`;
	}
	const topFadeId = `${fadeId.current}-top`;
	const ground = useTokenColor("elevated");
	/* A modal that mounts while another is up stands down rather than painting a
	 *  second full-viewport surface over it — the rule and its reasoning are in
	 *  `@/ui/modal-stack`, and the registration lives here because this is where the
	 *  `Modal` is rendered. */
	const { covered, dims: drawsDim, scope } = useModalStackEntry(visible);
	/* Owes a dismissal from the close until RNW's `onDismiss`, so a screen that
	 *  moves the reader waits out this sheet's focus return (`@/ui/modal-dismissal-
	 *  ledger`; PR #122 QA round 6, Q9). Keyed on what the Modal is given. */
	/* `exiting` keeps the Modal mounted for the exit animation. It is never true
	 *  while another modal is up (`shouldAnimateExit`), so it cannot paint over
	 *  the modal that covers this one. */
	const shown = (visible || exiting) && !covered;
	/* The LEDGER stays keyed on the caller's close, not on `shown`: a dismissal
	 *  is owed from the commit that closes the sheet — the exit animation only
	 *  moves the `onDismiss` that settles it later. Keyed on `shown`, the debt
	 *  would not exist while the sheet animates out, and a screen waiting on it
	 *  (Settings' refusal reveal, Q9) would move the reader mid-exit;
	 *  `modal-dismissal-ledger.test.ts` fails on exactly that. */
	const dismissed = useModalDismissal(
		visible && !covered,
		Platform.OS === "web",
	);

	/**
	 * Keep the pointer-only scrim from taking focus from the sheet's title.
	 *
	 * `focusTitle` already removes the scrim from the accessibility tree and gives it
	 * `tabIndex={-1}`, so nothing TABS to it — but focus can still be PLACED on it,
	 * and one path does exactly that. Opening this sheet from the drawer's workspace
	 * row closes the drawer in the same press: the pane's focused node unmounts, and
	 * the modal's own trap re-enters at the first node it can focus, which is this
	 * scrim. A keyboard or screen-reader reader then hears "Close" instead of the
	 * title they just opened (QA round 2, Q7 — 3/3 reps at 390/100 and 320/200, while
	 * the chip and Settings openers landed on the heading).
	 *
	 * WHY A LISTENER ON THE SCRIM AND NOT A RE-FOCUS. The guard fires only when the
	 * SCRIM ITSELF is focused, so a control that is still on screen — the persistent
	 * pane header in split layout, which is `returnFocusTestID`'s `activeElement ===
	 * body` guard for the same reason — is never robbed of focus by a blanket
	 * refocus. The listener is web-only: native has no `<div>` and no focus trap.
	 */
	useEffect(() => {
		if (!shown || !focusTitle || Platform.OS !== "web") return;
		const scrim = scrimRef.current as unknown as HTMLElement | null;
		const title = titleRef.current as unknown as HTMLElement | null;
		if (!scrim || !title) return;
		const onFocusIn = (event: Event) => {
			if (event.target === scrim) title.focus({ preventScroll: true });
		};
		scrim.addEventListener("focusin", onFocusIn);
		return () => scrim.removeEventListener("focusin", onFocusIn);
	}, [shown, focusTitle]);

	/* `Animated.ScrollView` only when the height is driven per frame: a sheet that
	 *  did not opt in keeps the plain `ScrollView` it always had. */
	const Body = resizable ? Animated2.ScrollView : ScrollView;
	const grabColour = useTokenColor("ink-muted");
	const ModalRoot = resizable ? GestureHandlerRootView : View;
	/* GestureDetector is a wrapper, so a non-resizable sheet renders the row alone.
	 *  A resizable one mounts one extra `GestureHandlerRootView` inside the Modal
	 *  (`ModalRoot`) and all sheets get one extra flex `View` around the column
	 *  (`DirectionView`) — layout-neutral, but not literally the same tree. */
	const headerRow = (
		<View
			className="flex-row items-center gap-2 px-4 py-3"
			onLayout={(event) => setHeaderHeight(event.nativeEvent.layout.height)}
		>
			<Heading
				ref={titleRef}
				tabIndex={focusTitle ? -1 : undefined}
				level={2}
				className="flex-1 text-title text-ink"
				/* ONE LINE, the app's truncation idiom (36 call sites, the rows
				 * themselves included): at 200 % on a 320 pt phone the WRAPPED
				 * title was the sheet's single biggest chrome block — 81 pt of a
				 * 525 pt surface (design D63-1) — and a single-line title that
				 * ellipsizes keeps its full accessible name. */
				numberOfLines={titleLines}
			>
				{title}
			</Heading>
			{resizable ? (
				/* The grab bar is the size control (36×5 pt pill, 6 pt from the top).
				 *  Its visible mark rides the row's own padding so the header's
				 *  MEASURED height — the chrome the cap spends — does not move. It
				 *  sits AFTER the title in the tree because RN routes a touch to the
				 *  topmost sibling: drawn first, the title took every tap in the band
				 *  and the control never fired (measured in the evidence run: the tap
				 *  "succeeded" at Medium and nothing moved).
				 *
				 *  THE PRESSABLE IS A REAL 44 pt-TALL FRAME containing the pill, not a
				 *  5 pt pill grown by `hitSlop`: hit slop does not grow the frame
				 *  VoiceOver reads, so the adjustable control was announced 5 pt tall
				 *  (design r1 D3 / review N2). The close button is a later sibling and
				 *  stays on top of the band's right end. A tap toggles Medium/Large
				 *  without a drag; the whole header row stays the drag zone; and a
				 *  reader who cannot drag adjusts the same size from the VoiceOver /
				 *  TalkBack action list (spec 3.6). */
				<Pressable
					accessibilityRole={ROLE.adjustable}
					accessibilityLabel={t("mobile.common.resize_panel")}
					accessibilityValue={{
						text:
							resizeSize === "large"
								? t("mobile.common.size.large")
								: t("mobile.common.size.medium"),
					}}
					/* Only the action that can happen at THIS size is offered: an
					 *  "adjust up" already at Large is a control that does nothing
					 *  (review r1 N1). */
					accessibilityActions={
						resizeSize === "large"
							? [{ name: "decrement", label: t("mobile.common.size.shorter") }]
							: [{ name: "increment", label: t("mobile.common.size.taller") }]
					}
					onAccessibilityAction={(event) => {
						/* The same rule as the tap below: while the keyboard pins the
						 *  body, this control does not write a size the reader cannot
						 *  see change — it puts the keyboard away instead (UX r2 U9). */
						if (keyboard.visible) {
							Keyboard.dismiss();
							return;
						}
						const action = event.nativeEvent.actionName;
						if (action === "increment") remember("large");
						if (action === "decrement") remember("medium");
					}}
					onPress={() => {
						/* With the keyboard up the bar is not a size control: a tap there
						 *  puts the keyboard away and writes nothing, so the size the
						 *  reader chose with the keyboard down is not overwritten by a
						 *  stray tap while they were typing (UX r1 U5). */
						if (keyboard.visible) {
							Keyboard.dismiss();
							return;
						}
						remember(resizeSizeRef.current === "large" ? "medium" : "large");
					}}
					testID={CONTROL.sheetGrabBar}
					style={{
						position: "absolute",
						top: 0,
						/* 44 pt tall and 120 pt wide, CENTRED on the pill: the target is
						 *  real (design r1 D3) without making the whole header — the
						 *  title included — a size toggle, or putting the adjustable
						 *  control in VoiceOver's path before the heading (design r2
						 *  D9). 120 pt keeps it ~80 pt clear of Close at 320 pt.
						 *  No `left`/`right`: Yoga centres an absolutely positioned
						 *  child with auto insets by `alignSelf`, which is also the
						 *  direction-neutral spelling the physical-edge guard wants. */
						alignSelf: "center",
						width: 120,
						height: 44,
						alignItems: "center",
						paddingTop: 6,
					}}
				>
					<View
						style={{
							width: 36,
							height: 5,
							borderRadius: 3,
							backgroundColor: grabColour,
							opacity: 0.6,
						}}
					/>
				</Pressable>
			) : null}
			<IconButton
				accessibilityLabel={t("mobile.common.close")}
				testID={CONTROL.sheetClose}
				onPress={onClose}
				icon={({ color, size }) => <X color={color} size={size} />}
			/>
		</View>
	);

	return (
		/* The scope publishes this sheet as the HOST of anything a modal is raised
		 *  inside it — the conversations pane's menu is the app's nested case. */
		<ModalScopeContext.Provider value={scope}>
			<Modal
				visible={shown}
				transparent
				animationType="none"
				onRequestClose={onClose}
				onShow={() => {
					if (!focusTitle || !titleRef.current) return;
					if (Platform.OS === "web")
						(titleRef.current as unknown as HTMLElement).focus({
							preventScroll: true,
						});
					else {
						const handle = findNodeHandle(titleRef.current);
						if (handle !== null)
							AccessibilityInfo.setAccessibilityFocus(handle);
					}
				}}
				onDismiss={
					Platform.OS === "web"
						? () => {
								/* ONLY ONCE THE SURFACE IS GONE (PR #339 round 2: UX U1,
								 *  design D1, QA Q2). `useModalExit` sets `exiting` in an effect,
								 *  so for the one commit between the caller's close and that
								 *  update RNW's Modal is handed `visible=false`. With
								 *  `animationType="none"` its `ModalAnimation` drops `isRendering`
								 *  at once and calls this, although the next commit hands it
								 *  `visible` again and the sheet — focus trap and scrim included —
								 *  stays in the DOM for the whole exit. Anything a caller runs
								 *  "after dismissal" then ran ~110 ms early: a route pushed from
								 *  here had its autofocused composer robbed by the closing sheet's
								 *  scrim, and focus ended on `body` at the real unmount (measured
								 *  on the hosted web export, 0/10). While `shown` is still true
								 *  the dismissal is that blip, not a dismissal; the real one
								 *  arrives when the exit releases the Modal (`shown` false), so
								 *  it is skipped here rather than delayed. Keyed on `shown`, not
								 *  `exiting`: a sheet covered mid-exit is released too and must
								 *  still settle. Pinned by `sheet-dismiss-timing.test.tsx`
								 *  against RNW's real `ModalAnimation`. */
								if (shown) return;
								// Settle the fallback before publishing the ledger transition; Settings'
								// refusal reveal must run after ALL focus-return work (#122).
								if (
									!visible &&
									returnFocusTestID &&
									(document.activeElement === document.body ||
										document.activeElement === null)
								) {
									/* Presence in the DOM is not focusability: an earlier
									 *  screen stays mounted but hidden under the stack, and
									 *  an exiting modal is kept mounted inert, so the same
									 *  testID can match a node `focus()` silently refuses.
									 *  Every match of every candidate is tried, and only a
									 *  node that BECAME `activeElement` ends the search. */
									candidates: for (const id of [returnFocusTestID].flat()) {
										for (const target of document.querySelectorAll<HTMLElement>(
											`[data-testid="${id}"]`,
										)) {
											target.focus({ preventScroll: true });
											if (document.activeElement === target) break candidates;
										}
									}
								}
								dismissed();
								onDismiss?.();
							}
						: onDismiss
				}
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
					{/* The gesture root has to be INSIDE the modal (see the resize block
					 *  above); `View` for every sheet that did not opt in, so nothing else
					 *  changes at all. */}
					<ModalRoot style={{ flex: 1 }}>
						{/* Same rule as `Dialog`: the modal root is a separate root, so the
						 *  direction is re-applied here or a sheet opened in an Urdu session keeps
						 *  its leading/trailing chrome on the English edges. */}
						<DirectionView
							className="flex-1 justify-end"
							/* Inert from the close on: the exit keeps this mounted, and a
							 *  second tap must not land on a sheet that is leaving (R2). */
							pointerEvents={exitPointerEvents(visible)}
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
									ref={scrimRef}
									className="flex-1"
									style={{
										backgroundColor: drawsDim ? scrimColour : "transparent",
									}}
									accessibilityRole={ROLE.button}
									accessibilityLabel={t("mobile.common.close")}
									// The labelled close button remains available; a picker's scrim is
									// pointer-only so initial focus never starts on a duplicate Close.
									accessible={!focusTitle}
									accessibilityElementsHidden={focusTitle}
									importantForAccessibility={
										focusTitle ? "no-hide-descendants" : "auto"
									}
									tabIndex={focusTitle ? -1 : 0}
									testID={CONTROL.sheetScrim}
									/* First tap with the keyboard up puts the keyboard away and
									 *  leaves the sheet open; closing is then one press away.
									 *  Opt-in: where nothing is being typed, the first tap
									 *  keeps meaning "close". */
									onPress={
										dismissKeyboardOnScrimTap && keyboard.visible
											? () => Keyboard.dismiss()
											: onClose
									}
									/* A SCREEN READER'S ACTIVATION ALWAYS CLOSES. The visual first
									 *  tap's "keyboard away, stay open" is a refinement for a
									 *  finger; VoiceOver already announces this element "Close", and
									 *  a control that says Close and only hides a keyboard is a lie
									 *  (review r1). `onAccessibilityTap` is the path a double-tap
									 *  takes, so the announcement and the result agree. */
									onAccessibilityTap={onClose}
								/>
							</Animated.View>

							<Animated.View
								/* THE SURFACE IS THE DIALOG. `accessibilityViewIsModal` on the
								 *  Modal keeps the app behind it out of the tree, but nothing
								 *  named the dialog itself: a reader entered a surface whose
								 *  heading was just the first text node. `role` (not
								 *  `accessibilityRole` — RN's AccessibilityRole has no dialog)
								 *  plus the title gives it the accessible name the title is
								 *  already showing. */
								role={ROLE.dialog}
								aria-label={title}
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
								{resizable ? (
									<GestureDetector gesture={resizePan}>
										{headerRow}
									</GestureDetector>
								) : (
									headerRow
								)}
								{pinned === undefined ? null : (
									<View
										/* The hairline is the pinned region's edge (design D1): rows scroll
										 *  up UNDER it, and without a line a provider label cut mid-glyph
										 *  under the field read as a rendering fault — the footer's own
										 *  boundary, mirrored. */
										className="px-4 border-b border-hairline"
										testID={SURFACE.sheetPinned}
										onLayout={(event) =>
											setPinnedHeight(event.nativeEvent.layout.height)
										}
									>
										{pinned}
									</View>
								)}
								<Body
									ref={bodyRef}
									testID={SURFACE.sheetBody}
									/* A row tapped while the keyboard is up is picked in ONE tap. The
									 *  default (`never`) spends the first tap dismissing the keyboard,
									 *  which in a search sheet reads as "the row didn't respond". A tap
									 *  on empty body space still dismisses it (`handled`). */
									keyboardShouldPersistTaps="handled"
									/* Opt-in (the ask panel's Other field): the platform's own
									 *  dismissal, so a swipe down on the body puts the keyboard away
									 *  — iOS follows the finger, Android waits for the drag to end. */
									keyboardDismissMode={keyboardDismissMode}
									/* A sheet with a `pinned` slot is a search over its body, so it HOLDS
									 *  its cap instead of hugging its content (design D2): the surface is
									 *  bottom-anchored (to the keyboard, while it is up), so a hugging body
									 *  moved the field the reader is typing in by every result a keystroke
									 *  removed — 59 → ≈272 pt for one query on a 430×932 phone. Sheets
									 *  without one keep hugging. The cap is held with the keyboard down
									 *  too: the `content` detent (`SHEET_DETENTS.content`, 0.6) still
									 *  yields a cap, so a narrowed query keeps the sheet at that height
									 *  after the keyboard is dismissed — the field stays put, and the
									 *  held height never exceeds the detent. */
									style={
										resizable
											? resizeBodyStyle
											: maxContentHeight === undefined
												? undefined
												: pinned === undefined
													? { maxHeight: maxContentHeight }
													: {
															maxHeight: maxContentHeight,
															minHeight: maxContentHeight,
														}
									}
									contentContainerClassName="px-4"
									/* `pb-6` (24) plus the safe-area inset, computed rather than spelled
									 *  as a class so the indicator's height rides the DEVICE, and the model /
									 *  effort / slash sheets are corrected by the same line. With a pinned
									 *  footer the inset belongs to the FOOTER (it is the last thing drawn),
									 *  so the body keeps only the gutters — double-spending it would leave a
									 *  dead band between the last field and the action. */
									contentContainerStyle={{
										paddingBottom: footer === undefined ? 24 + bottomInset : 16,
									}}
									/* The three readings the cut-edge fade is earned from (its own
									 *  comment on `syncBodyCue`): the viewport, the content, and the scroll
									 *  position. A ref, not state — the state they collapse to is the one
									 *  boolean below. */
									onLayout={(event) => {
										scrollFacts.current.viewportH =
											event.nativeEvent.layout.height;
										syncBodyCue();
									}}
									onContentSizeChange={(_width, height) => {
										scrollFacts.current.contentH = height;
										/* The opening size and the content hug are decided from
										 *  this measurement (the resize block above). */
										setContentHeight(height);
										syncBodyCue();
									}}
									onScroll={(event) => {
										scrollFacts.current.y = event.nativeEvent.contentOffset.y;
										syncBodyCue();
									}}
									scrollEventThrottle={16}
								>
									{/* The body's own space, as one press target UNDER the content:
									 *  an option card or a field handles its own press and wins, so
									 *  only a tap on copy or empty space reaches this and puts the
									 *  keyboard away (opt-in, see the prop).
									 *
									 *  INVISIBLE TO THE ACCESSIBILITY TREE. A Pressable is an
									 *  accessibility element by default and an accessible parent
									 *  GROUPS its children: as shipped, it announced the whole body as
									 *  one node and the ask sheet's Other field left the tree (QA r1
									 *  Q1 / review F3, reproduced with `maestro hierarchy`). The same
									 *  opt-out `selectable-message.tsx` uses for its rows. */}
									<SheetBodyScrollContext.Provider value={bodyScroll}>
										{dismissKeyboardOnBodyTap ? (
											<Pressable
												accessible={false}
												importantForAccessibility="no"
												onPress={() => Keyboard.dismiss()}
												style={{ minHeight: "100%" }}
											>
												{children}
											</Pressable>
										) : (
											children
										)}
									</SheetBodyScrollContext.Provider>
								</Body>
								{footer === undefined ? null : (
									<View
										className={cx(
											"px-4 pt-3",
											/* The divider is the cut region's CLOSE, paired with the fade below:
											 * the fade fades the body's last partial row into the surface, and
											 * the hairline traces where content stops being scrollable — the
											 * pair is the boundary cue design D63-1 asked for. */
											"border-t border-hairline",
										)}
										onLayout={(event) =>
											setFooterHeight(event.nativeEvent.layout.height)
										}
										style={{ paddingBottom: 24 + bottomInset }}
									>
										{footer}
									</View>
								)}
								{pinned !== undefined && pinnedHeight > 0 && topCue ? (
									/* The footer fade's mirror under the pinned region (design D1):
									 *  solid at the hairline, transparent toward the content, shown only
									 *  while rows have scrolled up under it. The header's measured height
									 *  (its seed for the one frame before `onLayout`) places it. */
									<View
										pointerEvents="none"
										aria-hidden
										testID={SURFACE.sheetPinnedFade}
										style={{
											position: "absolute",
											left: insets.left,
											right: insets.right,
											top:
												(headerHeight > 0 ? headerHeight : CHROME_SEED_HEADER) +
												pinnedHeight,
											height: SHEET_BODY_FADE,
										}}
									>
										<Svg width="100%" height="100%">
											<Defs>
												<LinearGradient
													id={topFadeId}
													x1="0%"
													y1="0%"
													x2="0%"
													y2="100%"
												>
													<Stop
														key="far"
														offset="0"
														stopColor={ground}
														stopOpacity={1}
													/>
													<Stop
														key="near"
														offset="1"
														stopColor={ground}
														stopOpacity={0}
													/>
												</LinearGradient>
											</Defs>
											<Rect
												width="100%"
												height="100%"
												fill={`url(#${topFadeId})`}
											/>
										</Svg>
									</View>
								) : null}
								{footer !== undefined && footerHeight > 0 && bodyCue ? (
									/* The cut-edge cue (design D63-1): a band of the sheet's own ground
									 *  over the bottom of the scrolling body, transparent at the content
									 *  edge and solid at the footer edge, so a partially drawn row reads as
									 *  "more below" instead of as a rendering fault. Truthful by
									 *  construction: shown only while the body overflows and is not
									 *  scrolled to its end. */
									<View
										pointerEvents="none"
										aria-hidden
										testID={SURFACE.sheetBodyFade}
										style={{
											position: "absolute",
											left: insets.left,
											right: insets.right,
											bottom: footerHeight,
											height: SHEET_BODY_FADE,
										}}
									>
										<Svg width="100%" height="100%">
											<Defs>
												<LinearGradient
													id={fadeId.current}
													x1="0%"
													y1="0%"
													x2="0%"
													y2="100%"
												>
													<Stop
														key="near"
														offset="0"
														stopColor={ground}
														stopOpacity={0}
													/>
													<Stop
														key="far"
														offset="1"
														stopColor={ground}
														stopOpacity={1}
													/>
												</LinearGradient>
											</Defs>
											<Rect
												width="100%"
												height="100%"
												fill={`url(#${fadeId.current})`}
											/>
										</Svg>
									</View>
								) : null}
							</Animated.View>
							{/* The keyboard's footprint, under the bottom-anchored surface: the
							 *  column is `justify-end`, so this lifts the surface's bottom edge to
							 *  the keyboard's top. A spacer, not a margin on the surface, because
							 *  the surface's transform runs on the native driver and a layout
							 *  property cannot share that node's animation. */}
							{keyboardLift > 0 ? (
								<View
									pointerEvents="none"
									testID={SURFACE.sheetKeyboardSpacer}
									style={{ height: keyboardLift }}
								/>
							) : null}
						</DirectionView>
					</ModalRoot>
				</ScopedVariables>
			</Modal>
		</ModalScopeContext.Provider>
	);
};
