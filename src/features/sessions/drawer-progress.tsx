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
 *
 * THE MOUNT HAS TWO LEVELS. `presented` is the SHELL — the sliding panel's own
 * fill, cheap enough to mount at every touch-down. `revealed` is the pane's
 * CONTENT — its timers, its tag catalogue read and its modal-stack entry — and
 * it turns on only once the touch is a real sideways drag (`reveal`). A tap or
 * a vertical scroll mounts the shell and drops it again without ever paying for
 * the content (M2).
 */
const IDLE_PLAN: SettlePlan = { from: 0, to: 0, t0: 1, ms: 120 };

export type DrawerProgress = {
	progress: SharedValue<number>;
	/** The shell is mounted: the panel's fill, off-screen until a settle moves
	 *  it. True from touch-down or from `open()`. */
	presented: boolean;
	/** The content is mounted inside the shell. True once a touch crossed the
	 *  reveal threshold, or from `open()`. */
	revealed: boolean;
	open: () => void;
	close: () => void;
	/** Mount the shell off-screen without settling it: the page swipe's
	 *  touch-down prime. Idempotent, and it does not move `progress`, so a
	 *  drag that interrupts a close picks the panel up where it is. */
	prime: () => void;
	/** Mount the content inside a primed shell. No-op without a shell, or when
	 *  the content is already up. */
	reveal: () => void;
	/** Drop a primed shell that never became a drag (a tap, a vertical
	 *  scroll), without animating it out. */
	unprime: () => void;
	/** Restart the settle a `prime` interrupted, to the target it was heading
	 *  for. Answers whether one was waiting: a touch that froze an opening
	 *  panel and then did nothing must not leave it part-open (M1). */
	resume: () => boolean;
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
	const [revealed, setRevealed] = useState(false);
	const presentedRef = useRef(false);
	const revealedRef = useRef(false);
	/* The mount/close intent the running clock belongs to. A completion queued
	 *  to the JS thread may arrive after a reopen or a prime; only the latest
	 *  intent is allowed to act (m3: a stale close `unmount` wedged `visible`). */
	const intentRef = useRef(0);
	/* The target the clock is settling to, and the one a touch took over with
	 *  `prime`; `resume` hands the held target back to `settle`. */
	const settlingRef = useRef<0 | 1 | null>(null);
	const heldRef = useRef<0 | 1 | null>(null);

	useAnimatedReaction(
		() => clock.value,
		(u) => {
			progress.value = settleAt(plan.value, u);
		},
	);

	const unmount = useCallback(() => {
		presentedRef.current = false;
		revealedRef.current = false;
		progress.value = 0;
		setPresented(false);
		setRevealed(false);
	}, [progress]);

	/* Runs on the JS thread when a settle ends. The intent check is what stops a
	 *  close that finished a tick BEFORE a reopen from unmounting the reopened
	 *  panel (the `presented` wedge m3 recorded). */
	const finishSettle = useCallback(
		(intent: number, target: 0 | 1) => {
			if (intentRef.current !== intent) return;
			settlingRef.current = null;
			if (target === 0) unmount();
		},
		[unmount],
	);

	const prime = useCallback(() => {
		/* A settle still running would fight the finger for `progress`; the
		 *  drag then continues from the value it stopped at, which is what
		 *  makes an interrupted close look continuous. Cancelled even when the
		 *  panel is already mounted: a touch on a settling panel takes it over,
		 *  and `resume` gives the settle back if that touch never drags (M1). */
		intentRef.current += 1;
		if (settlingRef.current !== null) heldRef.current = settlingRef.current;
		settlingRef.current = null;
		cancelAnimation(clock);
		if (presentedRef.current) return;
		presentedRef.current = true;
		progress.value = 0;
		setPresented(true);
	}, [clock, progress]);

	const reveal = useCallback(() => {
		if (!presentedRef.current || revealedRef.current) return;
		revealedRef.current = true;
		setRevealed(true);
	}, []);

	const unprime = useCallback(() => {
		intentRef.current += 1;
		settlingRef.current = null;
		heldRef.current = null;
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
			/* Every settle is a new intent: the previous clock's completion may
			 *  still be queued to the JS thread and must not act on this one. */
			const intent = intentRef.current + 1;
			intentRef.current = intent;
			heldRef.current = null;
			settlingRef.current = target;
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
					runOnJS(finishSettle)(intent, target);
				},
			);
		},
		[clock, plan, progress, finishSettle],
	);

	const resume = useCallback((): boolean => {
		const target = heldRef.current;
		heldRef.current = null;
		if (target === null) return false;
		settle(target);
		return true;
	}, [settle]);

	const open = useCallback(() => {
		if (!presentedRef.current) {
			presentedRef.current = true;
			progress.value = 0;
			setPresented(true);
		}
		if (!revealedRef.current) {
			revealedRef.current = true;
			setRevealed(true);
		}
		settle(1);
	}, [progress, settle]);

	const close = useCallback(() => {
		if (!presentedRef.current) return;
		settle(0);
	}, [settle]);

	return {
		progress,
		presented,
		revealed,
		open,
		close,
		prime,
		reveal,
		unprime,
		resume,
	};
};
