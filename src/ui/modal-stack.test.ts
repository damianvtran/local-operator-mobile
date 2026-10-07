import { afterEach, describe, expect, it } from "vitest";

import {
	closeModal,
	isCovered,
	type ModalHandle,
	type ModalScope,
	modalStackDepth,
	openModal,
	subscribeToModalStack,
} from "@/ui/modal-stack";

/**
 * The stacking rule, asserted on the store rather than through a renderer.
 *
 * WHY THIS FILE EXISTS. The first version of this guard was a prop on one screen
 * (`visible={editor !== null && !confirmRemove}`), which the review round rejected
 * for covering one pairing of two components that can be mounted in nine — the
 * screen's OTHER confirm re-created the identical full-viewport overlap. The rule
 * that replaces it is an ordering rule, and an ordering rule is exactly what a
 * plain test can settle: which of two mounted modals stands down, and what closing
 * one does to the other. The rendered half (does the surface actually disappear)
 * is the capture's job, and `S16-detail/milestone-remove` — the cell whose frames
 * U-08 failed — is what re-measures it.
 */
describe("the modal stack", () => {
	const opened: ModalHandle[] = [];

	/** Every handle this test opened, closed, whatever it left behind. */
	afterEach(() => {
		for (const handle of opened) closeModal(handle);
		opened.length = 0;
		expect(modalStackDepth()).toBe(0);
	});

	/* A registration the way a renderer makes one: its OWN scope holder (filled on
	 *  registration, exactly as the hook fills it) and the scope of the modal it is
	 *  drawn inside — null at the root. */
	const openWithin = (parent: ModalScope | null): ModalHandle => {
		const scope: ModalScope = { current: null };
		const handle = openModal(scope, parent);
		scope.current = handle;
		opened.push(handle);
		return handle;
	};

	const open = (): ModalHandle => openWithin(null);

	const openInside = (host: ModalHandle): ModalHandle => openWithin(host.scope);

	it("covers the older modal while a newer one is up", () => {
		const sheet = open();
		const confirm = open();

		expect(isCovered(sheet)).toBe(true);
		expect(isCovered(confirm)).toBe(false);
	});

	it("returns the reader to the modal underneath when the newer one closes", () => {
		const sheet = open();
		const confirm = open();

		closeModal(confirm);

		expect(isCovered(sheet)).toBe(false);
		expect(modalStackDepth()).toBe(1);
	});

	it("does not report an unmounted handle as covered", () => {
		const only = open();

		// Not registered is not the same as hidden: a handle the store has never
		// seen must not make a component render nothing.
		expect(isCovered({ scope: { current: null } })).toBe(false);
		expect(isCovered(only)).toBe(false);
	});

	it("ignores a close for a handle that is not open", () => {
		const only = open();

		closeModal({ scope: { current: null } });
		closeModal(only);
		closeModal(only);

		expect(modalStackDepth()).toBe(0);
	});

	it("does NOT stand a modal down for one raised INSIDE it", () => {
		/* THE DEFECT THIS PINS (round 3, R14). The conversations pane's long-press
		 *  menu is a `Sheet` rendered inside the drawer's own `Modal`, so a flat
		 *  mount-order rule made the menu the drawer's newer sibling: the drawer stood
		 *  down, RNW's `Modal` unmounted its children, and the pane — and the menu in
		 *  it — went with it. A modal nested in another is its CONTENT, not a second
		 *  full-viewport layer, and the reader's press must not destroy the surface it
		 *  was made on. */
		const drawer = open();
		const menu = openInside(drawer);

		expect(isCovered(drawer)).toBe(false);
		expect(isCovered(menu)).toBe(false);
	});

	it("still stands the older one down for a sibling, and for a modal in another branch", () => {
		const sheet = open();
		const confirm = open();

		expect(isCovered(sheet)).toBe(true);

		// A grandchild inside a dismissed branch does not make its host overlap-safe
		// either: what covers `sheet` is the newcomer, not the nesting.
		const drawer = open();
		const menu = openInside(drawer);

		expect(isCovered(sheet)).toBe(true);
		expect(isCovered(drawer)).toBe(false);
		expect(isCovered(confirm)).toBe(true);
		expect(isCovered(menu)).toBe(false);
	});

	it("treats a grandchild as nested inside its grandparent", () => {
		const drawer = open();
		const menu = openInside(drawer);
		const confirm = openInside(menu);

		expect(isCovered(drawer)).toBe(false);
		expect(isCovered(menu)).toBe(false);
		expect(isCovered(confirm)).toBe(false);
	});

	it("returns a nested modal's host to normal when the nested one closes", () => {
		const drawer = open();
		const menu = openInside(drawer);

		closeModal(menu);

		expect(isCovered(drawer)).toBe(false);
		expect(modalStackDepth()).toBe(1);
	});

	it("notifies a subscriber on every mount and unmount", () => {
		const readings: number[] = [];
		const unsubscribe = subscribeToModalStack(() =>
			readings.push(modalStackDepth()),
		);

		const a = open();
		const b = open();
		closeModal(b);
		closeModal(a);
		unsubscribe();
		open();

		// Four changes, and nothing after the unsubscribe — a stale listener is a
		// component that re-renders for a store it no longer reads.
		expect(readings).toEqual([1, 2, 1, 0]);
	});
});
