/**
 * The page's drawer swipe: one Pan around each `(app)` screen's content, and
 * the ref the surfaces inside it use to claim their own sideways touches.
 *
 * WHERE IT LIVES. `app/(app)/_layout.tsx` mounts this per screen through the
 * stack's `screenLayout`, so the gesture wraps exactly the screen the reader is
 * on. One Pan per screen instance also means one ref per screen, which is what
 * makes `DrawerSwipeClaim` inside that screen unambiguous.
 *
 * THE DRAG IS THE UITHREAD'S. `progress` is the drawer's own shared value
 * (`drawer-progress.tsx`), so the panel follows the finger 1:1 with no JS
 * round trip per frame; the JS thread is touched twice, at touch-down (`prime`,
 * which mounts the panel off-screen) and at release (`settle`, which runs the
 * same ease-in-out curve from wherever the finger left the panel).
 *
 * THE TOUCH-DOWN PRIME IS A BET. The 16 pt activation costs a few frames, so
 * the panel starts mounting at `onBegin` rather than at `onStart`; a touch that
 * turns out to be a tap or a vertical scroll abandons it (`onFinalize` without
 * an `onStart`). If a device shows the panel's first frame arriving after the
 * finger's, this bet is done and the alternative is priming at `onStart` with a
 * visible lag at activation — the trade-off E3 records.
 */

import { type ReactNode, useMemo, useRef, useSyncExternalStore } from "react";
import { Keyboard, Platform, useWindowDimensions, View } from "react-native";
import {
	Gesture,
	GestureDetector,
	type GestureType,
} from "react-native-gesture-handler";
import { runOnJS, useSharedValue } from "react-native-reanimated";
import {
	activeTextSelection,
	subscribeTextSelection,
} from "@/features/session/text-selection";
import { applyPagePanConfig, panEnabled } from "@/features/sessions/drawer-pan";
import { routeClassOf } from "@/features/sessions/top-level-routes";
import { useWorkspaceDrawer } from "@/features/sessions/workspace-drawer-context";
import { decideRelease } from "@/ui/drawer-motion";
import { DrawerPageGestureContext } from "@/ui/drawer-swipe-claim";

const hasSelection = () => activeTextSelection() !== null;
const neverSelecting = () => false;

/** The keyboard is dismissed when the gesture ACTIVATES, not at touch-down: a
 *  touch that turns out to be a tap must leave the field where it was. */
const dismissKeyboard = () => {
	Keyboard.dismiss();
};

/**
 * A screen's pan host. `routeName` is the declared route (`session/[id]`, not
 * the path), which is what `top-level-routes.ts` classifies; an undeclared
 * route is treated as nested and gets no page swipe.
 */
export const PageSwipeHost = ({
	routeName,
	children,
}: {
	routeName: string;
	children?: ReactNode;
}) => {
	const { progress, visible, prime, abandon, settle } = useWorkspaceDrawer();
	const { width } = useWindowDimensions();
	/* E5: the selection store is a JS store, so it is read through
	 *  `useSyncExternalStore` — the same shape `selectable-message.tsx` uses.
	 *  While a selection is live its handles own horizontal drags. */
	const selecting = useSyncExternalStore(
		subscribeTextSelection,
		hasSelection,
		neverSelecting,
	);
	const enabled =
		Platform.OS !== "web" &&
		panEnabled({
			routeClass: routeClassOf(routeName),
			drawerVisible: visible,
			selecting,
		});
	/* The ref is created once: `withRef` writes the mounted handler into it, and
	 *  every claim in this screen blocks THAT handler. */
	const pageRef = useRef<GestureType | undefined>(undefined);
	/* Where the settle was when the finger landed: a drag that interrupts a
	 *  close picks the panel up where it is instead of snapping it shut first. */
	const base = useSharedValue(0);

	const pan = useMemo(() => {
		const gesture = Gesture.Pan()
			.withRef(pageRef)
			.onBegin(() => {
				"worklet";
				base.value = progress.value;
				runOnJS(prime)();
			})
			.onStart(() => {
				"worklet";
				runOnJS(dismissKeyboard)();
			})
			.onUpdate((event) => {
				"worklet";
				const next = base.value + event.translationX / width;
				progress.value = next < 0 ? 0 : next > 1 ? 1 : next;
			})
			.onEnd((event, success) => {
				"worklet";
				/* A cancelled touch is not a choice: `decideRelease` refuses it.
				 *  The measured amount is the finger's travel in the commit
				 *  direction (rightward, here), from the app's motion module. */
				const commit = decideRelease({
					amount: event.translationX,
					width,
					velocity: event.velocityX,
					cancelled: !success,
				});
				runOnJS(settle)(commit);
			})
			.onFinalize(() => {
				"worklet";
				/* Runs after `onEnd` too; the provider's `abandon` is what knows
				 *  whether this touch ever activated, so a release is not undone. */
				runOnJS(abandon)();
			});
		/* `enabled` is a config value on the same object, so it is applied here
		 *  rather than by mutating a memoised gesture: a route change or a
		 *  selection flip rebuilds the pan, and neither can happen mid-drag. */
		return applyPagePanConfig(gesture, Platform.OS).enabled(enabled);
	}, [width, enabled, progress, base, prime, settle, abandon]);

	return (
		<DrawerPageGestureContext.Provider value={pageRef}>
			<GestureDetector gesture={pan}>
				<View className="flex-1">{children}</View>
			</GestureDetector>
		</DrawerPageGestureContext.Provider>
	);
};
