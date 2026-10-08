import { afterEach, describe, expect, it } from "vitest";

import {
	closeModal,
	dimmer,
	hostDims,
	isCovered,
	type ModalHandle,
	type ModalScope,
	modalStackDepth,
	openModal,
	readModalStack,
	subscribeToModalStack,
} from "@/ui/modal-stack";

/**
 * THE STORE'S RULE, NOT THE HOOK. This file stays green when the hook regresses — it
 * did, twice, and that is why `src/ui/components/modal-stack-entry.test.ts` exists: it
 * renders the real hook and fails by name on a `!visible` branch that overwrites the
 * close's reading, or on a handle dropped at cleanup. What this file covers is
 * `dimmer()`/`readModalStack` themselves, which the hook calls and does not duplicate.
 *
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
	const openWithin = (parent: ModalScope | null, scrim = true): ModalHandle => {
		const scope: ModalScope = { current: null };
		const handle = openModal(scope, parent, scrim);
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

	it("keeps the dim alive through a dismissal, and hands it over at most once", () => {
		/* THE READING A RENDERER DRAWS FROM, walked through the dismissals (round 10,
		 *  R43). R34 has been fixed twice and regressed twice, and each time the store's
		 *  own rule was right — what broke was the reading a closing modal took. So this
		 *  asserts `readModalStack` at the moments the fade passes through: while a
		 *  modal's content is still mounted there is exactly ONE dimmer, never none and
		 *  never two. The React plumbing above it is not covered here — a Node test has
		 *  no renderer (vitest.config.ts) — and the capture is what exercises the hook;
		 *  what IS covered is every decision the hook makes, because it makes none. */
		const openWithin = (
			parent: ModalScope | null,
			scrim = true,
		): ModalHandle => {
			const scope: ModalScope = { current: null };
			const handle = openModal(scope, parent, scrim);
			return handle;
		};
		const dimmersIn = (handles: ModalHandle[]): number =>
			handles.filter((handle) => readModalStack(handle).dims).length;

		// (a) a standalone Dialog, dismissing: its own content is still mounted, so the
		// dim stays with it — this is the reading round 9's hook overwrote one tick later
		const dialog = openWithin(null, true);
		expect(readModalStack(dialog).dims).toBe(true);
		closeModal(dialog);
		expect(readModalStack(dialog).dims).toBe(true);

		// (e) …and if ANOTHER modal opens during that fade it takes the dim, rather than
		// both drawing it — the case that made retaining the reading unsafe
		const later = openWithin(null, true);
		expect(readModalStack(dialog).dims).toBe(false);
		expect(readModalStack(later).dims).toBe(true);
		expect(dimmersIn([dialog, later])).toBe(1);
		closeModal(later);
		expect(readModalStack(later).dims).toBe(true);

		// (b) the sibling resurface: the Sheet that comes back takes the dim as the
		// confirm goes, and the confirm stops drawing it — exactly one, at every step
		const sheet = openWithin(null, true);
		const confirm = openWithin(null, true);
		expect(dimmersIn([sheet, confirm])).toBe(1);
		expect(readModalStack(confirm).dims).toBe(true);
		closeModal(confirm);
		expect(dimmersIn([sheet, confirm])).toBe(1);
		expect(readModalStack(sheet).dims).toBe(true);
		closeModal(sheet);

		// (c) a Dialog raised inside a hosted Sheet: the outermost modal of the branch
		// dims for the whole chain, so the guest never paints a second one
		const host = openWithin(null, true);
		const guest = openWithin(host.scope, true);
		expect(dimmersIn([host, guest])).toBe(1);
		expect(readModalStack(host).dims).toBe(true);
		expect(readModalStack(guest).dims).toBe(false);
		closeModal(guest);
		closeModal(host);

		// (d) drawer, its pane's menu, and a Dialog from the menu: one throughout
		const drawer = openWithin(null, true);
		const menu = openWithin(drawer.scope, true);
		const inner = openWithin(menu.scope, true);
		expect(dimmersIn([drawer, menu, inner])).toBe(1);
		closeModal(inner);
		expect(dimmersIn([drawer, menu])).toBe(1);
		closeModal(menu);
		expect(dimmersIn([drawer, menu])).toBe(1);
		closeModal(drawer);
		expect(readModalStack(drawer).dims).toBe(true);
	});

	it("names ONE dimmer for every stack shape it can be put in", () => {
		/* ONE DIMMER PER FRAME (round 9, R39). Round 8 asserted a per-modal predicate
		 *  (`!covered && !hostDims`), which could be satisfied TWICE — a Dialog closing
		 *  over a Sheet left both drawing — so the question now has one answer, from
		 *  one place, and this is the table of shapes it has to answer for. */
		const who = (): ModalHandle | null => dimmer();

		// the shipped shape: drawer, its pane's menu, a dialog raised from the menu
		const drawer = openWithin(null, true);
		const menu = openWithin(drawer.scope, true);
		const dialog = openWithin(menu.scope, true);
		expect(who()).toBe(drawer);

		// SIBLINGS, not nested — `project-detail.tsx`'s milestone editor and its
		// destructive confirm. Closing the confirm hands the dim to the sheet that
		// resurfaces, instead of the two of them drawing it (the measured 0.91 pulse).
		closeModal(dialog);
		closeModal(menu);
		closeModal(drawer);
		const sheet = openWithin(null, true);
		const confirm = openWithin(null, true);
		expect(who()).toBe(confirm);
		closeModal(confirm);
		expect(who()).toBe(sheet);

		// nothing registered: the dim stays with the modal that had it, because that is
		// the one whose own Modal is still painting its content through the fade (R34)
		closeModal(sheet);
		expect(who()).toBe(sheet);

		// a guest whose host goes first takes the dim over rather than leaving a frame
		// with none
		const host = openWithin(null, true);
		const guest = openWithin(host.scope, true);
		expect(who()).toBe(host);
		closeModal(host);
		expect(who()).toBe(guest);

		// a Sheet over a Dialog: the outer one dims for both
		const base = openWithin(null, true);
		const overDialog = openWithin(base.scope, true);
		expect(who()).toBe(base);

		closeModal(overDialog);
		closeModal(guest);
		closeModal(base);
	});

	it("reports a scrimmed ancestor, and only a scrimmed one", () => {
		/* ONE DIM PER STACK (design round 5, D7/D8/D9). The guest asks this to
		 *  decide whether it draws a dim of its own, and the walk is the whole
		 *  chain: a dialog raised over a sheet that is itself hosted by the drawer
		 *  must still find the drawer's dim, or it would paint the second one the
		 *  round-4 blocker was about. */
		const drawer = openWithin(null, true);
		expect(hostDims(drawer)).toBe(false);

		const menu = openWithin(drawer.scope, true);
		expect(hostDims(menu)).toBe(true);

		// A GRANDCHILD still finds the drawer, through the sheet between them.
		const confirm = openWithin(menu.scope, true);
		expect(hostDims(confirm)).toBe(true);

		// A host that draws no dim passes none down.
		const plain = openWithin(null, false);
		const insidePlain = openWithin(plain.scope, true);
		expect(hostDims(insidePlain)).toBe(false);

		// A SIBLING is not an ancestor.
		const sibling = openWithin(null, true);
		expect(hostDims(sibling)).toBe(false);
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
