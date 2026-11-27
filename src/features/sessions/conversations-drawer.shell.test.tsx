import {
	act,
	createElement,
	isValidElement,
	type ReactNode,
	useEffect,
} from "react";
import { createRoot } from "react-dom/client";
import { View } from "react-native";
import type { SharedValue } from "react-native-reanimated";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type DomShim, installDomShim } from "@/testing/dom-shim";

/**
 * The drawer's SHELL against its CONTENT, and the close drag's end without a
 * drag. Both are wiring facts Node can prove even though it cannot drag:
 * `ConversationsPane` is reduced to a marker that starts its own 60 s timer on
 * mount, and the close pan's callbacks are read back through the recording
 * gesture mock and invoked by hand.
 *
 * WHY THE SPLIT EXISTS (M2). Every touch-down on a top-level screen primes the
 * drawer. When the prime mounted the WHOLE pane, a tap or a vertical scroll also
 * mounted the pane's timer, its tag-catalogue read and a root modal entry, then
 * unmounted them. The shell (the panel's fill) is what touch-down mounts now;
 * the content follows a rightward drag (`reveal`).
 *
 * WHY THE CLOSE PAN NEEDS `onFinalize` (M1). Its `onBegin` takes a running
 * settle over; a touch that never activates (a tap on the list, a scroll) is not
 * a choice, so the settle has to be handed back or the panel stays part-open.
 */
const host = vi.hoisted(() => ({
	paneMounts: 0,
	/** Pane timers started: 0 while only the shell is up. */
	paneTimers: 0,
	entryVisible: [] as boolean[],
}));

vi.mock("react-native", async (importOriginal) => {
	const actual = await importOriginal<typeof import("react-native")>();
	return {
		...actual,
		Platform: { ...actual.Platform, OS: "ios" },
		findNodeHandle: () => null,
		AccessibilityInfo: { setAccessibilityFocus: () => {} },
		BackHandler: {
			addEventListener: () => ({ remove: () => {} }),
		},
	};
});
vi.mock("react-native-gesture-handler", async () => {
	const { gestureHandlerModuleMock } = await import(
		"@/testing/native-gesture-mocks"
	);
	return gestureHandlerModuleMock();
});
vi.mock("react-native-reanimated", async () => {
	const { reanimatedModuleMock } = await import(
		"@/testing/native-gesture-mocks"
	);
	return reanimatedModuleMock();
});
vi.mock("react-native-safe-area-context", () => ({
	useSafeAreaInsets: () => ({
		top: 0,
		bottom: 0,
		left: 0,
		right: 0,
		width: 390,
		height: 844,
	}),
}));
vi.mock("@/ui/appearance", () => ({
	useTokenColor: () => "#000000",
	useReducedMotion: () => false,
	useTheme: () => ({ theme: "light" }),
}));
vi.mock("@/features/sessions/conversations-pane", () => ({
	ConversationsPane: () => {
		host.paneMounts += 1;
		useEffect(() => {
			/* The pane's own 60 s clock (`conversations-pane.tsx`): started here
			 *  so a primed shell can prove it never ran. */
			host.paneTimers += 1;
			const timer = setInterval(() => {}, 60_000);
			return () => clearInterval(timer);
		}, []);
		return null;
	},
	WorkspaceSidebarFooter: () => null,
}));
vi.mock("@/ui/text-scale-provider", () => ({
	TextScaleProvider: ({ children }: { children?: ReactNode }) =>
		children ?? null,
}));
vi.mock("@/ui/components/modal-stack-entry", () => ({
	ModalScopeContext: {
		Provider: ({ children }: { children?: ReactNode }) => children ?? null,
	},
	useModalStackEntry: (visible: boolean) => {
		host.entryVisible.push(visible);
		return {
			covered: false,
			dims: false,
			hostDims: false,
			nested: false,
			scope: { current: null },
		};
	},
}));

const { ConversationsDrawer } = await import(
	"@/features/sessions/conversations-drawer"
);
const { WorkspaceDrawerContext } = await import(
	"@/features/sessions/workspace-drawer-context"
);
const { nativeCalls, panCalls, detectorChildren } = await import(
	"@/testing/native-gesture-mocks"
);

type DrawerContext = NonNullable<
	React.ContextType<typeof WorkspaceDrawerContext>
>;

const progress = { value: 0 } as unknown as SharedValue<number>;

const drawerContext = (): DrawerContext => ({
	mode: "agents",
	progress,
	visible: true,
	open: vi.fn(),
	close: vi.fn(),
	prime: vi.fn(),
	reveal: vi.fn(),
	abandon: vi.fn(),
	settle: vi.fn(),
	resume: vi.fn(),
	selectMode: vi.fn(),
	newChatRequest: 0,
	consumeNewChatRequest: () => false,
	setAgentsPresentation: vi.fn(),
});

let dom: DomShim;
let root: ReturnType<typeof createRoot>;

const mount = async ({
	presented,
	revealed,
	visible = false,
	context = drawerContext(),
}: {
	presented: boolean;
	revealed: boolean;
	visible?: boolean;
	context?: DrawerContext;
}) => {
	await act(async () =>
		root.render(
			createElement(
				WorkspaceDrawerContext.Provider,
				{ value: context },
				createElement(ConversationsDrawer, {
					visible,
					presented,
					revealed,
					progress,
					onClose: vi.fn(),
				}),
			),
		),
	);
	return context;
};

/** The last recorded callback of a pan method (this render's gesture). */
const fire = (name: string) => {
	const args = panCalls.filter((call) => call.name === name).at(-1)?.args as
		| [((...rest: unknown[]) => void)?]
		| undefined;
	args?.[0]?.();
};

beforeEach(() => {
	host.paneMounts = 0;
	host.paneTimers = 0;
	host.entryVisible = [];
	panCalls.length = 0;
	nativeCalls.length = 0;
	detectorChildren.length = 0;
	dom = installDomShim();
	root = createRoot(dom.container as Element);
});
afterEach(async () => {
	await act(async () => root.unmount());
	dom.dispose();
});

describe("the drawer shell without its content", () => {
	it("mounts no pane, starts no timer and registers no modal entry (M2)", async () => {
		await mount({ presented: true, revealed: false });
		expect(host.paneMounts).toBe(0);
		expect(host.paneTimers).toBe(0);
		expect(host.entryVisible.at(-1)).toBe(false);
	});

	it("mounts the pane and its timer once the touch revealed it", async () => {
		await mount({ presented: true, revealed: false });
		await mount({ presented: true, revealed: true });
		expect(host.paneMounts).toBe(1);
		expect(host.paneTimers).toBe(1);
		expect(host.entryVisible.at(-1)).toBe(true);
	});

	it("mounts the pane for the reader's open even if no reveal arrived", async () => {
		/* `open()` reveals as well, but the content must not depend on that one
		 *  path: an open is the reader's intent, and a panel that slides in as an
		 *  empty fill is the round-2 blocker (QA: dim, no rows, no ✕). */
		await mount({ presented: true, revealed: false, visible: true });
		expect(host.paneMounts).toBe(1);
		expect(host.paneTimers).toBe(1);
		expect(host.entryVisible.at(-1)).toBe(true);
	});

	it("hands the close drag a plain host View to attach to", async () => {
		await mount({ presented: true, revealed: true, visible: true });
		const child = detectorChildren.at(-1);
		expect(isValidElement(child)).toBe(true);
		if (!isValidElement(child)) return;
		const element = child as { type: unknown; props: Record<string, unknown> };
		/* RNGH clones this child with `collapsable: false`; an animated component
		 *  did not give the recogniser a host node (QA round 2). */
		expect(element.type).toBe(View);
		expect(element.props.collapsable).toBe(false);
	});
});

describe("the panel's close drag", () => {
	it("hands an interrupted settle back when the touch never drags (M1)", async () => {
		const context = await mount({
			presented: true,
			revealed: true,
			visible: true,
		});
		fire("onBegin");
		expect(context.prime).toHaveBeenCalledOnce();
		/* A tap on the list or a vertical scroll: no `onStart`, so no choice. */
		fire("onFinalize");
		expect(context.resume).toHaveBeenCalledOnce();
		expect(context.settle).not.toHaveBeenCalled();
	});

	it("does not hand anything back after an activated drag", async () => {
		const context = await mount({
			presented: true,
			revealed: true,
			visible: true,
		});
		fire("onBegin");
		fire("onStart");
		fire("onFinalize");
		expect(context.resume).not.toHaveBeenCalled();
		/* The flag is per touch: the NEXT touch that never drags still resumes. */
		fire("onBegin");
		fire("onFinalize");
		expect(context.resume).toHaveBeenCalledOnce();
	});
});
