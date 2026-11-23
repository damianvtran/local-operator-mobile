/**
 * A press and a long-press read from RAW touch events, for the ancestors of a
 * horizontal scroller.
 *
 * WHY THIS EXISTS. A `Pressable` claims the JS responder when a touch lands in
 * it. Put one around a horizontal `ScrollView` and, on iOS, the scroller's drag
 * never starts: the markdown table, code block and diagram in a message were
 * wrapped by exactly such a `Pressable` (the iOS select-text long-press), so a
 * wide table could not be scrolled from anywhere inside it. Measured on an
 * iOS 27.2 simulator with the mock relay's `tables` scenario: the same swipe
 * moves the table when the wrapper is a plain `View` and does nothing when it
 * is a `Pressable`, with the system's full-screen swipe-back on or off.
 *
 * Touch events (`onTouchStart` and friends) are only OBSERVED: they bubble
 * without claiming the responder, so the native scroll recognizer keeps the
 * gesture and RN sends `touchCancel` to the observer when a scroll takes over.
 * That cancel, plus the movement slop, is what ends a pending long-press.
 */
import { useEffect, useMemo, useRef } from "react";
import type { GestureResponderEvent } from "react-native";

/** `Pressable`'s own default `delayLongPress`, so a hold feels the same. */
export const LONG_PRESS_DELAY_MS = 500;
/** How far a finger may drift (pt) before the touch is a drag, not a hold. */
export const LONG_PRESS_SLOP_PT = 10;

export type TouchPressOptions = {
	/** A touch that lifted without moving and without reaching the delay. */
	onPress?: () => void;
	/** The finger stayed down and still for the delay. */
	onLongPress?: () => void;
	delayMs?: number;
	slopPt?: number;
};

export type TimerApi = {
	set: (callback: () => void, ms: number) => unknown;
	clear: (handle: unknown) => void;
};

const REAL_TIMERS: TimerApi = {
	set: (callback, ms) => setTimeout(callback, ms),
	clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export type TouchPress = {
	start: (x: number, y: number, touches: number) => void;
	move: (x: number, y: number, touches: number) => void;
	end: () => void;
	cancel: () => void;
};

/**
 * The state machine, free of React Native so a test can drive it with fake
 * timers. `read` supplies the CURRENT handlers on every call (a hook passes a
 * ref), so the machine itself never needs to be rebuilt.
 */
export function createTouchPress(
	read: () => TouchPressOptions,
	timers: TimerApi = REAL_TIMERS,
): TouchPress {
	type Phase = "idle" | "down" | "held" | "dragged";
	let phase: Phase = "idle";
	let originX = 0;
	let originY = 0;
	let handle: unknown;

	const clear = () => {
		if (handle !== undefined) timers.clear(handle);
		handle = undefined;
	};
	const finish = (next: Phase) => {
		clear();
		phase = next;
	};

	return {
		start(x, y, touches) {
			clear();
			// A second finger is a pinch or a scroll, never a press.
			if (touches > 1) {
				phase = "dragged";
				return;
			}
			phase = "down";
			originX = x;
			originY = y;
			const { delayMs = LONG_PRESS_DELAY_MS, onLongPress } = read();
			if (onLongPress === undefined) return;
			handle = timers.set(() => {
				handle = undefined;
				if (phase !== "down") return;
				phase = "held";
				read().onLongPress?.();
			}, delayMs);
		},
		move(x, y, touches) {
			if (phase !== "down") return;
			const { slopPt = LONG_PRESS_SLOP_PT } = read();
			if (touches > 1 || Math.hypot(x - originX, y - originY) > slopPt) {
				finish("dragged");
			}
		},
		end() {
			const was = phase;
			finish("idle");
			if (was === "down") read().onPress?.();
		},
		cancel() {
			finish("idle");
		},
	};
}

export type TouchPressHandlers = {
	onTouchStart: (event: GestureResponderEvent) => void;
	onTouchMove: (event: GestureResponderEvent) => void;
	onTouchEnd: () => void;
	onTouchCancel: () => void;
};

/** The state machine as the four `View` props that feed it. */
export function useTouchPress(options: TouchPressOptions): TouchPressHandlers {
	const latest = useRef(options);
	latest.current = options;
	const machine = useMemo(() => createTouchPress(() => latest.current), []);
	// A row that unmounts mid-hold (the list windows it out) must not fire later.
	useEffect(() => machine.cancel, [machine]);
	return useMemo<TouchPressHandlers>(
		() => ({
			onTouchStart: (event) =>
				machine.start(
					event.nativeEvent.pageX,
					event.nativeEvent.pageY,
					event.nativeEvent.touches.length,
				),
			onTouchMove: (event) =>
				machine.move(
					event.nativeEvent.pageX,
					event.nativeEvent.pageY,
					event.nativeEvent.touches.length,
				),
			onTouchEnd: machine.end,
			onTouchCancel: machine.cancel,
		}),
		[machine],
	);
}
