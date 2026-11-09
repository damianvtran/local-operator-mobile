import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type DomShim, installDomShim } from "@/testing/dom-shim";
import {
	EXIT_FALLBACK_SLACK_MS,
	shouldAnimateExit,
	useModalExit,
} from "@/ui/modal-exit";
import { closeModal, type ModalHandle, openModal } from "@/ui/modal-stack";

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
