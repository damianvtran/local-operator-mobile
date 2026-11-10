import { act, createElement, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHomeDrawer } from "@/features/home/use-home-drawer";
import { type DomShim, installDomShim } from "@/testing/dom-shim";
import { CONTROL } from "@/ui/a11y";
import { layoutFor, sidebarWidthFor } from "@/ui/size-class";
import { TOUCH_TARGET } from "@/ui/tokens.gen";
import type { ConversationsDrawerProps } from "./conversations-drawer";
import type { WorkspaceDrawerBridgeAdapter } from "./workspace-drawer.contract";

const host = vi.hoisted(() => ({
	path: "/session/synthetic-chat",
	isHomeFocused: vi.fn(() => true),
	platform: "web",
	navigate: vi.fn(),
	dismiss: vi.fn(),
	drawer: null as ConversationsDrawerProps | null,
	presses: new Map<string, () => void>(),
	labels: new Map<string, string>(),
	badges: [] as string[],
	badgeTones: [] as string[],
	unread: { count: 7, state: "ready" } as unknown,
	mounts: 0,
	unmounts: 0,
	persistentRows: 0,
}));
vi.mock("expo-router", () => ({
	useFocusEffect: (effect: () => undefined | (() => void)) => {
		const focused = host.isHomeFocused();
		useEffect(() => {
			if (focused) return effect();
		}, [effect, focused]);
	},
	usePathname: () => host.path,
	useRouter: () => ({ navigate: host.navigate }),
}));
vi.mock("lucide-react-native", () => ({ Menu: () => null, X: () => null }));
vi.mock("react-native", () => ({
	Platform: {
		get OS() {
			return host.platform;
		},
	},
	Keyboard: { dismiss: host.dismiss },
	View: ({ children }: { children?: import("react").ReactNode }) =>
		children ?? null,
	Text: ({ children }: { children?: import("react").ReactNode }) =>
		children ?? null,
	Pressable: (props: {
		children?:
			| import("react").ReactNode
			| ((state: { pressed: boolean }) => import("react").ReactNode);
		testID: string;
		onPress: () => void;
		accessibilityLabel: string;
	}) => {
		host.presses.set(props.testID, props.onPress);
		host.labels.set(props.testID, props.accessibilityLabel);
		const content =
			typeof props.children === "function"
				? props.children({ pressed: false })
				: props.children;
		return content ?? null;
	},
}));
vi.mock("@/features/auth/connection-provider", () => ({
	useLocaleFrame: () => "en",
	useListState: (select: (state: unknown) => unknown) =>
		select({ unread: host.unread }),
}));
vi.mock("@/ui/appearance", () => ({ useTokenColor: () => "black" }));
vi.mock("@/ui/layout", () => ({ TOUCH_FLOOR: 44 }));
vi.mock("@/ui/text-scale-provider", () => ({
	useTextScale: () => ({ effectiveScale: 1 }),
}));
vi.mock("@/ui/components/badge", () => ({
	Badge: ({
		label,
		tone,
		emphasis,
	}: {
		label: string;
		tone?: string;
		emphasis?: boolean;
	}) => {
		host.badges.push(label);
		host.badgeTones.push(emphasis ? "emphasis" : (tone ?? "neutral"));
		return null;
	},
}));
vi.mock("@/ui/components/button", () => ({
	Button: ({ testID, onPress }: { testID: string; onPress: () => void }) => {
		host.presses.set(testID, onPress);
		return null;
	},
}));
vi.mock("@/ui/components/icon-button", () => ({
	IconButton: ({
		testID,
		onPress,
	}: {
		testID: string;
		onPress: () => void;
	}) => {
		host.presses.set(testID, onPress);
		return null;
	},
}));
vi.mock("./conversations-drawer", () => ({
	ConversationsDrawer: (props: ConversationsDrawerProps) => {
		host.drawer = props;
		return props.header ?? null;
	},
}));

const {
	WorkspaceDrawerProvider,
	WorkspaceDrawerButton,
	useWorkspaceDrawer,
	modeBarLayout,
	MODE_BADGE_INSET,
} = await import("./workspace-drawer");
let controller: ReturnType<typeof useWorkspaceDrawer>;
let setDraft: (text: string) => void;
let draft = "";
function Chat() {
	controller = useWorkspaceDrawer();
	[draft, setDraft] = useState("unsent synthetic draft");
	useEffect(() => {
		host.mounts += 1;
		return () => {
			host.unmounts += 1;
		};
	}, []);
	return createElement(WorkspaceDrawerButton, { testID: "chat-menu" });
}
let dom: DomShim;
let root: ReturnType<typeof createRoot>;
const mount = (adapter?: WorkspaceDrawerBridgeAdapter) =>
	act(async () =>
		root.render(
			<WorkspaceDrawerProvider bridgeAdapter={adapter}>
				<Chat />
			</WorkspaceDrawerProvider>,
		),
	);
beforeEach(() => {
	vi.clearAllMocks();
	host.presses.clear();
	host.labels.clear();
	host.badges = [];
	host.mounts = 0;
	host.unmounts = 0;
	host.persistentRows = 0;
	host.platform = "web";
	host.isHomeFocused.mockReturnValue(true);
	host.unread = { count: 7, state: "ready" };
	dom = installDomShim();
	root = createRoot(dom.container as Element);
});
afterEach(async () => {
	await act(async () => root.unmount());
	dom.dispose();
});

describe("one workspace drawer above the mounted chat", () => {
	it("opens from a chat without navigating or remounting its draft; close restores its trigger only after web dismissal", async () => {
		await mount();
		await act(async () => setDraft("edited draft and caret owner"));
		const restore = vi.fn();
		await act(async () => controller.open({ returnFocus: restore }));
		expect(host.drawer?.visible).toBe(true);
		expect(host.drawer?.currentSessionId).toBe("synthetic-chat");
		expect(host.navigate).not.toHaveBeenCalled();
		expect(host.mounts).toBe(1);
		expect(host.unmounts).toBe(0);
		expect(draft).toBe("edited draft and caret owner");
		await act(async () => host.drawer?.onClose());
		expect(host.drawer?.visible).toBe(false);
		expect(restore).not.toHaveBeenCalled();
		await act(async () => host.drawer?.onDismiss?.());
		expect(restore).toHaveBeenCalledOnce();
		expect(draft).toBe("edited draft and caret owner");
	});
	it.each(["ios", "android"])(
		"restores the %s trigger without requiring a web dismissal event",
		async (platform) => {
			host.platform = platform;
			await mount();
			const restore = vi.fn();
			await act(async () => controller.open({ returnFocus: restore }));
			await act(async () => host.drawer?.onClose());
			expect(restore).toHaveBeenCalledOnce();
			await act(async () => host.drawer?.onDismiss?.());
			expect(restore).toHaveBeenCalledOnce();
		},
	);
	it("does not restore the old chat's focus on navigation and consumes New chat once across route remounts", async () => {
		await mount();
		const restore = vi.fn();
		await act(async () => controller.open({ returnFocus: restore }));
		await act(async () => host.drawer?.onNavigate?.());
		await act(async () => host.drawer?.onDismiss?.());
		expect(restore).not.toHaveBeenCalled();
		await act(async () => host.drawer?.onNewChat?.());
		expect(host.navigate).toHaveBeenCalledExactlyOnceWith("/");
		expect(controller.consumeNewChatRequest(controller.newChatRequest)).toBe(
			true,
		);
		expect(controller.consumeNewChatRequest(controller.newChatRequest)).toBe(
			false,
		);
	});
	it("renders no promised Bridge entry without an adapter, then switches content without a route push", async () => {
		await mount();
		expect(host.presses.has(CONTROL.workspaceDrawerTeamBridge)).toBe(false);
		const pane = vi.fn(
			(_props: { onNavigate: () => void; onClose?: () => void }) => null,
		);
		await mount({
			bridgePane: pane,
			bridgeBadge: {
				count: null,
				state: "unavailable",
				a11yLabel: "Synthetic Bridge unavailable",
			},
		});
		await act(async () => controller.open());
		expect(host.presses.has(CONTROL.workspaceDrawerAgents)).toBe(true);
		expect(host.presses.has(CONTROL.workspaceDrawerTeamBridge)).toBe(true);
		await act(async () =>
			host.presses.get(CONTROL.workspaceDrawerTeamBridge)?.(),
		);
		expect(pane).toHaveBeenCalled();
		expect(host.navigate).not.toHaveBeenCalled();
		const callbacks = pane.mock.calls.at(-1)?.[0];
		expect(callbacks).toEqual({
			onNavigate: expect.any(Function),
			onClose: expect.any(Function),
		});
	});
	it("uses the relay unread projection for the same menu label and suppresses an unknown count", async () => {
		await mount();
		expect(host.labels.get("chat-menu")).toBe(
			"Open conversations, 7 new conversations",
		);
		expect(host.badges.at(-1)).toBe("7");
		host.unread = null;
		host.badges = [];
		await mount();
		expect(host.labels.get("chat-menu")).toBe("Open conversations");
		expect(host.badges).toEqual([]);
	});
	it("names and badges the trigger after the pane it opens: agent unreads only on Home/chats, Team Bridge unreads (green) on a bridge thread (R1-3/U1-3/D1-3)", async () => {
		host.unread = { count: 0, state: "ready" };
		host.badges = [];
		host.badgeTones = [];
		const bridgeAdapter: WorkspaceDrawerBridgeAdapter = {
			bridgePane: () => null,
			bridgeBadge: {
				count: 3,
				state: "ready",
				a11yLabel: "Team Bridge · 3 unread",
			},
		};
		// Home/chat trigger opens Agents: bridge unreads must not rename it.
		// (The drawer header's mode bar paints its own green "3"; the trigger
		// must add no red one.)
		await mount(bridgeAdapter);
		expect(host.labels.get("chat-menu")).toBe("Open conversations");
		expect(host.badgeTones).not.toContain("danger");
		// The thread header's trigger opens Team Bridge: its count, its name,
		// and the same green emphasis pill the drawer's segment uses.
		await act(async () =>
			root.render(
				<WorkspaceDrawerProvider bridgeAdapter={bridgeAdapter}>
					<WorkspaceDrawerButton testID="bridge-menu" mode="team-bridge" />
				</WorkspaceDrawerProvider>,
			),
		);
		expect(host.labels.get("bridge-menu")).toBe("Team Bridge · 3 unread");
		expect(host.badges.at(-1)).toBe("3");
		expect(host.badgeTones).not.toContain("danger");
		// Agent unreads keep the danger tone on the Home trigger.
		host.unread = { count: 7, state: "ready" };
		host.badgeTones = [];
		await mount(bridgeAdapter);
		expect(host.badgeTones).toContain("danger");
		// Negative control: a loading bridge badge never paints a count.
		host.badges = [];
		await act(async () =>
			root.render(
				<WorkspaceDrawerProvider
					bridgeAdapter={{
						bridgePane: () => null,
						bridgeBadge: {
							count: null,
							state: "loading",
							a11yLabel: "Team Bridge · loading",
						},
					}}
				>
					<WorkspaceDrawerButton testID="bridge-menu" mode="team-bridge" />
				</WorkspaceDrawerProvider>,
			),
		);
		expect(host.labels.get("bridge-menu")).toBe("Open conversations");
		expect(host.badges).toEqual([]);
	});
});

/** Mount the Home ownership effect inside the REAL shared provider. The native
 * pane/drawer renderer is a boundary double here: one synthetic row per visible
 * owner exposes duplicates without relying on selectors to choose a lucky copy.
 * Real DOM hit testing and pixels remain the compiled-web QA lane. */
function ResponsiveHome({
	forcePanelOpen,
	width,
	height,
}: {
	forcePanelOpen: boolean;
	width: number;
	height: number;
}) {
	const { split } = layoutFor(width, height);
	useHomeDrawer(forcePanelOpen, split);
	host.persistentRows = split ? 1 : 0;
	return <Chat />;
}
const home = (forcePanelOpen: boolean, width: number, height = 834) =>
	act(async () =>
		root.render(
			<WorkspaceDrawerProvider>
				<ResponsiveHome
					forcePanelOpen={forcePanelOpen}
					width={width}
					height={height}
				/>
			</WorkspaceDrawerProvider>,
		),
	);
const rowOwners = () => host.persistentRows + (host.drawer?.visible ? 1 : 0);

describe("Home responsive workspace ownership (Q-tablet)", () => {
	it("wide Conversations uses only its persistent pane, without opening a modal", async () => {
		await home(true, 1112);
		expect(rowOwners()).toBe(1);
		expect(host.drawer?.visible).toBe(false);
		expect(host.dismiss).not.toHaveBeenCalled();
	});
	it("narrow Conversations opens exactly one shared modal", async () => {
		await home(true, 390, 844);
		expect(rowOwners()).toBe(1);
		expect(host.drawer?.visible).toBe(true);
		expect(host.dismiss).toHaveBeenCalledOnce();
	});
	it("rotation transfers ownership without leaving a stale overlay or remounting the draft", async () => {
		await home(true, 390, 844);
		await act(async () => setDraft("synthetic rotation draft"));
		await home(true, 1112);
		expect(rowOwners()).toBe(1);
		expect(host.drawer?.visible).toBe(false);
		await home(true, 390, 844);
		expect(rowOwners()).toBe(1);
		expect(host.drawer?.visible).toBe(true);
		expect(host.mounts).toBe(1);
		expect(host.unmounts).toBe(0);
		expect(draft).toBe("synthetic rotation draft");
		expect(host.navigate).not.toHaveBeenCalled();
	});
	it("non-forced Home stays closed; its menu opens once and expanding closes it", async () => {
		await home(false, 390, 844);
		expect(rowOwners()).toBe(0);
		expect(host.dismiss).not.toHaveBeenCalled();
		await act(async () => host.presses.get("chat-menu")?.());
		expect(rowOwners()).toBe(1);
		expect(host.dismiss).toHaveBeenCalledOnce();
		await home(false, 1112);
		expect(rowOwners()).toBe(1);
		expect(host.drawer?.visible).toBe(false);
		await home(false, 390, 844);
		expect(rowOwners()).toBe(0);
	});
	it("a retained background Home cannot steal a chat menu on resize; refocusing reconciles it", async () => {
		await home(false, 390, 844);
		host.isHomeFocused.mockReturnValue(false);
		await home(false, 390, 844);
		await act(async () => host.presses.get("chat-menu")?.());
		expect(host.drawer?.visible).toBe(true);
		await home(false, 1112);
		expect(host.drawer?.visible).toBe(true);
		host.isHomeFocused.mockReturnValue(true);
		await home(false, 1112);
		expect(host.drawer?.visible).toBe(false);
		expect(host.mounts).toBe(1);
		expect(host.navigate).not.toHaveBeenCalled();
	});
});

/* Node has no layout engine, so the mode track's geometry is pinned as the
 * class contract that produces it plus the width budget it was sized from
 * (design D1-2 / UX U1-1, measured on the #222 web build at 100 %). */
describe("the mode track stays one row below large text (D1-2/U1-1/Q1-2/U1-2)", () => {
	const split = (value: string) => value.split(" ");
	it("below LARGE_TEXT_SCALE: no wrap, content-sized segments, equal heights, centred", () => {
		const layout = modeBarLayout(false);
		expect(split(layout.track)).toEqual(
			expect.arrayContaining([
				"flex-nowrap",
				"items-stretch",
				"content-center",
			]),
		);
		expect(split(layout.track)).not.toContain("flex-wrap");
		expect(split(layout.segment)).toEqual(["min-w-0", "grow", "shrink"]);
		expect(split(layout.content)).toEqual(["flex-nowrap", "px-2"]);
		// U2-1/U2-2: the count is out of flow, so it costs no width at all.
		expect(layout.badge).toBe("overlay");
		/* The TRUE 320 pt budget (U2-1): the drawer panel is
		 *  `sidebarWidthFor(320, 48)`, and the row's px-3 (24) + gap-1.5 (6)
		 *  + the 48 pt close button + the track's p-0.5 (4) leave a 190 pt
		 *  inner track, and its gap-0.5 (2) leaves 188 pt for the two
		 *  segments. The 225 pt this test used to assume was wrong. The 48 pt
		 *  (Android / web) floor is the tighter of the two platforms. */
		const floor = TOUCH_TARGET.android;
		const panel = sidebarWidthFor(320, floor);
		expect(panel).toBe(272);
		const track = panel - 24 - 6 - floor - 4;
		expect(track).toBe(190);
		const segments = track - 2;
		const agents = 47 + 16 + 2;
		const bridge = 79 + 16 + 2;
		expect(agents + bridge).toBeLessThanOrEqual(segments);
		// The inline count this replaced (6 gap + a 30.5 "99+" pill) overflowed.
		expect(agents + bridge + 6 + 30.5).toBeGreaterThan(segments);
		// The overlay rises into the row's 6 pt top inset and the 6 pt gap.
		expect(-MODE_BADGE_INSET.top).toBeLessThanOrEqual(6);
		expect(-MODE_BADGE_INSET.end).toBeLessThanOrEqual(6);
	});
	it("at large text: wraps whole segments, never mid-word (200 % / Urdu RTL, D2-1) and still centres wrapped rows", () => {
		const layout = modeBarLayout(true);
		expect(split(layout.track)).toEqual(
			expect.arrayContaining(["flex-wrap", "items-stretch", "content-center"]),
		);
		/* D2-1: content-proportioned segments, never `flex-1` halves (93 pt
		 *  each of the 190 pt track left "Bridge", ~80 pt at 28 px, a 73 pt
		 *  box), and a label that never shrinks below its longest word. */
		expect(split(layout.segment)).toEqual(["min-w-0", "grow", "shrink"]);
		expect(split(layout.content)).toContain("flex-wrap");
		expect(split(layout.label)).not.toContain("min-w-0");
		expect(split(layout.label)).not.toContain("shrink");
		expect(layout.badge).toBe("inline");
	});
});
