import { usePathname, useRouter } from "expo-router";
import { Menu } from "lucide-react-native";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useRef,
	useState,
} from "react";
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
import { t } from "@/i18n";
import { CONTROL, ROLE } from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { Badge } from "@/ui/components/badge";
import { Button } from "@/ui/components/button";
import { TOUCH_FLOOR } from "@/ui/layout";
import { useTextScale } from "@/ui/text-scale-provider";

const SESSION_PATH = /^\/session\/([^/]+)(?:\/|$)/;

const WorkspaceDrawerContext = createContext<
	| (WorkspaceDrawerController & {
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
	const { effectiveScale } = useTextScale();
	return (
		<WorkspaceDrawerContext.Provider
			value={{
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
						<View className="flex-row gap-2 px-4 py-2">
							<Button
								testID={CONTROL.workspaceDrawerAgents}
								label={t("mobile.chrome.drawer.agents")}
								selected={mode === "agents"}
								variant={mode === "agents" ? "primary" : "quiet"}
								onPress={() => selectMode("agents")}
							/>
							{/* LABEL AND COUNT ARE SEPARATE (Bridge UI brief §2). The
							 *  button's visible text is the stable product name; the
							 *  adapter's `a11yLabel` — which may carry the count or
							 *  "unavailable" — is its accessible name only, so the
							 *  selector never grows an ever-longer label. The count is
							 *  its own badge and is drawn ONLY for a known, positive
							 *  number: `null` is unknown and a non-ready state has no
							 *  count to trust, and neither may paint as a zero. */}
							<View className="flex-row items-center gap-1">
								<Button
									testID={CONTROL.workspaceDrawerTeamBridge}
									label={t("mobile.team_bridge.title")}
									accessibilityLabel={bridgeAdapter.bridgeBadge.a11yLabel}
									selected={Boolean(bridge)}
									variant={bridge ? "primary" : "quiet"}
									onPress={() => selectMode("team-bridge")}
								/>
								{bridgeAdapter.bridgeBadge.state === "ready" &&
								bridgeAdapter.bridgeBadge.count !== null &&
								bridgeAdapter.bridgeBadge.count > 0 ? (
									<View aria-hidden pointerEvents="none">
										<Badge
											label={countLabel(bridgeAdapter.bridgeBadge.count)}
											tone="warning"
											emphasis
											mono
											scale={effectiveScale}
										/>
									</View>
								) : null}
							</View>
						</View>
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
 * Unknown unread is absence, not zero; no local row count invents a receipt. */
export const WorkspaceDrawerButton = ({
	testID = CONTROL.homeSidebar,
}: {
	testID?: string;
}) => {
	const drawer = useWorkspaceDrawer();
	useLocaleFrame();
	const unread = useListState((state) => state.unread);
	const count = unreadBadgeCount(unread);
	const ink = useTokenColor("ink-muted");
	const { effectiveScale } = useTextScale();
	const trigger = useRef<View | null>(null);
	return (
		<Pressable
			ref={trigger}
			accessibilityRole={ROLE.button}
			accessibilityLabel={
				count !== null && count > 0
					? t("mobile.chrome.drawer.open_count", { count })
					: t("mobile.chrome.drawer.open")
			}
			onPress={() =>
				drawer.open({ returnFocus: () => trigger.current?.focus() })
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
