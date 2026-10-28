import {
	useCallback,
	useLayoutEffect,
	useRef,
	useSyncExternalStore,
} from "react";

/**
 * Which modals have closed but not yet finished their web dismissal (PR #122 QA
 * round 6, Q9 / A1).
 *
 * WHY IT EXISTS. On the web, react-native-web's `Modal` returns focus to the
 * element that held it when the modal OPENED, and it does so after `visible`
 * went false — when the modal stops rendering, which for `animationType="fade"`
 * is ~250 ms later. That focus scrolls the opener back into view. A screen that
 * scrolls something else into view in the meantime (Settings revealing a
 * refusal) is undone by it: a failed Sign out revealed its refusal at scrollTop
 * 174 and the Dialog's focus return put the screen back at the bottom 40–130 ms
 * later. Round 5 counted this for the switcher sheet alone, in its provider; any
 * modal can owe the same focus return, so the kit's renderers report to ONE
 * ledger instead of each caller keeping a count.
 *
 * WHAT IS RECORDED. A modal OWES a dismissal from the commit its Modal's
 * `visible` prop goes true→false until RNW's `onDismiss` fires. The prop the
 * Modal is actually given (`visible && !covered`), not the caller's `visible`:
 * a covered modal is dismissed by RNW too, and it fires `onDismiss` then. A
 * reopen before the dismissal clears the debt (RNW keeps rendering and never
 * dismisses), and so does an unmount (the focus return runs in the unmount
 * itself). A close while already down records nothing.
 *
 * ORDERING CONSTRAINT. The close is recorded in a LAYOUT effect, and a reader
 * must read `dismissalsOwed()` live inside its passive effect, not the value it
 * rendered with. A refusal and a close can land in the same commit (a failed
 * pick closes the switcher as the refusal is stored), and the screen's passive
 * effect can run before the modal's — the provider's sheet is a later sibling
 * of the screen. Layout effects of a commit all run before any passive effect,
 * so a live read in a passive effect always sees that commit's closes.
 * `useDismissalsOwed()` exists to re-render the reader when the debt settles.
 *
 * WEB ONLY. Native has no dismissal event the kit forwards, so a renderer passes
 * `web: false` there and records nothing; native readers keep their own
 * "is it down" check.
 *
 * A plain module rather than a context for the reason `@/ui/modal-stack` gives:
 * every modal renderer registers here wherever it is mounted, with no provider
 * to forget, and the rule is asserted directly in Node.
 */
const owed = new Set<object>();
const listeners = new Set<() => void>();

function changed(): void {
	for (const listener of listeners) listener();
}

function settle(token: object): void {
	if (owed.delete(token)) changed();
}

/** How many modals have closed and not yet been dismissed. Read it LIVE in an
 *  effect (see the ordering constraint above). */
export function dismissalsOwed(): number {
	return owed.size;
}

export function subscribeToDismissals(onChange: () => void): () => void {
	listeners.add(onChange);
	return () => {
		listeners.delete(onChange);
	};
}

/** Re-renders the caller whenever the number of owed dismissals changes. */
export function useDismissalsOwed(): number {
	return useSyncExternalStore(
		subscribeToDismissals,
		dismissalsOwed,
		dismissalsOwed,
	);
}

/**
 * Records this modal's closes in the ledger. `shown` is the `visible` prop the
 * `Modal` itself receives; pass the returned function as (or call it from) the
 * Modal's `onDismiss`. Every `Modal` renderer that can return focus on a screen
 * that moves the reader should call it — today `Sheet` and `Dialog`.
 */
export function useModalDismissal(shown: boolean, web: boolean): () => void {
	const token = useRef<object | null>(null);
	if (token.current === null) token.current = {};
	const wasShown = useRef(false);
	useLayoutEffect(() => {
		const self = token.current as object;
		if (web && wasShown.current && !shown) {
			owed.add(self);
			changed();
		} else if (shown) settle(self);
		wasShown.current = shown;
	}, [shown, web]);
	useLayoutEffect(() => () => settle(token.current as object), []);
	return useCallback(() => settle(token.current as object), []);
}
