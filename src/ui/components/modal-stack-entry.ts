import { useEffect, useRef, useState } from "react";

import {
	closeModal,
	isCovered,
	type ModalHandle,
	openModal,
	subscribeToModalStack,
} from "@/ui/modal-stack";

/**
 * Whether a modal with this `visible` prop should actually be DRAWN, given that
 * every modal in this app covers the viewport.
 *
 * The rule itself — mount order, newest wins — lives in `@/ui/modal-stack` with
 * its own reasoning and its own test, because that module has no renderer in it.
 * This file is the few lines of React that connect a component to it, shared by
 * `Sheet` and `Dialog` rather than written twice: the guard has to hold between
 * ANY two modals, which is exactly the property a per-component copy would lose.
 *
 * The registration is keyed on `visible`, not on mount, so a modal that is
 * mounted but closed (the shape every caller here uses — a screen keeps its
 * sheets in the tree) does not stand down the sheet the reader is actually in.
 */
export function useModalStackEntry(visible: boolean): boolean {
	const handle = useRef<ModalHandle | null>(null);
	const [covered, setCovered] = useState(false);

	useEffect(() => {
		if (!visible) {
			setCovered(false);
			return;
		}
		const opened = openModal();
		handle.current = opened;
		const sync = () => setCovered(isCovered(opened));
		/* READ ONCE IMMEDIATELY, then on every change: a modal that opens while a
		 *  later one is already mounted (two sheets driven at once, a confirm raised
		 *  in the same commit) would otherwise keep whatever it last computed, and
		 *  the mount-order rule would be applied to a stale list. */
		sync();
		const unsubscribe = subscribeToModalStack(sync);
		return () => {
			unsubscribe();
			handle.current = null;
			/* Closing is what un-covers the modal underneath — the store's `emit` runs
			 *  the listeners of every other live entry, which is how the sheet the
			 *  reader returns to comes back without a second prop. */
			closeModal(opened);
		};
	}, [visible]);

	return covered;
}
