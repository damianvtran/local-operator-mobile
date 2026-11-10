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
import { LARGE_TEXT_SCALE } from "@/ui/text-scale";
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
 * The mode track's layout, by text scale. Exported so the arithmetic below is
 * pinned in a unit test (Node has no layout engine to measure it).
 *
 * BELOW `LARGE_TEXT_SCALE`: ONE row, always, and the unread count costs NO
 * layout. The panel at 320 pt is `sidebarWidthFor(320, 48)` = 272 pt; the
 * row's `px-3` (24) + `gap-1.5` (6) + the 48 pt close button leave 194 pt, the
 * track's `p-0.5` a 190 pt inner track, and its `gap-0.5` 188 pt for the two
 * segments. Agents (47 + 16 + 2) and Team Bridge (79 + 16 + 2) need ~162 pt; an
 * INLINE count (6 gap + up to 30.5 for "99+") pushed that to ~198.5 pt, so
 * "Team Bridge" wrapped to two lines, the bar grew 48 → 54.6 pt and the
 * drawer and the segment divider moved whenever an unread arrived (PR #222 UX U2-1/U2-2, design D2-2). The
 * count is therefore an out-of-flow corner overlay (`badge: "overlay"`): adding
 * or clearing "7" / "99+" changes zero layout pixels. Segments size from their
 * content (`grow`, basis auto) and share only the slack (D1-2/U1-1/Q1-2).
 *
 * AT AND ABOVE IT: the track wraps (PR #212 QA Q1-1) so "Team Bridge" breaks
 * onto its own row instead of truncating at 200 %+ / Urdu RTL. Segments are
 * content-proportioned (`grow shrink`, basis auto), NOT `flex-1` halves: equal
 * halves of the 190 pt track gave each label a 73 pt inner box, narrower than
 * the single word "Bridge" (~80 pt at 28 px), and with `min-w-0 shrink` on the
 * label that forced the mid-word break "Bridg / e" (design D2-1). Now a segment
 * that does not fit wraps onto its own full-width row, and the label never
 * shrinks below its longest word (`label` carries no `min-w-0 shrink`). The
 * count stays INLINE here: a 200–300 % pill overlaid on the corner would sit
 * on top of a wrapped label, and the wrap already absorbs its width.
 *
 * Both: the track stretches its children (`items-stretch`) so the two
 * segments are always the same height, and wrapped rows centre in the track
 * (`content-center`) rather than top-aligning one label above the other
 * (UX U1-2).
 */
export const modeBarLayout = (largeText: boolean) =>
	largeText
		? ({
				track:
					"min-w-0 flex-1 flex-row flex-wrap content-center items-stretch gap-0.5 rounded-md bg-sunken p-0.5",
				segment: "min-w-0 grow shrink",
				content: "flex-wrap px-2.5",
				label: "text-center text-body-sm",
				badge: "inline",
			} as const)
		: ({
				track:
					"min-w-0 flex-1 flex-row flex-nowrap content-center items-stretch gap-0.5 rounded-md bg-sunken p-0.5",
				segment: "min-w-0 grow shrink",
				content: "flex-nowrap px-2",
				label: "text-center text-body-sm",
				badge: "overlay",
			} as const);

/** Where the overlaid Team Bridge count sits on its segment's top-trailing
 *  corner. It rises into the row's `pt-1.5` (6 pt) and reaches past the track
 *  into the `gap-1.5` before the close button (or the docked pane's `px-3`),
 *  so it never clips or leaves the panel. `end`, not `right`, so Urdu RTL
 *  mirrors it to the leading corner. */
export const MODE_BADGE_INSET = { top: -5, end: -4 } as const;

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
 * at 200 %+ / RTL (whole-word wraps, never `numberOfLines={1}`), and a crisp
 * count in both selected and unselected states (`bg-elevated` / `bg-sunken`
 * grounds, never `bg-accent`, ringed in the segment's own ground).
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
	const layout = modeBarLayout(effectiveScale > LARGE_TEXT_SCALE);
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
			 *  wraps, and a segment that does not fit takes its own row so its
			 *  label breaks between words instead of ellipsizing. Below large
			 *  text it stays one row instead (`modeBarLayout`). */}
			<View className={layout.track}>
				<Pressable
					testID={CONTROL.workspaceDrawerAgents}
					accessibilityRole={ROLE.button}
					accessibilityLabel={t("mobile.chrome.drawer.agents")}
					accessibilityState={a11yState({ selected: agentsSelected })}
					aria-selected={agentsSelected}
					onPress={() => onSelectMode("agents")}
					className={layout.segment}
					style={{ minHeight: TOUCH_FLOOR }}
				>
					{({ pressed }) => (
						<View
							className={cx(
								"flex-1 flex-row items-center justify-center rounded-sm border py-1.5",
								layout.content,
								agentsSelected
									? "border-hairline bg-elevated"
									: pressed
										? "border-transparent bg-row-hover"
										: "border-transparent bg-transparent",
							)}
						>
							<Text
								className={cx(
									layout.label,
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
				<View className={layout.segment}>
					<Pressable
						testID={CONTROL.workspaceDrawerTeamBridge}
						accessibilityRole={ROLE.button}
						accessibilityLabel={bridgeBadge.a11yLabel}
						accessibilityState={a11yState({ selected: bridgeSelected })}
						aria-selected={bridgeSelected}
						onPress={() => onSelectMode("team-bridge")}
						/* `flex-1` so the Pressable fills its stretched wrapper and
						 *  both segments paint the same height. */
						className="flex-1"
						style={{ minHeight: TOUCH_FLOOR }}
					>
						{({ pressed }) => (
							<View
								className={cx(
									"flex-1 flex-row items-center justify-center gap-1.5 rounded-sm border py-1.5",
									layout.content,
									bridgeSelected
										? "border-hairline bg-elevated"
										: pressed
											? "border-transparent bg-row-hover"
											: "border-transparent bg-transparent",
								)}
							>
								<Text
									className={cx(
										layout.label,
										bridgeSelected
											? "font-semibold text-ink"
											: pressed
												? "font-medium text-ink"
												: "font-medium text-ink-muted",
									)}
								>
									{t("mobile.team_bridge.title")}
								</Text>
								{showCount &&
								bridgeBadge.count !== null &&
								layout.badge === "inline" ? (
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
					{/* Out of flow (U2-1/U2-2): a sibling of the Pressable, so it is
					 *  never part of the hit target's layout, and `pointerEvents
					 *  ="none"` so a tap on it still lands on the segment. The 2 pt
					 *  ring is the segment's own ground (`bg-elevated` selected,
					 *  the track's `bg-sunken` otherwise) so the pill reads as
					 *  lifted off its corner rather than fused to the edge. */}
					{showCount &&
					bridgeBadge.count !== null &&
					layout.badge === "overlay" ? (
						<View
							aria-hidden
							pointerEvents="none"
							className={cx(
								"absolute rounded-full border-2",
								bridgeSelected ? "border-elevated" : "border-sunken",
							)}
							style={MODE_BADGE_INSET}
						>
							<Badge
								label={countLabel(bridgeBadge.count)}
								emphasis
								mono
								scale={effectiveScale}
							/>
						</View>
					) : null}
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
