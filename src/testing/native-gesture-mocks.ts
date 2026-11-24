/**
 * The two native gesture modules `Sheet` now imports, reduced for the Node
 * runner.
 *
 * WHY SHARED, NOT COPIED PER SUITE. `vitest.config.ts` runs components through
 * react-native-web with no native recognisers: reanimated's worklets and
 * gesture-handler's `GestureDetector` do not exist there, and their published
 * entry points are untranspiled native source (`Unexpected token 'typeof'`).
 * Four of the sheet's suites mount the REAL `Sheet`, so the reduction is one
 * module they all use — a mock that drifted between them would let one suite go
 * green about a component tree the others never render.
 *
 * Nothing here decides behaviour a test asserts: the pan's callbacks are never
 * invoked (a Node test cannot drag), and the animated height is the value the
 * worklet would be given, read at render.
 */
import type { ReactNode } from "react";
import { ScrollView, View } from "react-native";

export const reanimatedModuleMock = () => ({
	__esModule: true,
	default: { ScrollView },
	/** A shared value without a UI thread: the write is what a test can read. */
	useSharedValue: <T>(initial: T) => ({ value: initial }),
	useAnimatedStyle: <T extends object>(factory: () => T) => factory(),
	withSpring: <T>(toValue: T) => toValue,
	withTiming: <T>(toValue: T) => toValue,
	cancelAnimation: () => {},
	runOnJS: <A extends unknown[]>(fn: (...args: A) => void) => fn,
});

/** A chainable pan builder: every configuration call returns the same object, so
 *  `Gesture.Pan().minDistance(8).onEnd(…)` builds without a gesture runtime. */
const panBuilder = () => {
	const builder: Record<string, unknown> = {};
	for (const name of [
		"minDistance",
		"failOffsetX",
		"activeOffsetY",
		"onBegin",
		"onStart",
		"onUpdate",
		"onEnd",
		"onFinalize",
	]) {
		builder[name] = () => builder;
	}
	return builder;
};

export const gestureHandlerModuleMock = () => ({
	__esModule: true,
	Gesture: { Pan: panBuilder },
	/* The detector is a wrapper, not a view: the sheet's header keeps the exact
	 *  host a test looks for. */
	GestureDetector: ({ children }: { children?: ReactNode }) => children ?? null,
	GestureHandlerRootView: View,
});

/** What a `useKeyboardHandler` call registered, in call order. */
export type KeyboardHandlers = {
	onStart?: (event: { height: number; progress: number }) => void;
	onMove?: (event: { height: number; progress: number }) => void;
	onInteractive?: (event: { height: number; progress: number }) => void;
	onEnd?: (event: { height: number; progress: number }) => void;
};

/**
 * `react-native-keyboard-controller` reduced for the Node runner (its entry
 * point is untranspiled native source, like reanimated's).
 *
 * `useKeyboardHandler` RECORDS the handlers it is given in `registeredHandlers`,
 * so a test can drive a keyboard motion (`onStart` → `onMove`… → `onEnd`) and read
 * what the component did with it; the library itself never calls them without a
 * native keyboard. The providers are passthroughs, as `GestureDetector` is above.
 */
export const registeredHandlers: KeyboardHandlers[] = [];

export const keyboardControllerModuleMock = () => ({
	__esModule: true,
	KeyboardProvider: ({ children }: { children?: ReactNode }) =>
		children ?? null,
	KeyboardGestureArea: ({ children }: { children?: ReactNode }) =>
		children ?? null,
	useKeyboardHandler: (handlers: KeyboardHandlers) => {
		registeredHandlers.push(handlers);
	},
	KeyboardController: {
		setInputMode: () => {},
		setDefaultMode: () => {},
		dismiss: async () => {},
		isVisible: () => false,
	},
});
