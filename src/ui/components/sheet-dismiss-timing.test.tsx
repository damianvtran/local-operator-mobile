/**
 * The REAL `Sheet` against react-native-web's REAL `ModalAnimation`: when does a
 * web `onDismiss` reach the caller?
 *
 * WHY THIS EXISTS (PR #339 round 2 — UX U1, design D1, QA Q2). The Team Bridge
 * actions sheet defers "Reply in thread" to `onDismiss` so the pushed thread's
 * composer is not robbed of focus by the closing sheet's focus trap. Its unit
 * test mocked `Sheet` and called `onDismiss` by hand, so it could not see that
 * the kit's web `onDismiss` fired at the START of the exit animation: for the
 * one commit before `useModalExit` sets `exiting`, RNW's Modal is handed
 * `visible=false`, and with `animationType="none"` `ModalAnimation` reports a
 * dismissal at once, although the next commit shows it again and the surface
 * stays mounted for the whole exit (hosted web export: navigation ~20 ms after
 * the tap, sheet out of the DOM at ~130 ms, composer focus lost 10 of 10).
 *
 * WHAT IS REAL AND WHAT IS NOT. `Sheet`, `useModalExit`, the modal stack, the
 * dismissal ledger and RNW's `ModalAnimation` (the component that decides when
 * `onDismiss` fires) are real. RNW's `Modal` wrapper is reduced to that
 * `ModalAnimation`: its portal and focus trap need a real document, which this
 * Node runner does not have (`vitest.config.ts`, ADR 0003). `Animated.parallel`
 * is captured so the test, not a frame clock, ends the exit animation.
 */
import { act, createElement, type ReactNode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SheetProps } from "@/ui/components/sheet";

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

const rec = vi.hoisted(() => ({
	events: [] as string[],
	/** The last `Animated.parallel`'s completion callback. The entry uses one
	 *  too, so each test clears it after opening: set again = the exit started. */
	finishExit: null as null | (() => void),
	reduceMotion: false,
	/** The last props each `Pressable` received, by testID. */
	presses: new Map<string, { onPress?: () => void }>(),
}));

vi.mock("react-native", async (importOriginal) => {
	const rnw = (await importOriginal()) as Record<string, unknown>;
	const { createElement, useEffect: useMountEffect } = await import("react");
	const ModalAnimation = (
		(await import(
			// @ts-expect-error untyped deep import: RNW ships no declaration for it.
			"react-native-web/dist/exports/Modal/ModalAnimation"
		)) as { default: (props: unknown) => ReactNode }
	).default;
	const Animated = rnw.Animated as Record<string, unknown>;
	/* What the Modal draws, logging its own mount and unmount: "the surface is
	 *  in the DOM" for this runner. */
	const Surface = ({ children }: { children?: ReactNode }) => {
		useMountEffect(() => {
			rec.events.push("surface:mounted");
			return () => {
				rec.events.push("surface:unmounted");
			};
		}, []);
		return children ?? null;
	};
	return {
		...rnw,
		Platform: { ...(rnw.Platform as object), OS: "web" },
		Modal: (props: {
			visible: boolean;
			onDismiss?: () => void;
			onShow?: () => void;
			children?: ReactNode;
		}) =>
			createElement(ModalAnimation as never, {
				animationType: "none",
				visible: props.visible,
				onDismiss: props.onDismiss,
				onShow: props.onShow,
				children: createElement(Surface, null, props.children),
			}),
		/* Recorded, so a test can press an action row: the shim has no events. */
		Pressable: (props: { testID?: string; onPress?: () => void }) => {
			if (props.testID) rec.presses.set(props.testID, props);
			return null;
		},
		Animated: {
			...Animated,
			parallel: () => ({
				start: (done?: (r: { finished: boolean }) => void) => {
					rec.finishExit = () => done?.({ finished: true });
				},
				stop: () => {},
			}),
			timing: () => ({ start: () => {}, stop: () => {} }),
		},
	};
});
vi.mock("lucide-react-native", () => ({
	X: () => null,
	Copy: () => null,
	MessageSquareReply: () => null,
	TextCursor: () => null,
}));
vi.mock("@/lib/haptics", () => ({ haptic: () => {} }));
/* The sheet hook reads the Team Bridge store for its quick-reaction row
 *  (reactions slice PR b). This file pins dismissal timing only, with
 *  reactions off, so a fixed snapshot stands in for the provider (whose real
 *  import graph is native). */
vi.mock("@/team-bridge/provider", () => {
	const state = {
		reactionsUnserved: false,
		selfAccountId: null,
		reactionPending: {},
		reactionFailed: {},
	};
	return {
		useTeamBridge: () => ({ actions: {}, store: { getState: () => state } }),
		useTeamBridgeState: (select: (s: typeof state) => unknown) => select(state),
	};
});
vi.mock("expo-clipboard", () => ({ setStringAsync: async () => true }));
vi.mock("@/ui/appearance", async (importOriginal) => ({
	...((await importOriginal()) as object),
	useTheme: () => ({ theme: "light" }),
	useTokenColor: () => "#137742",
	useReducedMotion: () => rec.reduceMotion,
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
const { useMessageActions } = await import(
	"@/features/team-bridge/message-actions-sheet"
);
const { message: fixture, SELF } = await import(
	"@/team-bridge/__tests__/fixtures"
);
const { teamBridgeMessageActionId } = await import("@/ui/a11y");

describe("Sheet web onDismiss timing", () => {
	let dom: ReturnType<typeof installDomShim>;
	let root: ReturnType<typeof createRoot>;
	/* `children` is required by `SheetProps` and biome's noChildrenProp bars it
	 *  inside `createElement`, so the fixed props live here (the ledger test's
	 *  pattern). */
	const props = {
		title: "Message actions",
		onClose: () => {
			rec.events.push("close");
		},
		onDismiss: () => {
			rec.events.push("dismiss");
		},
		children: null,
	} satisfies Omit<SheetProps, "visible">;
	const render = (visible: boolean) =>
		act(async () => root.render(createElement(Sheet, { ...props, visible })));

	beforeEach(() => {
		vi.useFakeTimers();
		rec.events = [];
		rec.finishExit = null;
		rec.reduceMotion = false;
		rec.presses.clear();
		dom = installDomShim();
		root = createRoot(dom.container as Element);
	});
	afterEach(async () => {
		await act(async () => root.unmount());
		dom.dispose();
		vi.useRealTimers();
	});

	it("does not report a dismissal while the exit keeps the surface mounted", async () => {
		await render(true);
		expect(rec.events).toEqual(["surface:mounted"]);
		rec.finishExit = null;
		await render(false);
		// The exit has started and the surface is still there: nothing is owed yet.
		expect(rec.finishExit).not.toBeNull();
		expect(rec.events).toEqual(["surface:mounted"]);
		await act(async () => rec.finishExit?.());
		// Only now, after the surface left, and exactly once.
		expect(rec.events).toEqual([
			"surface:mounted",
			"surface:unmounted",
			"dismiss",
		]);
	});

	it("still dismisses when the exit ends on its fallback timer", async () => {
		await render(true);
		await render(false);
		await act(async () => {
			vi.advanceTimersByTime(1_000);
		});
		expect(rec.events).toEqual([
			"surface:mounted",
			"surface:unmounted",
			"dismiss",
		]);
	});

	it("dismisses straight away when there is no exit (reduced motion)", async () => {
		rec.reduceMotion = true;
		await render(true);
		rec.finishExit = null;
		await render(false);
		expect(rec.finishExit).toBeNull();
		expect(rec.events).toEqual([
			"surface:mounted",
			"surface:unmounted",
			"dismiss",
		]);
	});
});

/**
 * The Team Bridge seam the round-2 finding was measured on: "Reply in thread"
 * through the REAL `useMessageActions` and the REAL `Sheet`. The reply thread
 * (and its `autoFocus` composer) must mount only after the sheet's surface —
 * and with it the focus trap and the scrim that took the composer's focus on
 * the hosted export — has left. Node has no focus to read (`dom-shim`: no
 * focus, no events), so the order of mounts is what is asserted here; the
 * focus itself is the web export's QA row.
 */
describe("Team Bridge Reply in thread on the real Sheet (web)", () => {
	let dom: ReturnType<typeof installDomShim>;
	let root: ReturnType<typeof createRoot>;
	let controller: ReturnType<typeof useMessageActions>["controller"] | null;
	const ROOT = fixture(1, SELF, "2026-11-18T09:00:00Z", { body: "Ship it" });

	/** Mounts with the reply thread, as the pushed route's composer would. */
	const Composer = () => {
		useEffect(() => {
			rec.events.push("composer:mounted");
		}, []);
		return null;
	};
	const Screen = () => {
		const [thread, setThread] = useState<string | null>(null);
		const actions = useMessageActions({
			scope: "timeline",
			tenantId: "ten_x",
			canReplyInThread: true,
			canReact: false,
			onReplyInThread: (id) => {
				rec.events.push(`push:${id}`);
				setThread(id);
			},
		});
		controller = actions.controller;
		return createElement(
			"main",
			null,
			actions.sheet,
			thread ? createElement(Composer) : null,
		);
	};

	beforeEach(() => {
		vi.useFakeTimers();
		rec.events = [];
		rec.finishExit = null;
		rec.reduceMotion = false;
		rec.presses.clear();
		controller = null;
		dom = installDomShim();
		root = createRoot(dom.container as Element);
	});
	afterEach(async () => {
		await act(async () => root.unmount());
		dom.dispose();
		vi.useRealTimers();
	});

	it("mounts the thread composer only after the sheet surface has left", async () => {
		await act(async () => root.render(createElement(Screen)));
		await act(async () => controller?.open(ROOT));
		expect(rec.events).toEqual(["surface:mounted"]);
		rec.finishExit = null;
		const row = rec.presses.get(teamBridgeMessageActionId("reply_in_thread"));
		await act(async () => row?.onPress?.());
		// Closing, still on screen: nothing has navigated yet.
		expect(rec.finishExit).not.toBeNull();
		expect(rec.events).toEqual(["surface:mounted"]);
		await act(async () => rec.finishExit?.());
		expect(rec.events).toEqual([
			"surface:mounted",
			"surface:unmounted",
			`push:${ROOT.id}`,
			"composer:mounted",
		]);
	});
});
