import { useSyncExternalStore } from "react";
import {
	Dimensions,
	Keyboard,
	type KeyboardEvent,
	Platform,
} from "react-native";

import { keyboardOverlap } from "@/features/session/composer-presentation";

/**
 * The software keyboard's frame, as ONE source for every reader.
 *
 * WHY ONE SOURCE (TestFlight 753: pasted images pushed Send under the
 * keyboard). The composer lifts itself above the keyboard and the session
 * screen computes the composer's ceiling; the screen used to know nothing about
 * the keyboard, so it capped the composer against the full window while the
 * composer separately guessed a bound from the window's top. Both now read this
 * store, so the overlap the composer lifts by and the overlap the screen caps
 * against are the same number from the same native event.
 *
 * WHAT "OVERLAP" MEANS. The part of the window the keyboard covers, in pt:
 * `window height - keyboard top`. On iOS the window keeps its full height with
 * the keyboard up, so this is the keyboard's height above the window bottom. On
 * Android the app is edge-to-edge (mandatory from Expo SDK 54 / RN 0.81 on), and
 * an edge-to-edge window is NOT resized by the IME even under the default
 * `adjustResize` (`softwareKeyboardLayoutMode: "resize"`): the IME is an inset,
 * so the overlap is likewise the keyboard's height. Should a window ever resize
 * instead, the event's `screenY` equals the new window height and the overlap
 * is 0 — the window height already ends at the keyboard — so both contracts
 * give the composer the same visible room without a platform branch.
 *
 * EVENTS. iOS `keyboardWillChangeFrame` fires before the keyboard moves (with
 * its animation's duration) and again for every height change while it is up
 * — the predictive bar, the emoji keyboard. Android has no "will" events;
 * `keyboardDidShow` fires on show and again when the IME changes height.
 * `keyboardDidHide` ends it on both. `visible` follows #206's rule: a frame
 * with an overlap or a height shows the keyboard, and only didHide hides it
 * (iOS's hide `willChangeFrame` reports overlap 0 a moment before didHide).
 *
 * One native subscription is shared by all readers and removed with the last
 * of them; the frame resets then, so a remount never starts from a stale one.
 */
export type KeyboardFrame = {
	visible: boolean;
	/** Whole pt, so a measurement tagged with it compares exactly. */
	overlap: number;
	/** The native animation's duration, in ms (200 when the platform gives none). */
	duration: number;
};

export const KEYBOARD_HIDDEN: KeyboardFrame = {
	visible: false,
	overlap: 0,
	duration: 200,
};

/** The frame a native keyboard event describes, given the one before it. */
export const keyboardFrameFrom = (
	previous: KeyboardFrame,
	windowHeight: number,
	event: Pick<KeyboardEvent, "duration" | "endCoordinates">,
): KeyboardFrame => {
	const overlap = Math.round(
		keyboardOverlap(windowHeight, event.endCoordinates.screenY),
	);
	return {
		visible: previous.visible || overlap > 0 || event.endCoordinates.height > 0,
		overlap,
		duration: event.duration || 200,
	};
};

type Listener = (frame: KeyboardFrame) => void;
let current: KeyboardFrame = KEYBOARD_HIDDEN;
const listeners = new Set<Listener>();
let native: { remove: () => void }[] | null = null;

const emit = (next: KeyboardFrame) => {
	current = next;
	for (const listener of [...listeners]) listener(next);
};

/** Subscribe to keyboard frames; the listener runs synchronously in the native
 *  event, which is what lets the composer start its lift in the same frame. */
export const subscribeKeyboardFrame = (listener: Listener): (() => void) => {
	listeners.add(listener);
	if (native === null && Platform.OS !== "web") {
		native = [
			Keyboard.addListener(
				Platform.OS === "ios" ? "keyboardWillChangeFrame" : "keyboardDidShow",
				(event) =>
					emit(
						keyboardFrameFrom(current, Dimensions.get("window").height, event),
					),
			),
			Keyboard.addListener("keyboardDidHide", () => emit(KEYBOARD_HIDDEN)),
		];
	}
	return () => {
		listeners.delete(listener);
		if (listeners.size > 0 || native === null) return;
		for (const sub of native) sub.remove();
		native = null;
		current = KEYBOARD_HIDDEN;
	};
};

export const keyboardFrameNow = (): KeyboardFrame => current;

/** The current keyboard frame, re-rendering on every change. */
export const useKeyboardFrame = (): KeyboardFrame =>
	useSyncExternalStore(
		subscribeKeyboardFrame,
		keyboardFrameNow,
		() => KEYBOARD_HIDDEN,
	);
