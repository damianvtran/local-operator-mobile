/**
 * Escape in the drawer's search pill: clear, then blur, then (and only then)
 * close the drawer.
 *
 * WHY THIS EXISTS (QA round 1, Q1, PR #256). The pill's field handled Escape on
 * KEYDOWN — clear the query, or blur an empty field — but react-native-web's
 * `Modal` closes on a document-level KEYUP Escape
 * (`react-native-web/dist/exports/Modal/ModalContent.js`, `closeOnEscape`), and
 * the drawer is that `Modal` (`conversations-drawer.tsx`, `onRequestClose`). So
 * every Escape the field had already acted on still reached the document a
 * moment later and closed the whole drawer, query and all.
 *
 * THE RULE. A keydown the field consumes marks its matching keyup as spent;
 * a capture-phase listener on `window` — which runs before the Modal's
 * bubble-phase listener on `document` — stops that keyup. An Escape the field
 * did not see (the field is empty and already blurred, so focus is elsewhere)
 * is never marked, reaches the Modal, and closes the drawer as before.
 *
 * CONSTRAINTS.
 * - Web only. Native has no document keyup: Android's back gesture/button
 *   reaches `onRequestClose` through the platform `Modal`, which this never
 *   touches, so "back closes the drawer" is unchanged.
 * - The mark is cleared by a capture-phase listener on EVERY keydown, which
 *   runs before the field's own keydown handler. A keyup lost to a window
 *   blur therefore can never swallow some later, unrelated Escape.
 * - Plain module with no `react-native` import, so a Node test can drive it
 *   against the real Modal listener (`search-escape.test.tsx`).
 */

/** What the pill hands the handler: its current query and its two actions. */
export type SearchEscapeField = {
	query(): string;
	clear(): void;
	blur(): void;
};

/** The slice of a DOM `KeyboardEvent` this reads. */
export type EscapeKeyEvent = {
	key: string;
	stopPropagation(): void;
	stopImmediatePropagation?(): void;
};

/** The slice of `window` the guard listens on. */
export type KeyEventTarget = {
	addEventListener(
		type: "keydown" | "keyup",
		listener: (event: EscapeKeyEvent) => void,
		capture: boolean,
	): void;
	removeEventListener(
		type: "keydown" | "keyup",
		listener: (event: EscapeKeyEvent) => void,
		capture: boolean,
	): void;
};

export type SearchEscape = {
	/** The field's own keydown (`onKeyPress`). True when it acted on Escape. */
	keyDown(key: string): boolean;
	/** Install the window guard; returns its removal. */
	guard(target: KeyEventTarget): () => void;
};

export function createSearchEscape(field: SearchEscapeField): SearchEscape {
	let spent = false;
	const onAnyKeyDown = () => {
		spent = false;
	};
	const onKeyUp = (event: EscapeKeyEvent) => {
		if (event.key !== "Escape" || !spent) return;
		spent = false;
		event.stopImmediatePropagation?.();
		event.stopPropagation();
	};
	return {
		keyDown(key) {
			if (key !== "Escape") return false;
			if (field.query() !== "") field.clear();
			else field.blur();
			spent = true;
			return true;
		},
		guard(target) {
			target.addEventListener("keydown", onAnyKeyDown, true);
			target.addEventListener("keyup", onKeyUp, true);
			return () => {
				target.removeEventListener("keydown", onAnyKeyDown, true);
				target.removeEventListener("keyup", onKeyUp, true);
			};
		},
	};
}
