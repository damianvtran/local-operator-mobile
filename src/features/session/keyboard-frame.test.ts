import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

/* The native keyboard events, driven by hand: the store's whole job is to turn
 *  them into ONE frame every reader agrees on (TestFlight 753). */
const native = vi.hoisted(() => ({
	os: "ios",
	window: 844,
	listeners: new Map<string, (event: unknown) => void>(),
	/* What RN's `Keyboard.metrics()` answers: the frame of a keyboard that is
	 *  already up, `undefined` while hidden. */
	metrics: undefined as
		| { screenX: number; screenY: number; width: number; height: number }
		| undefined,
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
		isVisible: () => native.metrics !== undefined,
		metrics: () => native.metrics,
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
	native.metrics = undefined;
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
		expect(composer).toContain(
			"const unsubscribe = subscribeKeyboardFrame((frame) => {",
		);
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

	/* PR #216 review m2: a reader that MOUNTS while the keyboard is up (the
	 *  session composer opened over a focused field) used to read "hidden" until
	 *  the keyboard next moved, so it never lifted and the screen capped it
	 *  against the full window. */
	it("a reader mounting with the keyboard already up reads its frame, with no event", () => {
		native.os = "ios";
		native.window = 844;
		native.metrics = { screenX: 0, screenY: 528, width: 390, height: 316 };
		const seen: number[] = [];
		const off = subscribeKeyboardFrame((f) => seen.push(f.overlap));
		expect(keyboardFrameNow()).toMatchObject({ visible: true, overlap: 316 });
		/* Seeding is not an event: no reader is called for it. */
		expect(seen).toEqual([]);
		/* A second reader joining a live store reads the same present frame. */
		const offLate = subscribeKeyboardFrame(() => {});
		expect(keyboardFrameNow().overlap).toBe(316);
		offLate();
		off();
		/* After the reset, a restart seeds again from the native keyboard. */
		native.metrics = undefined;
		const offHidden = subscribeKeyboardFrame(() => {});
		expect(keyboardFrameNow()).toEqual(KEYBOARD_HIDDEN);
		offHidden();
	});

	it("the composer seeds its lift and its box tag from the present frame on subscribe", () => {
		const composer = readFileSync(
			new URL("./components/composer.tsx", import.meta.url),
			"utf8",
		).replace(/\s+/g, " ");
		const subscribe = composer.indexOf(
			"const unsubscribe = subscribeKeyboardFrame((frame) => {",
		);
		const seed = composer.indexOf("const present = keyboardFrameNow();");
		/* Read AFTER subscribing: that is when the store seeds itself. */
		expect(subscribe).toBeGreaterThan(0);
		expect(seed).toBeGreaterThan(subscribe);
		expect(composer).toContain(
			"liftTarget.current = present.visible ? present.overlap : 0; keyboardOffset.value = liftTarget.current;",
		);
		/* Mid-lift boxes are not published, so the screen keeps a settled one. */
		expect(composer).toContain(
			"if (keyboardOverlap !== liftTarget.current) return;",
		);
	});

	it("subscribes to nothing on the web", () => {
		native.os = "web";
		const off = subscribeKeyboardFrame(() => {});
		expect(native.listeners.size).toBe(0);
		off();
	});
});
