import { act, type ReactNode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inlineChartModel } from "@/features/session/inline-chart-model";
import { inlineChartsContainerTouch } from "@/features/session/inline-chart-touch";
import { resetLocaleSource, setLocaleSource } from "@/i18n";
import { installDomShim } from "@/testing/dom-shim";
import { PALETTE } from "@/ui/tokens.gen";
import { donutHeight, horizontalRow, reservedHeight } from "./inline-chart";
import { InlineUiPreview, inlineUiData } from "./inline-ui-preview";

// The chart root is the one `adjustable` element; its props are the whole
// screen-reader contract (§5 Screen readers), so the mock records them.
type RootProps = {
	accessibilityLabel?: string;
	accessibilityValue?: { text: string };
	"aria-valuetext"?: string;
	style?: { direction?: string };
	onAccessibilityAction?: (event: {
		nativeEvent: { actionName: string };
	}) => void;
	onFocus?: (event: { target: unknown }) => void;
	onTouchStart?: () => void;
};
// The PanResponder callbacks each plot creates (§5 Touch); tests drive them.
type Gesture = {
	onShouldBlockNativeResponder?: () => boolean;
	onPanResponderGrant?: (e: {
		nativeEvent: { locationX: number; locationY: number };
	}) => void;
	onPanResponderMove?: (e: unknown, g: { dx: number; dy: number }) => void;
	onPanResponderRelease?: (e: unknown, g: { dx: number; dy: number }) => void;
	onPanResponderTerminate?: () => void;
};
const host = vi.hoisted(() => ({
	texts: [] as string[],
	renders: 0,
	stopped: 0,
	root: null as null | RootProps,
	gestures: [] as Gesture[],
	disclosure: null as null | {
		"aria-expanded": boolean;
		onPress: () => void;
	},
	width: 360,
}));

vi.mock("@/features/auth/connection-provider", () => ({
	useLocaleFrame: () => "en",
}));
vi.mock("react-native", () => {
	const View = ({
		children,
		onLayout,
		accessibilityRole,
		...props
	}: RootProps & {
		children?: ReactNode;
		accessibilityRole?: string;
		onLayout?: (event: { nativeEvent: { layout: { width: number } } }) => void;
	}) => {
		if (accessibilityRole === "adjustable") host.root = props;
		useEffect(() => {
			onLayout?.({ nativeEvent: { layout: { width: host.width } } });
		}, [onLayout]);
		return children ?? null;
	};
	return {
		View,
		ScrollView: ({ children }: { children: ReactNode }) => children,
		Text: ({ children }: { children: ReactNode }) => {
			host.renders++;
			if (typeof children === "string") host.texts.push(children);
			return children;
		},
		Pressable: ({
			children,
			...props
		}: {
			children: ReactNode;
			"aria-expanded"?: boolean;
			onPress: () => void;
		}) => {
			if (props["aria-expanded"] !== undefined)
				host.disclosure = props as NonNullable<typeof host.disclosure>;
			return children;
		},
		Animated: {
			View: ({ children }: { children: ReactNode }) => children,
			Value: class {
				setValue() {}
				stopAnimation() {
					host.stopped++;
				}
			},
			timing: () => ({ start() {} }),
		},
		AccessibilityInfo: { isReduceMotionEnabled: () => Promise.resolve(true) },
		PanResponder: {
			create: (config: Gesture) => {
				host.gestures.push(config);
				return { panHandlers: {} };
			},
		},
		Platform: { OS: "ios" },
	};
});
vi.mock("react-native-svg", () => {
	const noop = () => null;
	return {
		default: noop,
		Circle: noop,
		Defs: noop,
		Line: noop,
		LinearGradient: noop,
		Path: noop,
		Pattern: noop,
		Polyline: noop,
		Rect: noop,
		Stop: noop,
	};
});
vi.mock("@/ui/appearance", () => ({
	useTheme: () => ({
		active: { colors: PALETTE.light },
		chart: [PALETTE.light.accent, "#1762B6"],
		theme: "light",
	}),
	useTokenColor: () => PALETTE.light["ink-muted"],
}));
vi.mock("@/ui/text-scale-provider", () => ({
	useTextScale: () => ({ effectiveScale: 1 }),
}));

const VALUE_WITH_UNIT = /\d.*USD/;

const spend = inlineUiData({
	type: "line",
	title: "Datadog spend",
	unit: "USD",
	data: [
		["Nov 16", 84.04],
		["Nov 17", 97.2],
		["Nov 18", 140.61],
		["Nov 24 · rollout", 1234.5],
	],
});

let dom: ReturnType<typeof installDomShim>;
let root: ReturnType<typeof createRoot>;
const action = (actionName: string) =>
	act(async () =>
		host.root?.onAccessibilityAction?.({ nativeEvent: { actionName } }),
	);

beforeEach(() => {
	host.texts = [];
	host.renders = 0;
	host.gestures = [];
	host.root = null;
	host.disclosure = null;
	host.width = 360;
	setLocaleSource(() => "en");
	dom = installDomShim();
	root = createRoot(dom.container as Element);
});
afterEach(async () => {
	await act(async () => root.unmount());
	dom.dispose();
	resetLocaleSource();
});

describe("inline chart accessibility (§5)", () => {
	it("is one adjustable element whose actions walk the marks", async () => {
		await act(async () => root.render(<InlineUiPreview data={spend} />));
		expect(host.root?.accessibilityLabel).toBe("Datadog spend");
		// U3/Q4: never a bare number at rest; the web build gets valuetext.
		expect(host.root?.accessibilityValue?.text).toBe("Values: 4");
		expect(host.root?.["aria-valuetext"]).toBe("Values: 4");

		await action("increment");
		expect(host.root?.accessibilityValue?.text).toBe(
			"Nov 16, 84.04 USD, 1 of 4",
		);
		await action("increment");
		await action("increment");
		expect(host.root?.accessibilityValue?.text).toBe(
			"Nov 18, 140.61 USD, 3 of 4",
		);
		// The tooltip mirrors it: full annotated label, exact grouped value.
		await action("increment");
		expect(host.root?.accessibilityValue?.text).toBe(
			"Nov 24 · rollout, 1,234.5 USD, 4 of 4",
		);
		expect(host.texts).toContain("Nov 24 · rollout");
		expect(host.texts).toContain("1,234.5 USD");
		// Clamped at the last mark; decrement walks back.
		await action("increment");
		expect(host.root?.accessibilityValue?.text).toContain("4 of 4");
		await action("decrement");
		expect(host.root?.accessibilityValue?.text).toContain("3 of 4");
	});

	it("shows the axis part of annotated labels and nice ticks with the unit once", async () => {
		await act(async () => root.render(<InlineUiPreview data={spend} />));
		// x axis: text before " · "; the full label is tooltip/table only.
		expect(host.texts).toContain("Nov 24");
		expect(host.texts).not.toContain("Nov 24 · rollout");
		// Unit is the axis title, never repeated per tick; ticks are nice
		// steps, not the raw extremes (84.04 → 0, 1,234.5 → 1,500 on 180 px).
		expect(host.texts).toContain("USD");
		expect(host.texts.filter((text) => VALUE_WITH_UNIT.test(text))).toEqual([]);
		expect(host.texts).not.toContain("84.04");
	});

	it("announces pie slices with share and folds a long tail into Other", async () => {
		const data = inlineUiData({
			type: "pie",
			title: "Spend by service",
			data: Array.from({ length: 12 }, (_, i): [string, number] => [
				`Service ${i + 1}`,
				12 - i,
			]),
		});
		await act(async () => root.render(<InlineUiPreview data={data} />));
		expect(host.texts).toContain("Other (6)");
		await action("increment");
		expect(host.root?.accessibilityValue?.text).toBe(
			"Service 1, 12, 15% of total, 1 of 7",
		);
	});
});

describe("chart data disclosure (§6)", () => {
	it("starts collapsed and lists every original row once opened", async () => {
		const data = inlineUiData({
			type: "pie",
			title: "Spend by service",
			unit: "USD",
			data: Array.from({ length: 12 }, (_, i): [string, number] => [
				`Service ${i + 1}`,
				12 - i,
			]),
		});
		await act(async () => root.render(<InlineUiPreview data={data} />));
		expect(host.disclosure?.["aria-expanded"]).toBe(false);
		expect(host.texts).not.toContain("Service 12");
		host.texts = [];
		await act(async () => host.disclosure?.onPress());
		expect(host.disclosure?.["aria-expanded"]).toBe(true);
		// Folded slices are still in the table (no silent truncation).
		expect(host.texts).toContain("Service 12");
		expect(host.texts).toContain("1 USD");
	});
});

const lastGesture = () => {
	const gesture = host.gestures.at(-1);
	if (!gesture) throw new Error("no plot gesture was created");
	return gesture;
};
// The plot's left gutter at 360 for the spend data: 28 (minimum) — a touch
// at x is measured from the overlay, which spans the whole chart box.
const tap = (x: number, y: number) =>
	act(async () => {
		const g = lastGesture();
		g.onPanResponderGrant?.({ nativeEvent: { locationX: x, locationY: y } });
		g.onPanResponderRelease?.(null, { dx: 0, dy: 0 });
	});

describe("touch (§5 Touch, X7)", () => {
	it("never blocks the native scroller on Android (R2)", async () => {
		await act(async () => root.render(<InlineUiPreview data={spend} />));
		expect(lastGesture().onShouldBlockNativeResponder?.()).toBe(false);
	});

	it("pins on a tap, and clears on a scroll takeover", async () => {
		await act(async () => root.render(<InlineUiPreview data={spend} />));
		await tap(30, 100);
		expect(host.root?.accessibilityValue?.text).toBe(
			"Nov 16, 84.04 USD, 1 of 4",
		);
		// The transcript's scroll view takes the gesture over.
		await act(async () => lastGesture().onPanResponderTerminate?.());
		expect(host.root?.accessibilityValue?.text).toBe("Values: 4");
	});

	it("dismisses a pinned mark on a touch outside the chart, not inside", async () => {
		await act(async () => root.render(<InlineUiPreview data={spend} />));
		await tap(30, 100);
		// A touch inside the chart bubbles chart-first, then to the list.
		await act(async () => {
			host.root?.onTouchStart?.();
			inlineChartsContainerTouch();
		});
		expect(host.root?.accessibilityValue?.text).toContain("1 of 4");
		// A touch elsewhere in the transcript reaches only the list.
		await act(async () => inlineChartsContainerTouch());
		expect(host.root?.accessibilityValue?.text).toBe("Values: 4");
	});

	it("does not re-render while a scrub stays on the same mark (R3)", async () => {
		await act(async () => root.render(<InlineUiPreview data={spend} />));
		const g = lastGesture();
		await act(async () =>
			g.onPanResponderGrant?.({
				nativeEvent: { locationX: 30, locationY: 90 },
			}),
		);
		await act(async () => g.onPanResponderMove?.(null, { dx: 12, dy: 0 }));
		expect(host.root?.accessibilityValue?.text).toContain("1 of 4");
		const renders = host.renders;
		await act(async () => g.onPanResponderMove?.(null, { dx: 14, dy: 1 }));
		await act(async () => g.onPanResponderMove?.(null, { dx: 16, dy: 0 }));
		expect(host.renders).toBe(renders);
		await act(async () => g.onPanResponderMove?.(null, { dx: 300, dy: 0 }));
		expect(host.root?.accessibilityValue?.text).toContain("4 of 4");
	});
});

describe("keyboard focus and direction (§5, X8)", () => {
	it("activates mark 0 on focus so the first arrow moves (U2)", async () => {
		await act(async () => root.render(<InlineUiPreview data={spend} />));
		await act(async () => host.root?.onFocus?.({ target: {} }));
		expect(host.root?.accessibilityValue?.text).toBe(
			"Nov 16, 84.04 USD, 1 of 4",
		);
		await action("increment");
		expect(host.root?.accessibilityValue?.text).toContain("2 of 4");
	});

	it("pins the chart root LTR under an RTL locale", async () => {
		setLocaleSource(() => "ur");
		await act(async () => root.render(<InlineUiPreview data={spend} />));
		expect(host.root?.style?.direction).toBe("ltr");
		// The axis still reads in plot order: first and last x labels, in place.
		expect(host.texts).toContain("Nov 16");
		expect(host.texts).toContain("Nov 24");
	});
});

describe("pie readouts (§3, X9, Q7, R5)", () => {
	const twelve = inlineUiData({
		type: "pie",
		title: "Spend by service",
		unit: "USD",
		data: Array.from({ length: 12 }, (_, i): [string, number] => [
			`Service ${i + 1}`,
			12 - i,
		]),
	});

	it("names the folded items under the donut when Other is selected", async () => {
		await act(async () => root.render(<InlineUiPreview data={twelve} />));
		for (let i = 0; i < 7; i++) await action("increment");
		expect(host.root?.accessibilityValue?.text).toBe(
			"Other (6), 21 USD, 27% of total, 7 of 7",
		);
		expect(host.texts).toContain("Service 7 · Service 8 · Service 9 · +3 more");
	});

	it("reserves the donut's final height before the first layout", () => {
		if (twelve.chart?.type !== "pie") throw new Error("expected a pie");
		const pie = inlineChartModel(twelve.chart);
		if (pie.kind !== "pie") throw new Error("expected a pie model");
		expect(reservedHeight(twelve.chart, 0)).toBe(donutHeight(pie, 360, 1));
		// 180 ring + one caption line + 8 + four 44 legend rows.
		expect(reservedHeight(twelve.chart, 0)).toBeGreaterThan(180 + 4 * 44);
	});
});

describe("text scale (R4)", () => {
	it("grows horizontal-bar rows with the reader's text scale", () => {
		expect(horizontalRow(1)).toBe(28);
		expect(horizontalRow(2)).toBeGreaterThan(28);
		expect(horizontalRow(3)).toBeGreaterThanOrEqual(Math.ceil(12 * 3 * 1.3));
	});
});

describe("chart data table (Q5)", () => {
	it("groups values like the tooltip does", async () => {
		const data = inlineUiData({
			type: "bar",
			title: "Cost",
			unit: "USD",
			data: [
				["Compute", 4120],
				["Storage", 2380.5],
			],
		});
		await act(async () => root.render(<InlineUiPreview data={data} />));
		await act(async () => host.disclosure?.onPress());
		expect(host.texts).toContain("4,120 USD");
		expect(host.texts).toContain("2,380.5 USD");
		expect(host.texts).not.toContain("4120 USD");
	});
});

describe("heatmap (§4, §5, Q2)", () => {
	const load = inlineUiData({
		type: "heatmap",
		title: "Queue load",
		unit: "jobs",
		columns: ["Mon", "Tue", "Wed"],
		rowLabels: ["AM", "PM"],
		rows: [
			[0, 1200, 30],
			[null, 4, 9],
		],
	});

	it("is an adjustable chart whose steps walk every cell", async () => {
		await act(async () => root.render(<InlineUiPreview data={load} />));
		expect(host.root?.accessibilityLabel).toBe("Queue load");
		expect(host.root?.accessibilityValue?.text).toBe("Values: 6");
		// No text in the cells: a middle value is not printed anywhere until a
		// mark is active; the gradient legend carries the min and max.
		expect(host.texts).not.toContain("30 jobs");
		expect(host.texts).not.toContain("30");
		expect(host.texts).toContain("0 jobs");
		expect(host.texts).toContain("1,200 jobs");
		for (let i = 0; i < 4; i++) await action("increment");
		expect(host.root?.accessibilityValue?.text).toBe(
			"PM, Mon, No data, 4 of 6",
		);
		expect(host.texts).toContain("No data");
	});

	it("answers a tap on a cell with its exact value", async () => {
		await act(async () => root.render(<InlineUiPreview data={load} />));
		// Row labels take the 28 minimum gutter; the legend row is 16 + 8.
		await tap(200, 24 + 5);
		expect(host.root?.accessibilityValue?.text).toBe(
			"AM, Tue, 1,200 jobs, 2 of 6",
		);
	});
});

describe("motion (§7, R10)", () => {
	it("stops the entrance fade when the chart unmounts", async () => {
		host.stopped = 0;
		await act(async () => root.render(<InlineUiPreview data={spend} />));
		await act(async () => root.render(null));
		expect(host.stopped).toBe(1);
	});
});

describe("degenerate ticks (X11)", () => {
	it("renders tiny values without duplicate React keys", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const data = inlineUiData({
			type: "line",
			title: "Tiny",
			data: [
				["a", 1e-22],
				["b", 3e-22],
				["c", 2e-22],
			],
		});
		await act(async () => root.render(<InlineUiPreview data={data} />));
		expect(
			error.mock.calls.filter((call) => String(call[0]).includes("same key")),
		).toEqual([]);
		error.mockRestore();
	});
});
