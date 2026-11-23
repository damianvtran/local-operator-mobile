import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type DomShim, installDomShim } from "@/testing/dom-shim";

/**
 * `Button fill` (ask-panel parity review, minor 3): the footer's Send and
 * Decline sit side by side and must read as one pair even when one label wraps.
 * Only leaf primitives are stubbed (Node has no React Native host); what is
 * asserted is the style and class the Button hands them.
 */
const seen = vi.hoisted(() => ({
	style: undefined as unknown,
	pillClass: "",
}));
vi.mock("react-native", () => ({
	ActivityIndicator: () => null,
	Text: ({ children }: { children?: ReactNode }) => children ?? null,
	View: ({
		children,
		className,
	}: {
		children?: ReactNode;
		className?: string;
	}) => {
		seen.pillClass = className ?? "";
		return children ?? null;
	},
	Pressable: ({
		children,
		style,
	}: {
		children?: ReactNode | ((state: { pressed: boolean }) => ReactNode);
		style?: unknown;
	}) => {
		seen.style = style;
		return (
			(typeof children === "function"
				? children({ pressed: false })
				: children) ?? null
		);
	},
}));
vi.mock("@/ui/appearance", () => ({ useTokenColor: () => "black" }));
vi.mock("@/ui/layout", () => ({ TOUCH_FLOOR: 44 }));

const { Button } = await import("./button");

let dom: DomShim;
let root: ReturnType<typeof createRoot>;
const render = (fill?: boolean) =>
	act(async () =>
		root.render(
			<Button label="Send" onPress={() => undefined} testID="b" fill={fill} />,
		),
	);

beforeEach(() => {
	seen.style = undefined;
	seen.pillClass = "";
	dom = installDomShim();
	root = createRoot(dom.container as Element);
});
afterEach(async () => {
	await act(async () => root.unmount());
	dom.dispose();
});

describe("Button fill", () => {
	it("grows the pressable and the pill to the shared row's height", async () => {
		await render(true);
		expect(seen.style).toEqual({ flexGrow: 1 });
		expect(seen.pillClass).toContain("flex-1");
	});
	it("leaves every other button at its own height", async () => {
		await render();
		expect(seen.style).toBeUndefined();
		expect(seen.pillClass).not.toContain("flex-1");
	});
});
