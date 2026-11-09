import { useEffect, useRef, useState } from "react";

import { modalStackDepth, subscribeToModalStack } from "@/ui/modal-stack";

/**
 * Whether a closing modal may play an exit animation, or must vanish at once.
 *
 * Pure, so the rule is table-tested (`modal-exit.test.ts`):
 *
 *  - REDUCED MOTION → no. The entry keeps a capped duration because a press
 *    must look like a press; a close has no such debt, and "less motion" is
 *    the whole request.
 *  - ANOTHER MODAL IS UP OR ARRIVING → no. The app's commonest close is a
 *    hand-off: a menu row closes its sheet and opens the next in the same
 *    press, and the drawer's workspace row closes the drawer to raise the
 *    computer switcher. Holding the outgoing modal mounted through an exit
 *    would put two native `Modal`s on screen at once. Stacked presentations
 *    are a known hazard on iOS (a second one raised while the first is still
 *    dismissing), and this change could not be exercised on a device, so a
 *    hand-off stays exactly as instant as it was before exits existed.
 */
export const shouldAnimateExit = (input: {
	reduceMotion: boolean;
	/** Modals still registered AFTER this one closed (`modalStackDepth`). */
	othersOpen: number;
}): boolean => !input.reduceMotion && input.othersOpen === 0;

/** Slack added to the exit's own duration before the fallback unmounts the
 *  modal anyway. Not a cap on measured work: the animation's length is the
 *  caller's token, and this only covers a completion callback that never
 *  arrives (an animation driver that drops it), so a sheet can never be left
 *  mounted and invisible over the app. */
export const EXIT_FALLBACK_SLACK_MS = 120;

/**
 * Keeps a modal mounted for one exit animation after `visible` goes false.
 *
 * WHY (perf audit P7). Sheets and the conversations drawer animated IN on the
 * native driver and did not animate out at all: on `visible=false` the values
 * were reset and the `Modal` hidden in the same commit, so every one of them
 * blinked away. The exit runs on the same native-driven values as the entry —
 * off the JS thread — and the caller renders `visible || exiting`.
 *
 * WHAT DOES NOT MOVE. Everything else about a close is still keyed on the
 * caller's `visible`: the modal-stack registration is released immediately (so
 * a sheet opening right after is not told it is covered), and `onClose` has
 * already run. Only the `Modal`'s own unmount — and therefore the platform's
 * `onDismiss` — is later, by the exit's duration.
 *
 * @param animateOut Start the exit; call `done` when it finishes (or is
 *   interrupted). Must be safe to call while the entry is still running.
 * @param reset Put the animated values back to "closed" without animating —
 *   the pre-exit behaviour, used whenever the exit is skipped.
 */
export const useModalExit = (input: {
	visible: boolean;
	reduceMotion: boolean;
	durationMs: number;
	animateOut: (done: () => void) => void;
	reset: () => void;
}): boolean => {
	const [exiting, setExiting] = useState(false);
	const was = useRef(input.visible);
	/* The callbacks are read through a ref so the effect below depends on
	 *  `visible` alone: a caller's inline closures must not restart an exit. */
	const latest = useRef(input);
	latest.current = input;
	useEffect(() => {
		const closed = was.current && !input.visible;
		was.current = input.visible;
		if (input.visible) {
			setExiting(false);
			return undefined;
		}
		const { reduceMotion, durationMs, animateOut, reset } = latest.current;
		if (
			!closed ||
			!shouldAnimateExit({ reduceMotion, othersOpen: modalStackDepth() })
		) {
			reset();
			return undefined;
		}
		let live = true;
		const finish = () => {
			if (!live) return;
			live = false;
			clearTimeout(fallback);
			unsubscribe();
			latest.current.reset();
			setExiting(false);
		};
		/* A modal that opens DURING the exit ends it at once — the same
		 *  two-modals hazard `shouldAnimateExit` refuses up front, arriving a
		 *  tick later (a sibling's effect, a deferred open). */
		const unsubscribe = subscribeToModalStack(() => {
			if (modalStackDepth() > 0) finish();
		});
		const fallback = setTimeout(finish, durationMs + EXIT_FALLBACK_SLACK_MS);
		setExiting(true);
		animateOut(finish);
		return () => {
			/* Reopened (or unmounted) mid-exit: the entry owns the values now. */
			live = false;
			clearTimeout(fallback);
			unsubscribe();
		};
	}, [input.visible]);
	return exiting;
};
