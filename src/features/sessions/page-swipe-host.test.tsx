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
import {
	detectorChildren,
	nativeCalls,
	panCalls,
} from "@/testing/native-gesture-mocks";
import { DrawerSwipeClaim } from "@/ui/drawer-swipe-claim";

const drawer = () => ({
	mode: "agents" as const,
	progress: { value: 0 } as unknown as SharedValue<number>,
	visible: false,
	open: vi.fn(),
	close: vi.fn(),
	prime: vi.fn(),
	reveal: vi.fn(),
	abandon: vi.fn(),
	settle: vi.fn(),
	resume: vi.fn(),
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
	const rendered = act(async () =>
		root.render(
			createElement(
				WorkspaceDrawerContext.Provider,
				{ value },
				createElement(PageSwipeHost, { routeName }, children),
			),
		),
	);
	return { value, rendered };
};

const callsTo = (name: string) =>
	panCalls.filter((call) => call.name === name).map((call) => call.args);

/** The last recorded callback of a pan method, invoked with `event`. */
const drive = (name: string, event: unknown) => {
	const args = callsTo(name).at(-1) as [(event: unknown) => void] | undefined;
	args?.[0](event);
};

/** A `GestureTouchEvent` as the pan's raw-touch callbacks receive it. */
const touchEvent = (x: number, y: number) => ({
	handlerTag: 1,
	numberOfTouches: 1,
	eventType: 1,
	allTouches: [{ id: 1, x, y, absoluteX: x, absoluteY: y }],
	changedTouches: [{ id: 1, x, y, absoluteX: x, absoluteY: y }],
});

beforeEach(() => {
	panCalls.length = 0;
	nativeCalls.length = 0;
	detectorChildren.length = 0;
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
		await mount("session/[id]").rendered;
		expect(callsTo("activeOffsetX")).toEqual([[16]]);
		expect(callsTo("failOffsetX")).toEqual([[-16]]);
		expect(callsTo("failOffsetY")).toEqual([[[-12, 12]]]);
		expect(callsTo("enabled").at(-1)).toEqual([true]);
	});

	it("never runs on a nested screen: the native stack owns that swipe", async () => {
		await mount("theme").rendered;
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
		await mount("past").rendered;
		expect(callsTo("enabled").at(-1)).toEqual([true]);
		await act(async () => enterTextSelection("message-1"));
		expect(callsTo("enabled").at(-1)).toEqual([false]);
		await act(async () => exitTextSelection("message-1"));
		expect(callsTo("enabled").at(-1)).toEqual([true]);
	});
});

describe("the page pan's touch-down prime", () => {
	it("reveals on activation even when the move threshold never reported (backstop)", async () => {
		const { value, rendered } = mount("library");
		await rendered;
		drive("onBegin", {});
		expect(value.reveal).not.toHaveBeenCalled();
		/* Activation is a real drag by definition; the 6 pt move event is the
		 *  normal reveal, and this is the backstop when a device delivers
		 *  activation without it. Idempotent in the provider. */
		drive("onStart", {});
		expect(value.reveal).toHaveBeenCalledOnce();
	});

	it("does not mount the pane's content until the touch is a rightward drag (M2)", async () => {
		const { value, rendered } = mount("library");
		await rendered;
		drive("onBegin", {});
		drive("onTouchesDown", touchEvent(100, 200));
		expect(value.prime).toHaveBeenCalledOnce();
		expect(value.reveal).not.toHaveBeenCalled();
		/* A 4 pt drift is under the threshold; a vertical scroll that drifts
		 *  right stays out too, because the page gesture is the horizontal one. */
		drive("onTouchesMove", touchEvent(104, 201));
		drive("onTouchesMove", touchEvent(110, 218));
		expect(value.reveal).not.toHaveBeenCalled();
		drive("onTouchesMove", touchEvent(106, 202));
		expect(value.reveal).toHaveBeenCalledOnce();
		/* Once per touch, however far it travels. */
		drive("onTouchesMove", touchEvent(160, 202));
		expect(value.reveal).toHaveBeenCalledOnce();
	});

	it("resets the reveal for the next touch", async () => {
		const { value, rendered } = mount("library");
		await rendered;
		drive("onBegin", {});
		drive("onTouchesDown", touchEvent(100, 200));
		drive("onTouchesMove", touchEvent(108, 200));
		expect(value.reveal).toHaveBeenCalledOnce();
		drive("onFinalize", {});
		drive("onBegin", {});
		drive("onTouchesDown", touchEvent(100, 200));
		drive("onTouchesMove", touchEvent(108, 200));
		expect(value.reveal).toHaveBeenCalledTimes(2);
	});
});

describe("a claimed surface against the page pan", () => {
	it("blocks the page pan by the ref the pan was built with", async () => {
		/* A plain `View` in a claim, not a scroller: this pins the WIRING (the
		 *  claim blocks THIS screen's pan), not that a native recogniser wins
		 *  the touch — only a device can show that (QA row). */
		await mount("library").rendered;
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
		await mount("library").rendered;
		expect(callsTo("simultaneousWithExternalGesture")).toEqual([]);
		expect(callsTo("requireExternalGestureToFail")).toEqual([]);
	});
});
