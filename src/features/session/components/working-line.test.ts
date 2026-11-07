import React, { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pinnedWorkingLine } from "@/features/session/projection";
import { type DomShim, installDomShim } from "@/testing/dom-shim";

/**
 * The pinned working line (the relay's `WorkingLine` with `stopPid`, mounted above
 * the dock): which frames draw it, what it says, its Stop, and its memo boundary.
 *
 * Units run in Node (`vitest.config.ts`), so `react-native` and Reanimated are
 * replaced by pass-throughs that keep the two things asserted here real: the
 * component's own React state (spinner, clock, stop latch) and React's `memo`
 * bail-out. Geometry and motion are a rendered-frame question, not a unit one.
 */

const probe = vi.hoisted(() => ({
	/** Renders of the line's BODY: `elapsedLabel` is called once per render
	 *  (accessible name) plus once for the clock, so this counts behind `memo`. */
	bodies: 0,
	presses: new Map<string, () => void>(),
}));

vi.mock("react-native", async () => {
	const React = await import("react");
	const host =
		(tag: string) =>
		({ children }: { children?: React.ReactNode }) =>
			React.createElement(tag, null, children ?? null);
	return {
		View: host("div"),
		Text: host("span"),
		Pressable: ({
			children,
			onPress,
			testID,
			accessibilityLabel,
		}: {
			children: (state: { pressed: boolean }) => React.ReactNode;
			onPress: () => void;
			testID: string;
			accessibilityLabel: string;
		}) => {
			probe.presses.set(testID, onPress);
			return React.createElement(
				"button",
				null,
				`[${accessibilityLabel}]`,
				children({ pressed: false }),
			);
		},
	};
});
vi.mock("react-native-reanimated", async () => {
	const React = await import("react");
	const View = ({ children }: { children?: React.ReactNode }) =>
		React.createElement("section", null, children ?? null);
	return {
		__esModule: true,
		default: { View },
		// Tweens land at once and report completion, so the close's hold-then-unmount
		// path runs to its end state inside `act`.
		withTiming: (
			to: number,
			_config: unknown,
			done?: (ok: boolean) => void,
		) => {
			done?.(true);
			return to;
		},
		runOnJS:
			<A extends unknown[]>(fn: (...args: A) => void) =>
			(...args: A) =>
				fn(...args),
		useSharedValue: <T>(value: T) => React.useRef({ value }).current,
		useAnimatedStyle: (fn: () => unknown) => fn(),
	};
});
vi.mock("@/ui/components", () => ({ useReducedMotion: () => false }));
vi.mock("@/ui/direction", () => ({ TEXT_END_CLASS: "text-right" }));
vi.mock("@/ui/layout", () => ({ TOUCH_FLOOR: 44 }));
vi.mock("@/lib/format", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/format")>();
	return {
		...actual,
		elapsedLabel: (seconds: number) => {
			probe.bodies += 1;
			return actual.elapsedLabel(seconds);
		},
	};
});

const { PinnedWorkingLine } = await import(
	"@/features/session/components/working-line"
);
const { CONTROL } = await import("@/ui/a11y");

type Node = {
	nodeValue?: string | null;
	textContent?: string | null;
	childNodes: Node[];
};
/* react-dom writes a lone string child as the element's `textContent` rather
 *  than a text node, so both are read. */
const textOf = (node: Node): string =>
	node.childNodes.length === 0
		? (node.nodeValue ?? node.textContent ?? "")
		: node.childNodes.map(textOf).join("");

let shim: DomShim;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
	vi.useFakeTimers();
	shim = installDomShim();
	root = createRoot(shim.container as Element);
	probe.bodies = 0;
	probe.presses.clear();
});
afterEach(() => {
	act(() => root.unmount());
	shim.dispose();
	vi.useRealTimers();
});

const frame = (
	streaming: boolean,
	activity: string,
	activity_started_s: number | null,
) => pinnedWorkingLine({ streaming, activity, activity_started_s });

describe("pinnedWorkingLine (state derivation from projection frames)", () => {
	it("follows a turn: thinking → a tool's intent → the next tool → done", () => {
		// The wire's own sequence, as the daemon projected it (PR evidence): the
		// label is the server-folded activity, the clock re-zeroes at each edge.
		expect(frame(true, "thinking", 0)).toEqual({
			activity: "thinking",
			startedS: 0,
		});
		expect(frame(true, "Reading PR states", 0)).toEqual({
			activity: "Reading PR states",
			startedS: 0,
		});
		expect(frame(true, "Running the suite", 2.4)).toEqual({
			activity: "Running the suite",
			startedS: 2.4,
		});
		expect(frame(false, "", null)).toBeNull();
	});

	it("draws nothing while idle, even if a stale label lingers", () => {
		expect(frame(false, "", null)).toBeNull();
		expect(frame(false, "thinking", 3)).toBeNull();
	});

	it("draws a live turn before the server names its activity (Stop in reach)", () => {
		expect(frame(true, "", null)).toEqual({ activity: "", startedS: null });
	});
});

const render = (props: Parameters<typeof PinnedWorkingLine>[0]) =>
	act(() => root.render(createElement(PinnedWorkingLine, props)));
const screen = () => textOf(shim.container as Node);

describe("PinnedWorkingLine", () => {
	it("renders nothing when no turn is alive", () => {
		render({ line: null, onStop: async () => true, gapBelow: false });
		expect(screen()).toBe("");
	});

	it("says the intent and the clock, re-zeroes on the next tool, and leaves when the turn ends", () => {
		const onStop = async () => true;
		render({
			line: { activity: "Reading PR states", startedS: 0 },
			onStop,
			gapBelow: true,
		});
		expect(screen()).toContain("Reading PR states");
		expect(screen()).toContain("0s");
		expect(screen()).toContain("stop");
		act(() => vi.advanceTimersByTime(3000));
		expect(screen()).toContain("3s");

		render({
			line: { activity: "Running the suite", startedS: 0 },
			onStop,
			gapBelow: true,
		});
		expect(screen()).toContain("Running the suite");
		expect(screen()).not.toContain("Reading PR states");
		expect(screen()).not.toContain("3s");

		render({ line: null, onStop, gapBelow: true });
		expect(screen()).toBe("");
	});

	it("withholds the digits when the server has no instant", () => {
		render({
			line: { activity: "thinking", startedS: null },
			onStop: async () => true,
			gapBelow: false,
		});
		act(() => vi.advanceTimersByTime(2000));
		expect(screen()).toContain("thinking");
		expect(screen()).not.toMatch(/\ds/);
	});

	it("stops through the given path once; a repeat tap is a no-op; a failed stop re-arms", async () => {
		const onStop = vi.fn(async () => false);
		render({
			line: { activity: "thinking", startedS: 0 },
			onStop,
			gapBelow: false,
		});
		const press = () => probe.presses.get(CONTROL.sessionWorkingStop)?.();
		expect(screen()).toContain("[stop the agent]");
		await act(async () => {
			press();
			press();
		});
		expect(onStop).toHaveBeenCalledTimes(1);
		// The relay never reached: the latch clears so the reader can try again.
		expect(screen()).toContain("[stop the agent]");

		onStop.mockImplementation(() => new Promise<boolean>(() => {}));
		await act(async () => press());
		expect(screen()).toContain("[stopping]");
		await act(async () => press());
		expect(onStop).toHaveBeenCalledTimes(2);
	});

	it("is the memo boundary: a parent frame with the same inputs does not re-render it, and its own ticks never re-render the parent", () => {
		const onStop = async () => true;
		let parentRenders = 0;
		let setTick: (n: number) => void = () => {};
		const line = { activity: "thinking", startedS: 0 };
		const Parent = () => {
			const [tick, set] = React.useState(0);
			setTick = set;
			parentRenders += 1;
			return createElement(
				"main",
				null,
				`frame ${tick}`,
				createElement(PinnedWorkingLine, { line, onStop, gapBelow: false }),
			);
		};
		act(() => root.render(createElement(Parent)));
		const bodiesAfterMount = probe.bodies;
		const parentsAfterMount = parentRenders;

		// A streamed projection frame re-renders the screen; the line's inputs are
		// the same references (`useMemo` on the three wire fields in the screen).
		act(() => setTick(1));
		act(() => setTick(2));
		expect(parentRenders).toBe(parentsAfterMount + 2);
		expect(probe.bodies).toBe(bodiesAfterMount);

		// The line's own clock ticks: only its body re-renders.
		act(() => vi.advanceTimersByTime(2000));
		expect(probe.bodies).toBeGreaterThan(bodiesAfterMount);
		expect(parentRenders).toBe(parentsAfterMount + 2);
	});
});
