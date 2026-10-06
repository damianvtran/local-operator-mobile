import { afterEach, describe, expect, it } from "vitest";

import {
	closeModal,
	isCovered,
	type ModalHandle,
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

	const open = (): ModalHandle => {
		const handle = openModal();
		opened.push(handle);
		return handle;
	};

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
		expect(isCovered(Symbol("never opened"))).toBe(false);
		expect(isCovered(only)).toBe(false);
	});

	it("ignores a close for a handle that is not open", () => {
		const only = open();

		closeModal(Symbol("never opened"));
		closeModal(only);
		closeModal(only);

		expect(modalStackDepth()).toBe(0);
	});

	it("notifies a subscriber on every mount and unmount", () => {
		const readings: number[] = [];
		const unsubscribe = subscribeToModalStack(() => readings.push(modalStackDepth()));

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
