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
	/**
	 * Whether this renderer draws a DIM of its own when nothing above it does.
	 * A modal whose host already dims does not draw a second one — see
	 * `hostDims` — so this is "would", not "does".
	 */
	scrim: boolean;
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
	scrim = true,
): ModalHandle {
	const handle: ModalHandle = { scope };
	open.push({ handle, parent, scrim });
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
/**
 * Whether a modal raised INSIDE this one is open.
 *
 * The host needs this for its own SCRIM, and the reason changed in round 7. Round 4
 * used it to stand the scrim down, which is what produced the transition defects; the
 * scrim now stays and paints the dim for the whole time the host is up. What it must
 * NOT do while a modal inside it is up is stay INTERACTIVE: the nested surface's scrim
 * is above it, so this one can never receive the dismiss press it exists for — and a
 * painter that is neither interactive nor has text of its own is exactly the node the
 * audit's overlap rule excludes from its pair set (`isGhost`, `checks.ts`), which is
 * how one dim stops reading as two.
 *
 * NOT "make the guest scrim transparent and call it a ghost", which is what round 6
 * claimed and CI disproved (run 37721652724: six `U-08` FAILs on the `S15/menu-open`
 * iphone-se cells, `Close conversations ∩ Close`). `isGhost` is
 * `clippedAway || (ariaHidden && !ownInk)`; a transparent PRESSABLE has ink-less paint
 * but neither property, so it stays in the pair set. A transparent, childless,
 * borderless box is only a ghost when it is also aria-hidden — and hiding the guest's
 * dismiss control from assistive tech to satisfy a rule is the wrong trade when the
 * honest answer is that the HOST's layer is the one not doing anything.
 */
export function hasNestedModal(handle: ModalHandle): boolean {
	const at = open.findIndex((entry) => entry.handle === handle);
	if (at === -1) return false;
	return open.some(
		(other) => other.handle !== handle && isNestedIn(other, handle),
	);
}

/**
 * Whether `entry` was raised inside `ancestor`, through any number of levels.
 *
 * The chain is the modal's own `parent` scope and then each owner's `parent`, rather
 * than a comparison of positions in the list: a modal raised inside another is that
 * one's CONTENT, not a later sibling of it, and the two rules that need the
 * distinction (`isCovered`, `hasNestedModal`) would both be wrong on mount order
 * alone — the drawer's sheet mounts after the drawer and is not over it.
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

/**
 * Whether an ANCESTOR of this modal already dims the screen.
 *
 * ONE DIM PER STACK (design round 5, D7/D8/D9). Round 4 stood the host's scrim down
 * while a nested modal was up and handed the dim to the nested surface; every frame of
 * that hand-over was a frame that could be wrong, and all three findings were the
 * hand-over — the strip beside the drawer going fully undimmed for 40-89 ms on close
 * (30 of 32 reps), the dim dipping to 0.570 when a release timer fired mid-fade, and
 * the overlap pulsing 0.70 -> 0.91. No tuning removes the class, so the host keeps the
 * dim and the guest paints none while an ancestor holds it. This is the question the
 * guest asks; `hasNestedModal` is the one the host asks about its own layer.
 *
 * THE WALK IS THE WHOLE CHAIN, not the immediate parent: a dialog raised over a sheet
 * that is itself hosted by the drawer must still find the drawer's dim, or it would
 * paint the second dim the round-4 blocker was about.
 *
 * ROUND 7 CORRECTED A CLAIM THAT USED TO SIT HERE. Round 6 said a transparent guest
 * scrim "is a ghost to the audit's overlap rule" and CI disproved it (run
 * 37721652724: six `U-08` FAILs on the `S15/menu-open` iphone-se cells,
 * `Close conversations ∩ Close`). `isGhost` is `clippedAway || (ariaHidden &&
 * !ownInk)`, and a transparent PRESSABLE is neither. What keeps that pair out is the
 * HOST's side of it: while a nested modal owns the dismiss the host's layer stops
 * being interactive, and a painter with no text and no interactivity is the node the
 * rule excludes.
 */
export function hostDims(handle: ModalHandle): boolean {
	let entry = open.find((candidate) => candidate.handle === handle);
	while (entry !== undefined && entry.parent !== null) {
		const owner = open.find(
			(candidate) => candidate.handle.scope === entry?.parent,
		);
		if (owner === undefined) return false;
		if (owner.scrim) return true;
		entry = owner;
	}
	return false;
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
