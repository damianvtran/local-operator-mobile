import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

/* The native keyboard events, driven by hand: the store's whole job is to turn
 *  them into ONE frame every reader agrees on (TestFlight 753). */
const native = vi.hoisted(() => ({
	os: "ios",
	window: 844,
	listeners: new Map<string, (event: unknown) => void>(),
}));
vi.mock("react-native", () => ({
	Platform: {
		get OS() {
			return native.os;
		},
	},
	Dimensions: { get: () => ({ width: 390, height: native.window }) },
	Keyboard: {
		addListener: (name: string, listener: (event: unknown) => void) => {
			native.listeners.set(name, listener);
			return { remove: () => native.listeners.delete(name) };
		},
	},
}));

import {
	KEYBOARD_HIDDEN,
	keyboardFrameFrom,
	keyboardFrameNow,
	subscribeKeyboardFrame,
} from "./keyboard-frame";

const frame = (screenY: number, height: number, duration = 250) => ({
	duration,
	endCoordinates: { screenX: 0, screenY, width: 390, height },
});

afterEach(() => {
	native.listeners.clear();
});

describe("keyboardFrameFrom", () => {
	it("is the overlap from the window bottom, in whole pt (the screenshot's 316)", () => {
		expect(keyboardFrameFrom(KEYBOARD_HIDDEN, 844, frame(528, 316))).toEqual({
			visible: true,
			overlap: 316,
			duration: 250,
		});
		expect(
			keyboardFrameFrom(KEYBOARD_HIDDEN, 844, frame(507.6, 336.4)).overlap,
		).toBe(336);
	});

	it("gives 0 overlap when the window itself resized to the keyboard's top", () => {
		/* Android with a resizing window: screenY is the new window height. */
		expect(
			keyboardFrameFrom(KEYBOARD_HIDDEN, 500, frame(500, 300)).overlap,
		).toBe(0);
	});

	it("keeps `visible` until didHide, as #206 did (iOS hide's willChangeFrame)", () => {
		const up = keyboardFrameFrom(KEYBOARD_HIDDEN, 844, frame(508, 336));
		expect(keyboardFrameFrom(up, 844, frame(844, 0)).visible).toBe(true);
	});
});

describe("subscribeKeyboardFrame", () => {
	it.each([
		["ios", "keyboardWillChangeFrame"],
		["android", "keyboardDidShow"],
	])(
		"on %s, every reader sees each frame, height changes included",
		(os, show) => {
			native.os = os;
			native.window = os === "ios" ? 844 : 800;
			const a: number[] = [];
			const b: number[] = [];
			const offA = subscribeKeyboardFrame((f) => a.push(f.overlap));
			const offB = subscribeKeyboardFrame((f) => b.push(f.overlap));
			const bottom = native.window;
			native.listeners.get(show)?.(frame(bottom - 300, 300));
			/* The predictive bar / an IME resize while it stays up. */
			native.listeners.get(show)?.(frame(bottom - 336, 336));
			native.listeners.get("keyboardDidHide")?.({});
			expect(a).toEqual([300, 336, 0]);
			expect(b).toEqual(a);
			offA();
			expect(native.listeners.size).toBe(2);
			offB();
			/* The last reader removes the one native subscription and the frame. */
			expect(native.listeners.size).toBe(0);
			expect(keyboardFrameNow()).toBe(KEYBOARD_HIDDEN);
		},
	);

	/* The device-only half (A4): the composer must measure again when its lift
	 *  LANDS, tag the box with the offset it had reached, and re-measure on a
	 *  height change while the keyboard is up. Pinned at the source because the
	 *  timing completion runs on reanimated's UI runtime. */
	it("is wired so the composer re-measures at the end of the lift", () => {
		const composer = readFileSync(
			new URL("./components/composer.tsx", import.meta.url),
			"utf8",
		).replace(/\s+/g, " ");
		expect(composer).toContain("return subscribeKeyboardFrame((frame) => {");
		expect(composer).toContain(
			"(finished) => { if (finished) runOnJS(remeasure)(); },",
		);
		expect(composer).toContain(
			"const keyboardOverlap = Math.round(keyboardOffset.value);",
		);
		expect(composer).toContain("`keyboard:${keyboard.overlap}`");
		/* No second native listener for the lift. */
		expect(composer).not.toContain("Keyboard.addListener");
		expect(composer).not.toContain("composerKeyboardLimit");
	});

	it("subscribes to nothing on the web", () => {
		native.os = "web";
		const off = subscribeKeyboardFrame(() => {});
		expect(native.listeners.size).toBe(0);
		off();
	});
});
