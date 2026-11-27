import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type DomShim, installDomShim } from "@/testing/dom-shim";

const host = vi.hoisted(() => ({
	width: 390,
	timings: [] as Array<{ to: number; duration: number }>,
	completions: [] as Array<(finished?: boolean) => void>,
	/* `runOnJS` QUEUES here instead of running: the drawer's close completion
	 *  reaches the JS thread a tick after the clock finishes, and the race that
	 *  wedges `presented` (m3) lives exactly in that gap. */
	jsCalls: [] as Array<() => void>,
}));

vi.mock("react-native", () => ({
	useWindowDimensions: () => ({ width: host.width, height: 844 }),
}));
vi.mock("react-native-reanimated", async () => {
	const { useRef } = await import("react");
	const shared = <T,>(initial: T) => {
		const held = useRef({ value: initial });
		return held.current;
	};
	return {
		__esModule: true,
		default: {},
		useSharedValue: shared,
		// The real reaction maps the clock onto progress; the test only needs the
		// initial mapping to happen so a render sees the plan's start position.
		useAnimatedReaction: (
			prepare: () => unknown,
			reactToClock: (value: unknown) => void,
		) => {
			reactToClock(prepare());
		},
		withTiming: (
			toValue: number,
			config: { duration: number },
			callback?: (finished?: boolean) => void,
		) => {
			host.timings.push({ to: toValue, duration: config.duration });
			if (callback) host.completions.push(callback);
			return toValue;
		},
		cancelAnimation: () => {},
		runOnJS:
			<A extends unknown[]>(fn: (...args: A) => void) =>
			(...args: A) => {
				host.jsCalls.push(() => fn(...args));
			},
		Easing: { linear: (value: number) => value },
	};
});

import {
	type DrawerProgress,
	useDrawerProgress,
} from "@/features/sessions/drawer-progress";
import { effectiveMs, settlePlan } from "@/ui/drawer-motion";

let controller: DrawerProgress;
const Probe = ({ reduceMotion }: { reduceMotion: boolean }) => {
	controller = useDrawerProgress({ reduceMotion });
	return null;
};
let dom: DomShim;
let root: ReturnType<typeof createRoot>;
const mount = (reduceMotion = false) =>
	act(async () => root.render(createElement(Probe, { reduceMotion })));
/** Deliver the `runOnJS` calls queued since the last flush, in order. */
const flushJs = async () => {
	const calls = host.jsCalls.splice(0);
	await act(async () => {
		for (const call of calls) call();
	});
};

beforeEach(() => {
	host.timings = [];
	host.completions = [];
	host.jsCalls = [];
	host.width = 390;
	dom = installDomShim();
	root = createRoot(dom.container as Element);
});
afterEach(async () => {
	await act(async () => root.unmount());
	dom.dispose();
});

describe("useDrawerProgress", () => {
	it("opens with the full 320 ms curve and mounts the panel", async () => {
		await mount();
		await act(async () => controller.open());
		expect(controller.presented).toBe(true);
		expect(host.timings.at(-1)).toEqual({ to: 1, duration: 320 });
	});

	it("resumes a close from the current position: half way is 160 ms", async () => {
		await mount();
		await act(async () => controller.open());
		controller.progress.value = 0.5;
		await act(async () => controller.close());
		expect(controller.presented).toBe(true);
		const plan = settlePlan({
			position: 0.5 * host.width,
			width: host.width,
			target: 0,
		});
		expect(plan.ms).toBeCloseTo(160, 6);
		// The clock always runs 0→1; the plan's `to` decides where it settles.
		expect(host.timings.at(-1)).toEqual({
			to: 1,
			duration: effectiveMs(plan.ms, false),
		});
	});

	it("keeps the panel mounted until the close settle finishes", async () => {
		await mount();
		await act(async () => controller.open());
		await act(async () => controller.close());
		expect(controller.presented).toBe(true);
		await act(async () => host.completions.at(-1)?.(true));
		// The unmount crosses to the JS thread; nothing is visible until it does.
		expect(controller.presented).toBe(true);
		await flushJs();
		expect(controller.presented).toBe(false);
		expect(controller.revealed).toBe(false);
	});

	it("reverses mid-close from where the panel is, not from closed", async () => {
		await mount();
		await act(async () => controller.open());
		controller.progress.value = 0.25;
		await act(async () => controller.close());
		controller.progress.value = 0.25;
		await act(async () => controller.open());
		// A quarter open is a quarter of the curve already spent, so the reverse
		// takes the plan's remaining time — not a full 320 ms from a standstill.
		const plan = settlePlan({
			position: host.width / 4,
			width: host.width,
			target: 1,
		});
		expect(host.timings.at(-1)).toEqual({
			to: 1,
			duration: effectiveMs(plan.ms, false),
		});
	});

	it("caps the settle when the reader asks for reduced motion", async () => {
		await mount(true);
		await act(async () => controller.open());
		expect(host.timings.at(-1)).toEqual({ to: 1, duration: 120 });
	});

	it("closing while closed starts nothing", async () => {
		await mount();
		await act(async () => controller.close());
		expect(host.timings).toEqual([]);
		expect(controller.presented).toBe(false);
	});

	it("primes the panel with no settle, and drops it when the touch was a tap", async () => {
		await mount();
		await act(async () => controller.prime());
		expect(controller.presented).toBe(true);
		expect(controller.progress.value).toBe(0);
		expect(host.timings).toEqual([]);
		await act(async () => controller.unprime());
		expect(controller.presented).toBe(false);
	});

	it("a touch on a settling panel takes it over from where it is", async () => {
		await mount();
		await act(async () => controller.open());
		controller.progress.value = 0.6;
		await act(async () => controller.close());
		controller.progress.value = 0.35;
		const timings = host.timings.length;
		await act(async () => controller.prime());
		// Hold, not settle: the panel keeps the position the touch found it at.
		expect(host.timings.length).toBe(timings);
		expect(controller.progress.value).toBe(0.35);
		expect(controller.presented).toBe(true);
	});

	it("a touch that never drags gives the interrupted settle back (M1)", async () => {
		await mount();
		await act(async () => controller.open());
		controller.progress.value = 0.45;
		await act(async () => controller.prime());
		const timings = host.timings.length;
		await act(async () => {
			expect(controller.resume()).toBe(true);
		});
		/* The settle restarts from where the touch froze it, toward the target
		 *  it was already heading for — an opening panel finishes opening. */
		expect(host.timings.length).toBe(timings + 1);
		const plan = settlePlan({
			position: 0.45 * host.width,
			width: host.width,
			target: 1,
		});
		expect(host.timings.at(-1)).toEqual({
			to: 1,
			duration: effectiveMs(plan.ms, false),
		});
	});

	it("a touch on a settled panel resumes nothing", async () => {
		await mount();
		await act(async () => controller.open());
		await act(async () => host.completions.at(-1)?.(true));
		await flushJs();
		const timings = host.timings.length;
		await act(async () => controller.prime());
		await act(async () => {
			expect(controller.resume()).toBe(false);
		});
		expect(host.timings.length).toBe(timings);
	});

	it("primes the shell only; `reveal` mounts the content (M2)", async () => {
		await mount();
		await act(async () => controller.prime());
		expect(controller.presented).toBe(true);
		expect(controller.revealed).toBe(false);
		await act(async () => controller.reveal());
		expect(controller.revealed).toBe(true);
		await act(async () => controller.open());
		expect(controller.revealed).toBe(true);
		await act(async () => controller.close());
		await act(async () => host.completions.at(-1)?.(true));
		await flushJs();
		expect(controller.presented).toBe(false);
		expect(controller.revealed).toBe(false);
	});

	it("a close's queued unmount never drops a panel reopened first (m3)", async () => {
		await mount();
		await act(async () => controller.open());
		await act(async () => controller.close());
		/* The close clock finished and queued its unmount; the reader reopens
		 *  before the JS thread runs it. */
		await act(async () => host.completions.at(-1)?.(true));
		await act(async () => controller.open());
		await flushJs();
		expect(controller.presented).toBe(true);
		expect(controller.revealed).toBe(true);
	});
});
