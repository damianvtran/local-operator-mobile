import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native-keyboard-controller", async () => {
	const { keyboardControllerModuleMock } = await import(
		"@/testing/native-gesture-mocks"
	);
	return keyboardControllerModuleMock();
});

import { useKeyboardHandler } from "react-native-keyboard-controller";
import { registeredHandlers } from "@/testing/native-gesture-mocks";

/* The mock is the instrument later suites drive a keyboard motion with, so its
 * own contract is pinned: a handler it was given must come back out and run. */
describe("the keyboard-controller mock", () => {
	beforeEach(() => {
		registeredHandlers.length = 0;
	});

	it("records the handlers a component registers so a test can drive them", () => {
		const heights: number[] = [];
		useKeyboardHandler({ onMove: (event) => heights.push(event.height) }, []);
		expect(registeredHandlers).toHaveLength(1);
		registeredHandlers[0]?.onMove?.({ height: 120, progress: 0.4 });
		expect(heights).toEqual([120]);
	});
});
