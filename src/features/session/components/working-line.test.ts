import { readFileSync } from "node:fs";
import React, { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pinnedWorkingLine } from "@/features/session/projection";
import { t } from "@/i18n";
import { decodeFrame } from "@/relay/sse";
import { createProjectionStore, readEntry } from "@/state/projection-store";
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
	/** When set, tweens wait for `finishTweens()` instead of landing at once, so
	 *  a test can act INSIDE the line's close animation. */
	deferTweens: false,
	tweens: [] as Array<(ok: boolean) => void>,
	/** The geometry props each Pressable was given, by testID: the touch floor
	 *  must be the BOX (react-native-web drops `hitSlop` on `Pressable`). */
	targets: new Map<string, { style?: unknown; hitSlop?: unknown }>(),
	texts: [] as Array<{
		children?: React.ReactNode;
		className?: string;
		style?: { opacity?: number; position?: string };
	}>,
}));
const DIGIT_SECONDS = /\ds/;

vi.mock("react-native", async () => {
	const React = await import("react");
	return {
		// The status region's accessible name is printed as `<name>` so the
		// assertions can read what a screen reader hears.
		View: ({
			children,
			accessibilityRole,
			accessibilityLabel,
		}: {
			children?: React.ReactNode;
			accessibilityRole?: string;
			accessibilityLabel?: string;
		}) =>
			React.createElement(
				"div",
				null,
				accessibilityRole === "progressbar" ? `<${accessibilityLabel}>` : null,
				children ?? null,
			),
		Text: (props: (typeof probe.texts)[number]) => {
			probe.texts.push(props);
			return React.createElement(
				"span",
				null,
				props.style?.opacity === 0 ? null : (props.children ?? null),
			);
		},
		Pressable: ({
			children,
			onPress,
			disabled,
			testID,
			accessibilityLabel,
			style,
			hitSlop,
		}: {
			children: (state: { pressed: boolean }) => React.ReactNode;
			onPress: () => void;
			disabled?: boolean;
			testID: string;
			accessibilityLabel: string;
			style?: unknown;
			hitSlop?: unknown;
		}) => {
			// A disabled Pressable never calls `onPress`, as on device.
			probe.presses.set(testID, disabled ? () => {} : onPress);
			probe.targets.set(testID, { style, hitSlop });
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
			if (probe.deferTweens) {
				if (done) probe.tweens.push(done);
			} else done?.(true);
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

const { PinnedWorkingLine, usePhaseElapsed } = await import(
	"@/features/session/components/working-line"
);
const { STOPPING_BOUND_MS, resetTurnStopForTests, stopTurn, useTurnStopping } =
	await import("@/features/session/turn-stop");
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
	probe.targets.clear();
	probe.texts = [];
	probe.deferTweens = false;
	probe.tweens = [];
});
afterEach(() => {
	act(() => root.unmount());
	resetTurnStopForTests();
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

	it("draws nothing while idle", () => {
		expect(frame(false, "", null)).toBeNull();
	});

	it("draws the line while a label survives a lowered `streaming` (turnRunning)", () => {
		// A reconcile can lower `streaming` and leave the label: the header still
		// says Working and the composer still steers, so the line and its Stop
		// must agree with them rather than vanish (#189 Q1/U2/D3).
		expect(frame(false, "Reading", 1.5)).toEqual({
			activity: "Reading",
			startedS: 1.5,
		});
	});

	it("draws a live turn before the server names its activity (Stop in reach)", () => {
		expect(frame(true, "", null)).toEqual({ activity: "", startedS: null });
	});
});

const render = (props: Parameters<typeof PinnedWorkingLine>[0]) =>
	act(() => root.render(createElement(PinnedWorkingLine, props)));
const screen = () => textOf(shim.container as Node);

describe("activity wire → projection store → pinned line", () => {
	it.each([128.4, 0, null])(
		"preserves the producer intent and phase age %s across reconnect",
		(age) => {
			// The fixture documents its synthetic provenance and relay source ref;
			// don't manufacture a second event shape just for the indicator.
			const fixture = JSON.parse(
				readFileSync(
					new URL(
						"../../../../fixtures/relay/synthetic/sse-projection-every-entry-kind.json",
						import.meta.url,
					),
					"utf8",
				),
			);
			const store = createProjectionStore();
			const id = "activity-wire-test";
			for (const version of [9, 1]) {
				store.getState().beginStream(id);
				const decoded = decodeFrame({
					event: fixture.event,
					data: JSON.stringify({
						...fixture.data,
						version,
						activity_started_s: age,
					}),
					receivedAt: 0,
				});
				expect(decoded.kind).toBe("projection");
				if (decoded.kind !== "projection")
					throw new Error("fixture did not decode");
				store.getState().applyFrame(id, decoded.data);
				const projection = readEntry(store.getState(), id).projection;
				expect(projection).not.toBeNull();
				if (projection === null)
					throw new Error("projection did not reach store");
				const line = pinnedWorkingLine(projection);
				expect(line).toEqual({
					activity: fixture.data.activity,
					startedS: age,
				});
				render({
					line,
					onStop: async () => true,
					gapBelow: false,
					stopping: false,
				});
				expect(screen().replace(/<[^>]*>/g, "")).toContain(
					fixture.data.activity,
				);
				store.getState().endStream(id);
			}
		},
	);
});

describe("PinnedWorkingLine", () => {
	it("visibly names a live turn before the relay supplies an intent", () => {
		render({
			line: frame(true, "", null),
			onStop: async () => true,
			gapBelow: false,
			stopping: false,
		});
		// The shim prints accessibility names between angle brackets. Remove
		// them: an accessible-only fallback still leaves sighted users with Stop.
		const visible = screen().replace(/<[^>]*>/g, "");
		expect(visible).toContain(t("relay.chrome.session.subtitle.working_plain"));
	});
	it("reserves the clock with real text geometry, not browser-only character units", () => {
		render({
			line: frame(true, "Reading exact intent", null),
			onStop: async () => true,
			gapBelow: false,
			stopping: false,
		});
		expect(
			probe.texts.some(
				(text) => text.style?.opacity === 0 && text.children === "59m 59s",
			),
		).toBe(true);
		expect(probe.texts.some((text) => text.className?.includes("ch]"))).toBe(
			false,
		);
		const visible = screen().replace(/<[^>]*>/g, "");
		expect(visible).toContain("Reading exact intent");
		expect(visible).not.toContain("Working");
		expect(visible).not.toContain("59m 59s");
	});

	it("carries the trailing counts between the clock and the Stop (D1)", () => {
		render({
			line: frame(true, "Reading", 3),
			onStop: async () => true,
			gapBelow: false,
			stopping: false,
			trailing: createElement("span", null, "[counts]"),
		});
		const visible = screen().replace(/<[^>]*>/g, "");
		expect(visible).toContain("Reading");
		expect(visible.indexOf("[counts]")).toBeGreaterThan(
			visible.indexOf("Reading"),
		);
		expect(visible.indexOf(t("relay.composer.action.stop"))).toBeGreaterThan(
			visible.indexOf("[counts]"),
		);
		expect(visible.match(/\[counts\]/g)).toHaveLength(1);
	});

	it("draws the counts ONCE when they take their own line (large text)", () => {
		render({
			line: frame(true, "Reading", 3),
			onStop: async () => true,
			gapBelow: false,
			stopping: false,
			trailing: createElement("span", null, "[counts]"),
			trailingStacked: true,
		});
		const visible = screen().replace(/<[^>]*>/g, "");
		expect(visible.match(/\[counts\]/g)).toHaveLength(1);
		/* Under the row: after the Stop, not between the clock and it. */
		expect(visible.indexOf("[counts]")).toBeGreaterThan(
			visible.indexOf(t("relay.composer.action.stop")),
		);
	});

	it("keeps the slot open for the counts alone when no turn is alive", () => {
		/* Tasks, agents and a queue outlive the turn: the capsule band showed
		 *  them at rest, so the line that replaced it must too — with no
		 *  spinner, no status and no Stop to press. */
		render({
			line: null,
			onStop: async () => true,
			gapBelow: false,
			stopping: false,
			trailing: createElement("span", null, "[counts]"),
		});
		expect(screen()).toBe("[counts]");
		expect(probe.presses.has("session-working-stop")).toBe(false);
	});

	it("renders nothing when no turn is alive", () => {
		render({
			line: null,
			onStop: async () => true,
			gapBelow: false,
			stopping: false,
		});
		expect(screen()).toBe("");
	});

	it("gives the Stop a touch-floor BOX, not slop (U-01 on the web build)", () => {
		// The iphone-se audit measured this Stop at 17 pt tall (#193, 96 U-01
		// FAILs) while it reached 48 pt through `hitSlop`, which react-native-web
		// does not implement on `Pressable`. The audit can only see the box.
		render({
			line: { activity: "reading the relay source", startedS: 0 },
			onStop: async () => true,
			gapBelow: false,
			stopping: false,
		});
		const target = probe.targets.get(CONTROL.sessionWorkingStop);
		expect(target?.style).toMatchObject({ minHeight: 44, minWidth: 44 });
		expect(target?.hitSlop).toBeUndefined();
	});

	it("says the intent and the clock, re-zeroes on the next tool, and leaves when the turn ends", () => {
		const onStop = async () => true;
		render({
			line: { activity: "Reading PR states", startedS: 0 },
			onStop,
			gapBelow: true,
			stopping: false,
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
			stopping: false,
		});
		expect(screen()).toContain("Running the suite");
		expect(screen()).not.toContain("Reading PR states");
		expect(screen()).not.toContain("3s");

		render({ line: null, onStop, gapBelow: true, stopping: false });
		expect(screen()).toBe("");
	});

	it("withholds the digits when the server has no instant", () => {
		render({
			line: { activity: "thinking", startedS: null },
			onStop: async () => true,
			gapBelow: false,
			stopping: false,
		});
		act(() => vi.advanceTimersByTime(2000));
		expect(screen()).toContain("thinking");
		expect(screen()).not.toMatch(DIGIT_SECONDS);
	});

	it('names the status "Working" before the daemon names an activity (R1-5)', () => {
		render({
			line: { activity: "", startedS: null },
			onStop: async () => true,
			gapBelow: false,
			stopping: false,
		});
		expect(screen()).toContain("<Working>");
	});
});

/* The screen's real wiring, in miniature: both Stops call the SAME per-session
 *  latch (`stopTurn`) and read the SAME flag (`useTurnStopping`), exactly as
 *  `use-composer.ts` hands them `composer.stop` / `composer.stopping`. */
type HarnessProps = {
	alive: boolean;
	line: { activity: string; startedS: number | null } | null;
	send: () => Promise<boolean>;
	/** Exposes the composer ■'s view of the latch and its press. */
	disc?: (state: { stopping: boolean; press: () => void }) => void;
};
const Harness = ({ alive, line, send, disc }: HarnessProps) => {
	const stopping = useTurnStopping("s-1", alive);
	const onStop = React.useCallback(() => stopTurn("s-1", send), [send]);
	disc?.({ stopping, press: () => void onStop() });
	return createElement(PinnedWorkingLine, {
		line,
		onStop,
		stopping,
		gapBelow: false,
	});
};
const mount = (props: HarnessProps) =>
	act(() => root.render(createElement(Harness, props)));
const pressLine = () => probe.presses.get(CONTROL.sessionWorkingStop)?.();

describe("the shared stop latch (turn-stop.ts) on the pinned line", () => {
	it("a failed stop re-arms at once; a repeat tap while one is out is a no-op", async () => {
		const send = vi.fn(async () => false);
		const line = { activity: "thinking", startedS: 0 };
		mount({ alive: true, line, send });
		expect(screen()).toContain("[stop the agent]");
		await act(async () => {
			pressLine();
			pressLine();
		});
		expect(send).toHaveBeenCalledTimes(1);
		// Never reached the relay: released so the reader can try again.
		expect(screen()).toContain("[stop the agent]");

		send.mockImplementation(() => new Promise<boolean>(() => {}));
		await act(async () => pressLine());
		expect(screen()).toContain("[stopping]");
		await act(async () => pressLine());
		expect(send).toHaveBeenCalledTimes(2);
	});

	it("case A: the abort reached the relay but the turn runs on — Stop works again after the bound", async () => {
		const send = vi.fn(async () => true);
		const line = { activity: "thinking", startedS: 0 };
		mount({ alive: true, line, send });
		await act(async () => pressLine());
		expect(send).toHaveBeenCalledTimes(1);
		expect(screen()).toContain("[stopping]");

		// Still streaming just inside the bound: still latched, a tap is a no-op.
		await act(async () => vi.advanceTimersByTime(STOPPING_BOUND_MS - 1));
		await act(async () => pressLine());
		expect(send).toHaveBeenCalledTimes(1);
		expect(screen()).toContain("[stopping]");

		// The bound passes with the turn still alive: Stop is live again.
		await act(async () => vi.advanceTimersByTime(1));
		expect(screen()).toContain("[stop the agent]");
		await act(async () => pressLine());
		expect(send).toHaveBeenCalledTimes(2);
	});

	it("case B: a new turn inside the close tween gets a fresh, working Stop; the closing one is inert", async () => {
		probe.deferTweens = true;
		const send = vi.fn(async () => true);
		mount({ alive: true, line: { activity: "thinking", startedS: 0 }, send });
		await act(async () => pressLine());
		expect(screen()).toContain("[stopping]");

		// The turn ends: the line is HELD for its close tween (not yet finished).
		mount({ alive: false, line: null, send });
		expect(screen()).toContain("thinking");
		// R1-4: a late tap during the close sends nothing to the idle session.
		await act(async () => pressLine());
		expect(send).toHaveBeenCalledTimes(1);

		// A new turn starts before the tween lands (< 180 ms).
		mount({ alive: true, line: { activity: "responding", startedS: 0 }, send });
		expect(screen()).toContain("responding");
		expect(screen()).toContain("[stop the agent]");
		await act(async () => pressLine());
		expect(send).toHaveBeenCalledTimes(2);
		expect(screen()).toContain("[stopping]");
	});

	it("one latch for both Stops: a tap on each sends ONE abort, and both read stopping", async () => {
		const send = vi.fn(() => new Promise<boolean>(() => {}));
		let composerDisc = { stopping: false, press: () => {} };
		mount({
			alive: true,
			line: { activity: "thinking", startedS: 0 },
			send,
			disc: (state) => {
				composerDisc = state;
			},
		});
		await act(async () => composerDisc.press());
		expect(composerDisc.stopping).toBe(true);
		expect(screen()).toContain("[stopping]");
		await act(async () => pressLine());
		expect(send).toHaveBeenCalledTimes(1);
	});
});

describe("usePhaseElapsed (one clock for the header and the line)", () => {
	const Reader = ({ id, startedS }: { id: string; startedS: number | null }) =>
		createElement(
			"i",
			null,
			`${id}=${usePhaseElapsed("thinking", startedS) ?? "none"};`,
		);

	it("two readers of one phase agree, even when the second mounts mid-second", () => {
		const both = (header: boolean) =>
			createElement(
				"b",
				null,
				createElement(Reader, { id: "line", startedS: 4 }),
				header ? createElement(Reader, { id: "header", startedS: 4 }) : null,
			);
		act(() => root.render(both(false)));
		act(() => vi.advanceTimersByTime(1500));
		expect(screen()).toBe("line=5;");
		// The header reader arrives half a second off the ticker's beat.
		act(() => root.render(both(true)));
		expect(screen()).toBe("line=5;header=5;");
		act(() => vi.advanceTimersByTime(3000));
		expect(screen()).toBe("line=8;header=8;");
	});

	it("a later turn with the same seed starts from its own instant; null stays null", () => {
		act(() => root.render(createElement(Reader, { id: "a", startedS: 0 })));
		act(() => vi.advanceTimersByTime(5000));
		expect(screen()).toBe("a=5;");
		act(() => root.render(createElement("b", null)));
		act(() => vi.advanceTimersByTime(2000));
		act(() => root.render(createElement(Reader, { id: "a", startedS: 0 })));
		expect(screen()).toBe("a=0;");
		act(() => root.render(createElement(Reader, { id: "a", startedS: null })));
		expect(screen()).toBe("a=none;");
	});
});

describe("PinnedWorkingLine memo", () => {
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
				createElement(PinnedWorkingLine, {
					line,
					onStop,
					gapBelow: false,
					stopping: false,
				}),
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
