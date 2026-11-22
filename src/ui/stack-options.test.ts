import { describe, expect, it } from "vitest";

import { BACK_SWIPE_EDGE_PT, stackScreenOptions } from "@/ui/stack-options";

describe("stack screen options: back is the left-edge swipe, never a mid-screen one", () => {
	it("iOS 26 and later keep the native swipe but only from the leading edge", () => {
		for (const version of ["26.0", "26", 27, "27.2"]) {
			expect(stackScreenOptions("ios", version)).toEqual({
				headerShown: false,
				fullScreenGestureEnabled: true,
				gestureResponseDistance: { end: BACK_SWIPE_EDGE_PT },
			});
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
