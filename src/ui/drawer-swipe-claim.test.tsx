import { act, createElement, isValidElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { View } from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type DomShim, installDomShim } from "@/testing/dom-shim";

/**
 * The claim's SHAPE, which is what the recogniser attaches to.
 *
 * WHY THIS IS A TEST AND NOT A COMMENT. `GestureDetector` clones its child with
 * `collapsable: false` because the recogniser needs a HOST view under it. The
 * composer is a custom component, so the prop never reached a host node, the
 * node was flattened on Fabric, and a drag that started on the field opened
 * the drawer instead of moving the composer (QA round 2, Q2) — with RNGH's
 * view-flattened warning pointing at this component. A regression here is
 * invisible in a screenshot until a finger drags the wrong control, so it is
 * pinned as structure: the detector gets a plain View with `collapsable:
 * false`, and the claim still blocks the screen's own pan by identity.
 */
vi.mock("react-native-gesture-handler", async () => {
	const { gestureHandlerModuleMock } = await import(
		"@/testing/native-gesture-mocks"
	);
	return gestureHandlerModuleMock();
});

import { detectorChildren, nativeCalls } from "@/testing/native-gesture-mocks";
import {
	DrawerPageGestureContext,
	DrawerSwipeClaim,
} from "@/ui/drawer-swipe-claim";

let dom: DomShim;
let root: ReturnType<typeof createRoot>;

const render = async (node: ReactNode) => {
	await act(async () => root.render(node));
};

beforeEach(() => {
	nativeCalls.length = 0;
	detectorChildren.length = 0;
	dom = installDomShim();
	root = createRoot(dom.container as Element);
});
afterEach(async () => {
	await act(async () => root.unmount());
	dom.dispose();
});

describe("a claimed surface's detector child", () => {
	it("is a plain host View with view flattening off", async () => {
		const pageRef = { current: undefined };
		const claimed = createElement(View, { testID: "claimed" });
		await render(
			createElement(
				DrawerPageGestureContext.Provider,
				{ value: pageRef },
				createElement(DrawerSwipeClaim, null, claimed),
			),
		);
		const child = detectorChildren.at(-1);
		expect(isValidElement(child)).toBe(true);
		if (!isValidElement(child)) return;
		const element = child as { type: unknown; props: Record<string, unknown> };
		/* A host component: the same `View` the claim imports, not the custom
		 *  component it was given (whose root the clone could not reach). */
		expect(element.type).toBe(View);
		expect(element.props.collapsable).toBe(false);
		/* The claimed surface is still INSIDE that host view, so the touch the
		 *  recogniser sees is the one that lands on the control. */
		expect(element.props.children).toBe(claimed);
	});

	it("blocks the screen's own page pan by the ref the pan was built with", async () => {
		const pageRef = { current: undefined };
		await render(
			createElement(
				DrawerPageGestureContext.Provider,
				{ value: pageRef },
				createElement(DrawerSwipeClaim, null, createElement(View, null)),
			),
		);
		const blocked = nativeCalls.find(
			(call) => call.name === "blocksExternalGesture",
		);
		expect(blocked?.args[0]).toBe(pageRef);
	});

	it("stays a plain wrapper outside a page host", async () => {
		await render(createElement(DrawerSwipeClaim, null, createElement(View)));
		expect(detectorChildren).toHaveLength(0);
		expect(nativeCalls).toHaveLength(0);
	});
});
