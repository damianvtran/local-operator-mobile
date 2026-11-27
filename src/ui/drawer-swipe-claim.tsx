/**
 * The one relation that makes a surface's own sideways touch beat the page's
 * drawer swipe.
 *
 * WHY A CLAIM, NOT A THRESHOLD. The page pan (`page-swipe-host.tsx`) is an
 * ancestor recogniser; the RN `ScrollView` inside a table, a code block or a
 * diagram is not an RNGH handler, so `simultaneousHandlers`-style config has
 * nothing to point at. `blocksExternalGesture` is the relation RNGH does
 * support for exactly this: the claim recognises the touch first and the page
 * pan waits for it to fail, so a drag that begins here never reaches the pan
 * however far it travels. Wrapping the SURFACE rather than adding another
 * scroller is also what covers the surfaces that are not scrollers at all — the
 * inline chart's scrub `PanResponder` — and the composer, whose field owns its
 * own horizontal drag.
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
 * Wrap a surface whose horizontal touch belongs to it: a sideways scroller and
 * the inline chart's scrub. The claim recognises the touch and the page pan
 * waits for it, so a drag that begins here never opens the drawer — at any
 * travel, in any direction (the operator's P4: a table at its left end keeps
 * scrolling rather than handing off).
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
