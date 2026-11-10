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
const WHITESPACE = /\s+/;
type BridgeSlice = Pick<
	TeamBridgeState,
	"gate" | "unreadKnown" | "unreadFailed" | "totalUnread"
>;
type ViewProps = {
	className?: string;
	style?: Record<string, number>;
	pointerEvents?: string;
	children?: ReactNode;
};
const host = vi.hoisted(() => ({
	platform: "web",
	log: [] as string[],
	navigate: vi.fn(),
	push: vi.fn(),
	replace: vi.fn(),
	pathname: "/session/synthetic-chat",
	drawer: null as ConversationsDrawerProps | null,
	presses: new Map<string, () => void>(),
	labels: new Map<string, string>(),
	selected: new Map<string, boolean>(),
	labelLines: new Map<string, number | undefined>(),
	views: [] as ViewProps[],
	texts: [] as string[],
	badges: [] as string[],
	directory: null as { onBeforeOpen?: () => void } | null,
	bridge: {
		state: {
			gate: "checking",
			unreadKnown: false,
			unreadFailed: false,
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
	usePathname: () => host.pathname,
	useRouter: () => ({
		navigate: host.navigate,
		push: host.push,
		replace: host.replace,
	}),
}));
vi.mock("expo-web-browser", () => ({}));
vi.mock("lucide-react-native", () => ({
	Menu: () => null,
	X: () => null,
	Bot: () => null,
	Clock: () => null,
	MessageSquare: () => null,
}));
vi.mock("react-native", () => ({
	Platform: {
		get OS() {
			return host.platform;
		},
	},
	Keyboard: { dismiss: vi.fn() },
	View: (props: ViewProps) => {
		host.views.push(props);
		return props.children ?? null;
	},
	Text: ({ children }: { children?: ReactNode }) => {
		if (typeof children === "string") host.texts.push(children);
		return children ?? null;
	},
	Pressable: ({
		children,
		testID,
		onPress,
	}: {
		children?: ReactNode;
		testID?: string;
		onPress?: () => void;
	}) => {
		if (testID && onPress) host.presses.set(testID, onPress);
		return children ?? null;
	},
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
			// The profile sheet also reads who "self" is and the org's rows;
			// none is the synthetic account's state here.
			() =>
				select({
					...host.bridge.state,
					...({ orgs: {}, selfAccountId: null } as object),
				}),
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
		labelLines?: number;
		accessibilityLabel?: string;
		selected?: boolean;
		onPress: () => void;
	}) => {
		host.labelLines.set(props.testID, props.labelLines);
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
/* The profile sheet's chrome only: `Sheet` renders its footer (where "Message"
 * lives) while visible, and the card body is out of this suite's scope. */
vi.mock("@/ui/components/sheet", () => ({
	Sheet: (props: { visible: boolean; footer?: ReactNode }) =>
		props.visible ? (props.footer ?? null) : null,
}));
vi.mock("./profile-details", () => ({ ProfileDetails: () => null }));
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
const {
	BridgeThreadDrawerButton,
	bridgeDrawerBadge,
	TeamBridgeDrawerPane,
	useTeamBridgeDrawerAdapter,
} = await import("./drawer-adapter");
const { openDisposition, ProfileSheet, useOpenTarget } = await import(
	"./profile-card"
);
const { directoryMemberSchema } = await import("@/team-bridge/contract");

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
	host.pathname = "/session/synthetic-chat";
	host.log = [];
	host.presses.clear();
	host.labels.clear();
	host.selected.clear();
	host.labelLines.clear();
	host.views = [];
	host.texts = [];
	host.badges = [];
	host.directory = null;
	host.drawer = null;
	host.bridge.state = {
		gate: "checking",
		unreadKnown: false,
		unreadFailed: false,
		totalUnread: 0,
	};
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
		[
			{
				gate: "checking",
				unreadKnown: false,
				unreadFailed: false,
				totalUnread: 0,
			},
			"loading",
		],
		// Admitted, but the account-unread read has not landed: still unknown.
		[
			{ gate: "open", unreadKnown: false, unreadFailed: false, totalUnread: 0 },
			"loading",
		],
		[
			{
				gate: "signed_out",
				unreadKnown: false,
				unreadFailed: false,
				totalUnread: 0,
			},
			"unavailable",
		],
		[
			{
				gate: "unavailable",
				unreadKnown: true,
				unreadFailed: false,
				totalUnread: 3,
			},
			"unavailable",
		],
		[
			{
				gate: "plan_required",
				unreadKnown: false,
				unreadFailed: false,
				totalUnread: 0,
			},
			"unavailable",
		],
		[
			{
				gate: "update_required",
				unreadKnown: false,
				unreadFailed: false,
				totalUnread: 0,
			},
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
			bridgeDrawerBadge({
				gate: "open",
				unreadKnown: true,
				unreadFailed: false,
				totalUnread: 0,
			}),
		).toEqual({ count: 0, state: "ready", a11yLabel: "Team Bridge" });
		expect(
			bridgeDrawerBadge({
				gate: "open",
				unreadKnown: true,
				unreadFailed: false,
				totalUnread: 4,
			}),
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

describe("a failed first unread read (R1-2 / Q1-2)", () => {
	it("is unavailable, never loading forever and never a zero", () => {
		expect(
			bridgeDrawerBadge({
				gate: "open",
				unreadKnown: false,
				unreadFailed: true,
				totalUnread: 0,
			}),
		).toEqual({
			count: null,
			state: "unavailable",
			a11yLabel: t("mobile.team_bridge.navigation.entry_unavailable"),
		});
	});
	it("the live drawer button moves off loading, draws no badge, and recovers on a later read", async () => {
		setBridge({ gate: "open" });
		await mountDrawer();
		expect(host.labels.get(CONTROL.workspaceDrawerTeamBridge)).toBe(
			t("mobile.team_bridge.navigation.entry_loading"),
		);
		host.badges = [];
		await act(async () => setBridge({ unreadFailed: true }));
		expect(host.labels.get(CONTROL.workspaceDrawerTeamBridge)).toBe(
			t("mobile.team_bridge.navigation.entry_unavailable"),
		);
		expect(host.badges).toEqual([]);
		await act(async () =>
			setBridge({ unreadKnown: true, unreadFailed: false, totalUnread: 3 }),
		);
		expect(host.labels.get(CONTROL.workspaceDrawerTeamBridge)).toBe(
			"Team Bridge · 3 unread",
		);
		expect(host.badges.at(-1)).toBe("3");
	});
});

describe("the adapter object is memoized (R1-4)", () => {
	it("keeps its identity across unrelated re-renders and changes with the badge", async () => {
		const seen: unknown[] = [];
		function Probe({ tick }: { tick: number }) {
			seen.push(useTeamBridgeDrawerAdapter());
			return tick;
		}
		setBridge({ gate: "open", unreadKnown: true, totalUnread: 1 });
		await act(async () => root.render(<Probe tick={1} />));
		await act(async () => root.render(<Probe tick={2} />));
		expect(seen).toHaveLength(2);
		expect(seen[1]).toBe(seen[0]);
		await act(async () => setBridge({ totalUnread: 2 }));
		expect(seen.at(-1)).not.toBe(seen[0]);
	});
});

/** Whether a JSX subtree (unrendered elements) holds the given `testID`. */
const holds = (node: ReactNode, testID: string): boolean => {
	if (Array.isArray(node)) return node.some((child) => holds(child, testID));
	if (!node || typeof node !== "object" || !("props" in node)) return false;
	const props = node.props as { testID?: string; children?: ReactNode };
	return props.testID === testID || holds(props.children, testID);
};

describe("the mode row wraps at large text, never truncates (F2)", () => {
	it("the row wraps, the Bridge group shrinks, the badge sits on the button's corner, and the label is never one-line clamped", async () => {
		setBridge({ gate: "open", unreadKnown: true, totalUnread: 4 });
		await mountDrawer();
		const containing = host.views.filter((v) =>
			holds(v.children, CONTROL.workspaceDrawerTeamBridge),
		);
		// Outermost first: the mode row, then the Bridge button's own group.
		const [row, group] = containing.slice(-2);
		const classes = (v?: ViewProps) => (v?.className ?? "").split(WHITESPACE);
		expect(classes(row)).toEqual(
			expect.arrayContaining(["flex-row", "flex-wrap"]),
		);
		expect(holds(row?.children, CONTROL.workspaceDrawerAgents)).toBe(true);
		expect(classes(group)).toEqual(
			expect.arrayContaining(["min-w-0", "shrink"]),
		);
		// Neither label may be clamped: the product name wraps, not "Team B…".
		expect(host.labelLines.has(CONTROL.workspaceDrawerTeamBridge)).toBe(true);
		expect(host.labelLines.get(CONTROL.workspaceDrawerTeamBridge)).toBe(
			undefined,
		);
		expect(host.labelLines.get(CONTROL.workspaceDrawerAgents)).toBe(undefined);
		// The badge overlaps the button (inside the group, absolutely placed) and
		// passes taps through to it (design D2).
		const badge = host.views.find(
			(v) => v.pointerEvents === "none" && classes(v).includes("absolute"),
		);
		expect(badge).toBeDefined();
		expect(
			group && holds(group.children, CONTROL.workspaceDrawerTeamBridge),
		).toBe(true);
		expect(badge?.style).toMatchObject({ end: expect.any(Number) });
		expect(host.badges.at(-1)).toBe("4");
	});
});

describe("the Bridge pane's close row and gate help (D3, U2/U3)", () => {
	it("the close row carries the Agents pane's vertical padding", async () => {
		await act(async () =>
			root.render(
				<TeamBridgeDrawerPane onNavigate={vi.fn()} onClose={vi.fn()} />,
			),
		);
		// Innermost View holding the ✕: the close row itself, not the pane.
		const closeRow = host.views
			.filter((v) => holds(v.children, CONTROL.sidebarClose))
			.at(-1);
		expect((closeRow?.className ?? "").split(WHITESPACE)).toContain("py-1");
	});
	it.each([
		["signed_out", "mobile.team_bridge.gate.signed_out_help"],
		["unavailable", "mobile.team_bridge.gate.unavailable_help"],
		["update_required", "mobile.team_bridge.gate.update_help"],
		["plan_required", "mobile.team_bridge.gate.plan_description"],
		["checking", "mobile.team_bridge.gate.connecting"],
	] as const)("%s says why under its heading", async (gate, help) => {
		setBridge({ gate });
		await act(async () =>
			root.render(
				<TeamBridgeDrawerPane onNavigate={vi.fn()} onClose={vi.fn()} />,
			),
		);
		const line = t(help);
		expect(line).not.toMatch(RAW_KEY_OR_PLACEHOLDER);
		expect(host.texts).toContain(line);
	});
});

describe("a profile card's Message from the drawer (R1-3)", () => {
	const person = directoryMemberSchema.parse({
		account_id: "acct_synthetic_ada",
		display_label: "Ada",
		role: "member",
		bridge_enabled: true,
		bridge_state: "active",
	});
	it("closes the card, then the drawer, then routes to the DM", async () => {
		setBridge({ gate: "open", unreadKnown: true, totalUnread: 0 });
		host.push.mockImplementation(() => host.log.push("route"));
		const onCardClose = vi.fn(() => host.log.push("card"));
		/* The real drawer provider plus the real ProfileSheet, wired the way
		 * `BridgeDirectory` wires it: the drawer's own navigate is the card's
		 * `onBeforeOpen`. */
		function Card() {
			const drawer = useWorkspaceDrawer();
			controller = drawer;
			return (
				<ProfileSheet
					subject={{ person, agent: false }}
					tenantId="tnt_synthetic"
					onClose={onCardClose}
					onBeforeOpen={() => {
						host.log.push("drawer");
						// Exactly what the pane hands `BridgeDirectory`, which passes
						// it on to its ProfileSheet (list-screen.tsx).
						host.directory?.onBeforeOpen?.();
					}}
				/>
			);
		}
		await act(async () =>
			root.render(
				<BridgeWorkspaceDrawer>
					<Card />
				</BridgeWorkspaceDrawer>,
			),
		);
		await act(async () => controller.open());
		await press(CONTROL.workspaceDrawerTeamBridge);
		expect(host.drawer?.visible).toBe(true);
		await press(CONTROL.teamBridgeProfileMessage);
		expect(host.log).toEqual(["card", "drawer", "route"]);
		expect(host.drawer?.visible).toBe(false);
		expect(host.push).toHaveBeenCalledWith({
			pathname: "/team-bridge/[tenantId]/[conversationId]",
			params: {
				kind: "person",
				tenantId: "tnt_synthetic",
				accountId: "acct_synthetic_ada",
				label: "Ada",
				conversationId: "new",
			},
		});
	});
});

/* TestFlight 773, operator: "when you tap in the sidebar to switch and go to a
 * channel, there's a back button instead of the hamburger menu which makes it
 * hard to switch channels, remove the back UX there and replace with the
 * sidebar access". */
describe("a Bridge thread leads with the drawer, not back (TestFlight 773)", () => {
	it("the thread's hamburger opens the shared drawer straight into Team Bridge", async () => {
		setBridge({ gate: "open" });
		await act(async () =>
			root.render(
				<BridgeWorkspaceDrawer>
					<BridgeThreadDrawerButton />
				</BridgeWorkspaceDrawer>,
			),
		);
		expect(host.drawer?.visible).toBe(false);
		expect(host.presses.has(CONTROL.teamBridgeMenu)).toBe(true);
		expect(host.presses.has(CONTROL.teamBridgeBack)).toBe(false);
		await press(CONTROL.teamBridgeMenu);
		expect(host.drawer?.visible).toBe(true);
		// The Bridge pane's directory is what is mounted, and the mode switch
		// reads Team Bridge as selected — not the Agents list it last showed.
		expect(host.directory).not.toBeNull();
		expect(host.selected.get(CONTROL.workspaceDrawerTeamBridge)).toBe(true);
		expect(host.selected.get(CONTROL.workspaceDrawerAgents)).toBe(false);
	});

	it("the agents hamburger (no mode) still opens on the drawer's current mode", async () => {
		setBridge({ gate: "open" });
		const { WorkspaceDrawerButton } = await import(
			"@/features/sessions/workspace-drawer"
		);
		await act(async () =>
			root.render(
				<BridgeWorkspaceDrawer>
					<WorkspaceDrawerButton testID={CONTROL.sessionBack} />
				</BridgeWorkspaceDrawer>,
			),
		);
		await press(CONTROL.sessionBack);
		expect(host.drawer?.visible).toBe(true);
		expect(host.selected.get(CONTROL.workspaceDrawerAgents)).toBe(true);
		expect(host.directory).toBeNull();
	});
});

describe("opening a Bridge target: push from outside, replace inside (TestFlight 773)", () => {
	const target = {
		kind: "conversation" as const,
		tenantId: "synthetic-tenant",
		conversationId: "synthetic-other",
	};
	let open: (t: typeof target) => void;
	function Opener() {
		open = useOpenTarget();
		return null;
	}
	const mountOpener = () => act(async () => root.render(<Opener />));
	const destination = {
		pathname: "/team-bridge/[tenantId]/[conversationId]",
		params: { tenantId: "synthetic-tenant", conversationId: "synthetic-other" },
	};

	it("a channel picked while a thread is open REPLACES it — no stack push", async () => {
		host.pathname = "/team-bridge/synthetic-tenant/synthetic-current";
		await mountOpener();
		await act(async () => open(target));
		expect(host.replace).toHaveBeenCalledWith(destination);
		expect(host.push).not.toHaveBeenCalled();
	});

	it("the list screen also replaces, so the thread's back never reaches the list", async () => {
		host.pathname = "/team-bridge";
		await mountOpener();
		await act(async () => open(target));
		expect(host.replace).toHaveBeenCalledWith(destination);
		expect(host.push).not.toHaveBeenCalled();
	});

	it("from Home or an agent chat it pushes, so back returns there", async () => {
		await mountOpener();
		await act(async () => open(target));
		expect(host.push).toHaveBeenCalledWith(destination);
		expect(host.replace).not.toHaveBeenCalled();
	});

	it("picking the thread already shown neither pushes nor replaces", async () => {
		host.pathname = "/team-bridge/synthetic-tenant/synthetic-other";
		await mountOpener();
		await act(async () => open(target));
		expect(host.push).not.toHaveBeenCalled();
		expect(host.replace).not.toHaveBeenCalled();
	});

	it("disposition is decided by route alone", () => {
		expect(openDisposition("/", target)).toBe("push");
		expect(openDisposition("/team-bridge-other", target)).toBe("push");
		expect(openDisposition("/team-bridge/x/new", target)).toBe("replace");
		expect(
			openDisposition("/team-bridge/x/y", {
				kind: "person",
				tenantId: "x",
				accountId: "a",
			} as never),
		).toBe("replace");
	});
});
