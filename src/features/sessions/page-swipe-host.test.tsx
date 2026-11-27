import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { SharedValue } from "react-native-reanimated";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type DomShim, installDomShim } from "@/testing/dom-shim";

/* The gate is `Platform.OS !== "web"`; the Node runner resolves
 *  `react-native` to react-native-web, and the rule under test is the iOS one. */
vi.mock("react-native", async (importOriginal) => {
	const actual = await importOriginal<typeof import("react-native")>();
	return { ...actual, Platform: { ...actual.Platform, OS: "ios" } };
});
vi.mock("react-native-gesture-handler", async () => {
	const { gestureHandlerModuleMock } = await import(
		"@/testing/native-gesture-mocks"
	);
	return gestureHandlerModuleMock();
});
vi.mock("react-native-reanimated", async () => {
	const { reanimatedModuleMock } = await import(
		"@/testing/native-gesture-mocks"
	);
	return reanimatedModuleMock();
});

import { View } from "react-native";
import {
	enterTextSelection,
	exitTextSelection,
} from "@/features/session/text-selection";
import { PageSwipeHost } from "@/features/sessions/page-swipe-host";
import { WorkspaceDrawerContext } from "@/features/sessions/workspace-drawer-context";
import { nativeCalls, panCalls } from "@/testing/native-gesture-mocks";
import { DrawerSwipeClaim } from "@/ui/drawer-swipe-claim";

const drawer = () => ({
	mode: "agents" as const,
	progress: { value: 0 } as unknown as SharedValue<number>,
	visible: false,
	open: vi.fn(),
	close: vi.fn(),
	prime: vi.fn(),
	abandon: vi.fn(),
	settle: vi.fn(),
	selectMode: vi.fn(),
	newChatRequest: 0,
	consumeNewChatRequest: () => false,
	setAgentsPresentation: vi.fn(),
});

let dom: DomShim;
let root: ReturnType<typeof createRoot>;

const mount = (
	routeName: string,
	children: ReactNode = createElement(
		DrawerSwipeClaim,
		null,
		createElement(View, null),
	),
) => {
	const value = drawer();
	return act(async () =>
		root.render(
			createElement(
				WorkspaceDrawerContext.Provider,
				{ value },
				createElement(PageSwipeHost, { routeName }, children),
			),
		),
	);
};

const callsTo = (name: string) =>
	panCalls.filter((call) => call.name === name).map((call) => call.args);

beforeEach(() => {
	panCalls.length = 0;
	nativeCalls.length = 0;
	dom = installDomShim();
	root = createRoot(dom.container as Element);
});
afterEach(async () => {
	await act(async () => root.unmount());
	dom.dispose();
	exitTextSelection();
});

describe("the page swipe host", () => {
	it("configures the drawer thresholds on a top-level screen", async () => {
		await mount("session/[id]");
		expect(callsTo("activeOffsetX")).toEqual([[16]]);
		expect(callsTo("failOffsetX")).toEqual([[-16]]);
		expect(callsTo("failOffsetY")).toEqual([[[-12, 12]]]);
		expect(callsTo("enabled").at(-1)).toEqual([true]);
	});

	it("never runs on a nested screen: the native stack owns that swipe", async () => {
		await mount("theme");
		expect(callsTo("enabled").at(-1)).toEqual([false]);
	});

	it("stands down while the drawer is open", async () => {
		const value = { ...drawer(), visible: true };
		await act(async () =>
			root.render(
				createElement(
					WorkspaceDrawerContext.Provider,
					{ value },
					createElement(PageSwipeHost, { routeName: "settings" }, null),
				),
			),
		);
		expect(callsTo("enabled").at(-1)).toEqual([false]);
	});

	it("stands down while a message selection is live (E5)", async () => {
		await mount("past");
		expect(callsTo("enabled").at(-1)).toEqual([true]);
		await act(async () => enterTextSelection("message-1"));
		expect(callsTo("enabled").at(-1)).toEqual([false]);
		await act(async () => exitTextSelection("message-1"));
		expect(callsTo("enabled").at(-1)).toEqual([true]);
	});
});

describe("the scroller claim against the page pan", () => {
	it("blocks the page pan by the ref the pan was built with", async () => {
		await mount("library");
		const withRef = panCalls.find((call) => call.name === "withRef");
		const blocked = nativeCalls.find(
			(call) => call.name === "blocksExternalGesture",
		);
		expect(withRef).toBeDefined();
		expect(blocked).toBeDefined();
		/* Identity, not a copy: the claim blocks THIS screen's pan, so a touch
		 *  that starts inside the claimed surface can never reach it. */
		expect(blocked?.args[0]).toBe(withRef?.args[0]);
	});

	it("adds no simultaneous relation that could let the pan share a scroller's touch", async () => {
		await mount("library");
		expect(callsTo("simultaneousWithExternalGesture")).toEqual([]);
		expect(callsTo("requireExternalGestureToFail")).toEqual([]);
	});
});
