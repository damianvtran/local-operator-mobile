/**
 * One modal at a time, registered where the modal is mounted.
 *
 * WHY THE PRIMITIVE OWNS THIS. `Dialog` and `Sheet` are the only two components
 * that render a React Native `Modal`, and a `Modal` covers the viewport: two of
 * them mounted at once paint two full-height surfaces over each other, which is
 * what the audit's U-08 rule reports as a 320×568 pt overlap. The first fix for
 * this was a prop on ONE screen — `visible={editor !== null && !confirmRemove}`
 * in the projects detail — and that shape is wrong for two reasons, both paid for
 * in review: it guards one PAIRING, so the screen's other confirm (the project
 * delete, whose Dialog is unguarded) re-creates the identical overlap the moment
 * some other control raises it; and it leaves the invariant as a convention that
 * every future caller has to remember rather than as a property of the primitive
 * that renders the thing. A caller that opens a sheet over a sheet is not making
 * a mistake the reviewer should catch — it is asking for something the primitive
 * should refuse to draw.
 *
 * HOW IT RESOLVES. Mount order, not a priority: the modal that registered LAST is
 * the one the reader asked for, and every older one stands down while it is up.
 * That is also what makes the app's existing shape (a confirm raised over a
 * sheet, then dismissed returning the reader to the sheet with their typing
 * intact) work unchanged — the sheet is hidden, not unmounted, and its state
 * lives in the screen that owns it.
 *
 * WHY THE STORE IS A PLAIN MODULE, NOT A REACT CONTEXT. `vitest` here runs in
 * Node without a renderer (ADR 0003 — a test that needs the real renderer belongs
 * in the native layer), so the ORDERING rule is the part worth asserting and it is
 * asserted directly against this module. A context would put the rule inside a
 * component the tests cannot mount, and the components are already covered the
 * only way this repository covers them: by a rendered frame.
 */

/** A mounted modal, as the handle its own registration returns. */
export type ModalHandle = symbol;

/**
 * The open modals, in mount order. Last is on top.
 *
 * Module-level state is the point rather than a shortcut: two modals are only in
 * conflict if they are mounted in the same tree, and every modal in the app is.
 */
const open: ModalHandle[] = [];
const listeners = new Set<() => void>();

const emit = (): void => {
	for (const listener of listeners) listener();
};

/** Register a modal. The returned handle is what `closeModal` takes. */
export function openModal(): ModalHandle {
	const handle: ModalHandle = Symbol("modal");
	open.push(handle);
	emit();
	return handle;
}

/** Unregister a modal. A handle that is not open is ignored, not an error. */
export function closeModal(handle: ModalHandle): void {
	const at = open.indexOf(handle);
	if (at === -1) return;
	open.splice(at, 1);
	emit();
}

/**
 * Whether a NEWER modal is mounted over this one.
 *
 * A handle that is not in the list is not covered: it is not mounted at all, and
 * the caller's own `visible` prop is what decides that case. Reporting it as
 * covered here would turn "not registered yet" into "hidden", which is the one
 * way this could produce a frame of nothing.
 */
export function isCovered(handle: ModalHandle): boolean {
	const at = open.indexOf(handle);
	return at !== -1 && at < open.length - 1;
}

/** How many modals are mounted. The store's snapshot, for `useSyncExternalStore`. */
export function modalStackDepth(): number {
	return open.length;
}

/** Subscribe to mount/unmount. Returns the unsubscribe. */
export function subscribeToModalStack(onChange: () => void): () => void {
	listeners.add(onChange);
	return () => {
		listeners.delete(onChange);
	};
}
