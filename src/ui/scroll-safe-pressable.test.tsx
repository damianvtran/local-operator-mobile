import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `ScrollSafePressable` is a `Pressable` everywhere but iOS, where it is a
 * plain `View` driven by raw touches so a horizontal scroller inside keeps its
 * drag. The contract pinned here is which host element each platform gets.
 */
const host = vi.hoisted(() => ({
	os: "ios" as "ios" | "android",
	views: [] as Record<string, unknown>[],
	pressables: [] as Record<string, unknown>[],
}));

vi.mock("react-native", async () => {
	const { createElement } = await import("react");
	const record =
		(bucket: Record<string, unknown>[], tag: string) =>
		({ children, ...props }: { children?: ReactNode }) => {
			bucket.push(props);
			return createElement(tag, null, children);
		};
	return {
		Platform: {
			get OS() {
				return host.os;
			},
		},
		View: record(host.views, "div"),
		Pressable: record(host.pressables, "button"),
	};
});

import { ScrollSafePressable } from "@/ui/scroll-safe-pressable";

beforeEach(() => {
	host.views.length = 0;
	host.pressables.length = 0;
});

function mount(onPress: () => void, onLongPress: () => void) {
	renderToStaticMarkup(
		<ScrollSafePressable
			onPress={onPress}
			onLongPress={onLongPress}
			accessibilityLabel="Copy"
			testID="x"
		>
			<span>body</span>
		</ScrollSafePressable>,
	);
}

describe("ScrollSafePressable", () => {
	it("is a touch-driven View on iOS: no Pressable, so no responder claim", () => {
		host.os = "ios";
		mount(vi.fn(), vi.fn());
		expect(host.pressables).toHaveLength(0);
		expect(host.views.at(-1)).toMatchObject({
			accessible: true,
			accessibilityLabel: "Copy",
			testID: "x",
		});
		expect(host.views.at(-1)).toHaveProperty("onTouchMove");
		expect(host.views.at(-1)).toHaveProperty("onTouchStart");
	});

	it("is a plain Pressable on Android", () => {
		host.os = "android";
		const onPress = vi.fn();
		mount(onPress, vi.fn());
		expect(host.views).toHaveLength(0);
		expect(host.pressables.at(-1)).toMatchObject({
			onPress,
			accessibilityLabel: "Copy",
		});
	});
});
