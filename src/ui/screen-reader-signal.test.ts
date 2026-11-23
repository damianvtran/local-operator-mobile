import { describe, expect, it } from "vitest";
import { screenReaderSignalUsable } from "./screen-reader-signal";

/* Review W1: react-native-web answers `isScreenReaderEnabled()` with a constant
 *  `true`, so reading it switched the composer's compaction (and its
 *  `initialShrunk` test seam) off for every web visitor. */
describe("the screen-reader gate on each platform", () => {
	it("is not read on the web, whose answer is a constant", () => {
		expect(screenReaderSignalUsable("web")).toBe(false);
	});

	it("is read on the native platforms that report a real one", () => {
		expect(screenReaderSignalUsable("ios")).toBe(true);
		expect(screenReaderSignalUsable("android")).toBe(true);
	});
});
