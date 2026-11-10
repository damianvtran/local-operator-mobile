import { usePathname, useRouter } from "expo-router";
import { Menu, X } from "lucide-react-native";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useRef,
	useState,
} from "react";
import { Keyboard, Platform, Pressable, Text, View } from "react-native";
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
import { t } from "@/i18n";
import { state as a11yState, CONTROL, ROLE } from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { Badge } from "@/ui/components/badge";
import { IconButton } from "@/ui/components/icon-button";
import { TOUCH_FLOOR } from "@/ui/layout";
import { useTextScale } from "@/ui/text-scale-provider";
import { cx } from "@/ui/variants";

const SESSION_PATH = /^\/session\/([^/]+)(?:\/|$)/;

const WorkspaceDrawerContext = createContext<
	| (WorkspaceDrawerController & {
			mode: WorkspaceDrawerMode;
			bridgeAdapter?: WorkspaceDrawerBridgeAdapter;
			newChatRequest: number;
			consumeNewChatRequest: (request: number) => boolean;
			setAgentsPresentation: (value: {
				notice?: string | null;
				homeDirectory?: string | null;
			}) => void;
	  })
	| null
>(null);

export const useWorkspaceDrawer = () => {
	const value = useContext(WorkspaceDrawerContext);
	if (!value) throw new Error("WorkspaceDrawerProvider is required");
	return value;
};

/**
 * Optional reader for surfaces (`ConversationsPane`) that render both inside
 * `WorkspaceDrawerProvider` and inside isolated tests without one.
 */
export const useOptionalWorkspaceDrawer = () =>
	useContext(WorkspaceDrawerContext);

/**
 * Minimal, calm segmented mode track shared by the temporary workspace drawer
 * and the docked split-view pane.
 *
 * WHY NOT `Button variant="primary"`. Two standalone 44 pt primary CTA slabs
 * turned a navigation mode toggle into competing green action banners, and an
 * emphasis `bg-accent` badge on top of a selected `bg-accent` button collapsed
 * into a zero-contrast green-on-green lump. Here a quiet sunken pill track
 * raises the active segment (`bg-elevated`, subtle hairline, `text-ink
 * font-semibold`) while keeping `TOUCH_FLOOR` hit height, full multi-line wrap
 * at 200 %+ / RTL (`min-w-0 shrink`, never `numberOfLines={1}`), and crisp
 * inline badge contrast in both selected and unselected states.
 *
 * When `onClose` is supplied (the temporary drawer), `CONTROL.sidebarClose`
 * sits on the same top chrome row so neither Agents nor Team Bridge needs a
 * second 52 pt close-button band underneath.
 */
export const WorkspaceModeBar = ({
	mode,
	onSelectMode,
	bridgeBadge,
	onClose,
}: {
	mode: WorkspaceDrawerMode;
	onSelectMode: (next: WorkspaceDrawerMode) => void;
	bridgeBadge: WorkspaceDrawerBridgeAdapter["bridgeBadge"];
	onClose?: () => void;
}) => {
	const { effectiveScale } = useTextScale();
	const agentsSelected = mode === "agents";
	const bridgeSelected = mode === "team-bridge";
	const showCount =
		bridgeBadge.state === "ready" &&
		bridgeBadge.count !== null &&
		bridgeBadge.count > 0;
	return (
		<View className="flex-row items-center gap-1.5 px-3 pt-1.5 pb-1">
			{/* WRAP, NEVER TRUNCATE (PR #212 QA Q1-1 / design D1 / UX U1).
			 *  At 200 % text a fixed row cut "Team Bridge" to "Team B" and
			 *  pushed the badge past the panel (320/390 pt phones, Urdu RTL
			 *  started the button at x −88; text scale reaches 3×). The track
			 *  wraps, and each segment may shrink (`min-w-0 shrink`) so its
			 *  label breaks cleanly onto a second line instead of ellipsizing. */}
			<View className="min-w-0 flex-1 flex-row flex-wrap items-center gap-0.5 rounded-md bg-sunken p-0.5">
				<Pressable
					testID={CONTROL.workspaceDrawerAgents}
					accessibilityRole={ROLE.button}
					accessibilityLabel={t("mobile.chrome.drawer.agents")}
					accessibilityState={a11yState({ selected: agentsSelected })}
					aria-selected={agentsSelected}
					onPress={() => onSelectMode("agents")}
					className="min-w-0 flex-1 shrink"
					style={{ minHeight: TOUCH_FLOOR }}
				>
					{({ pressed }) => (
						<View
							className={cx(
								"flex-1 flex-row items-center justify-center rounded-sm border px-2.5 py-1.5",
								agentsSelected
									? "border-hairline bg-elevated"
									: pressed
										? "border-transparent bg-row-hover"
										: "border-transparent bg-transparent",
							)}
						>
							<Text
								className={cx(
									"text-center text-body-sm",
									agentsSelected
										? "font-semibold text-ink"
										: pressed
											? "font-medium text-ink"
											: "font-medium text-ink-muted",
								)}
							>
								{t("mobile.chrome.drawer.agents")}
							</Text>
						</View>
					)}
				</Pressable>
				{/* LABEL AND COUNT ARE SEPARATE (Bridge UI brief §2). The
				 *  segment's visible text is the stable product name; the
				 *  adapter's `a11yLabel` — which may carry the count or
				 *  "unavailable" — is its accessible name only, so the
				 *  selector never grows an ever-longer label. The count is
				 *  its own badge and is drawn ONLY for a known, positive
				 *  number: `null` is unknown and a non-ready state has no
				 *  count to trust, and neither may paint as a zero. */}
				<View className="min-w-0 flex-1 shrink">
					<Pressable
						testID={CONTROL.workspaceDrawerTeamBridge}
						accessibilityRole={ROLE.button}
						accessibilityLabel={bridgeBadge.a11yLabel}
						accessibilityState={a11yState({ selected: bridgeSelected })}
						aria-selected={bridgeSelected}
						onPress={() => onSelectMode("team-bridge")}
						style={{ minHeight: TOUCH_FLOOR }}
					>
						{({ pressed }) => (
							<View
								className={cx(
									"flex-1 flex-row flex-wrap items-center justify-center gap-1.5 rounded-sm border px-2.5 py-1.5",
									bridgeSelected
										? "border-hairline bg-elevated"
										: pressed
											? "border-transparent bg-row-hover"
											: "border-transparent bg-transparent",
								)}
							>
								<Text
									className={cx(
										"text-center text-body-sm",
										bridgeSelected
											? "font-semibold text-ink"
											: pressed
												? "font-medium text-ink"
												: "font-medium text-ink-muted",
									)}
								>
									{t("mobile.team_bridge.title")}
								</Text>
								{showCount && bridgeBadge.count !== null ? (
									<View aria-hidden pointerEvents="none">
										<Badge
											label={countLabel(bridgeBadge.count)}
											emphasis
											mono
											scale={effectiveScale}
										/>
									</View>
								) : null}
							</View>
						)}
					</Pressable>
				</View>
			</View>
			{onClose ? (
				<IconButton
					accessibilityLabel={t("mobile.chrome.close_conversations")}
					onPress={onClose}
					icon={({ color, size }) => <X color={color} size={size} />}
					testID={CONTROL.sidebarClose}
				/>
			) : null}
		</View>
	);
};

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

/** Home and chats deliberately share the exact projection and glyph geometry.
 * Unknown unread is absence, not zero; no local row count invents a receipt.
 * When `mode === "team-bridge"` (the thread header's hamburger), the badge and
 * accessible name reflect Team Bridge's known unreads rather than agent chat
 * unreads; when `mode` is omitted and agent unreads are absent/zero, known
 * positive bridge unreads still surface on the menu icon so hub messages are
 * not hidden behind a badge-free button. */
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
	const useBridgeCount =
		mode === "team-bridge" ||
		((agentCount === null || agentCount <= 0) && bridgeCount !== null);
	const count =
		mode === "team-bridge"
			? bridgeCount
			: agentCount && agentCount > 0
				? agentCount
				: bridgeCount;
	const accessibilityLabel = useBridgeCount
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
					className="absolute"
					style={MENU_BADGE_INSET}
				>
					<Badge
						label={countLabel(count)}
						tone="danger"
						mono
						scale={effectiveScale}
					/>
				</View>
			) : null}
		</Pressable>
	);
};
