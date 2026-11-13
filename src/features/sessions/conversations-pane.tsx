import { useRouter } from "expo-router";
import {
	CalendarClock,
	ChevronRight,
	FolderKanban,
	History,
	Inbox,
	Library,
	Search,
	Settings,
	SquarePen,
	X,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	FlatList,
	Pressable,
	RefreshControl,
	Text,
	TextInput,
	type TextStyle,
	View,
} from "react-native";
import type { SessionSummary } from "@/contracts";
import { avatarRefOf } from "@/features/agent-avatar/agent-avatar";
import {
	DrawerComputerRow,
	switcherFocusReturn,
} from "@/features/auth/computer-entry-points";
import { useComputerSwitcher } from "@/features/auth/computer-switcher-sheet";
import {
	useConnection,
	useConnectionState,
	useListState,
} from "@/features/auth/connection-provider";
import { libraryEnabled } from "@/features/library/library-model";
import {
	countLabel,
	notificationsEnabled,
} from "@/features/notifications/notifications-model";
import { SessionMoveSheet } from "@/features/sessions/move-sheet";
import {
	degradedNote,
	degradedShortNote,
	inboxBadgeCount,
	isRemoteRow,
	splitSidebarSections,
	staleNote,
	staleShortNote,
	visiblePeers,
} from "@/features/sessions/session-projection";
import { SessionRow } from "@/features/sessions/session-row";
import { canAssignSessionTags } from "@/features/sessions/tags";
import { SessionTagsSheet } from "@/features/sessions/tags-sheet";
import {
	useOptionalWorkspaceDrawer,
	WorkspaceModeBar,
} from "@/features/sessions/workspace-drawer";
import { t } from "@/i18n";
import { useUiStore } from "@/state/ui-store";
import { TeamBridgeEntry } from "@/team-bridge/navigation";
import { CONTROL, EMPTY, REGION, ROLE, STATE_MARKER, SURFACE } from "@/ui/a11y";
import { useKeyboardAppearance, useTokenColor } from "@/ui/appearance";
import { Badge } from "@/ui/components/badge";
import { Banner } from "@/ui/components/banner";
import { Button } from "@/ui/components/button";
import { ConnectionPill } from "@/ui/components/connection-pill";
import { EmptyState } from "@/ui/components/empty-state";
import { IconButton } from "@/ui/components/icon-button";
import { SectionHeader } from "@/ui/components/section-header";
import { Sheet } from "@/ui/components/sheet";
import { Skeleton } from "@/ui/components/skeleton";
import { useComposedDir } from "@/ui/direction";
import { sidebarFooterScrolls, TOUCH_FLOOR, useLayout } from "@/ui/layout";
import { LARGE_TEXT_SCALE } from "@/ui/text-scale";
import { useTextScale } from "@/ui/text-scale-provider";

/**
 * The conversations pane: the sessions list, where it lives now.
 *
 * The list did not change its job when it moved behind the sidebar — it changed
 * its WIDTH and its neighbours. What carries over from F-5, and each is a
 * failure the shipped web client had to learn:
 *
 *  1. **One state mark per row, by precedence** (`session-projection.ts`), so a
 *     row that is both streaming and blocked shows the block.
 *  2. **The empty state is not a dead end.** It names the action and offers the
 *     one that changes the situation (start one, connect a computer, clear a
 *     search) — all three reachable from this pane, because the pane is the
 *     only list left.
 *  3. **Stale is not blank.** While the stream reconnects, the last known list
 *     stays under a sentence carrying its age. `degraded: ["sessions"]` is a
 *     DIFFERENT fact: the relay could not walk the catalogue, so the list is
 *     incomplete rather than old.
 *  4. **Sections** are the desktop's vocabulary (Pinned · Running · Today ·
 *     This week · Older). The old app's Active/Previous split retired with the
 *     move: two vocabularies for one list is the drift this repo's contract
 *     checks exist to stop, and the section ids in `ui/a11y` moved with it.
 *
 * The pane is rendered in two homes, and it is the same element in both: the
 * phone's temporary drawer (over the home, `conversations-drawer.tsx`) and the
 * tablet's docked pane (inside `SplitView`, `home.tsx`). The only difference is
 * `onClose`, which exists only where there is something to close.
 *
 * **The loading state is distinguishable from the empty state — and says so.**
 * The old list rendered three skeletons while its first frame was in flight,
 * but on a 320 pt phone the loading frame and the empty frame came out
 * byte-identical (R-2, measured by the design lane): the skeleton block is
 * short enough to be hidden under the header at that size, and BOTH states
 * lacked a marker, so neither the frame nor the machine could tell them apart.
 * Here the skeletons carry `sidebar/loading` in the DOM (a zero-size sibling),
 * the empty state carries `EMPTY.sessions`, and the two cannot be confused
 * again: a reader who has conversations arriving sees rows coming, not "No
 * sessions yet."
 */
export type ConversationsPaneProps = {
	/** Closes the drawer. Only the phone drawer passes it: the docked pane has
	 *  nothing to close, and a control that cannot work is this repo's oldest
	 *  anti-pattern. */
	onClose?: () => void;
	currentSessionId?: string;
	/** Called before any navigation (row tap, New chat, the footer's routes). The
	 *  drawer closes first, so a selection never leaves the panel covering the
	 *  screen it just opened; the docked pane has nothing to close and passes
	 *  nothing. */
	onNavigate?: () => void;
	/** The home's staging slot, handed back: closes the panel and focuses the
	 *  composer (the home owns the field, so only it can). */
	onNewChat?: () => void;
	/** The one honest sentence a dead deep link lands with (ADR 0006 § 6.6,
	 *  rendered by `app/(app)/conversations.tsx`). */
	notice?: string | null;
	/** The relay's own home directory, for shortening row paths. Owned by the
	 *  home screen (`directories()` is one read, and two readers of one datum is
	 *  how two labels drift). */
	homeDirectory?: string | null;
	/**
	 * The surface these rows sit on, handed to `ListRow` so a selected agent's
	 * badge ring matches what is actually behind the row.
	 *
	 * The list does not own its background: the same component renders inside the
	 * screen (`bg-surface`-free, `bg-elevated`-free — the screen's `bg-canvas`) and
	 * inside the phone drawer's panel (`bg-elevated`). Only the caller knows which, so a
	 * hardcoded ring was right in exactly one placement (agent review round 2, R2-2).
	 * Undefined leaves `ListRow`'s own default (the screen canvas) in place.
	 */
	/**
	 * When true, the caller (`WorkspaceDrawerProvider`) already rendered the
	 * top mode bar and `CONTROL.sidebarClose`, so this pane omits a duplicate
	 * close button on its search row. Defaults to false so standalone drawer
	 * renders without a `bridgeAdapter` still carry `CONTROL.sidebarClose`.
	 */
	hideCloseButton?: boolean;
	surfaceClassName?: string;
};

/**
 * The inbox count pill, on the Inbox destination's icon and on the "More" row.
 * One component so the two places cannot paint the count two ways; its text
 * scale is passed through because at 300 % the digits outgrow the fixed 16 pt
 * line box (D25).
 */
const RailCount = ({ count }: { count: number }) => {
	const { effectiveScale } = useTextScale();
	return (
		<View testID={CONTROL.sidebarNotificationsCount}>
			<Badge
				/* The app's one cap, as the home bell uses (R7-02/D21). */
				label={countLabel(count)}
				scale={effectiveScale}
				tone="warning"
				emphasis
				mono
				/* The destination's own name carries the count for assistive tech
				 *  ("Inbox, 3 unread"), so the pill is not announced a second time. */
				hidden={false}
			/>
		</View>
	);
};

/**
 * Shared workspace footer (computer switcher, Settings, Inbox/Past/Projects/
 * Schedules/Library rail + large-text "More" sheet). Extracted so both `Agents`
 * and `Team Bridge` drawer modes keep consistent workspace navigation at the
 * bottom of the panel, matching Desktop's `SidebarFoot` (`team-bridge-route-column.tsx`).
 */
export const WorkspaceSidebarFooter = ({
	onNavigate,
	hasModeHeader = false,
}: {
	onNavigate?: () => void;
	/** True when a labelled `WorkspaceModeBar` already sits at the top of this
	 *  panel (either the phone drawer with a `bridgeAdapter` or the docked
	 *  split pane with one), so the compact footer icon is not rendered a second time. */
	hasModeHeader?: boolean;
}) => {
	const router = useRouter();
	const capabilities = useListState((state) => state.capabilities);
	const inboxBlock = useListState((state) => state.notifications);
	const inboxCount = inboxBadgeCount(inboxBlock);
	const hasInboxCount = inboxCount !== null && inboxCount > 0;
	const [destinationsOpen, setDestinationsOpen] = useState(false);
	const destinationInk = useTokenColor("ink-muted");
	const { effectiveScale } = useTextScale();
	const largeText = effectiveScale > LARGE_TEXT_SCALE;

	const destinations = [
		...(notificationsEnabled(capabilities)
			? [
					{
						key: "inbox",
						label: t("mobile.chrome.destination.inbox"),
						accessibilityLabel: hasInboxCount
							? t("mobile.chrome.destination.inbox_count", {
									count: inboxCount ?? 0,
								})
							: t("mobile.chrome.destination.inbox"),
						route: "/notifications",
						Icon: Inbox,
						count: hasInboxCount ? inboxCount : null,
						testID: CONTROL.sidebarNotifications,
					},
				]
			: []),
		{
			key: "past",
			label: t("mobile.chrome.destination.past"),
			accessibilityLabel: t("relay.chrome.drawer.past"),
			route: "/past",
			Icon: History,
			count: null,
			testID: CONTROL.sidebarPast,
		},
		{
			key: "projects",
			label: t("relay.chrome.drawer.projects"),
			accessibilityLabel: t("relay.chrome.drawer.projects"),
			route: "/projects",
			Icon: FolderKanban,
			count: null,
			testID: CONTROL.sidebarProjects,
		},
		{
			key: "schedules",
			label: t("mobile.chrome.destination.schedules"),
			accessibilityLabel: t("mobile.chrome.destination.schedules"),
			route: "/schedules",
			Icon: CalendarClock,
			count: null,
			testID: CONTROL.sidebarSchedules,
		},
		...(libraryEnabled(capabilities)
			? [
					{
						key: "library",
						label: t("relay.chrome.drawer.library"),
						accessibilityLabel: t("relay.chrome.drawer.library"),
						route: "/library",
						Icon: Library,
						count: null,
						testID: CONTROL.sidebarLibrary,
					},
				]
			: []),
	] as const;

	const go = (route: string) => {
		onNavigate?.();
		router.push(route as never);
	};

	return (
		<>
			<View
				className="gap-2 border-t border-hairline px-2 pt-1 pb-2"
				testID={REGION.sidebarFooter}
			>
				{/* The workspace row sits ABOVE the destinations (design spec 2026-11-06
				 *  § 4): the destinations are the panel's bottom bar, at the edge the thumb
				 *  rests on, and the computer chip reads as the context the list above
				 *  belongs to rather than as a sixth destination.
				 *
				 *  `gap-2` (8 pt), not `gap-1`: the Inbox count rides 6 pt ABOVE its icon
				 *  (`top: -6` below), out of flow, and the slot's content grows to fill
				 *  it as text scales, so at worst the icon sits flush with the slot's top.
				 *  With a 4 pt gap the badge crossed the computer chip's outline (0.4 pt
				 *  at 100 % on iOS, 2 pt at 135 %; design round 1 D1); 8 pt keeps it
				 *  clear at every scale. `sidebar-footer.test.ts` pins the arithmetic. */}
				<View className="flex-row items-center gap-1">
					<View className="min-w-0 flex-1">
						<DrawerComputerRow
							testID={CONTROL.sidebarComputers}
							onNavigate={onNavigate}
						/>
					</View>
					{/* Team Bridge: a hub destination, never a relay capability, so it is
					 *  not capability-gated. Shown as a compact icon control ONLY when no
					 *  labelled `WorkspaceModeBar` sits at the top of the panel; inside
					 *  the drawer or split pane with `bridgeAdapter`, the mode bar owns
					 *  the labelled Agents / Team Bridge switch so we never duplicate an
					 *  unlabelled icon in the footer. */}
					{hasModeHeader ? null : (
						<TeamBridgeEntry variant="compact" onNavigate={onNavigate} />
					)}
					<IconButton
						accessibilityLabel={t("relay.chrome.drawer.settings")}
						onPress={() => go("/settings")}
						icon={({ color, size }) => <Settings color={color} size={size} />}
						testID={CONTROL.settingsButton}
					/>
				</View>
				{largeText ? (
					/* ≥ 200 %-class text: one honest row instead of five clipped labels. */
					<Pressable
						accessibilityRole={ROLE.button}
						accessibilityLabel={t("relay.chrome.row.more")}
						accessibilityHint={t("mobile.chrome.destinations")}
						onPress={() => setDestinationsOpen(true)}
						testID={CONTROL.sidebarMore}
						className="flex-row items-center gap-3 px-2"
						style={{ minHeight: TOUCH_FLOOR }}
					>
						<Text
							className="min-w-0 flex-1 text-body-sm text-ink"
							numberOfLines={1}
						>
							{t("relay.chrome.row.more")}
						</Text>
						{hasInboxCount ? <RailCount count={inboxCount} /> : null}
						<ChevronRight size={18} color={destinationInk} aria-hidden />
					</Pressable>
				) : (
					<View className="flex-row" accessibilityRole="toolbar">
						{destinations.map((item) => (
							/* `gap-1`: the icon-to-label step is the scale's 4 pt, not
							 *  `gap-0.5`'s off-scale 2 pt (U-42); the touch-floor slot absorbs it. */
							<Pressable
								key={item.key}
								accessibilityRole={ROLE.button}
								accessibilityLabel={item.accessibilityLabel}
								onPress={() => go(item.route)}
								testID={item.testID}
								className="min-w-0 flex-1 items-center justify-center gap-1"
								style={{ minHeight: TOUCH_FLOOR, minWidth: TOUCH_FLOOR }}
							>
								<View>
									<item.Icon size={20} color={destinationInk} aria-hidden />
									{item.count !== null ? (
										/* The count on the ICON's corner (record §3): out of
										 *  flow, so it never shifts the label off the slot's
										 *  centre — the asymmetry D19–D23 spent four rounds on. */
										<View
											pointerEvents="none"
											className="absolute"
											style={{ top: -6, start: 12 }}
										>
											<RailCount count={item.count} />
										</View>
									) : null}
								</View>
								{/* `meta` (12 pt sans), not the mono label: the mono step's wide
								 *  advance cut "Projects"/"Schedules" to "Projec…" in a 65 pt slot
								 *  on the first web capture. */}
								<Text className="text-meta text-ink-muted" numberOfLines={1}>
									{item.label}
								</Text>
							</Pressable>
						))}
					</View>
				)}
			</View>

			{/* "More" at large text: the same destinations as the strip, as full
			 *  rows a 200 % label fits in. Closes before navigating, like every row
			 *  sheet here, so no sheet is left stacked under the next screen. */}
			<Sheet
				visible={destinationsOpen}
				onClose={() => setDestinationsOpen(false)}
				title={t("mobile.chrome.destinations")}
				testID={CONTROL.sidebarDestinationsSheet}
			>
				<View className="pb-4">
					{destinations.map((item) => (
						<Pressable
							key={item.key}
							accessibilityRole={ROLE.button}
							accessibilityLabel={item.accessibilityLabel}
							onPress={() => {
								setDestinationsOpen(false);
								go(item.route);
							}}
							className="flex-row items-center gap-3 px-4"
							style={{ minHeight: TOUCH_FLOOR }}
						>
							<item.Icon size={20} color={destinationInk} aria-hidden />
							<Text className="min-w-0 flex-1 text-body text-ink">
								{item.accessibilityLabel === item.label
									? item.label
									: item.key === "inbox"
										? item.label
										: item.accessibilityLabel}
							</Text>
							{item.count !== null ? <RailCount count={item.count} /> : null}
						</Pressable>
					))}
				</View>
			</Sheet>
		</>
	);
};

export const ConversationsPane = ({
	onClose,
	currentSessionId,
	onNavigate,
	onNewChat,
	notice,
	homeDirectory,
	hideCloseButton = false,
	surfaceClassName,
}: ConversationsPaneProps) => {
	const router = useRouter();
	const { refreshList, relay, busy, streamHealth } = useConnection();
	const showToast = useUiStore((state) => state.showToast);
	/* The New chat row's glyph, in the same ink as every other quiet control in
	 *  the panel — the icon ramp's `ink-muted`, not a decorative accent. */

	const sessions = useListState((state) => state.sessions);
	const degraded = useListState((state) => state.degraded);
	/* NARROW SUBSCRIPTIONS (perf audit P11). `frameCount` and `lastFrameAt`
	 *  change on EVERY list frame, and subscribing to them re-rendered this
	 *  whole pane — header, footer, sheets and list shell — per frame for two
	 *  facts that almost never change: "has any frame arrived" and "how old is
	 *  the frame we are showing while STALE" (a fresh frame clears `stale`, and
	 *  `staleNote` answers null without it, so the timestamp is only read while
	 *  the flag is up). The selectors return exactly those, so zustand's
	 *  identity check skips the pane on an ordinary frame. */
	const anyFrame = useListState((state) => state.frameCount > 0);
	const stale = useListState((state) => state.stale);
	const lastFrameAt = useListState((state) =>
		state.stale ? state.lastFrameAt : null,
	);
	const capabilities = useListState((state) => state.capabilities);
	const route = useConnectionState((state) => state.route);
	const destinationInk = useTokenColor("ink-muted");
	const workspaceDrawer = useOptionalWorkspaceDrawer();
	const dockedBridgeAdapter = !onClose
		? workspaceDrawer?.bridgeAdapter
		: undefined;
	const dockedMode = dockedBridgeAdapter
		? (workspaceDrawer?.mode ?? "agents")
		: "agents";

	/* The header pill's field, focused by a tap anywhere on the capsule. */
	const searchField = useRef<TextInput | null>(null);
	const searchPlaceholderInk = useTokenColor("ink-dim");
	const keyboardAppearance = useKeyboardAppearance();
	const composedDir = useComposedDir();
	const [query, setQuery] = useState("");
	const [menuTarget, setMenuTarget] = useState<SessionSummary | null>(null);
	/* The move/offload sheet's subject. A REMOTE row's tap opens it directly
	 *  (that IS its detail affordance — there is no local session screen for
	 *  another device's conversation); a local row reaches it through the
	 *  long-press menu. */
	const [moveTarget, setMoveTarget] = useState<SessionSummary | null>(null);
	/* The tags sheet's subject. The row is kept FRESH from the list frames below:
	 *  its `tags`/`primary` are the authoritative assignment, and a snapshot taken
	 *  at open time would keep painting the pre-write state after the relay spoke. */
	const [tagTarget, setTagTarget] = useState<SessionSummary | null>(null);
	useEffect(() => {
		if (tagTarget === null) return;
		const fresh = sessions.find(
			(session) => session.session_id === tagTarget.session_id,
		);
		if (fresh !== undefined && fresh !== tagTarget) setTagTarget(fresh);
	}, [sessions, tagTarget]);

	/* The tag routes are optional on the wire: absence is an older relay, never
	 *  "available". The one comparison lives in `canAssignSessionTags`. */
	const tagsAssignable = canAssignSessionTags(capabilities);

	/* The devices the LOADED LIST reveals — the whole destination catalogue the
	 *  phone has today (`visiblePeers` states the gap). Computed from the
	 *  UNFILTERED list: a search that hides a row must not hide a destination. */
	const peers = useMemo(() => visiblePeers(sessions), [sessions]);

	const routed = route !== null;

	/* The clock the relative times are read against, ticking once a minute: the
	 * pane's finest unit is a minute ("59 min"), so a faster tick repaints
	 * nothing and a slower one lets "now" sit on a row for two minutes. The
	 * desktop's own cadence. */
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 60_000);
		return () => clearInterval(timer);
	}, []);

	const { effectiveScale } = useTextScale();
	const largeText = effectiveScale > LARGE_TEXT_SCALE;
	/* Large text counts here because the routes grow with it: at 200 % on a
	 *  320 × 568 pane the pinned footer left the list 60 pt and the first session
	 *  row — the only thing that tells `ended` from `populated` — was entirely
	 *  below the fold (`S15` refused the capture on 2026-10-27). The number of
	 *  destinations comes from the relay's own flags, so an older relay with fewer
	 *  routes keeps the pinned footer it has always had (R7-01). */
	/* The footer is two compact rows now (record §3), whatever the relay
	 *  advertises; at large text the strip is ONE "More" row. The floor helper
	 *  counts destination ROWS, so the pinned footer is charged as the rows it is.
	 *  Team Bridge adds a third, always-shown row above the strip: a hub
	 *  destination, not a relay capability, so it is charged unconditionally and its
	 *  caption (which wraps) is never hidden by a relay that advertises less.
	 *  Two and three both sit under the helper's five-route threshold, so this
	 *  documents the merged footer without moving the floor main measured. */
	const pinnedRoutes = 3;
	const layout = useLayout();
	const scrollFooter = sidebarFooterScrolls(layout, {
		largeText,
		routes: pinnedRoutes,
	});

	const { open: openComputerSwitcher } = useComputerSwitcher();

	const filtered = useMemo(() => {
		const needle = query.trim().toLowerCase();
		if (needle.length === 0) return sessions;
		return sessions.filter(
			(session) =>
				session.conversation_name.toLowerCase().includes(needle) ||
				session.cwd.toLowerCase().includes(needle) ||
				session.session_id.toLowerCase().includes(needle),
		);
	}, [query, sessions]);

	const sections = useMemo(
		() => splitSidebarSections(filtered, now),
		[filtered, now],
	);
	const items = useMemo(() => buildItems(sections), [sections]);
	/* Does any row in THIS list draw a picture? Then every row reserves the picture's
	 *  width for its title, so the list's titles share one left edge instead of
	 *  stepping in and out between pictured and plain rows (design review round 1,
	 *  D4 / agent review round 1, R2). Decided from the WIRE (`avatar_sha256`), not
	 *  from which pictures resolved: a row whose digest the relay 404s still reserves,
	 *  so the column does not move when a picture loads, fails or is removed. */
	const anyRowPictured = useMemo(
		() =>
			items.some(
				(item) => item.kind === "row" && avatarRefOf(item.session) !== null,
			),
		[items],
	);

	const degradedMessage = degradedNote(degraded);
	const staleMessage = staleNote({ stale, lastFrameAt });
	const staleShortMessage = staleShortNote({ stale, lastFrameAt });
	const waiting = !anyFrame && !loadFailed(streamHealth);
	const hasRoute = sessions.length > 0 || anyFrame;
	/* The header's New chat row yields while the empty state owns the screen
	 * (design D6): two "New chat" actions inside one 264 pt panel, and the CTA
	 * at the point of need — the empty state's own action, the one the flows
	 * press (`sessions-new-action`) — is the one that stays. All three terms are
	 * load-bearing (`sessions.length === 0` included — without it the row left a
	 * POPULATED list, caught on a rendered frame). Loading, search-empty and
	 * no-route keep it (their CTAs are different actions, not duplicates). */
	const noSessionsYet =
		!waiting && query.trim().length === 0 && hasRoute && sessions.length === 0;

	const onRefresh = useMemo(
		() => () => {
			void refreshList();
		},
		[refreshList],
	);

	const togglePin = async (session: SessionSummary) => {
		const client = relay();
		if (!client) return;
		try {
			/* The relay answers with the state it READ BACK, not the state asked
			 * for, so the toast reports the relay's answer. */
			const result = await client.pin(session.session_id, !session.pinned);
			showToast(result.pinned ? "Pinned." : "Unpinned.");
			await refreshList();
		} catch {
			showToast("That did not stick. Try again.", "danger");
		}
	};

	const openSession = (session: SessionSummary) => {
		// Selecting the current chat is a dismissal, not a duplicate route that
		// remounts its input. Other selections switch directly, without Home.
		if (session.session_id !== currentSessionId)
			router.navigate(`/session/${session.session_id}`);
		onNavigate?.();
	};

	/* One tap's meaning, decided by the row's kind: a local row opens its
	 * session; a REMOTE row opens the move sheet, because this device cannot
	 * tail another device's conversation and the sheet is where its one verb
	 * lives. */
	const activate = (session: SessionSummary) => {
		if (isRemoteRow(session)) {
			setMoveTarget(session);
			return;
		}
		openSession(session);
	};

	/* STABLE ROW CALLBACKS (perf audit P11). `activate` closes over the router,
	 *  the current session and `onNavigate`, so it is a new function every
	 *  render; handed to a row it would defeat `memo(SessionRow)`. The ref holds
	 *  the latest pair and the two callbacks the rows receive never change
	 *  identity. Written in an effect-free assignment on purpose: the handlers
	 *  only run from a press, long after this render committed. */
	const rowHandlers = useRef({ activate, setMenuTarget, setMoveTarget });
	rowHandlers.current = { activate, setMenuTarget, setMoveTarget };
	const onRowActivate = useCallback(
		(session: SessionSummary) => rowHandlers.current.activate(session),
		[],
	);
	const onRowLongPress = useCallback((session: SessionSummary) => {
		if (isRemoteRow(session)) rowHandlers.current.setMoveTarget(session);
		else rowHandlers.current.setMenuTarget(session);
	}, []);
	/* Hoisted so the list's cells keep ONE `renderItem` across pane renders;
	 *  its dependencies are the row props that are not per-session. */
	const renderItem = useCallback(
		({ item }: { item: Item }) =>
			item.kind === "header" ? (
				/* The ROW owns the gutter (design D8): the list has no padding of its
				 *  own, so a header carries the same 16 pt the rows' `px-4` does. */
				<View className="px-4">
					<SectionHeader label={item.label} testID={item.testID} />
				</View>
			) : (
				<SessionRow
					session={item.session}
					section={item.section}
					selected={item.session.session_id === currentSessionId}
					now={now}
					reserveLeading={anyRowPictured}
					surfaceClassName={surfaceClassName}
					homeDirectory={homeDirectory}
					tagsAssignable={tagsAssignable}
					onActivate={onRowActivate}
					onLongPress={onRowLongPress}
				/>
			),
		[
			anyRowPictured,
			currentSessionId,
			homeDirectory,
			now,
			onRowActivate,
			onRowLongPress,
			surfaceClassName,
			tagsAssignable,
		],
	);

	/* THE FOOTER (record §3): conversations first, everything else in two compact
	 *  rows. It was five full-width centred buttons plus the computer row — 328 pt
	 *  of an 874 pt panel, leaving ~4.5 conversation rows (D-B1, TestFlight 365).
	 *
	 *  The DESTINATIONS STRIP (the touch floor, 44/48 pt; was 52): equal slots, each a
	 *  20 pt icon over a 12 pt label (≈ 41 pt of content, so the floor holds it) — Inbox (with its count on the icon), Past, Projects,
	 *  Schedules, Library. Capability-gated slots disappear and the strip re-flows.
	 *  At large text the labels cannot fit five across, so the strip becomes ONE
	 *  "More" row that opens a sheet listing the same destinations — a label is
	 *  never dropped silently.
	 *
	 *  The WORKSPACE ROW (44 pt), ABOVE the strip: the computer in use (the ONE
	 *  switcher — the header's duplicate is gone, D-B2) and the Settings gear, moved
	 *  from the home header. Total ≈ 44 + 44 + 4 + 12 = 104 pt on iOS, so the strip
	 *  is a bottom bar rather than a stack of large buttons ("a bunch of large
	 *  buttons taking up space", the operator, build 453).
	 *
	 *  Short landscape still scrolls the footer WITH the list (`scrollFooter`). It
	 *  used to carry a -16 margin there to cancel the list's `px-4`; the list has
	 *  no padding since design D8, so it needs none. */
	const hasModeHeader = Boolean(onClose || dockedBridgeAdapter);
	const footer = (
		<WorkspaceSidebarFooter
			onNavigate={onNavigate}
			hasModeHeader={hasModeHeader}
		/>
	);

	if (dockedBridgeAdapter && dockedMode === "team-bridge") {
		return (
			<View className="flex-1" style={{ paddingTop: 0 }}>
				<WorkspaceModeBar
					mode={dockedMode}
					onSelectMode={(next) => workspaceDrawer?.selectMode(next)}
					bridgeBadge={dockedBridgeAdapter.bridgeBadge}
				/>
				{dockedBridgeAdapter.bridgePane({
					onNavigate: onNavigate ?? (() => undefined),
				})}
				{/* The workspace footer (computer switcher, Settings, Inbox/Past/
				 *  Projects/Schedules/Library) belongs to the PANEL, not to the
				 *  Agents mode: dropping it here left a docked split view in Team
				 *  Bridge mode with no way to Settings or the destinations short of
				 *  switching modes first (review R1-1). The bridge pane owns its own
				 *  scroll, so the footer always pins below it — without the
				 *  short-landscape negative margin, which only cancels the
				 *  conversation list's px-4 and has no list to cancel here. */}
				<WorkspaceSidebarFooter
					onNavigate={onNavigate}
					hasModeHeader={hasModeHeader}
				/>
			</View>
		);
	}

	return (
		<View className="flex-1" style={{ paddingTop: 0 }}>
			{dockedBridgeAdapter ? (
				<WorkspaceModeBar
					mode={dockedMode}
					onSelectMode={(next) => workspaceDrawer?.selectMode(next)}
					bridgeBadge={dockedBridgeAdapter.bridgeBadge}
				/>
			) : null}
			{/* ---- the header row (record §2.5): search pill · new chat · close ----
			 *  The touch floor plus `py-1` (52/56 pt; was a fixed 60): its children are
			 *  all touch-floor controls, so the extra 8 pt of a fixed 60 was air the
			 *  list could use (spec 2026-11-06 § 4, "better use of vertical space"). The computer switcher that sat here was the panel's SECOND
			 *  switcher (D-B2) — the footer's workspace row is the one — and the 56 pt
			 *  full-bleed "New chat" row below it is now the square-pen button, so the
			 *  list starts ~112 pt higher. The brand mark left too: the panel is for
			 *  conversations, and the home already carries the identity. */}
			<View className="flex-row items-center gap-1 px-2 py-1">
				{/* THE PILL IS THE FIELD (operator, TestFlight 906: "The typing in the
				 *  search is not in the part of the UI that is already the search bar,
				 *  it creates a second uglier looking bar"). It used to be a button that
				 *  toggled a second, labelled `Input` under the header. Now the text
				 *  input lives inside the pill — same `sunken` capsule, same touch-floor
				 *  height, same glyph and the same "Search" words as its placeholder —
				 *  so the reader types where they tapped and nothing appears below.
				 *
				 *  - The whole capsule focuses the field (`onPress`), so a tap on the
				 *    glyph or the padding still lands the caret; the outer Pressable is
				 *    not itself accessible, so a screen reader meets ONE control, the
				 *    field, named by `relay.chrome.list.search_label`.
				 *  - `×` appears only with text, clears it and keeps focus (the reader
				 *    is mid-search). Escape (web/hardware keyboard) clears first, then
				 *    blurs — the conventional two-step. Blurring KEEPS the query: the
				 *    filtered list is what they were looking for, and `×` or the empty
				 *    state's "Clear the search" undoes it.
				 *  - The empty field states the page's direction (`useComposedDir`) so
				 *    an RTL locale's placeholder sits on the right, as `Input` does. */}
				<Pressable
					accessible={false}
					onPress={() => searchField.current?.focus()}
					testID={CONTROL.sidebarSearch}
					/* `sunken`, the mode track's ground: `elevated` on the `elevated` panel
					 *  measured 1.00:1, so "Search" floated as bare text (design D10). */
					className="min-w-0 flex-1 flex-row items-center gap-2 rounded-full bg-sunken ps-3"
					style={{ minHeight: TOUCH_FLOOR }}
				>
					<Search size={18} color={destinationInk} aria-hidden />
					<TextInput
						ref={searchField}
						value={query}
						onChangeText={setQuery}
						placeholder={t("relay.chrome.list.search_open")}
						placeholderTextColor={searchPlaceholderInk}
						{...(query === "" ? composedDir : {})}
						accessibilityLabel={t("relay.chrome.list.search_label")}
						keyboardAppearance={keyboardAppearance}
						autoCapitalize="none"
						autoCorrect={false}
						returnKeyType="search"
						onKeyPress={(event) => {
							if (event.nativeEvent.key !== "Escape") return;
							if (query !== "") setQuery("");
							else searchField.current?.blur();
						}}
						/* The pill's own box is the height; the field fills it so the
						 *  whole capsule is the caret target. No vertical padding: the
						 *  platform default would push the pill past the touch floor. */
						className="min-w-0 flex-1 text-body-sm text-ink"
						style={SEARCH_FIELD_STYLE}
						testID={CONTROL.sidebarSearchField}
					/>
					{query === "" ? (
						/* Keeps the trailing edge of the empty pill where it was (`px-3`). */
						<View className="w-3" />
					) : (
						<IconButton
							accessibilityLabel={t("mobile.chrome.clear_search")}
							onPress={() => {
								setQuery("");
								searchField.current?.focus();
							}}
							icon={({ color, size }) => <X color={color} size={size} />}
							size={16}
							testID={CONTROL.sidebarSearchClear}
						/>
					)}
				</Pressable>
				{/* Hidden while the empty state's own "New chat" is on screen — the
				 *  same no-duplicate rule the old full-bleed row followed
				 *  (`noSessionsYet`). */}
				{noSessionsYet ? null : (
					<IconButton
						accessibilityLabel={t("mobile.chrome.new_chat")}
						onPress={() => {
							onNavigate?.();
							onNewChat?.();
						}}
						icon={({ color, size }) => <SquarePen color={color} size={size} />}
						size={22}
						testID={CONTROL.sidebarNewChat}
					/>
				)}
				{onClose && !hideCloseButton ? (
					<IconButton
						accessibilityLabel={t("mobile.chrome.close_conversations")}
						onPress={onClose}
						icon={({ color, size }) => <X color={color} size={size} />}
						testID={CONTROL.sidebarClose}
					/>
				) : null}
			</View>

			{notice ? (
				<View className="px-4 pb-1">
					<Text
						className="text-body-sm text-ink-muted"
						testID={SURFACE.sidebarNotice}
					>
						{notice}
					</Text>
				</View>
			) : null}

			{/* The connection pill belongs ABOVE the list, not inside it: inside,
			 *  it was a scrolling header whose box ended up under the footer at
			 *  200 % on a 320 pt phone (U-08, measured 8 pt into the New session
			 *  button). As a sibling of the list and the footer the three cannot
			 *  overlap by construction. It appears only when it has something to
			 *  say: a permanent "Connected" dot is furniture the eye skips. */}
			{routed && pillState(streamHealth, stale) !== "connected" ? (
				<View className="px-4 pb-1 pt-2">
					<ConnectionPill
						state={pillState(streamHealth, stale)}
						message={staleNote({ stale, lastFrameAt }) ?? undefined}
					/>
				</View>
			) : null}

			{degradedMessage ? (
				<View className="px-4 pt-2">
					<Banner
						tone="warning"
						/* A listing the relay could not walk is the state where the reader
						 *  most needs rows on screen. The long sentences run 73–80
						 *  characters; at large text the SHORT sentence renders instead —
						 *  complete in itself (so a screen reader loses nothing) and the
						 *  D29 fix: a warning naming neither cause nor consequence at the
						 *  one text size where it most needs spelling out. NO `maxLines`:
						 *  the 2-line cap was sized for the full-width 320 pt list, and in
						 *  the 264 pt drawer at 200 % the message column fits ~10
						 *  characters a line, so the cap cut "Some rows may be missing." to
						 *  "Some rows may be …" — the consequence word, gone (U-04/U-07
						 *  measured: content 122 px in the 81 px two-line box; PR #34
						 *  review round 2). The short sentence, painted whole, is the
						 *  bound now: 3 lines at 264 pt / 200 %, against the 260 pt band
						 *  the long copy once ate (Q4-2). */
						message={largeText ? degradedShortNote(degraded) : degradedMessage}
						testID={CONTROL.sessionsDegradedBanner}
					/>
				</View>
			) : null}

			<FlatList
				className="flex-1"
				accessibilityRole="none"
				testID={REGION.sidebarList}
				/* A focused search field (the header pill) can keep a native keyboard open. The footer now
				 * shares this scroller: handled taps must reach its navigation buttons
				 * instead of being consumed solely to dismiss that keyboard. */
				keyboardShouldPersistTaps="handled"
				/* No horizontal padding: each row's own `px-4` is the gutter, so its
				 *  pressed and selected fills run to the panel edges (the iOS list
				 *  idiom). With the list ALSO padded `px-4` the gutter was doubled —
				 *  headers at x 17, titles at 57 and the time 33 pt from the trailing
				 *  edge on Ola's 430 pt drawer (TestFlight 883, design D8); now 16, 40
				 *  and 16. Headers, the stale line and the empty state pad themselves. */
				contentContainerClassName="grow"
				ListFooterComponent={scrollFooter ? footer : null}
				data={items}
				keyExtractor={itemKey}
				refreshControl={
					<RefreshControl refreshing={busy} onRefresh={onRefresh} />
				}
				ListHeaderComponent={
					staleMessage ? (
						<View className="px-4 pt-2">
							<Text
								className="text-body-sm text-ink-dim"
								numberOfLines={largeText ? 1 : undefined}
								testID={STATE_MARKER.sidebar.stale}
							>
								{largeText ? staleShortMessage : staleMessage}
							</Text>
						</View>
					) : null
				}
				renderItem={renderItem}
				ListEmptyComponent={
					/* `flex-1` only while the empty state FITS. The pane's list owns its
					 *  own box (header, pill, New chat and footer are siblings), and when
					 *  the empty content is taller than the remainder a flexbox
					 *  `justify-center` overflows BOTH directions, riding up over the
					 *  header it sits under — the measured U-08 at 320 pt. At large text
					 *  the wrapper stops growing and the content flows naturally. */
					<View className={largeText ? "flex-none px-4" : "flex-1 px-4"}>
						<PaneEmpty
							waiting={routed && waiting}
							hasRoute={hasRoute}
							query={query}
							onClearSearch={() => setQuery("")}
							onNew={() => {
								onNavigate?.();
								onNewChat?.();
							}}
							onConnect={() => {
								onNavigate?.();
								// Both name controls choose a computer; management remains in Settings.
								openComputerSwitcher({
									returnFocusTestID: switcherFocusReturn(
										layout.split,
										CONTROL.sessionsConnectAction,
									),
								});
							}}
						/>
					</View>
				}
			/>

			{scrollFooter ? null : footer}

			{/* Long-press rather than a swipe: the same action, a gesture a reader
			 *  discovers by trying it, and a sheet that names what it is about to
			 *  do. Rendered by the PANE, not the drawer, so it is present in the
			 *  docked pane too; the Sheet is its own Modal, so it stacks over the
			 *  drawer's — the platform's own ordering, no z-index arithmetic. */}
			<Sheet
				visible={menuTarget !== null}
				onClose={() => setMenuTarget(null)}
				title={menuTarget?.conversation_name.trim() || "untitled"}
				/* The id is the STATE's marker, not decoration: a held press is the only
				 *  way to reach this sheet, and `S15/menu-open` asserts it from a frame
				 *  (round 3, R14). */
				testID={SURFACE.sessionMenuSheet}
			>
				<View className="gap-2 pb-4">
					{/*
					 * RECORDED, NOT FIXED (review round 4, U4): this sheet is the only route
					 * to `Pin to the top`, and a held press is the only way to reach the
					 * sheet — the row itself is a focusable button whose Enter opens the
					 * session, and nothing advertises the hold. So the action has no
					 * non-touch route today, for a keyboard or switch-control reader. The
					 * follow-up is an accessibility action on the row (or a visible affordance
					 * beside the timestamp), which is a pane-wide change rather than a fix to
					 * this sheet; recorded here because the alternative is that the next
					 * reader re-derives it from the frames.
					 */}
					<Button
						testID={CONTROL.sessionOpenCurrent}
						label={menuTarget?.pinned ? "Unpin" : "Pin to the top"}
						onPress={() => {
							const target = menuTarget;
							setMenuTarget(null);
							if (target) void togglePin(target);
						}}
						variant="outline"
					/>
					{/* The move/offload entry: the OTHER half of what a conversation's row
					 *  can do. A local row can only reach the move sheet from here; a
					 *  remote row opens the sheet on a TAP and never sees this menu
					 *  (pinning refuses an id with no local folder, so a menu that offered
					 *  it for a peer row would offer a dead control). */}
					<Button
						testID={CONTROL.sessionMoveOpen}
						label="Move or copy…"
						onPress={() => {
							const target = menuTarget;
							setMenuTarget(null);
							if (target) setMoveTarget(target);
						}}
						variant="outline"
					/>
					{/* Only a relay that advertises the routes gets the entry: an older
					 *  relay has no `/api/sessions/{id}/tags`, and a control that 404s is
					 *  the dead-control pattern this pane already rejects for move. */}
					{tagsAssignable ? (
						<Button
							testID={CONTROL.sessionTagsAction}
							label="Tags…"
							onPress={() => {
								const target = menuTarget;
								setMenuTarget(null);
								if (target) setTagTarget(target);
							}}
							variant="outline"
						/>
					) : null}
					<Button
						testID={CONTROL.sessionOpenPrevious}
						label="Open"
						onPress={() => {
							const target = menuTarget;
							setMenuTarget(null);
							if (target) openSession(target);
						}}
					/>
				</View>
			</Sheet>

			{/* The move/offload sheet, for whichever row asked for it — a remote row's
			 *  tap or a local row's menu. It renders its own states (pick, in flight,
			 *  receipt, refusal) and refreshes the list after every settled outcome;
			 *  its subject is `moveTarget`, which is null while closed. */}
			<SessionMoveSheet
				visible={moveTarget !== null}
				session={moveTarget}
				peers={peers}
				onClose={() => setMoveTarget(null)}
			/>

			{/* The assignment sheet, for a LOCAL row only (the menu never opens for a
			 *  remote one). Its subject is kept fresh from the list frames above, so
			 *  the next authoritative row retires the local draft. */}
			<SessionTagsSheet
				visible={tagTarget !== null}
				sessionId={tagTarget?.session_id ?? ""}
				tags={tagTarget?.tags ?? []}
				primary={tagTarget?.primary ?? null}
				onClose={() => setTagTarget(null)}
			/>
		</View>
	);
};

/** The connection pill's state, from the stream's own status. A stale list reads
 *  as degraded even while the socket looks open: what the reader has is old. */
function pillState(
	health: ReturnType<typeof useConnection>["streamHealth"],
	stale: boolean,
): "connected" | "reconnecting" | "offline" | "degraded" {
	if (stale) return "degraded";
	if (health === "connecting") return "reconnecting";
	if (health === "offline") return "offline";
	if (health === "degraded") return "degraded";
	return "connected";
}

/** True when the stream failed before any frame arrived: skeletons would be a
 *  promise, and an empty list would be a wrong answer. */
function loadFailed(
	health: ReturnType<typeof useConnection>["streamHealth"],
): boolean {
	return health === "offline";
}

type Item =
	| { kind: "header"; key: string; label: string; testID?: string }
	| { kind: "row"; key: string; session: SessionSummary; section: string };

/** Module-level so the list never sees a new extractor (perf audit P11). */
/** The pill's field: fills the capsule's height (the capsule owns the touch
 *  floor) with the platform's vertical padding removed, so typing in place
 *  cannot grow the header. */
const SEARCH_FIELD_STYLE: TextStyle = {
	alignSelf: "stretch",
	paddingVertical: 0,
};

const itemKey = (item: Item): string => item.key;

/**
 * The flat list the pane renders: section headings and rows, in the relay's own
 * order (bucketing preserves it — nothing here re-sorts).
 *
 * A section is emitted only when it has rows, EXCEPT that Pinned always heads
 * the list and Running follows it. The old screen emitted Active and Previous
 * together including the empty one, because a reader whose conversations have
 * all ended should see where live ones will appear; the time-based sections do
 * that job here, and an empty "Today" heading above an empty list would be four
 * headings and no rows.
 */
function buildItems(sections: ReturnType<typeof splitSidebarSections>): Item[] {
	const items: Item[] = [];
	const push = (
		label: string,
		testID: string,
		rows: SessionSummary[],
		section: string,
	) => {
		if (rows.length === 0) return;
		items.push({ kind: "header", key: `h-${label}`, label, testID });
		for (const session of rows) {
			items.push({ kind: "row", key: session.session_id, session, section });
		}
	};
	push("Pinned", REGION.sidebarSectionPinned, sections.pinned, "pinned");
	push("Running", REGION.sidebarSectionRunning, sections.running, "running");
	push("Today", REGION.sidebarSectionToday, sections.today, "today");
	push("This week", REGION.sidebarSectionWeek, sections.week, "week");
	push("Older", REGION.sidebarSectionOlder, sections.older, "older");
	return items;
}

/**
 * The three pane states that are not a list: loading, no route, and no sessions
 * — plus a search with no matches, which is its own state and says so.
 *
 * `waiting` renders three skeleton rows and carries the `sidebar/loading`
 * marker, so the state is distinguishable from empty BY MACHINE as well as by
 * eye (R-2: the two frames were byte-identical, both markerless, and nothing
 * could tell them apart).
 */
const PaneEmpty = ({
	waiting,
	hasRoute,
	query,
	onClearSearch,
	onNew,
	onConnect,
}: {
	waiting: boolean;
	hasRoute: boolean;
	query: string;
	onClearSearch: () => void;
	onNew: () => void;
	onConnect: () => void;
}) => {
	if (waiting) {
		return (
			<View
				className="gap-3 py-3"
				aria-hidden
				testID={STATE_MARKER.sidebar.loading}
			>
				<Skeleton lines={1} ground="raised" />
				<Skeleton lines={1} ground="raised" />
				<Skeleton lines={1} ground="raised" />
			</View>
		);
	}
	if (query.trim().length > 0) {
		return (
			<EmptyState
				headline="Nothing matches that."
				next="Search covers the loaded sessions' names, ids and folders."
				action={{
					label: "Clear the search",
					/* A control that renders and does nothing when pressed is the defect this
					 *  replaces: this shipped as `onPress: () => undefined`. The predicate is
					 *  the one this branch renders on, passed through so the button's enabled
					 *  state cannot disagree with there being something to clear. */
					onPress: onClearSearch,
					disabled: query.trim().length === 0,
					testID: CONTROL.sessionsClearSearchAction,
				}}
				testID={STATE_MARKER.sidebar["empty-search"]}
			/>
		);
	}
	if (!hasRoute) {
		return (
			<EmptyState
				headline="No computer is connected yet."
				next="This app drives the sessions on your own computer, so it needs one first."
				action={{
					label: "Connect a computer",
					onPress: onConnect,
					testID: CONTROL.sessionsConnectAction,
				}}
				testID={CONTROL.sessionsNoRoute}
			/>
		);
	}
	return (
		<EmptyState
			headline="No sessions yet."
			next="A session is one conversation with the agent on your machine. Start one and it will appear here."
			action={{
				label: "New chat",
				onPress: onNew,
				testID: CONTROL.sessionsNewAction,
			}}
			testID={EMPTY.sessions}
		/>
	);
};
