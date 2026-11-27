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
import { useRef } from "react";
import { ScrollView, View } from "react-native";

export const reanimatedModuleMock = () => ({
	__esModule: true,
	default: { ScrollView, View },
	/** A shared value without a UI thread: the write is what a test can read.
	 *  Held in a ref, like the real hook — a new object every render would make
	 *  every callback that reads it a new identity, and an effect keyed on one
	 *  (the drawer's open) would fire again on each render. */
	useSharedValue: <T>(initial: T) => {
		const value = useRef({ value: initial });
		return value.current;
	},
	useAnimatedStyle: <T extends object>(factory: () => T) => factory(),
	/** The reaction runs once with the clock's initial value; a Node test cannot
	 *  tick it, and nothing it does here is an assertion about motion. */
	useAnimatedReaction: <T>(prepare: () => T, react: (value: T) => void) => {
		react(prepare());
	},
	withSpring: <T>(toValue: T) => toValue,
	/** The timing never runs here, so its COMPLETION is what a test can drive:
	 *  the callbacks are recorded in order and the last one fired is the settle
	 *  a test wants to finish (the drawer's close, usually). */
	withTiming: <T>(
		toValue: T,
		_config?: unknown,
		callback?: (finished?: boolean) => void,
	) => {
		if (callback) timingCompletions.push(callback);
		return toValue;
	},
	cancelAnimation: () => {},
	runOnJS: <A extends unknown[]>(fn: (...args: A) => void) => fn,
	Easing: { linear: (value: number) => value },
});

/** Every `withTiming` completion, in call order (`reanimatedModuleMock`). */
export const timingCompletions: Array<(finished?: boolean) => void> = [];

/** A chainable pan builder: every configuration call returns the same object, so
 *  `Gesture.Pan().minDistance(8).onEnd(…)` builds without a gesture runtime.
 *
 *  Every call is RECORDED, because the page swipe's thresholds and the claim's
 *  `blocksExternalGesture` are the two facts a Node test can prove about
 *  arbitration (the recognisers themselves only exist on a device): the test
 *  reads back what the component actually configured. */
export type RecordedGestureCall = { name: string; args: unknown[] };

export const panCalls: RecordedGestureCall[] = [];
export const nativeCalls: RecordedGestureCall[] = [];

const recordingBuilder = (calls: RecordedGestureCall[]) => {
	const builder: Record<string, unknown> = {};
	for (const name of [
		"minDistance",
		"activeOffsetX",
		"failOffsetX",
		"activeOffsetY",
		"failOffsetY",
		"hitSlop",
		"enabled",
		"withRef",
		"manualActivation",
		"blocksExternalGesture",
		"simultaneousWithExternalGesture",
		"requireExternalGestureToFail",
		"onBegin",
		"onStart",
		"onUpdate",
		"onEnd",
		"onFinalize",
		"onTouchesDown",
		"onTouchesMove",
		"onTouchesUp",
		"onTouchesCancelled",
	]) {
		builder[name] = (...args: unknown[]) => {
			calls.push({ name, args });
			return builder;
		};
	}
	return builder;
};

const panBuilder = () => recordingBuilder(panCalls);
const nativeBuilder = () => recordingBuilder(nativeCalls);

export const gestureHandlerModuleMock = () => ({
	__esModule: true,
	Gesture: { Pan: panBuilder, Native: nativeBuilder },
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
