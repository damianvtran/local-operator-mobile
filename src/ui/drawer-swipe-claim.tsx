/**
 * The one relation that makes a NON-SCROLLER surface's own sideways touch beat
 * the page's drawer swipe.
 *
 * WHY A CLAIM, NOT A THRESHOLD. The page pan (`page-swipe-host.tsx`) is an
 * ancestor recogniser; a surface that handles its own horizontal drag in JS
 * (the composer's field, the inline chart's scrub `PanResponder`) is not
 * something a threshold can yield to, and it is not an RNGH handler the pan
 * could race fairly. `blocksExternalGesture` is the relation RNGH does support
 * for exactly this: the claim recognises the touch first and the page pan waits
 * for it to fail, so a drag that begins here never reaches the pan however far
 * it travels.
 *
 * WHAT DOES NOT USE IT. Horizontal `ScrollView`s (markdown tables and code,
 * diagram blocks, previews, the library's row, the attachment strip) are NOT
 * wrapped: they keep their sideways drag through the platform's own recogniser
 * competition, with `HORIZONTAL_SCROLL_PROPS` on iOS (`@/ui/horizontal-scroll`).
 * The ledger test proves the declaration is there; only a device proves the
 * competition — see docs/design/navigation-gestures.md.
 *
 * A `null` context (a screen mounted outside the page host, or a unit test)
 * makes this a plain wrapper: there is no pan to block, so there is nothing to
 * claim and no behaviour to change.
 */

import {
	createContext,
	type MutableRefObject,
	type ReactNode,
	useContext,
	useMemo,
} from "react";
import {
	Gesture,
	GestureDetector,
	type GestureType,
} from "react-native-gesture-handler";

/** The page pan's ref, published per screen by `PageSwipeHost`. */
export const DrawerPageGestureContext = createContext<MutableRefObject<
	GestureType | undefined
> | null>(null);

/**
 * Wrap a surface whose horizontal touch belongs to it and which has no native
 * scroller to win the race for it: the composer's field and the inline chart's
 * scrub. The claim recognises the touch and the page pan waits for it, so a
 * drag that begins here never opens the drawer — at any travel, in any
 * direction (the operator's P4: a table at its left end keeps scrolling rather
 * than handing off).
 */
export const DrawerSwipeClaim = ({ children }: { children: ReactNode }) => {
	const pageRef = useContext(DrawerPageGestureContext);
	const claim = useMemo(
		() => (pageRef ? Gesture.Native().blocksExternalGesture(pageRef) : null),
		[pageRef],
	);
	if (!claim) return <>{children}</>;
	return <GestureDetector gesture={claim}>{children}</GestureDetector>;
};
