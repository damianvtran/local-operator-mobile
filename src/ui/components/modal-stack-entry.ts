import { createContext, useContext, useEffect, useRef, useState } from "react";

import {
	closeModal,
	isCovered,
	type ModalScope,
	openModal,
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
export function useModalStackEntry(visible: boolean): ModalStackEntry {
	const parent = useContext(ModalScopeContext);
	/* The holder is created during render and filled by the effect below: a nested
	 *  modal's own registration effect runs BEFORE its host's (React runs the
	 *  innermost effects first), so a child reading a handle would read null. It
	 *  reads the holder instead, and the holder is filled by the time the rule is
	 *  asked. */
	const held = useRef<ModalScope | null>(null);
	if (held.current === null) held.current = { current: null };
	const scope = held.current;

	const [covered, setCovered] = useState(false);

	useEffect(() => {
		if (!visible) {
			setCovered(false);
			return;
		}
		const opened = openModal(scope, parent);
		scope.current = opened;
		const sync = () => setCovered(isCovered(opened));
		/* READ ONCE IMMEDIATELY, then on every change: a modal that opens while a
		 *  later one is already mounted (two sheets driven at once, a confirm raised
		 *  in the same commit) would otherwise keep whatever it last computed, and
		 *  the mount-order rule would be applied to a stale list. */
		sync();
		const unsubscribe = subscribeToModalStack(sync);
		return () => {
			unsubscribe();
			scope.current = null;
			/* Closing is what un-covers the modal underneath — the store's `emit` runs
			 *  the listeners of every other live entry, which is how the sheet the
			 *  reader returns to comes back without a second prop. */
			closeModal(opened);
		};
	}, [visible, parent, scope]);

	return { covered, scope };
}
