/**
 * Drag-to-select text in the transcript and Team Bridge — the platform policy
 * and the one-at-a-time "select text" mode store.
 *
 * WHY THIS EXISTS (operator report on the iOS TestFlight build: "you can't
 * really tap to select and drag a selection to copy"). The two platforms give
 * `<Text selectable>` very different powers in React Native 0.86.3:
 *
 *  - ANDROID: `ReactTextViewManager.setSelectable` calls
 *    `TextView.setTextIsSelectable(true)`
 *    (`ReactAndroid/.../views/text/ReactTextViewManager.kt:295-296`), which is
 *    the platform's full selection: long-press picks a word, drag handles
 *    extend it across lines, and the floating toolbar offers Copy / Share /
 *    Select all. Nested `<Text>` spans are one TextView, so a paragraph with
 *    links and code spans still selects as one run.
 *  - iOS (Fabric): `RCTParagraphComponentView` draws through
 *    `RCTParagraphTextView`, a plain `UIView` (`RCTParagraphComponentView.mm:29`),
 *    not a `UITextView`. `selectable` only adds a `UILongPressGestureRecognizer`
 *    that presents an edit menu (`:289-327`) whose single `copy:` writes the
 *    WHOLE attributed string (`:347-365`). No caret, no handles, no partial
 *    range — that is the reported bug.
 *
 * The only stock iOS view with drag handles is `UITextView`, which RN exposes as
 * a multiline `TextInput`. With `editable={false}` the Fabric input sets
 * `UITextView.editable = NO` (`RCTTextInputComponentView.mm:214-215`) and leaves
 * `selectable` at UIKit's default YES, which is exactly iMessage's read-only
 * selection. So iOS gets a MODE: long-press a message swaps its rendered view for
 * a read-only `TextInput` holding the message's plain text, focused with the
 * whole message pre-selected so the handles are on screen at once.
 *
 * Android must NOT use that mode: `editable={false}` there maps to
 * `view.isEnabled = false` (`ReactTextInputManager.kt:597-600`), and a disabled
 * EditText cannot select at all. Android keeps native `selectable` leaves.
 * Web keeps `selectable` too (react-native-web maps it to `user-select: text`,
 * which already drags across paragraphs).
 *
 * No new native dependency: both paths are stock RN, so no prebuild change.
 */
import { Platform } from "react-native";

type OS = typeof Platform.OS;

/** iOS needs the TextInput mode; every other platform selects natively. */
export const usesSelectionMode = (os: OS = Platform.OS): boolean =>
	os === "ios";

/** Whether leaf `<Text>` should carry `selectable`. Off on iOS on purpose: the
 *  Fabric `selectable` long-press recognizer would fire its whole-block Copy
 *  menu on the SAME long-press that enters the selection mode. */
export const leafSelectable = (os: OS = Platform.OS): boolean =>
	!usesSelectionMode(os);

/**
 * Whether a selection change should end the mode. Tapping inside a read-only
 * UITextView collapses its selection to a caret position; that is the reader
 * saying "done", so a collapsed range exits — but only after a real range was
 * seen, because the input reports `{0,0}` while it mounts, before the initial
 * select-all lands, and exiting on that would close the mode instantly.
 */
export const selectionEndsMode = (
	selection: { start: number; end: number },
	sawRange: boolean,
): boolean => sawRange && selection.start === selection.end;

/* ------------------------------------------------------------ the mode store */

/**
 * At most ONE message is in selection mode, app-wide. A module store (not React
 * state in the list) so entering/leaving re-renders only the two rows whose
 * boolean flipped — each row subscribes to `activeId === myId`, and the list's
 * memoised rows never see the change. Lists call `exitTextSelection` on scroll
 * and on a touch outside the selecting row (`textSelectionContainerTouch`).
 */
let activeId: string | null = null;
let touchInside = false;
const listeners = new Set<() => void>();

const emit = () => {
	for (const listener of [...listeners]) listener();
};

export const subscribeTextSelection = (listener: () => void): (() => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};

export const activeTextSelection = (): string | null => activeId;

export const enterTextSelection = (id: string): void => {
	if (activeId === id) return;
	activeId = id;
	emit();
};

/** Leave the mode. With an id, only if that row is the active one (a row's own
 *  blur must not close a row that took over after it). */
export const exitTextSelection = (id?: string): void => {
	if (activeId === null) return;
	if (id !== undefined && activeId !== id) return;
	activeId = null;
	touchInside = false;
	emit();
};

/** The selecting row marks a touch as its own. Touch events bubble child-first,
 *  so this runs before the list's `textSelectionContainerTouch` for the same
 *  touch. */
export const noteTextSelectionTouch = (): void => {
	if (activeId !== null) touchInside = true;
};

/** A list's `onTouchStart`: a touch that did not start in the selecting row is
 *  a tap outside it, which ends the mode (iMessage/Slack behaviour). */
export const textSelectionContainerTouch = (): void => {
	if (activeId === null) return;
	if (touchInside) {
		touchInside = false;
		return;
	}
	exitTextSelection();
};
