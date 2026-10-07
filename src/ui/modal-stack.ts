/**
 * One modal at a time, registered where the modal is mounted — and a modal raised
 * INSIDE another does not stand its host down.
 *
 * WHY THE PRIMITIVE OWNS THIS. A React Native `Modal` covers the viewport, so two
 * of them mounted as SIBLINGS paint two full-height surfaces over each other —
 * what the audit's U-08 rule reports as a 320×568 pt overlap. The renderers are
 * `Sheet`, `Dialog` and `ConversationsDrawer`, and the rule is enforced by the
 * `Modal` being drawn rather than by a list here: a "these are all the callers"
 * claim in a comment is what let the drawer — a third caller — miss the guard for
 * a round, so every `Modal` in this app registers and `rg -n '<Modal' src/` is the
 * list. The first fix for this was a prop on ONE screen
 * (`visible={editor !== null && !confirmRemove}` in the projects detail) and that
 * shape is wrong for two reasons, both paid for in review: it guards one PAIRING,
 * so the screen's other confirm re-creates the identical overlap the moment some
 * other control raises it; and it leaves the invariant as a convention rather than
 * as a property of the primitive that renders the thing.
 *
 * WHY CONTAINMENT AND NOT JUST ORDER. Order alone got the drawer wrong, and the
 * way it got it wrong is worth keeping: the conversations pane ships a long-press
 * menu as a `Sheet` **rendered inside the drawer's own `Modal`**, so registering
 * the drawer as a flat entry meant the Sheet — its own DOM/React descendant — was
 * "newer", the drawer stood down, RNW's `Modal` unmounted its children, and the
 * pane (and the Sheet in it) went with it: a ~9 ms flicker and no menu, on the one
 * surface where the phone reader opens that menu. Two modals that NEST do not
 * overlap: the outer one's surface is the thing drawing the inner one, so the
 * inner one is the outer one's content rather than a second full-viewport layer.
 * The store therefore records, per entry, the SCOPE of the modal it was raised
 * inside (published by the renderer through `ModalScope`, a mutable holder rather
 * than a value, because React runs a child's effects before its parent's and a
 * snapshot taken at registration can be one commit too early), and an entry is
 * covered only by a newer entry that is NOT nested inside it.
 *
 * HOW IT RESOLVES. Mount order, not a priority: the newest entry that is not
 * nested inside an older one decides, and every older entry that is not its
 * ancestor stands down while it is up. That is also what makes the app's existing
 * shape (a confirm raised over a sheet, then dismissed returning the reader to the
 * sheet with their typing intact) work unchanged — the sheet is hidden, not
 * unmounted, and its state lives in the screen that owns it.
 *
 * WHY THE STORE IS A PLAIN MODULE, NOT A REACT CONTEXT. `vitest` here runs in Node
 * without a renderer (ADR 0003 — a test that needs the real renderer belongs in
 * the native layer), so the ORDERING rule is the part worth asserting and it is
 * asserted directly against this module. A context would put the rule inside a
 * component the tests cannot mount, and the components are already covered the
 * only way this repository covers them: by a rendered frame.
 */

/**
 * The handle of the modal a child renderer is nested inside — the renderer's own
 * registration, published to its subtree.
 *
 * A mutable `current` rather than the handle itself, and that is load-bearing: an
 * entry registers in an effect, and React runs the effects of the innermost
 * component first, so a nested modal that registers in the same commit as its host
 * would read a `null` snapshot and register as a sibling. The holder is created
 * during render and filled by the host's effect, so the answer is whatever is true
 * when the rule is asked.
 */
export interface ModalScope {
	current: ModalHandle | null;
}

/** A mounted modal, as the handle its own registration returns. */
export type ModalHandle = { readonly scope: ModalScope };

interface Entry {
	handle: ModalHandle;
	/** The scope this modal was raised inside, or null when it is at the root. */
	parent: ModalScope | null;
}

/**
 * The open modals, in mount order. Last is on top of its own branch.
 *
 * Module-level state is the point rather than a shortcut: two modals are only in
 * conflict if they are mounted in the same tree, and every modal in the app is.
 */
const open: Entry[] = [];
const listeners = new Set<() => void>();

const emit = (): void => {
	for (const listener of listeners) listener();
};

/**
 * Register a modal. The returned handle is what `closeModal` takes.
 *
 * `scope` is the holder this modal's OWN subtree reads to find it as a parent, and
 * `parent` is the scope of the modal it was raised inside (null at the root).
 */
export function openModal(
	scope: ModalScope,
	parent: ModalScope | null,
): ModalHandle {
	const handle: ModalHandle = { scope };
	open.push({ handle, parent });
	emit();
	return handle;
}

/** Unregister a modal. A handle that is not open is ignored, not an error. */
export function closeModal(handle: ModalHandle): void {
	const at = open.findIndex((entry) => entry.handle === handle);
	if (at === -1) return;
	open.splice(at, 1);
	emit();
}

/**
 * Whether `entry` was raised inside the modal `ancestor` — walked up the chain of
 * enclosing scopes, not off the mount order, because a modal raised inside an
 * older one is neither a sibling of it nor a sibling of anything it contains.
 */
function isNestedIn(entry: Entry, ancestor: ModalHandle): boolean {
	for (let scope = entry.parent; scope; ) {
		if (scope.current === ancestor) return true;
		const owner = open.find((candidate) => candidate.handle === scope?.current);
		scope = owner?.parent ?? null;
	}
	return false;
}

/**
 * Whether a NEWER modal that OVERLAPS this one is mounted over it.
 *
 * A handle that is not in the list is not covered: it is not mounted at all, and
 * the caller's own `visible` prop is what decides that case. Reporting it as
 * covered here would turn "not registered yet" into "hidden", which is the one way
 * this could produce a frame of nothing.
 */
export function isCovered(handle: ModalHandle): boolean {
	const at = open.findIndex((entry) => entry.handle === handle);
	if (at === -1) return false;
	return open.slice(at + 1).some((later) => !isNestedIn(later, handle));
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
