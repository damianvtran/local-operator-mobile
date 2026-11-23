/**
 * The View options sheet's way out to Settings, against an emulation of iOS's
 * native modal hosts — TWO of them, the sheet's nested inside the drawer's.
 *
 * WHY THIS EXISTS ("More sidebar settings" left Settings dead behind an
 * invisible modal, 2026-11-22 report; verified on the simulator). The old
 * footer ran `setOpen(false)`; `onNavigate()`; `router.push(…)` in one tick.
 * The sheet is a `Modal` rendered INSIDE the drawer's `Modal`, so two nested
 * dismissals began together and iOS left one controller presented over
 * Settings: the page was dead and its accessibility tree empty. The fix
 * (`sidebar-view-handoff.ts`) closes the sheet in one commit and moves the
 * drawer close and the push onto the sheet's own `onDismiss`.
 *
 * WHAT IS EMULATED. The native host only, one per `Modal`: each committed
 * `visible` is one `updateProps`, and a dismissal completion is asynchronous (a
 * macrotask), as UIKit's is. On top of that, the REPORTED device outcome of two
 * overlapping nested dismissals — one controller left presented — is recorded
 * as `ghost` on the first dismissal that begins while another host's is still
 * in flight. That flag is the emulation's model of the bug, not a claim about
 * UIKit internals; the ordering assertions are the real subject.
 *
 * The RED control renders the SAME two-host harness with the OLD wiring, so
 * the suite shows this emulation tells the two apart.
 */
import { act, createElement, type ReactNode, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type HostName = "drawer" | "sheet";
const hosts = () => ({
	drawer: { isPresented: false, dismissInFlight: 0, dropDismiss: false },
	sheet: { isPresented: false, dismissInFlight: 0, dropDismiss: false },
});

const native = vi.hoisted(() => ({
	hosts: {
		drawer: { isPresented: false, dismissInFlight: 0, dropDismiss: false },
		sheet: { isPresented: false, dismissInFlight: 0, dropDismiss: false },
	} as Record<
		"drawer" | "sheet",
		{ isPresented: boolean; dismissInFlight: number; dropDismiss: boolean }
	>,
	events: [] as string[],
	finishExit: null as null | (() => void),
	presses: new Map<string, { onPress?: () => void }>(),
	pushes: 0,
	/** Two nested dismissals overlapped: iOS leaves one presented. */
	ghost: false,
}));

vi.mock("react-native", async (importOriginal) => {
	const rnw = (await importOriginal()) as Record<string, unknown>;
	const { useLayoutEffect, useRef: useMockRef } = await import("react");
	const Animated = rnw.Animated as Record<string, unknown>;
	/* One `updateProps` per commit, as Fabric's mounting layer applies it. Each
	 *  Modal is ONE host; `host` names the drawer's, the sheet's is the default. */
	const Modal = (props: {
		host?: "drawer" | "sheet";
		visible: boolean;
		onDismiss?: () => void;
		children?: ReactNode;
	}) => {
		const name = props.host ?? "sheet";
		const host = native.hosts[name];
		const latest = useMockRef(props);
		latest.current = props;
		useLayoutEffect(() => {
			if (!host.isPresented && props.visible) {
				host.isPresented = true;
				native.events.push(
					host.dismissInFlight > 0
						? `${name}:present(during-dismiss)`
						: `${name}:present`,
				);
			}
			if (host.isPresented && !props.visible) {
				host.isPresented = false;
				host.dismissInFlight += 1;
				const others = Object.entries(native.hosts)
					.filter(
						([other, state]) => other !== name && state.dismissInFlight > 0,
					)
					.map(([other]) => other);
				native.events.push(
					others.length > 0
						? `${name}:dismiss(while ${others.join(",")} dismissing)`
						: `${name}:dismiss`,
				);
				if (others.length > 0) native.ghost = true;
				setTimeout(() => {
					host.dismissInFlight -= 1;
					native.events.push(`${name}:dismissed`);
					if (!host.dropDismiss) latest.current.onDismiss?.();
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
const { useSidebarViewHandoff } = await import(
	"@/features/sessions/sidebar-view-handoff"
);
const { DISMISS_FALLBACK_MS } = await import(
	"@/features/session/attach-handoff"
);
const { ModalScopeContext, useModalStackEntry } = await import(
	"@/ui/components/modal-stack-entry"
);

type HostModalProps = {
	host?: HostName;
	visible: boolean;
	onDismiss?: () => void;
	children?: ReactNode;
};
/* The MOCKED `Modal`: read through the module registry so this file sees the
 *  replacement above, never the real one. */
const { Modal: HostModal, Pressable } = (await import(
	"react-native"
)) as unknown as {
	Modal: (props: HostModalProps) => ReactNode;
	Pressable: (props: { testID?: string; onPress?: () => void }) => ReactNode;
};
/* The sheet needs a body; its rows are the controls, which this file does not
 *  render (they are not what the dismissal ordering depends on). */
const Empty = () => null;
const body = createElement(Empty);

/** The pane's `onNavigate` (close the drawer) and the footer's push. Both say
 *  whether they started while the sheet was still presented. */
const leave = (close: () => void) => {
	native.events.push(
		native.hosts.sheet.isPresented ? "navigate(over-sheet)" : "navigate",
	);
	close();
	push();
};
const push = () => {
	native.pushes += 1;
	native.events.push(
		native.hosts.sheet.isPresented ? "push(over-sheet)" : "push",
	);
};

/** The conversations drawer, reduced to what the nesting depends on: a root
 *  `Modal`, its scope published to the sheet inside it, and its own visibility
 *  (`conversations-drawer.tsx`). */
const Drawer = ({
	open,
	children,
}: {
	open: boolean;
	children?: ReactNode;
}) => {
	const { covered, scope } = useModalStackEntry(open, { scrim: true });
	return createElement(
		ModalScopeContext.Provider,
		{ value: scope },
		createElement(
			HostModal,
			{ host: "drawer", visible: open && !covered },
			children,
		),
	);
};

let openSheet: () => void = () => {};
let closeSheet: () => void = () => {};
/** The instant close, as a knob: `false` is the control for a sheet opened
 *  OUTSIDE any registered modal (the split-layout pane header), where nothing
 *  else refuses the exit. */
const wiring = { instant: true };

/** The fixed wiring: `SidebarViewButton`'s hook and sheet props, verbatim. */
const FixedOwner = () => {
	const [drawerOpen, setDrawerOpen] = useState(true);
	const sheet = useSidebarViewHandoff();
	openSheet = sheet.openSheet;
	closeSheet = sheet.closeSheet;
	const props = {
		visible: sheet.open,
		onClose: sheet.closeSheet,
		onDismiss: sheet.onDismiss,
		onHidden: sheet.onHidden,
		exitInstantly: sheet.exitInstantly,
		title: "View options",
		footer: createElement(Pressable, {
			testID: "more-settings",
			onPress: () =>
				sheet.moreSettings(() => leave(() => setDrawerOpen(false))),
		}),
		children: body,
	};
	return createElement(
		Drawer,
		{ open: drawerOpen },
		createElement(Sheet, props),
	);
};

/** The sheet with NO drawer around it — the split-layout pane header, where
 *  no other registration refuses the exit. `wiring.instant` is the knob. */
const BareOwner = () => {
	const sheet = useSidebarViewHandoff();
	openSheet = sheet.openSheet;
	const props = {
		visible: sheet.open,
		onClose: sheet.closeSheet,
		onDismiss: sheet.onDismiss,
		onHidden: sheet.onHidden,
		exitInstantly: wiring.instant && sheet.exitInstantly,
		title: "View options",
		footer: createElement(Pressable, {
			testID: "more-settings",
			onPress: () => sheet.moreSettings(() => leave(() => undefined)),
		}),
		children: body,
	};
	return createElement(Sheet, props);
};

/** RED control: the wiring this fix replaced — close the sheet, close the
 *  drawer and push in one tick, with nothing waiting for the sheet. */
const OldOwner = () => {
	const [drawerOpen, setDrawerOpen] = useState(true);
	const [open, setOpen] = useState(false);
	openSheet = () => setOpen(true);
	const props = {
		visible: open,
		onClose: () => setOpen(false),
		title: "View options",
		footer: createElement(Pressable, {
			testID: "more-settings",
			onPress: () => {
				setOpen(false);
				leave(() => setDrawerOpen(false));
			},
		}),
		children: body,
	};
	return createElement(
		Drawer,
		{ open: drawerOpen },
		createElement(Sheet, props),
	);
};

describe("the View options sheet's hand-off to Settings, against native hosts", () => {
	let dom: ReturnType<typeof installDomShim>;
	let root: ReturnType<typeof createRoot>;

	beforeEach(() => {
		vi.useFakeTimers();
		native.hosts = hosts();
		native.events = [];
		native.finishExit = null;
		native.presses.clear();
		native.pushes = 0;
		native.ghost = false;
		wiring.instant = true;
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

	/* Every native completion and the exit's own end, in order. */
	const drain = async () => {
		for (let i = 0; i < 4; i += 1) {
			await act(async () => {
				vi.runOnlyPendingTimers();
			});
			await act(async () => native.finishExit?.());
		}
	};

	/** Mount the owner, open the sheet, then press its footer link. */
	const pressMore = async (Owner: () => ReactNode) => {
		await act(async () => root.render(createElement(Owner)));
		await act(async () => openSheet());
		expect(native.events).toEqual(["drawer:present", "sheet:present"]);
		await act(async () => native.presses.get("more-settings")?.onPress?.());
	};

	const index = (event: string) => native.events.indexOf(event);

	it("closes the drawer and pushes only after the sheet's native dismissal", async () => {
		await pressMore(FixedOwner);
		await drain();
		expect(native.events).toEqual([
			"drawer:present",
			"sheet:present",
			"sheet:dismiss",
			"sheet:dismissed",
			"navigate",
			"push",
			"drawer:dismiss",
			"drawer:dismissed",
		]);
		expect(native.pushes).toBe(1);
		expect(native.ghost).toBe(false);
		/* The bug, as an assertion: nothing leaves the drawer for Settings while
		 *  the sheet's own dismissal is in flight. */
		expect(index("navigate")).toBeGreaterThan(index("sheet:dismissed"));
		expect(index("drawer:dismiss")).toBeGreaterThan(index("sheet:dismissed"));
	});

	/* #248's fallback, reused: a lost `onDismiss` must still leave the drawer. */
	it("with the sheet's onDismiss withheld, the 1 s fallback navigates once", async () => {
		native.hosts.sheet.dropDismiss = true;
		await pressMore(FixedOwner);
		// The native dismissal completes; no callback arrives.
		await act(async () => {
			vi.advanceTimersByTime(0);
		});
		expect(native.events).toEqual([
			"drawer:present",
			"sheet:present",
			"sheet:dismiss",
			"sheet:dismissed",
		]);
		// Not before the fallback's own wait is up.
		await act(async () => {
			vi.advanceTimersByTime(DISMISS_FALLBACK_MS - 1);
		});
		expect(native.pushes).toBe(0);
		await act(async () => {
			vi.advanceTimersByTime(1);
		});
		await drain();
		expect(native.events).toEqual([
			"drawer:present",
			"sheet:present",
			"sheet:dismiss",
			"sheet:dismissed",
			"navigate",
			"push",
			"drawer:dismiss",
			"drawer:dismissed",
		]);
		expect(native.pushes).toBe(1);
		expect(native.ghost).toBe(false);
	});

	it("a plain close (scrim) navigates nowhere, and a reopen still hands off once", async () => {
		await act(async () => root.render(createElement(FixedOwner)));
		await act(async () => openSheet());
		// The scrim's `onClose`: no choice was made, so nothing may be queued.
		await act(async () => closeSheet());
		await drain();
		expect(native.events).toEqual([
			"drawer:present",
			"sheet:present",
			"sheet:dismiss",
			"sheet:dismissed",
		]);
		expect(native.pushes).toBe(0);
		native.events = [];
		// A reopen is a fresh open: its hand-off must still fire exactly once.
		await act(async () => openSheet());
		await act(async () => native.presses.get("more-settings")?.onPress?.());
		await drain();
		expect(native.events).toEqual([
			"sheet:present",
			"sheet:dismiss",
			"sheet:dismissed",
			"navigate",
			"push",
			"drawer:dismiss",
			"drawer:dismissed",
		]);
		expect(native.pushes).toBe(1);
	});

	it("RED control: the old one-tick wiring overlaps both dismissals", async () => {
		await pressMore(OldOwner);
		await drain();
		/* The route changes while the sheet is still presented, and the drawer's
		 *  dismissal begins inside the sheet's: the reported device signature. */
		expect(native.events).toContain("navigate(over-sheet)");
		expect(native.events).toContain("push(over-sheet)");
		expect(native.events).toContain("drawer:dismiss(while sheet dismissing)");
		expect(native.ghost).toBe(true);
	});

	/* Outside the drawer nothing else refuses the exit (`useModalExit`'s
	 *  `shouldAnimateExit` sees no other registration), so `exitInstantly` is
	 *  what keeps the sheet to ONE visible edge there. */
	it("without a drawer around it, the instant close keeps the push off a re-presented sheet", async () => {
		await act(async () => root.render(createElement(BareOwner)));
		await act(async () => openSheet());
		expect(native.events).toEqual(["sheet:present"]);
		await act(async () => native.presses.get("more-settings")?.onPress?.());
		await drain();
		expect(native.events).toEqual([
			"sheet:present",
			"sheet:dismiss",
			"sheet:dismissed",
			"navigate",
			"push",
		]);
		expect(native.pushes).toBe(1);
	});

	it("RED control: with the animated close, the push lands on the re-presented sheet", async () => {
		wiring.instant = false;
		await act(async () => root.render(createElement(BareOwner)));
		await act(async () => openSheet());
		await act(async () => native.presses.get("more-settings")?.onPress?.());
		await drain();
		/* The exit's `visible=false` blip dismissed the controller while the
		 *  sheet was presented again for the animation: `onDismiss` fired from
		 *  that first dismissal, so the route was pushed under a sheet that was
		 *  still on screen. */
		expect(native.events).toContain("sheet:present(during-dismiss)");
		expect(native.events).toContain("push(over-sheet)");
	});
});
