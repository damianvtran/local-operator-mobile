/**
 * The REAL `Sheet` + the REAL attach hand-off against an emulation of iOS's
 * native modal host: when does a picker launch, relative to the sheet's
 * native presentation?
 *
 * WHY THIS EXISTS ("Photo Library / Files does nothing", TestFlight 1333). The
 * hand-off launches a picker from the Sheet's `onDismiss`, and its own tests
 * call `dismissed()` by hand, so they could not see WHEN iOS fires that
 * callback. `useModalExit` sets `exiting` in a passive effect, so a closing
 * Sheet hands its `Modal` `visible=false` for one commit and `visible=true`
 * again on the next (the same blip `sheet-dismiss-timing.test.tsx` pins on the
 * web). iOS's `RCTModalHostViewComponentView` (react-native 0.86,
 * `React/Fabric/Mounting/ComponentViews/Modal/RCTModalHostViewComponentView.mm`,
 * `updateProps` → `ensurePresentedOnlyIfNeeded`) acts on every `visible`
 * change: it dismisses the controller on the `false` commit, presents it again
 * on the `true` one, and fires `onDismiss` from the FIRST dismissal's
 * completion. The picker therefore launched while the sheet's controller was
 * presented again for the exit animation — expo-modules-core's
 * `currentViewController()` walks to it, the picker is presented ON the sheet,
 * and the exit's final dismissal takes it down with the sheet. No delegate
 * callback, no settled promise, no error line.
 *
 * WHAT IS EMULATED. The native host only: each committed `visible` is one
 * `updateProps`, and the dismiss completion is asynchronous (a macrotask), as
 * UIKit's is. React Native's `Modal.js` routes `onDismiss` to the LATEST props'
 * callback, which the emulation does too.
 */
import { act, createElement, type ReactNode, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* `Sheet` imports reanimated and gesture-handler; Node has neither (see the
 * shared reduction's own note). */
vi.mock("react-native-reanimated", async () => {
	const { reanimatedModuleMock } = await import(
		"@/testing/native-gesture-mocks"
	);
	return reanimatedModuleMock();
});
vi.mock("react-native-gesture-handler", async () => {
	const { gestureHandlerModuleMock } = await import(
		"@/testing/native-gesture-mocks"
	);
	return gestureHandlerModuleMock();
});

const native = vi.hoisted(() => ({
	events: [] as string[],
	isPresented: false,
	dismissInFlight: 0,
	finishExit: null as null | (() => void),
	presses: new Map<string, { onPress?: () => void }>(),
	/** Withhold every `onDismiss` (the case #328's fallback exists for). */
	dropDismiss: false,
}));

vi.mock("react-native", async (importOriginal) => {
	const rnw = (await importOriginal()) as Record<string, unknown>;
	const { useLayoutEffect, useRef: useMockRef } = await import("react");
	const Animated = rnw.Animated as Record<string, unknown>;
	/* One `updateProps` per commit, as Fabric's mounting layer applies it. */
	const Modal = (props: {
		visible: boolean;
		onDismiss?: () => void;
		children?: ReactNode;
	}) => {
		const latest = useMockRef(props);
		latest.current = props;
		useLayoutEffect(() => {
			const shouldPresent = props.visible;
			if (!native.isPresented && shouldPresent) {
				native.isPresented = true;
				native.events.push(
					native.dismissInFlight > 0
						? "native:present(during-dismiss)"
						: "native:present",
				);
			}
			if (native.isPresented && !shouldPresent) {
				native.isPresented = false;
				native.dismissInFlight += 1;
				native.events.push("native:dismiss");
				setTimeout(() => {
					native.dismissInFlight -= 1;
					native.events.push("native:dismissed");
					if (!native.dropDismiss) latest.current.onDismiss?.();
				}, 0);
			}
		}, [props.visible]);
		// Modal.js keeps rendering on iOS until the dismissal lands; the rows
		// must exist for the press.
		return props.children ?? null;
	};
	return {
		...rnw,
		Platform: { ...(rnw.Platform as object), OS: "ios" },
		Modal,
		Pressable: (props: { testID?: string; onPress?: () => void }) => {
			if (props.testID) native.presses.set(props.testID, props);
			return null;
		},
		Animated: {
			...Animated,
			parallel: () => ({
				start: (done?: (r: { finished: boolean }) => void) => {
					native.finishExit = () => done?.({ finished: true });
				},
				stop: () => {},
			}),
			timing: () => ({ start: () => {}, stop: () => {} }),
		},
	};
});
vi.mock("lucide-react-native", () => ({ X: () => null }));
vi.mock("@/lib/haptics", () => ({ haptic: () => {} }));
vi.mock("@/ui/appearance", async (importOriginal) => ({
	...((await importOriginal()) as object),
	useTheme: () => ({ theme: "light" }),
	useTokenColor: () => "#137742",
	useReducedMotion: () => false,
}));
vi.mock("react-native-safe-area-context", () => ({
	useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock("react-native-svg", () => {
	const none = () => null;
	return {
		__esModule: true,
		default: none,
		Defs: none,
		LinearGradient: none,
		Rect: none,
		Stop: none,
	};
});
vi.mock("uniwind", () => ({
	ScopedVariables: ({ children }: { children?: ReactNode }) => children ?? null,
	Uniwind: { setTheme: () => {}, updateCSSVariables: () => {} },
	useCSSVariable: () => undefined,
}));

const { installDomShim } = await import("@/testing/dom-shim");
const { Sheet } = await import("@/ui/components/sheet");
const { createAttachmentSheetHandoff, DISMISS_FALLBACK_MS } = await import(
	"@/features/session/attach-handoff"
);
const { Pressable } = await import("react-native");

/**
 * The composer's attach wiring (`composer.tsx`, `attachSheet`), reduced to the
 * parts the timing depends on: the row closes the sheet, marks the close as a
 * hand-off, and queues the launch on the hand-off; the Sheet's `onDismiss` is
 * the hand-off's. The composer itself needs the native renderer; its source is
 * pinned to this same wiring in `attachment-handoff.test.ts`.
 */
let openSheet: () => void = () => {};
/* The owner's wiring knobs. `instant: false` is the RED control (review R3):
 *  the same owner without #354's instant close, so the suite itself shows the
 *  emulation tells the two apart. `traces` is #328's diagnostics trail, which
 *  Copy diagnostics reads to say which path launched the picker. */
const wiring = {
	instant: true,
	traces: [] as Array<{ via: string; afterHiddenMs: number | null }>,
};
const Owner = () => {
	const [open, setOpen] = useState(false);
	const [handingOff, setHandingOff] = useState(false);
	const handoff = useRef(
		createAttachmentSheetHandoff((event) => wiring.traces.push(event)),
	).current;
	openSheet = () => {
		handoff.cancel();
		setHandingOff(false);
		setOpen(true);
	};
	const row = createElement(Pressable, {
		testID: "row-library",
		onPress: () => {
			setHandingOff(true);
			setOpen(false);
			handoff.choose(() => {
				native.events.push(
					native.isPresented || native.dismissInFlight > 0
						? "launch(onto-sheet)"
						: "launch",
				);
			}, "ios");
		},
	});
	const props = {
		visible: open,
		onClose: () => setOpen(false),
		onDismiss: handoff.dismissed,
		// #328: arms the 1 s fallback from the commit that let the Modal go.
		onHidden: handoff.hidden,
		exitInstantly: wiring.instant && handingOff,
		title: "attach",
		children: row,
	};
	return createElement(Sheet, props);
};

describe("iOS attach sheet → system picker, against the native modal host", () => {
	let dom: ReturnType<typeof installDomShim>;
	let root: ReturnType<typeof createRoot>;

	beforeEach(() => {
		vi.useFakeTimers();
		native.events = [];
		native.isPresented = false;
		native.dismissInFlight = 0;
		native.finishExit = null;
		native.presses.clear();
		native.dropDismiss = false;
		wiring.instant = true;
		wiring.traces = [];
		dom = installDomShim();
		root = createRoot(dom.container as Element);
	});
	afterEach(async () => {
		await act(async () => root.unmount());
		await act(async () => {
			vi.runOnlyPendingTimers();
		});
		dom.dispose();
		vi.useRealTimers();
	});

	const pressLibrary = async () => {
		await act(async () => root.render(createElement(Owner)));
		await act(async () => openSheet());
		expect(native.events).toEqual(["native:present"]);
		await act(async () => native.presses.get("row-library")?.onPress?.());
		// Every native completion and the exit's own end, in order.
		for (let i = 0; i < 4; i += 1) {
			await act(async () => {
				vi.runOnlyPendingTimers();
			});
			await act(async () => native.finishExit?.());
		}
	};

	it("launches the picker exactly once, after the sheet's ONLY native dismissal", async () => {
		await pressLibrary();
		expect(native.events).toEqual([
			"native:present",
			"native:dismiss",
			"native:dismissed",
			"launch",
		]);
	});

	it("is ready for a second attach: reopening presents the sheet again", async () => {
		await pressLibrary();
		native.events = [];
		await act(async () => openSheet());
		expect(native.events).toEqual(["native:present"]);
		expect(native.isPresented).toBe(true);
	});

	/* PR #354 round 2: #328 (onHidden → 1 s fallback, consume-once, trace)
	 *  composed with #354's instant close. The instant close reports hidden on
	 *  the close commit itself, so the fallback is armed BEFORE onDismiss; the
	 *  one native dismissal's onDismiss must launch, disarm it, and leave no
	 *  second launch however long the timers run. */
	it("with #328's fallback armed, onDismiss launches once and the fallback never fires", async () => {
		await pressLibrary();
		await act(async () => {
			vi.advanceTimersByTime(DISMISS_FALLBACK_MS * 3);
		});
		expect(native.events).toEqual([
			"native:present",
			"native:dismiss",
			"native:dismissed",
			"launch",
		]);
		// Copy diagnostics: launched by onDismiss, measured from the hide.
		expect(wiring.traces).toEqual([{ via: "onDismiss", afterHiddenMs: 0 }]);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("still falls back once, after the sheet is gone, when onDismiss never comes", async () => {
		native.dropDismiss = true;
		// `pressLibrary` drains pending timers, which includes the fallback's.
		await pressLibrary();
		await act(async () => {
			vi.advanceTimersByTime(DISMISS_FALLBACK_MS * 3);
		});
		expect(native.events).toEqual([
			"native:present",
			"native:dismiss",
			"native:dismissed",
			"launch",
		]);
		expect(wiring.traces).toEqual([
			{ via: "fallback", afterHiddenMs: DISMISS_FALLBACK_MS },
		]);
	});

	it("RED control: without the instant close the picker launches onto the re-presented sheet", async () => {
		wiring.instant = false;
		await pressLibrary();
		expect(native.events).toContain("native:present(during-dismiss)");
		expect(native.events).toContain("launch(onto-sheet)");
		/* The device signature QA and review named: onDismiss before any hide,
		 *  so the trail reads `onDismiss ?ms`. */
		expect(wiring.traces[0]).toEqual({ via: "onDismiss", afterHiddenMs: null });
	});
});
