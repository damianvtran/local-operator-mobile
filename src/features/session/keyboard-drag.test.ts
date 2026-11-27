import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	GESTURE_AREA_MIN_ANDROID_API,
	keyboardDragPlan,
} from "./keyboard-drag";

const read = (path: string) =>
	readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

describe("keyboardDragPlan", () => {
	it("iOS: the scroll view's own interactive dismissal, no gesture area", () => {
		expect(keyboardDragPlan("ios", "27.2")).toEqual({
			gestureArea: false,
			dismissMode: "interactive",
		});
	});

	it("Android 11+ (API 30): a gesture area, and the scroll view must not dismiss", () => {
		expect(GESTURE_AREA_MIN_ANDROID_API).toBe(30);
		for (const api of [30, 33, 36]) {
			expect(keyboardDragPlan("android", api)).toEqual({
				gestureArea: true,
				dismissMode: "none",
			});
		}
	});

	it("Android 10 and older (minSdk 24): the timed on-drag close, no gesture area", () => {
		for (const api of [24, 28, 29]) {
			expect(keyboardDragPlan("android", api)).toEqual({
				gestureArea: false,
				dismissMode: "on-drag",
			});
		}
	});

	it("an Android version that is not a number falls back, never to the gesture area", () => {
		expect(keyboardDragPlan("android", "30").gestureArea).toBe(false);
	});

	it("web keeps today's value", () => {
		expect(keyboardDragPlan("web", 0)).toEqual({
			gestureArea: false,
			dismissMode: "interactive",
		});
	});
});

describe("the transcript list is wired to the plan", () => {
	const source = read("src/features/session/components/transcript-list.tsx")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/\s+/g, " ");

	it("reads the plan for the platform it runs on, and takes its dismiss mode", () => {
		expect(source).toContain("keyboardDragPlan(Platform.OS, Platform.Version)");
		expect(source).toContain("keyboardDismissMode={KEYBOARD_DRAG.dismissMode}");
		expect(source).not.toContain('keyboardDismissMode="interactive"');
	});

	it("wraps the host in the ios-interpolated gesture area only when the plan says so", () => {
		expect(source).toContain(
			'KEYBOARD_DRAG.gestureArea ? ( <KeyboardGestureArea interpolator="ios" style={GESTURE_AREA_STYLE}> {body} </KeyboardGestureArea> ) : ( body )',
		);
	});

	it("the gesture area passes the column contract through", () => {
		expect(source).toContain(
			"const GESTURE_AREA_STYLE: ViewStyle = { flex: 1, minHeight: 0 };",
		);
	});
});
