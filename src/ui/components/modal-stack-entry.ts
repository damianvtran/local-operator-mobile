import { createContext, useContext, useEffect, useRef, useState } from "react";

import {
	closeModal,
	type ModalHandle,
	type ModalScope,
	type ModalStackReading,
	openModal,
	readModalStack,
	subscribeToModalStack,
} from "@/ui/modal-stack";

/**
 * The scope of the modal this subtree is drawn inside, or null at the root.
 *
 * A renderer wraps its own `Modal` in this provider with the `scope` the hook
 * returns, and that is what makes a modal raised INSIDE it register as content
 * rather than as a second full-viewport layer. The value is the host's HOLDER, not
 * its handle — see `@/ui/modal-stack`'s note on why a snapshot taken at
 * registration can be one commit too early.
 */
export const ModalScopeContext = createContext<ModalScope | null>(null);

export interface ModalStackEntry {
	/** Whether this modal should actually be DRAWN (a newer, overlapping modal is up). */
	covered: boolean;
	/**
	 * Whether a modal raised INSIDE this one is up. The host keeps painting its dim —
	 * it must, or the dim would have to be handed over and every frame of that hand-over
	 * is a frame that can be wrong — but it stops being a dismiss CONTROL, which is what
	 * keeps the audit's overlap rule from counting two dims (see `hasNestedModal`).
	 */
	nested: boolean;
	/**
	 * Whether THIS modal is the one drawing the dim. One modal answers yes per frame
	 * (see `dimmer`), and a modal that is mid-dismissal keeps the answer while its own
	 * content is still on screen — which is the whole of round 9's R39 and round 8's
	 * R34 at once.
	 */
	dims: boolean;
	/**
	 * Whether a modal raised inside this one already dims the screen. A modal whose
	 * host dims renders its scrim as a press layer with no dim of its own — one dim
	 * per stack, with no hand-over to get wrong (design round 5, D7/D8/D9).
	 */
	hostDims: boolean;
	/**
	 * This modal's own scope: pass it to `<ModalScopeContext.Provider value={scope}>`
	 * around the `Modal`. A renderer that nests a modal in its own content — the
	 * conversations drawer and the pane's long-press menu — then needs nothing else,
	 * and the primitive knows the inner one is content rather than a layer. Every
	 * `Modal` renderer wraps in it, and `rg -n '<Modal' src/` is the list that must.
	 */
	scope: ModalScope;
}

/**
 * Whether a modal with this `visible` prop should actually be DRAWN, given that
 * every modal in this app covers the viewport.
 *
 * The rule itself — mount order, with a modal nested inside another not covering
 * it — lives in `@/ui/modal-stack` with its own reasoning and its own test,
 * because that module has no renderer in it. This file is the few lines of React
 * that connect a component to it, shared by every modal renderer — `Sheet`,
 * `Dialog` and the conversations drawer — rather than written three times: the
 * guard has to hold between ANY two modals, which is exactly the property a
 * per-component copy would lose. The count is written as a rule rather than as a
 * list on purpose: an earlier version of this doc named two callers, the drawer
 * was a third, and the stale list is what let it miss the guard for a round.
 *
 * The registration is keyed on `visible`, not on mount, so a modal that is mounted
 * but closed (the shape every caller here uses — a screen keeps its sheets in the
 * tree) does not stand down the sheet the reader is actually in.
 */
export function useModalStackEntry(
	visible: boolean,
	options: { scrim?: boolean } = {},
): ModalStackEntry {
	const parent = useContext(ModalScopeContext);
	/* The holder is created during render and filled by the effect below: a nested
	 *  modal's own registration effect runs BEFORE its host's (React runs the
	 *  innermost effects first), so a child reading a handle would read null. It
	 *  reads the holder instead, and the holder is filled by the time the rule is
	 *  asked. */
	const held = useRef<ModalScope | null>(null);
	if (held.current === null) held.current = { current: null };
	const scope = held.current;
	/* The handle OUTLIVES the registration. A dismissal is exactly the moment the entry
	 *  leaves the list, and the reading that keeps the dim on screen during the fade is
	 *  the one taken with this handle (round 10, R43 — see `readModalStack`). */
	const last = useRef<ModalHandle | null>(null);
	/* Read off the options object so the effect's dependency is the primitive, not the
	 *  object literal every caller writes inline — a fresh `{}` per render would
	 *  re-register the modal on every render. */
	const scrim = options.scrim ?? true;

	const [snapshot, setSnapshot] = useState<ModalStackReading>({
		covered: false,
		dims: false,
		hostDims: false,
		nested: false,
	});

	/* SUBSCRIBED FOR THE COMPONENT'S LIFETIME, not for as long as it is visible: a
	 *  modal that is dismissing has to hear about the next one registering, or it would
	 *  keep painting its dim under a modal that has taken it (R43's second case), and a
	 *  modal that has closed has to be able to read the dim it still owns (R34). The
	 *  reading is `readModalStack`, so nothing here decides anything — round 9's version
	 *  wrote `dims: false` into a `!visible` branch and overwrote the very reading the
	 *  close had just produced. */
	const sync = useRef<() => void>(() => {});
	useEffect(() => {
		const read = () => setSnapshot(readModalStack(last.current));
		sync.current = read;
		read();
		return subscribeToModalStack(read);
	}, []);

	useEffect(() => {
		if (!visible) return;
		const opened = openModal(scope, parent, scrim);
		last.current = opened;
		scope.current = opened;
		/* `openModal` emits, but at that instant `last.current` was still the previous
		 *  handle, so read once more now that it is ours. */
		sync.current();
		return () => {
			closeModal(opened);
			scope.current = null;
			/* Re-read AFTER the close: the entry is gone, and the answer — whether this
			 *  modal still owns the dim — is what the fade is drawn from. */
			sync.current();
		};
	}, [visible, parent, scope, scrim]);

	return {
		covered: snapshot.covered,
		dims: snapshot.dims,
		hostDims: snapshot.hostDims,
		nested: snapshot.nested,
		scope,
	};
}
