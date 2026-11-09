import { act, createElement, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type DomShim, installDomShim } from "@/testing/dom-shim";
import { CONTROL } from "@/ui/a11y";
import type { ConversationsDrawerProps } from "./conversations-drawer";
import type { WorkspaceDrawerBridgeAdapter } from "./workspace-drawer.contract";

const host = vi.hoisted(() => ({
	path: "/session/synthetic-chat",
	platform: "web",
	navigate: vi.fn(),
	dismiss: vi.fn(),
	drawer: null as ConversationsDrawerProps | null,
	presses: new Map<string, () => void>(),
	labels: new Map<string, string>(),
	badges: [] as string[],
	unread: { count: 7, state: "ready" } as unknown,
	mounts: 0,
	unmounts: 0,
}));
vi.mock("expo-router", () => ({
	usePathname: () => host.path,
	useRouter: () => ({ navigate: host.navigate }),
}));
vi.mock("lucide-react-native", () => ({ Menu: () => null }));
vi.mock("react-native", () => ({
	Platform: {
		get OS() {
			return host.platform;
		},
	},
	Keyboard: { dismiss: host.dismiss },
	View: ({ children }: { children?: import("react").ReactNode }) =>
		children ?? null,
	Pressable: (props: {
		children?: import("react").ReactNode;
		testID: string;
		onPress: () => void;
		accessibilityLabel: string;
	}) => {
		host.presses.set(props.testID, props.onPress);
		host.labels.set(props.testID, props.accessibilityLabel);
		return props.children ?? null;
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
	Badge: ({ label }: { label: string }) => {
		host.badges.push(label);
		return null;
	},
}));
vi.mock("@/ui/components/button", () => ({
	Button: ({ testID, onPress }: { testID: string; onPress: () => void }) => {
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

const { WorkspaceDrawerProvider, WorkspaceDrawerButton, useWorkspaceDrawer } =
	await import("./workspace-drawer");
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
	host.platform = "web";
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
			(_props: { onNavigate: () => void; onClose: () => void }) => null,
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
});
