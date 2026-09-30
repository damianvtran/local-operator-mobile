/**
 * Whether a keydown is the composer's send gesture.
 *
 * The rule, stated once: **Enter sends, Shift+Enter inserts a newline**, on a
 * hardware keyboard, on both platforms. The three conditions are each a bug that
 * was measured rather than imagined:
 *
 * - `fromField` — the listener sits on the composer's own subtree, and the slash
 *   sheet's filter field renders inside it. Without this, Enter in the *filter*
 *   would send the draft the reader has not finished choosing from.
 * - `!shiftKey` — Shift+Enter is the only way to type a newline on a hardware
 *   keyboard, so claiming it would remove the ability to write one.
 * - `isComposing !== true` — while an IME is composing, Enter commits the
 *   CANDIDATE (a kana, a hanzi), and sending there would post half a word.
 *
 * Pure and React-free on purpose: the mechanism lives in a component, the test
 * runner cannot load the RN renderer, and a rule this easy to invert is exactly
 * the kind that needs a test which can fail.
 */
export const isSendKey = (event: {
	key: string;
	shiftKey: boolean;
	isComposing?: boolean;
	/** Whether the event's target is the message field, not another field in the subtree. */
	fromField: boolean;
}): boolean =>
	event.fromField &&
	event.key === "Enter" &&
	!event.shiftKey &&
	event.isComposing !== true;
