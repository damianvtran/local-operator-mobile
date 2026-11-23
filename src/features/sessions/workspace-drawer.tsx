import { usePathname, useRouter } from "expo-router";
import { Menu } from "lucide-react-native";
import { type ReactNode, useCallback, useRef, useState } from "react";
import { Keyboard, Platform, Pressable, View } from "react-native";
import {
	useListState,
	useLocaleFrame,
} from "@/features/auth/connection-provider";
import { MENU_BADGE_INSET } from "@/features/home/header-fit";
import { countLabel } from "@/features/notifications/notifications-model";
import { ConversationsDrawer } from "@/features/sessions/conversations-drawer";
import { unreadBadgeCount } from "@/features/sessions/session-projection";
import type {
	WorkspaceDrawerBridgeAdapter,
	WorkspaceDrawerController,
	WorkspaceDrawerMode,
} from "@/features/sessions/workspace-drawer.contract";
import {
	useWorkspaceDrawer,
	WorkspaceDrawerContext,
} from "@/features/sessions/workspace-drawer-context";
import { WorkspaceModeBar } from "@/features/sessions/workspace-mode-bar";
import { t } from "@/i18n";
import { CONTROL, ROLE } from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { Badge } from "@/ui/components/badge";
import { TOUCH_FLOOR } from "@/ui/layout";
import { useTextScale } from "@/ui/text-scale-provider";
import { cx } from "@/ui/variants";

const SESSION_PATH = /^\/session\/([^/]+)(?:\/|$)/;

/** One overlay above the route stack. Opening it must not change a route key,
 * remount a chat input, or reconstruct its scroll position/draft on dismissal. */
export const WorkspaceDrawerProvider = ({
	children,
	bridgeAdapter,
}: {
	children: ReactNode;
	bridgeAdapter?: WorkspaceDrawerBridgeAdapter;
}) => {
	const router = useRouter();
	useLocaleFrame();
	const pathname = usePathname();
	const [visible, setVisible] = useState(false);
	const [mode, setMode] = useState<WorkspaceDrawerMode>("agents");
	const [newChatRequest, setNewChatRequest] = useState(0);
	const [agentsPresentation, setAgentsPresentation] = useState<{
		notice?: string | null;
		homeDirectory?: string | null;
	}>({});
	const consumedRequest = useRef(0);
	const consumeNewChatRequest = useCallback((request: number) => {
		if (request <= consumedRequest.current) return false;
		consumedRequest.current = request;
		return true;
	}, []);
	const returnFocus = useRef<(() => void) | undefined>(undefined);
	const finishClose = useCallback(() => {
		const restore = returnFocus.current;
		returnFocus.current = undefined;
		restore?.();
	}, []);
	const close = useCallback(() => {
		setVisible(false);
		// RN web restores focus after its modal trap is removed. Android has no
		// onDismiss event, so its trigger restoration belongs to the close path.
		if (Platform.OS !== "web") finishClose();
	}, [finishClose]);
	const navigate = useCallback(() => {
		returnFocus.current = undefined;
		close();
	}, [close]);
	const newChat = useCallback(() => {
		navigate();
		setNewChatRequest((request) => request + 1);
		router.navigate("/");
	}, [navigate, router]);
	const open = useCallback<WorkspaceDrawerController["open"]>((options) => {
		Keyboard.dismiss();
		returnFocus.current = options?.returnFocus;
		if (options?.mode) setMode(options.mode);
		setVisible(true);
	}, []);
	const selectMode = useCallback(
		(next: WorkspaceDrawerMode) => {
			if (next === "agents" || bridgeAdapter) setMode(next);
		},
		[bridgeAdapter],
	);
	const currentSessionId = SESSION_PATH.exec(pathname)?.[1];
	const bridge = mode === "team-bridge" && bridgeAdapter;
	return (
		<WorkspaceDrawerContext.Provider
			value={{
				mode,
				bridgeAdapter,
				open,
				close,
				selectMode,
				newChatRequest,
				consumeNewChatRequest,
				setAgentsPresentation,
			}}
		>
			{children}
			<ConversationsDrawer
				visible={visible}
				onClose={close}
				onNavigate={navigate}
				onDismiss={finishClose}
				onNewChat={newChat}
				currentSessionId={currentSessionId}
				{...agentsPresentation}
				header={
					bridgeAdapter ? (
						<WorkspaceModeBar
							mode={mode}
							onSelectMode={selectMode}
							bridgeBadge={bridgeAdapter.bridgeBadge}
							onClose={close}
						/>
					) : undefined
				}
				content={
					bridge
						? bridge.bridgePane({ onNavigate: navigate, onClose: close })
						: undefined
				}
			/>
		</WorkspaceDrawerContext.Provider>
	);
};

/** The thread header's badge sits 2 pt higher than Home's and carries a
 *  2 pt canvas ring: at `MENU_BADGE_INSET` it covered ~13 px of the glyph's
 *  top stroke with no separation (design D1-4). `end` keeps 2 pt from the box
 *  edge so the pill never touches the title beside the button. */
const BRIDGE_MENU_BADGE_INSET = { top: 0, end: 2 } as const;

/** Home and chats deliberately share the exact projection and glyph geometry.
 * Unknown unread is absence, not zero; no local row count invents a receipt.
 * When `mode === "team-bridge"` (the thread header's hamburger), the badge and
 * accessible name reflect Team Bridge's known unreads; otherwise they reflect
 * agent chat unreads only, because that is the pane the button opens. */

export const WorkspaceDrawerButton = ({
	testID = CONTROL.homeSidebar,
	mode,
}: {
	testID?: string;
	/** The pane to open on. Absent keeps whichever mode the drawer last showed
	 *  (Home and agent chats); a Team Bridge thread passes `"team-bridge"` so
	 *  its hamburger opens on the channel list, the switcher it replaced a
	 *  back arrow with (TestFlight 773). */
	mode?: WorkspaceDrawerMode;
}) => {
	const drawer = useWorkspaceDrawer();
	useLocaleFrame();
	const unread = useListState((state) => state.unread);
	const agentCount = unreadBadgeCount(unread);
	const bridgeBadge = drawer.bridgeAdapter?.bridgeBadge;
	const bridgeCount =
		bridgeBadge?.state === "ready" &&
		bridgeBadge.count !== null &&
		bridgeBadge.count > 0
			? bridgeBadge.count
			: null;
	/* The badge and the name follow the pane this button OPENS, never the
	 *  other one (UX U1-3 / review R1-3): Home and agent chats open on Agents,
	 *  so they count agent unreads and are named "Open conversations" as on the
	 *  base; a Team Bridge thread opens on the channel list, so it counts
	 *  Team Bridge unreads and takes the adapter's name for that pane. Showing
	 *  bridge unreads on a button that lands in Agents announced "Team Bridge,
	 *  11 unread" and then opened something else. */
	const bridgeTrigger = mode === "team-bridge";
	const count = bridgeTrigger ? bridgeCount : agentCount;
	const accessibilityLabel = bridgeTrigger
		? bridgeCount !== null && bridgeBadge
			? bridgeBadge.a11yLabel
			: t("mobile.chrome.drawer.open")
		: agentCount !== null && agentCount > 0
			? t("mobile.chrome.drawer.open_count", { count: agentCount })
			: t("mobile.chrome.drawer.open");
	const ink = useTokenColor("ink-muted");
	const { effectiveScale } = useTextScale();
	const trigger = useRef<View | null>(null);
	return (
		<Pressable
			ref={trigger}
			accessibilityRole={ROLE.button}
			accessibilityLabel={accessibilityLabel}
			onPress={() =>
				drawer.open({ returnFocus: () => trigger.current?.focus(), mode })
			}
			testID={testID}
			className="items-center justify-center"
			style={{ minHeight: TOUCH_FLOOR, minWidth: TOUCH_FLOOR }}
		>
			<Menu color={ink} size={24} />
			{count !== null && count > 0 ? (
				<View
					pointerEvents="none"
					className={cx(
						"absolute",
						bridgeTrigger && "rounded-full border-2 border-canvas",
					)}
					style={bridgeTrigger ? BRIDGE_MENU_BADGE_INSET : MENU_BADGE_INSET}
				>
					{/* Team Bridge counts are the green emphasis pill everywhere
					 *  — this trigger, the drawer's segment and the directory rows —
					 *  so the same number is not red here and green one tap later
					 *  (design D1-3). Agent unreads keep Home's danger tone. */}
					{bridgeTrigger ? (
						<Badge
							label={countLabel(count)}
							emphasis
							mono
							scale={effectiveScale}
						/>
					) : (
						<Badge
							label={countLabel(count)}
							tone="danger"
							mono
							scale={effectiveScale}
						/>
					)}
				</View>
			) : null}
		</Pressable>
	);
};
