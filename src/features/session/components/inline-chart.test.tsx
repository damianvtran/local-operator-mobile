import { act, type ReactNode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetLocaleSource, setLocaleSource } from "@/i18n";
import { installDomShim } from "@/testing/dom-shim";
import { PALETTE } from "@/ui/tokens.gen";
import { InlineUiPreview, inlineUiData } from "./inline-ui-preview";

// The chart root is the one `adjustable` element; its props are the whole
// screen-reader contract (§5 Screen readers), so the mock records them.
type RootProps = {
	accessibilityLabel?: string;
	accessibilityValue?: { text: string };
	onAccessibilityAction?: (event: {
		nativeEvent: { actionName: string };
	}) => void;
};
const host = vi.hoisted(() => ({
	texts: [] as string[],
	root: null as null | RootProps,
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
			},
			timing: () => ({ start() {} }),
		},
		AccessibilityInfo: { isReduceMotionEnabled: () => Promise.resolve(true) },
		PanResponder: { create: () => ({ panHandlers: {} }) },
		Platform: { OS: "ios" },
	};
});
vi.mock("react-native-svg", () => {
	const noop = () => null;
	return {
		default: noop,
		Circle: noop,
		Line: noop,
		Path: noop,
		Polyline: noop,
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
		expect(host.root?.accessibilityValue).toBeUndefined();

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
			"Service 1, 12, 15.4% of total, 1 of 7",
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
