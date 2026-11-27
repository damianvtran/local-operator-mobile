import type { PanGesture } from "react-native-gesture-handler";
import { describe, expect, it } from "vitest";
import {
	applyClosePanConfig,
	applyPagePanConfig,
	DRAWER_PAN,
	panEnabled,
} from "@/features/sessions/drawer-pan";

/** The real API call chain, recorded: a Node test cannot drag, but it can read
 *  back exactly what the component configured on the recogniser. */
const recorder = () => {
	const calls: Array<[string, unknown[]]> = [];
	const builder: Record<string, unknown> = {};
	for (const name of [
		"activeOffsetX",
		"failOffsetX",
		"failOffsetY",
		"hitSlop",
		"enabled",
	]) {
		builder[name] = (...args: unknown[]) => {
			calls.push([name, args]);
			return builder;
		};
	}
	return { pan: builder as unknown as PanGesture, calls };
};

describe("the page pan's thresholds", () => {
	it("activates only on 16 pt of rightward travel and loses the other axes", () => {
		const { pan, calls } = recorder();
		applyPagePanConfig(pan, "ios");
		expect(calls).toEqual([
			["activeOffsetX", [DRAWER_PAN.activateRightPt]],
			["failOffsetX", [DRAWER_PAN.failLeftPt]],
			[
				"failOffsetY",
				[[-DRAWER_PAN.failVerticalPt, DRAWER_PAN.failVerticalPt]],
			],
		]);
		expect(calls.find(([name]) => name === "activeOffsetX")?.[1]).toEqual([16]);
		expect(calls.find(([name]) => name === "failOffsetX")?.[1]).toEqual([-16]);
		expect(calls.find(([name]) => name === "failOffsetY")?.[1]).toEqual([
			[-12, 12],
		]);
	});

	it("cuts the Android system back strips out of its start region", () => {
		const { pan, calls } = recorder();
		applyPagePanConfig(pan, "android");
		expect(calls.at(-1)).toEqual(["hitSlop", [{ left: -24, right: -24 }]]);
	});

	it("leaves iOS and web the whole screen: no hitSlop is configurable there", () => {
		for (const os of ["ios", "web"]) {
			const { pan, calls } = recorder();
			applyPagePanConfig(pan, os);
			expect(calls.some(([name]) => name === "hitSlop")).toBe(false);
		}
	});

	it("reveals the pane's content below the activation threshold (M2)", () => {
		/* The content mount is a JS state update; it must land while the pan is
		 *  still BEGAN, so the panel's first visible frame (at activation) never
		 *  waits for a render. */
		expect(DRAWER_PAN.contentRevealPt).toBeLessThanOrEqual(8);
		expect(DRAWER_PAN.contentRevealPt).toBeGreaterThan(0);
		expect(DRAWER_PAN.contentRevealPt).toBeLessThan(DRAWER_PAN.activateRightPt);
	});

	it("mirrors for the panel's close drag: leftward activates, rightward fails", () => {
		const { pan, calls } = recorder();
		applyClosePanConfig(pan);
		expect(calls).toEqual([
			["activeOffsetX", [-DRAWER_PAN.activateRightPt]],
			["failOffsetX", [DRAWER_PAN.activateRightPt]],
			[
				"failOffsetY",
				[[-DRAWER_PAN.failVerticalPt, DRAWER_PAN.failVerticalPt]],
			],
		]);
	});
});

describe("panEnabled", () => {
	it("is live on top-level routes only", () => {
		expect(
			panEnabled({
				routeClass: "top-level",
				drawerVisible: false,
				selecting: false,
			}),
		).toBe(true);
		for (const routeClass of ["nested", null] as const) {
			expect(
				panEnabled({ routeClass, drawerVisible: false, selecting: false }),
			).toBe(false);
		}
	});

	it("stands down while the drawer is open or a text selection is live", () => {
		expect(
			panEnabled({
				routeClass: "top-level",
				drawerVisible: true,
				selecting: false,
			}),
		).toBe(false);
		expect(
			panEnabled({
				routeClass: "top-level",
				drawerVisible: false,
				selecting: true,
			}),
		).toBe(false);
	});
});
