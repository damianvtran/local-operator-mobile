import { act, type ReactNode, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationsDrawerProps } from "@/features/sessions/conversations-drawer";
import { t } from "@/i18n";
import type { TeamBridgeState } from "@/team-bridge/store";
import { type DomShim, installDomShim } from "@/testing/dom-shim";
import { CONTROL } from "@/ui/a11y";

/**
 * The Team Bridge drawer adapter mounted in the REAL shared workspace drawer
 * provider (only leaf primitives and the drawer's Modal shell are stubbed:
 * Node has no React Native host). What it pins is the adapter's contract —
 * badge states, mode switching is not navigation, rows dismiss the drawer
 * before routing, and close returns focus through the shared controller.
 */
const RAW_KEY_OR_PLACEHOLDER = /mobile\.team_bridge|\{/;
type BridgeSlice = Pick<
	TeamBridgeState,
	"gate" | "unreadKnown" | "totalUnread"
>;
const host = vi.hoisted(() => ({
	platform: "web",
	log: [] as string[],
	navigate: vi.fn(),
	push: vi.fn(),
	drawer: null as ConversationsDrawerProps | null,
	presses: new Map<string, () => void>(),
	labels: new Map<string, string>(),
	selected: new Map<string, boolean>(),
	badges: [] as string[],
	directory: null as { onBeforeOpen?: () => void } | null,
	bridge: {
		state: {
			gate: "checking",
			unreadKnown: false,
			totalUnread: 0,
		} as BridgeSlice,
		listeners: new Set<() => void>(),
	},
}));
const setBridge = (next: Partial<BridgeSlice>) => {
	host.bridge.state = { ...host.bridge.state, ...next };
	for (const listener of host.bridge.listeners) listener();
};
vi.mock("expo-router", () => ({
	usePathname: () => "/session/synthetic-chat",
	useRouter: () => ({ navigate: host.navigate, push: host.push }),
}));
vi.mock("expo-web-browser", () => ({}));
vi.mock("lucide-react-native", () => ({ Menu: () => null, X: () => null }));
vi.mock("react-native", () => ({
	Platform: {
		get OS() {
			return host.platform;
		},
	},
	Keyboard: { dismiss: vi.fn() },
	View: ({ children }: { children?: ReactNode }) => children ?? null,
	Text: ({ children }: { children?: ReactNode }) => children ?? null,
	Pressable: ({ children }: { children?: ReactNode }) => children ?? null,
}));
vi.mock("@/features/auth/connection-provider", () => ({
	useLocaleFrame: () => "en",
	useListState: (select: (state: unknown) => unknown) =>
		select({ unread: { count: null, state: "loading" } }),
	useConnection: () => ({}),
}));
vi.mock("@/team-bridge/provider", () => ({
	useTeamBridge: () => ({ actions: {} }),
	useTeamBridgeState: <T,>(select: (state: BridgeSlice) => T) =>
		useSyncExternalStore(
			(listener) => {
				host.bridge.listeners.add(listener);
				return () => host.bridge.listeners.delete(listener);
			},
			() => select(host.bridge.state),
		),
}));
vi.mock("@/ui/appearance", () => ({ useTokenColor: () => "black" }));
vi.mock("@/ui/layout", () => ({ TOUCH_FLOOR: 44 }));
vi.mock("@/ui/text-scale-provider", () => ({
	useTextScale: () => ({ effectiveScale: 1 }),
}));
vi.mock("@/ui/components/back-button", () => ({ BackButton: () => null }));
vi.mock("@/ui/components/screen", () => ({ Screen: () => null }));
vi.mock("@/ui/components/badge", () => ({
	Badge: ({ label }: { label: string }) => {
		host.badges.push(label);
		return null;
	},
}));
vi.mock("@/ui/components/button", () => ({
	Button: (props: {
		testID: string;
		label: string;
		accessibilityLabel?: string;
		selected?: boolean;
		onPress: () => void;
	}) => {
		host.presses.set(props.testID, props.onPress);
		host.labels.set(props.testID, props.accessibilityLabel ?? props.label);
		host.selected.set(props.testID, !!props.selected);
		return null;
	},
}));
vi.mock("@/ui/components/icon-button", () => ({
	IconButton: (props: { testID: string; onPress: () => void }) => {
		host.presses.set(props.testID, props.onPress);
		return null;
	},
}));
vi.mock("./list-screen", () => ({
	BridgeDirectory: (props: { onBeforeOpen?: () => void }) => {
		host.directory = props;
		return null;
	},
}));
vi.mock("@/features/sessions/conversations-drawer", () => ({
	ConversationsDrawer: (props: ConversationsDrawerProps) => {
		host.drawer = props;
		return (
			<>
				{props.header}
				{props.content}
			</>
		);
	},
}));

const { WorkspaceDrawerProvider, useWorkspaceDrawer } = await import(
	"@/features/sessions/workspace-drawer"
);
const { bridgeDrawerBadge, TeamBridgeDrawerPane, useTeamBridgeDrawerAdapter } =
	await import("./drawer-adapter");

let controller: ReturnType<typeof useWorkspaceDrawer>;
function Chat() {
	controller = useWorkspaceDrawer();
	return null;
}
/** The root layout's wiring, verbatim in shape (`app/_layout.tsx`). */
function BridgeWorkspaceDrawer({ children }: { children: ReactNode }) {
	return (
		<WorkspaceDrawerProvider bridgeAdapter={useTeamBridgeDrawerAdapter()}>
			{children}
		</WorkspaceDrawerProvider>
	);
}
let dom: DomShim;
let root: ReturnType<typeof createRoot>;
const mountDrawer = () =>
	act(async () =>
		root.render(
			<BridgeWorkspaceDrawer>
				<Chat />
			</BridgeWorkspaceDrawer>,
		),
	);
const press = (id: string) => act(async () => host.presses.get(id)?.());

beforeEach(() => {
	vi.clearAllMocks();
	host.platform = "web";
	host.log = [];
	host.presses.clear();
	host.labels.clear();
	host.selected.clear();
	host.badges = [];
	host.directory = null;
	host.drawer = null;
	host.bridge.state = { gate: "checking", unreadKnown: false, totalUnread: 0 };
	dom = installDomShim();
	root = createRoot(dom.container as Element);
});
afterEach(async () => {
	await act(async () => root.unmount());
	dom.dispose();
});

describe("bridgeDrawerBadge: unknown is not zero", () => {
	const loading = t("mobile.team_bridge.navigation.entry_loading");
	const unavailable = t("mobile.team_bridge.navigation.entry_unavailable");
	it.each([
		[{ gate: "checking", unreadKnown: false, totalUnread: 0 }, "loading"],
		// Admitted, but the account-unread read has not landed: still unknown.
		[{ gate: "open", unreadKnown: false, totalUnread: 0 }, "loading"],
		[{ gate: "signed_out", unreadKnown: false, totalUnread: 0 }, "unavailable"],
		[{ gate: "unavailable", unreadKnown: true, totalUnread: 3 }, "unavailable"],
		[
			{ gate: "plan_required", unreadKnown: false, totalUnread: 0 },
			"unavailable",
		],
		[
			{ gate: "update_required", unreadKnown: false, totalUnread: 0 },
			"unavailable",
		],
	] as const)("%o is %s with no count", (input, state) => {
		expect(bridgeDrawerBadge(input)).toEqual({
			count: null,
			state,
			a11yLabel: state === "loading" ? loading : unavailable,
		});
	});
	it("a known count is ready, zero included, with the catalogue's plural label", () => {
		expect(
			bridgeDrawerBadge({ gate: "open", unreadKnown: true, totalUnread: 0 }),
		).toEqual({ count: 0, state: "ready", a11yLabel: "Team Bridge" });
		expect(
			bridgeDrawerBadge({ gate: "open", unreadKnown: true, totalUnread: 4 }),
		).toEqual({
			count: 4,
			state: "ready",
			a11yLabel: "Team Bridge · 4 unread",
		});
	});
	it("loading, unavailable and zero are three different announcements", () => {
		expect(new Set([loading, unavailable, "Team Bridge"]).size).toBe(3);
		for (const label of [loading, unavailable])
			expect(label).not.toMatch(RAW_KEY_OR_PLACEHOLDER);
	});
});

describe("the adapter in the shared workspace drawer", () => {
	it("shows the labelled mode switch, and the count only once it is known", async () => {
		setBridge({ gate: "open", unreadKnown: false, totalUnread: 0 });
		await mountDrawer();
		expect(host.presses.has(CONTROL.workspaceDrawerAgents)).toBe(true);
		expect(host.presses.has(CONTROL.workspaceDrawerTeamBridge)).toBe(true);
		expect(host.labels.get(CONTROL.workspaceDrawerTeamBridge)).toBe(
			t("mobile.team_bridge.navigation.entry_loading"),
		);
		expect(host.badges).toEqual([]);
		host.badges = [];
		await act(async () =>
			setBridge({ gate: "open", unreadKnown: true, totalUnread: 4 }),
		);
		expect(host.labels.get(CONTROL.workspaceDrawerTeamBridge)).toBe(
			"Team Bridge · 4 unread",
		);
		expect(host.badges.at(-1)).toBe("4");
	});

	it("switching to Team Bridge changes content without navigating; a row dismisses first", async () => {
		setBridge({ gate: "open", unreadKnown: true, totalUnread: 2 });
		await mountDrawer();
		await act(async () => controller.open());
		expect(host.drawer?.visible).toBe(true);
		expect(host.selected.get(CONTROL.workspaceDrawerAgents)).toBe(true);
		await press(CONTROL.workspaceDrawerTeamBridge);
		expect(host.selected.get(CONTROL.workspaceDrawerTeamBridge)).toBe(true);
		expect(host.selected.get(CONTROL.workspaceDrawerAgents)).toBe(false);
		expect(host.navigate).not.toHaveBeenCalled();
		expect(host.push).not.toHaveBeenCalled();
		expect(host.drawer?.visible).toBe(true);
		// The pane renders the shared directory and hands it the drawer's own
		// navigate, which closes the overlay before the row routes.
		expect(host.directory?.onBeforeOpen).toBeTypeOf("function");
		await act(async () => host.directory?.onBeforeOpen?.());
		expect(host.drawer?.visible).toBe(false);
		// Back to Agents is also not navigation.
		await act(async () => controller.open());
		await press(CONTROL.workspaceDrawerAgents);
		expect(host.navigate).not.toHaveBeenCalled();
		expect(host.push).not.toHaveBeenCalled();
	});

	it("the Bridge pane's close returns focus through the shared controller", async () => {
		host.platform = "ios";
		setBridge({ gate: "open", unreadKnown: true, totalUnread: 0 });
		await mountDrawer();
		const restore = vi.fn();
		await act(async () => controller.open({ returnFocus: restore }));
		await press(CONTROL.workspaceDrawerTeamBridge);
		await press(CONTROL.sidebarClose);
		expect(host.drawer?.visible).toBe(false);
		expect(restore).toHaveBeenCalledTimes(1);
		expect(host.push).not.toHaveBeenCalled();
	});
});

describe("the Bridge pane before admission", () => {
	it.each(["checking", "signed_out", "unavailable"] as const)(
		"%s offers the full screen: dismiss first, then route",
		async (gate) => {
			setBridge({ gate });
			const onNavigate = vi.fn(() => host.log.push("dismiss"));
			host.push.mockImplementation((path: string) => host.log.push(path));
			await act(async () =>
				root.render(
					<TeamBridgeDrawerPane onNavigate={onNavigate} onClose={vi.fn()} />,
				),
			);
			expect(host.directory).toBeNull();
			expect(host.labels.get(CONTROL.teamBridgeDrawerOpen)).toBe(
				t("mobile.team_bridge.navigation.open_hub"),
			);
			await press(CONTROL.teamBridgeDrawerOpen);
			expect(host.log).toEqual(["dismiss", "/team-bridge"]);
		},
	);
});
