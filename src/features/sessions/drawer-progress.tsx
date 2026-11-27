import { useCallback, useRef, useState } from "react";
import { useWindowDimensions } from "react-native";
import {
	cancelAnimation,
	Easing,
	runOnJS,
	type SharedValue,
	useAnimatedReaction,
	useSharedValue,
	withTiming,
} from "react-native-reanimated";

import {
	effectiveMs,
	type SettlePlan,
	settleAt,
	settlePlan,
} from "@/ui/drawer-motion";

/**
 * The drawer's progress as ONE shared value (0 closed … 1 a full width open),
 * and the settle plan every open and close runs on the UI thread.
 *
 * WHY A PLAN SHARED VALUE. The finger path, a tap-open, a spring-back and a
 * close are the same settle: write the plan, then run a linear clock from 0
 * to 1 for the plan's remaining time and map the clock through the curve. A
 * release resumes the SAME curve from the position it was left at, and an
 * interrupted settle can start again from wherever the value currently is.
 * The alternative — a custom easing closure handed to `withTiming` — would put
 * a JS closure on the UI thread, which is the less safe shape.
 *
 * `presented` is the MOUNT, not the intent: it turns on with `open()` and off
 * only when a close settle finishes, so the panel can slide out instead of
 * disappearing at the first frame. The provider keeps the reader-facing
 * `visible` flag.
 */
const IDLE_PLAN: SettlePlan = { from: 0, to: 0, t0: 1, ms: 120 };

export type DrawerProgress = {
	progress: SharedValue<number>;
	presented: boolean;
	open: () => void;
	close: () => void;
	/** Mount the panel off-screen without settling it: the page swipe's
	 *  touch-down prime. Idempotent, and it does not move `progress`, so a
	 *  drag that interrupts a close picks the panel up where it is. */
	prime: () => void;
	/** Drop a primed panel that never became a drag (a tap, a vertical
	 *  scroll), without animating it out. */
	unprime: () => void;
};

/** What a page swipe's `onEnd` or the panel's close drag calls: settle the
 *  drawer to open or closed from wherever the finger left it. */
export type DrawerSettle = (open: boolean) => void;

export const useDrawerProgress = ({
	reduceMotion,
}: {
	reduceMotion: boolean;
}): DrawerProgress => {
	const { width } = useWindowDimensions();
	const widthRef = useRef(width);
	widthRef.current = width;
	const reduceMotionRef = useRef(reduceMotion);
	reduceMotionRef.current = reduceMotion;

	const progress = useSharedValue(0);
	const clock = useSharedValue(0);
	const plan = useSharedValue<SettlePlan>(IDLE_PLAN);
	const [presented, setPresented] = useState(false);
	const presentedRef = useRef(false);

	useAnimatedReaction(
		() => clock.value,
		(u) => {
			progress.value = settleAt(plan.value, u);
		},
	);

	const unmount = useCallback(() => {
		presentedRef.current = false;
		progress.value = 0;
		setPresented(false);
	}, [progress]);

	const prime = useCallback(() => {
		/* A settle still running would fight the finger for `progress`; the
		 *  drag then continues from the value it stopped at, which is what
		 *  makes an interrupted close look continuous. Cancelled even when the
		 *  panel is already mounted: a touch on a settling panel takes it over. */
		cancelAnimation(clock);
		if (presentedRef.current) return;
		presentedRef.current = true;
		progress.value = 0;
		setPresented(true);
	}, [clock, progress]);

	const unprime = useCallback(() => {
		if (!presentedRef.current) return;
		cancelAnimation(clock);
		unmount();
	}, [clock, unmount]);

	const settle = useCallback(
		(target: 0 | 1) => {
			const next = settlePlan({
				position: progress.value * widthRef.current,
				width: widthRef.current,
				target,
			});
			plan.value = next;
			// A new touch or a reversed tap must not leave the previous timing
			// running into the new plan.
			cancelAnimation(clock);
			clock.value = 0;
			clock.value = withTiming(
				1,
				{
					duration: effectiveMs(next.ms, reduceMotionRef.current),
					easing: Easing.linear,
				},
				(finished) => {
					if (finished !== true) return;
					if (target === 0) runOnJS(unmount)();
				},
			);
		},
		[clock, plan, progress, unmount],
	);

	const open = useCallback(() => {
		if (!presentedRef.current) {
			presentedRef.current = true;
			progress.value = 0;
			setPresented(true);
		}
		settle(1);
	}, [progress, settle]);

	const close = useCallback(() => {
		if (!presentedRef.current) return;
		settle(0);
	}, [settle]);

	return { progress, presented, open, close, prime, unprime };
};
