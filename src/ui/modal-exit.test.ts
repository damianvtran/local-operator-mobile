import { readFileSync } from "node:fs";
import { act, createElement, Fragment, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type DomShim, installDomShim } from "@/testing/dom-shim";
import {
	createTransitionTick,
	EXIT_FALLBACK_SLACK_MS,
	exitPointerEvents,
	shouldAnimateExit,
	useModalExit,
} from "@/ui/modal-exit";
import { closeModal, type ModalHandle, openModal } from "@/ui/modal-stack";

/* The sheet's content root, with the comment that sits between its props. */
const SHEET_ROOT_INERT =
	/<DirectionView className="flex-1 justify-end" (?:\/\*.*?\*\/ )?pointerEvents=\{exitPointerEvents\(visible\)\}/;

describe("shouldAnimateExit", () => {
	it("animates a plain close", () => {
		expect(shouldAnimateExit({ reduceMotion: false, othersOpen: 0 })).toBe(
			true,
		);
	});

	it("never animates under reduced motion", () => {
		expect(shouldAnimateExit({ reduceMotion: true, othersOpen: 0 })).toBe(
			false,
		);
	});

	it("never holds a closing modal over one that is up or arriving", () => {
		// The hand-off (a menu row opening the next sheet in the same press)
		// must stay instant: two native modals at once is the hazard.
		for (const othersOpen of [1, 2, 5])
			expect(shouldAnimateExit({ reduceMotion: false, othersOpen })).toBe(
				false,
			);
	});

	it("keeps the unmount fallback a small positive slack", () => {
		expect(EXIT_FALLBACK_SLACK_MS).toBeGreaterThan(0);
		expect(EXIT_FALLBACK_SLACK_MS).toBeLessThanOrEqual(250);
	});
});

/**
 * The hook itself, mounted: what a caller's `Modal` is told while a close
 * animates. Driven through the real modal stack, because "another modal is up
 * or arrives" is the case the exit must lose to.
 */
describe("useModalExit", () => {
	let dom: DomShim | null = null;
	let root: ReturnType<typeof createRoot> | null = null;
	let exiting: boolean[] = [];
	let done: (() => void) | null = null;
	let resets = 0;
	const opened: ModalHandle[] = [];

	const Probe = ({
		visible,
		reduceMotion = false,
	}: {
		visible: boolean;
		reduceMotion?: boolean;
	}) => {
		exiting.push(
			useModalExit({
				visible,
				reduceMotion,
				durationMs: 150,
				animateOut: (finish) => {
					done = finish;
				},
				reset: () => {
					resets += 1;
				},
			}),
		);
		return null;
	};
	const show = (props: { visible: boolean; reduceMotion?: boolean }) =>
		act(async () => root?.render(createElement(Probe, props)));
	const last = () => exiting[exiting.length - 1];

	beforeEach(() => {
		vi.useFakeTimers();
		dom = installDomShim();
		root = createRoot(dom.container as Element);
		exiting = [];
		done = null;
		resets = 0;
	});
	afterEach(async () => {
		await act(async () => root?.unmount());
		root = null;
		dom?.dispose();
		dom = null;
		for (const handle of opened.splice(0)) closeModal(handle);
		vi.useRealTimers();
	});

	it("holds the modal for the exit and releases it when the animation ends", async () => {
		await show({ visible: true });
		expect(last()).toBe(false);
		await show({ visible: false });
		expect(last()).toBe(true);
		await act(async () => done?.());
		expect(last()).toBe(false);
	});

	it("releases on the fallback when the animation never reports back", async () => {
		await show({ visible: true });
		await show({ visible: false });
		expect(last()).toBe(true);
		await act(async () => {
			vi.advanceTimersByTime(150 + EXIT_FALLBACK_SLACK_MS);
		});
		expect(last()).toBe(false);
	});

	it("does not animate under reduced motion: reset, as before", async () => {
		await show({ visible: true, reduceMotion: true });
		await show({ visible: false, reduceMotion: true });
		expect(exiting).not.toContain(true);
		expect(done).toBeNull();
		expect(resets).toBeGreaterThan(0);
	});

	it("does not animate when another modal is already up (a hand-off)", async () => {
		await show({ visible: true });
		opened.push(openModal({ current: null }, null, true));
		await show({ visible: false });
		expect(exiting).not.toContain(true);
		expect(done).toBeNull();
	});

	it("ends at once when another modal opens during the exit", async () => {
		await show({ visible: true });
		await show({ visible: false });
		expect(last()).toBe(true);
		await act(async () => {
			opened.push(openModal({ current: null }, null, true));
		});
		expect(last()).toBe(false);
	});

	it("a reopen mid-exit cancels it; the late animation callback is ignored", async () => {
		await show({ visible: true });
		await show({ visible: false });
		const stale = done;
		await show({ visible: true });
		expect(last()).toBe(false);
		const before = resets;
		await act(async () => stale?.());
		// The entry owns the values now: the stale exit must not reset them.
		expect(resets).toBe(before);
		expect(last()).toBe(false);
	});
});

/**
 * Review round 1, R2: the exit keeps a closed modal MOUNTED, so its content has
 * to stop taking presses from the commit that closes it — or a fast double-tap
 * on a drawer destination pushes its route twice.
 */
describe("an exiting modal is inert", () => {
	const source = (relative: string) =>
		readFileSync(new URL(relative, import.meta.url), "utf8").replace(
			/\s+/g,
			" ",
		);

	it("takes presses while open and none from the close on", () => {
		expect(exitPointerEvents(true)).toBe("auto");
		expect(exitPointerEvents(false)).toBe("none");
	});

	it("the sheet's content root is keyed on the caller's `visible`", () => {
		const SHEET = source("./components/sheet.tsx");
		expect(SHEET).toMatch(SHEET_ROOT_INERT);
		/* Still mounted for the exit — the inertness is what makes that safe. */
		expect(SHEET).toContain("const shown = (visible || exiting) && !covered;");
	});

	it("the drawer's content root is keyed on the caller's `visible`", () => {
		const DRAWER = source("../features/sessions/conversations-drawer.tsx");
		expect(DRAWER).toContain(
			'<View className="flex-1" pointerEvents={exitPointerEvents(visible)}>',
		);
		expect(DRAWER).toContain("visible={(visible || exiting) && !covered}");
	});
});

/** Review round 1, R4: a sheet-to-sheet hand-off is one surface change. */
describe("createTransitionTick", () => {
	it("fires once for every edge in one commit, and again in the next", () => {
		let fired = 0;
		const resets: Array<() => void> = [];
		const tick = createTransitionTick(
			() => {
				fired += 1;
			},
			(reset) => resets.push(reset),
		);
		tick(); // sheet A closes…
		tick(); // …and sheet B opens, in the same flush
		expect(fired).toBe(1);
		expect(resets).toHaveLength(1);
		for (const reset of resets.splice(0)) reset();
		tick(); // a later, separate transition
		expect(fired).toBe(2);
	});

	it("re-arms on a microtask by default", async () => {
		let fired = 0;
		const tick = createTransitionTick(() => {
			fired += 1;
		});
		tick();
		tick();
		expect(fired).toBe(1);
		await Promise.resolve();
		tick();
		expect(fired).toBe(2);
	});

	it("every sheet ticks through the ONE shared gate", () => {
		const SHEET = readFileSync(
			new URL("./components/sheet.tsx", import.meta.url),
			"utf8",
		).replace(/\s+/g, " ");
		expect(SHEET).toContain(
			'const sheetTransitionTick = createTransitionTick(() => haptic("selection"));',
		);
		expect(SHEET).toContain(
			"if (wasVisible.current !== visible) sheetTransitionTick();",
		);
		/* TWO, and each is named by its own call site, so a SWAP fails as well as a
		 *  third: the transition gate above (one tick per visible change) and the
		 *  resize snap inside `remember` (one tick per size change while the sheet
		 *  is open — the comment there says why). The test's intent — no open or
		 *  close ticks outside the shared gate — is what the first pin holds. */
		const rememberBody = SHEET.slice(
			SHEET.indexOf("const remember = useCallback("),
			SHEET.indexOf("}, [resizeKey],"),
		);
		expect(rememberBody).not.toBe("");
		expect(rememberBody.match(/haptic\("selection"\)/g)).toHaveLength(1);
		expect(
			SHEET.replace(rememberBody, "").match(/haptic\("selection"\)/g),
		).toHaveLength(1);
	});
});

/**
 * The commit that actually hides a closing modal's native `Modal` (#248). A
 * caller waiting for that `Modal`'s `onDismiss` needs a start point for a
 * fallback that is never EARLIER than the native dismissal can begin: after the
 * exit animation, not the press that closed the sheet — the race the attach
 * handoff's old 500 ms timer lost.
 */
describe("useModalExit onHidden", () => {
	let dom: DomShim | null = null;
	let root: ReturnType<typeof createRoot> | null = null;
	let hidden: string[] = [];
	let shown: boolean[] = [];
	let done: (() => void) | null = null;
	const opened: ModalHandle[] = [];

	/* The Sheet's own composition: its Modal is given `visible || exiting`. */
	const SheetProbe = ({
		visible,
		tag = "a",
		reduceMotion = false,
	}: {
		visible: boolean;
		tag?: string;
		reduceMotion?: boolean;
	}) => {
		const exiting = useModalExit({
			visible,
			reduceMotion,
			durationMs: 120,
			animateOut: (finish) => {
				done = finish;
			},
			reset: () => {},
			onHidden: () => hidden.push(`${tag}:${visible || exiting}`),
		});
		shown.push(visible || exiting);
		return null;
	};
	const show = (props: {
		visible: boolean;
		tag?: string;
		reduceMotion?: boolean;
	}) => act(async () => root?.render(createElement(SheetProbe, props)));

	beforeEach(() => {
		vi.useFakeTimers();
		dom = installDomShim();
		root = createRoot(dom.container as Element);
		hidden = [];
		shown = [];
		done = null;
	});
	afterEach(async () => {
		await act(async () => root?.unmount());
		root = null;
		dom?.dispose();
		dom = null;
		for (const handle of opened.splice(0)) closeModal(handle);
		vi.useRealTimers();
	});

	it("fires once, after the exit animation, never on the close itself", async () => {
		await show({ visible: true });
		await show({ visible: false });
		// The row press closed the sheet; the Modal is held shown for the exit.
		expect(shown[shown.length - 1]).toBe(true);
		expect(hidden).toEqual([]);
		await act(async () => done?.());
		// Reported from the commit whose Modal is no longer shown.
		expect(hidden).toEqual(["a:false"]);
		await show({ visible: false });
		await act(async () => {
			vi.runAllTimers();
		});
		expect(hidden).toEqual(["a:false"]);
	});

	it("fires once when the exit falls back because the animation never reports", async () => {
		await show({ visible: true });
		await show({ visible: false });
		await act(async () => {
			vi.advanceTimersByTime(120 + EXIT_FALLBACK_SLACK_MS);
		});
		expect(hidden).toEqual(["a:false"]);
		await act(async () => done?.());
		expect(hidden).toEqual(["a:false"]);
	});

	it("fires on the close commit itself when the exit is skipped", async () => {
		await show({ visible: true, reduceMotion: true });
		await show({ visible: false, reduceMotion: true });
		expect(hidden).toEqual(["a:false"]);
	});

	it("fires on the close commit of a hand-off to another modal", async () => {
		await show({ visible: true });
		opened.push(openModal({ current: null }, null, true));
		await show({ visible: false });
		expect(hidden).toEqual(["a:false"]);
	});

	it("never fires for a modal that mounts closed, or reopens mid-exit", async () => {
		await show({ visible: false });
		await act(async () => {
			vi.runAllTimers();
		});
		expect(hidden).toEqual([]);
		await show({ visible: true });
		await show({ visible: false });
		await show({ visible: true });
		await act(async () => {
			vi.runAllTimers();
		});
		expect(hidden).toEqual([]);
	});

	it("fires again for the next open and close, through the latest callback", async () => {
		await show({ visible: true });
		await show({ visible: false });
		await act(async () => done?.());
		await show({ visible: true, tag: "b" });
		await show({ visible: false, tag: "b" });
		await act(async () => done?.());
		expect(hidden).toEqual(["a:false", "b:false"]);
	});

	/* Review round 1, R2: `finish` running in the SAME effect flush as the
	 * exit's start batched exiting false → true → false, React bailed out, and
	 * a ref-driven effect on `exiting` never ran again. */
	it("fires when the exit animation completes in the same pass", async () => {
		const Instant = ({ visible }: { visible: boolean }) => {
			useModalExit({
				visible,
				reduceMotion: false,
				durationMs: 120,
				animateOut: (finish) => finish(),
				reset: () => {},
				onHidden: () => hidden.push("instant"),
			});
			return null;
		};
		const render = (visible: boolean) =>
			act(async () => root?.render(createElement(Instant, { visible })));
		await render(true);
		await render(false);
		expect(hidden).toEqual(["instant"]);
	});

	it("fires when a sibling opens another modal in the close commit", async () => {
		const Opener = ({ open }: { open: boolean }) => {
			useEffect(() => {
				if (open) opened.push(openModal({ current: null }, null, true));
			}, [open]);
			return null;
		};
		const render = (visible: boolean) =>
			act(async () =>
				root?.render(
					createElement(
						Fragment,
						null,
						createElement(SheetProbe, { visible }),
						createElement(Opener, { open: !visible }),
					),
				),
			);
		await render(true);
		await render(false);
		expect(hidden).toEqual(["a:false"]);
	});

	it("the Sheet passes its caller's onHidden to the exit that owns the hide", () => {
		const SHEET = readFileSync(
			new URL("./components/sheet.tsx", import.meta.url),
			"utf8",
		).replace(/\s+/g, " ");
		expect(SHEET).toContain("onHidden, });");
		expect(SHEET).toContain("visible={shown}");
	});
});
