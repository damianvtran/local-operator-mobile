import { describe, expect, it } from "vitest";

import {
	BACK_SWIPE_EDGE_PT,
	NESTED_STACK_SCREEN_OPTIONS,
	stackScreenOptions,
} from "@/ui/stack-options";

describe("stack screen options: back is the system's swipe, scoped per stack", () => {
	it("the root and (auth) stacks keep the measured left-edge limit on iOS 26", () => {
		for (const version of ["26.0", "26", 27, "27.2"]) {
			expect(stackScreenOptions("ios", version)).toEqual({
				headerShown: false,
				fullScreenGestureEnabled: true,
				gestureResponseDistance: { end: BACK_SWIPE_EDGE_PT },
			});
		}
	});

	it("nested app screens take the full-width pop and no distance (E2)", () => {
		for (const version of ["26.0", "26", 27, "27.2"]) {
			const options = stackScreenOptions("ios", version, "nested");
			expect(options).toEqual({
				headerShown: false,
				fullScreenGestureEnabled: true,
			});
			expect(options).not.toHaveProperty("gestureResponseDistance");
		}
	});

	it("iOS before 26 has only the system edge swipe; no full-width recognizer", () => {
		for (const version of ["25.4", "18.2", 17]) {
			expect(stackScreenOptions("ios", version)).toEqual({
				headerShown: false,
				fullScreenGestureEnabled: false,
			});
		}
	});

	it("a nested scope changes nothing before iOS 26, on Android or on web", () => {
		for (const [os, version] of [
			["ios", "25.4"],
			["ios", "18.2"],
			["android", 35],
			["web", 0],
		] as const) {
			expect(stackScreenOptions(os, version, "nested")).toEqual(
				stackScreenOptions(os, version),
			);
		}
	});

	it("the app group's default is the nested scope", () => {
		expect(NESTED_STACK_SCREEN_OPTIONS).not.toHaveProperty(
			"gestureResponseDistance",
		);
	});

	it("Android and web are untouched by the iOS-only options", () => {
		for (const os of ["android", "web"]) {
			expect(stackScreenOptions(os, 35)).toEqual({
				headerShown: false,
				fullScreenGestureEnabled: false,
			});
		}
	});

	it("an unreadable iOS version never turns the full-width swipe on", () => {
		expect(stackScreenOptions("ios", "")).toMatchObject({
			fullScreenGestureEnabled: false,
		});
	});

	it("never disables the back swipe itself (gestureEnabled stays default)", () => {
		for (const os of ["ios", "android"]) {
			expect(stackScreenOptions(os, 27)).not.toHaveProperty("gestureEnabled");
		}
	});
});
