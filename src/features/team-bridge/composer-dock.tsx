import { type ReactNode, useEffect } from "react";
import { View } from "react-native";
import Animated, {
	useAnimatedStyle,
	useSharedValue,
	withTiming,
} from "react-native-reanimated";
import { COMPOSER_SIDE_PAD } from "@/features/session/composer-presentation";
import {
	keyboardFrameNow,
	subscribeKeyboardFrame,
	useKeyboardFrame,
} from "@/features/session/keyboard-frame";
import { composerOuterGap } from "@/ui/device-corner";

/**
 * The Team Bridge composer's dock: it rides above the software keyboard the way
 * the agent chat composer does.
 *
 * WHY (operator, TestFlight 800): "the composer doesn't move up to go above the
 * keyboard like the agent chat composer does". The thread wrapped its whole body
 * in a `KeyboardAvoidingView`, which measures its own frame against the keyboard
 * and is fragile inside the app's `Screen` chrome; the agent screen instead reads
 * #216's ONE keyboard store (`keyboard-frame.ts`) and lifts its composer by the
 * store's overlap. This dock is that mechanism, not a second one:
 *
 *  - the lift is the store's `overlap`, animated with the native frame's own
 *    `duration` and seeded from `keyboardFrameNow()` so a dock mounting over an
 *    open keyboard starts above it (the agent composer's PR #216 review m2);
 *  - the clearance is `composerOuterGap` — safe inset + 8 with the keyboard
 *    down, 8 alone with it up (#219's rule) — so the painted bottom offset is
 *    `inset + 8` down and `overlap + 8` up, the agent dock's carrier padding
 *    plus its `marginBottom: keyboardOffset + 8` (`composer.tsx`, dockMotion).
 *
 * The transcript above is `flex-1`, so the lift shortens the list's viewport;
 * the list's `onLayout` is the thread viewport's (`thread-viewport.ts`), which
 * keeps a follower at the newest message on a resize and leaves a reader who
 * scrolled up where they were (#208). Nothing here scrolls the list.
 *
 * Only the dock's OUTER box animates (a margin under it); the inner box keeps
 * the screen's `className`, `testID` and the static clearance, so the static
 * rule is readable from the rendered tree and the animated part is the overlap
 * alone.
 */
export function BridgeComposerDock({
	bottomInset,
	className,
	testID,
	children,
}: {
	bottomInset: number;
	className?: string;
	testID?: string;
	children: ReactNode;
}) {
	/* The same store the lift subscribes to below, read for `visible`: the inset
	 *  drops with the keyboard's first frame, exactly when the agent dock drops
	 *  its carrier inset (`dockInset`). */
	const keyboardVisible = useKeyboardFrame().visible;
	const lift = useSharedValue(0);
	useEffect(() => {
		/* Subscribed directly (not through the hook's re-render) so the lift starts
		 *  in the native event itself, as the agent composer's does. Hidden snaps
		 *  to 0: didHide fires after the keyboard has gone. */
		const unsubscribe = subscribeKeyboardFrame((frame) => {
			lift.value = frame.visible
				? withTiming(frame.overlap, { duration: frame.duration })
				: 0;
		});
		const present = keyboardFrameNow();
		lift.value = present.visible ? present.overlap : 0;
		return unsubscribe;
	}, [lift]);
	const liftStyle = useAnimatedStyle(() => ({ marginBottom: lift.value }));
	return (
		<Animated.View style={liftStyle}>
			<View
				className={className}
				style={{
					paddingHorizontal: COMPOSER_SIDE_PAD,
					paddingBottom: composerOuterGap(bottomInset, keyboardVisible),
				}}
				testID={testID}
			>
				{children}
			</View>
		</Animated.View>
	);
}
