import { describe, expect, it } from "vitest";
import { sheetKeyboardLift, sheetKeyboardRoom } from "./sheet-keyboard";

/** TestFlight 1295: the arithmetic `Sheet` uses to sit on the keyboard. */
describe("sheetKeyboardLift", () => {
	it("is the overlap when the host was not resized (iOS Modal, Android edge-to-edge)", () => {
		expect(
			sheetKeyboardLift({ overlap: 336, columnHeight: 844, windowHeight: 844 }),
		).toBe(336);
	});

	it("is the overlap before the column is measured", () => {
		expect(
			sheetKeyboardLift({ overlap: 336, columnHeight: 0, windowHeight: 844 }),
		).toBe(336);
	});

	it("is 0 when the host already resized by the keyboard (no double lift)", () => {
		expect(
			sheetKeyboardLift({ overlap: 336, columnHeight: 508, windowHeight: 844 }),
		).toBe(0);
	});

	it("ignores a bar-sized difference between column and window", () => {
		expect(
			sheetKeyboardLift({ overlap: 336, columnHeight: 820, windowHeight: 844 }),
		).toBe(336);
	});

	it("is 0 with no keyboard", () => {
		expect(
			sheetKeyboardLift({ overlap: 0, columnHeight: 844, windowHeight: 844 }),
		).toBe(0);
	});
});

describe("sheetKeyboardRoom", () => {
	it("is the space between the safe top and the keyboard top", () => {
		expect(sheetKeyboardRoom({ capHeight: 844, lift: 336, safeTop: 47 })).toBe(
			461,
		);
	});

	it("never goes negative", () => {
		expect(sheetKeyboardRoom({ capHeight: 300, lift: 336, safeTop: 47 })).toBe(
			0,
		);
	});
});
