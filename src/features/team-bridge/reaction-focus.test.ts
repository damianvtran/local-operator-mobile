import { afterEach, describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({
	os: "web",
	focus: vi.fn(),
	handle: vi.fn(() => 42),
}));
vi.mock("react-native", () => ({
	Platform: {
		get OS() {
			return boundary.os;
		},
	},
	AccessibilityInfo: { setAccessibilityFocus: boundary.focus },
	findNodeHandle: boundary.handle,
}));

import { captureReactionFocus } from "./reaction-focus";

afterEach(() => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
	boundary.os = "web";
});

describe("reaction origin focus boundary (not browser focus proof)", () => {
	it("returns to the connected launching control without scrolling", () => {
		const control = { tagName: "BUTTON", isConnected: true, focus: vi.fn() };
		vi.stubGlobal("document", { activeElement: control });
		const restore = captureReactionFocus();
		vi.stubGlobal("document", { activeElement: null });
		restore();
		expect(control.focus).toHaveBeenCalledWith({ preventScroll: true });
	});
	it.each(["INPUT", "TEXTAREA", "BODY"])(
		"never focuses %s and unexpectedly opens the keyboard",
		(tagName) => {
			const control = { tagName, isConnected: true, focus: vi.fn() };
			vi.stubGlobal("document", { activeElement: control });
			captureReactionFocus()();
			expect(control.focus).not.toHaveBeenCalled();
		},
	);
	it("does not use an unmounted explicit origin or a stale fallback", () => {
		const control = { tagName: "BUTTON", isConnected: true, focus: vi.fn() };
		vi.stubGlobal("document", { activeElement: control });
		const restore = captureReactionFocus(() => null);
		restore();
		expect(control.focus).not.toHaveBeenCalled();
	});
	it("resolves native handles only at completion, and skips unmounted controls", () => {
		boundary.os = "ios";
		let mounted = true;
		const restore = captureReactionFocus(() =>
			mounted ? ({} as never) : null,
		);
		expect(boundary.handle).not.toHaveBeenCalled();
		restore();
		expect(boundary.focus).toHaveBeenCalledWith(42);
		mounted = false;
		restore();
		expect(boundary.focus).toHaveBeenCalledTimes(1);
	});
});
