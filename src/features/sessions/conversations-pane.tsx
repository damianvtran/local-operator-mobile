import { useRouter } from "expo-router";
import { Search, SquarePen, X } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";

import type { SessionSummary } from "@/contracts";
import {
	useConnection,
	useConnectionState,
	useListState,
} from "@/features/auth/connection-provider";
import { SessionMoveSheet } from "@/features/sessions/move-sheet";
import {
	attentionWord,
	degradedNote,
	degradedShortNote,
	isRemoteRow,
	relativeTimeFor,
	remoteAttention,
	remoteDeviceLabel,
	splitSidebarSections,
	staleNote,
	staleShortNote,
	visiblePeers,
} from "@/features/sessions/session-projection";
import { homeShortened } from "@/lib/format";
import { listLabel } from "@/lib/route-label";
import { useUiStore } from "@/state/ui-store";
import {
	CONTROL,
	EMPTY,
	REGION,
	ROLE,
	remoteSessionRowId,
	STATE_MARKER,
	SURFACE,
	sessionRowId,
} from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { Banner } from "@/ui/components/banner";
import { Button } from "@/ui/components/button";
import { ConnectionPill } from "@/ui/components/connection-pill";
import { EmptyState } from "@/ui/components/empty-state";
import { IconButton } from "@/ui/components/icon-button";
import { Input } from "@/ui/components/input";
import { ListRow } from "@/ui/components/list-row";
import { tailFit } from "@/ui/components/list-row-meta";
import { SectionHeader } from "@/ui/components/section-header";
import { Sheet } from "@/ui/components/sheet";
import { Skeleton } from "@/ui/components/skeleton";
import { TOUCH_FLOOR } from "@/ui/layout";
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
};

export const ConversationsPane = ({
	onClose,
	onNavigate,
	onNewChat,
	notice,
	homeDirectory,
}: ConversationsPaneProps) => {
	const router = useRouter();
	const { refreshList, relay, busy, streamHealth } = useConnection();
	const showToast = useUiStore((state) => state.showToast);
	/* The New chat row's glyph, in the same ink as every other quiet control in
	 *  the panel — the icon ramp's `ink-muted`, not a decorative accent. */
	const newChatInk = useTokenColor("ink-muted");

	const sessions = useListState((state) => state.sessions);
	const degraded = useListState((state) => state.degraded);
	const frameCount = useListState((state) => state.frameCount);
	const stale = useListState((state) => state.stale);
	const lastFrameAt = useListState((state) => state.lastFrameAt);
	const computers = useConnectionState((state) => state.computers);
	const tunnelId = useConnectionState((state) => state.tunnelId);
	const route = useConnectionState((state) => state.route);

	const [searching, setSearching] = useState(false);
	const [query, setQuery] = useState("");
	const [menuTarget, setMenuTarget] = useState<SessionSummary | null>(null);
	/* The move/offload sheet's subject. A REMOTE row's tap opens it directly
	 *  (that IS its detail affordance — there is no local session screen for
	 *  another device's conversation); a local row reaches it through the
	 *  long-press menu. */
	const [moveTarget, setMoveTarget] = useState<SessionSummary | null>(null);

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

	/* The switcher's painted label. The text box's OWN width is the budget —
	 *  measured on the line, so it cannot drift from the flex rules — and the
	 *  fit is the row's meta arithmetic (`tailFit`): whole before the first
	 *  layout (the common label fits, so the first frame is the settled frame),
	 *  tail-kept once the box is narrower than the string. Measured motivation
	 *  (review round 3, D3): at 200 % the drawer's 143 dp box dropped the port
	 *  of `127.0.0.1:51078` — the only part that differs per session — because
	 *  react-native-web ignores `ellipsizeMode`, so the painted STRING is the
	 *  only control over which end survives. The home header paints the same
	 *  ladder whole at 200 %: its box is wider, and the fit engages only where
	 *  the box runs out. */
	const switcherLabel = listLabel(computers, tunnelId, route);
	const [switcherLabelWidth, setSwitcherLabelWidth] = useState(0);
	const paintedSwitcherLabel =
		switcherLabelWidth > 0
			? tailFit(switcherLabel, switcherLabelWidth, effectiveScale)
			: switcherLabel;

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

	const degradedMessage = degradedNote(degraded);
	const staleMessage = staleNote({ stale, lastFrameAt });
	const staleShortMessage = staleShortNote({ stale, lastFrameAt });
	const waiting = frameCount === 0 && !loadFailed(streamHealth);
	const hasRoute = sessions.length > 0 || frameCount > 0;
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
		onNavigate?.();
		router.push(`/session/${session.session_id}`);
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

	return (
		<View className="flex-1" style={{ paddingTop: 0 }}>
			{/* ---- the header row: switcher・search・close (close: drawer only) ---- */}
			<View className="flex-row items-center gap-1 px-2">
				<Pressable
					accessibilityRole={ROLE.button}
					accessibilityLabel={`${switcherLabel} — choose a computer`}
					onPress={() => {
						onNavigate?.();
						router.push("/tunnels");
					}}
					testID={CONTROL.sidebarSwitcher}
					className="min-w-0 flex-1 justify-center px-2"
					/* The floor is the PLATFORM's: 44 on iOS, 48 wherever `Platform.OS`
					 *  is not iOS — the web/audit profile included, which is the build the
					 *  audit measures (QA round 1 caught the 44 pt `min-h-11` switcher). */
					style={{ minHeight: TOUCH_FLOOR }}
				>
					<Text
						className="text-mono-sm text-ink-muted"
						numberOfLines={1}
						ellipsizeMode="tail"
						/* The painted string is fitted above (`tailFit`); this pair stays as the
						 *  platform mop-up, as on the row's meta line: on iOS/Android the tail
						 *  ellipsis is the direction the fitted string already has. */
						onLayout={(event) =>
							setSwitcherLabelWidth(event.nativeEvent.layout.width)
						}
					>
						{paintedSwitcherLabel}
					</Text>
				</Pressable>
				<IconButton
					accessibilityLabel="Search conversations"
					onPress={() => setSearching((value) => !value)}
					icon={({ color, size }) => <Search color={color} size={size} />}
					testID={CONTROL.sidebarSearch}
				/>
				{onClose ? (
					<IconButton
						accessibilityLabel="Close conversations"
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

			{searching ? (
				<View className="px-4 pb-2">
					<Input
						label="Search conversations"
						value={query}
						onChangeText={setQuery}
						placeholder="Name, id or folder"
						autoFocus
						testID={CONTROL.sidebarSearchField}
					/>
				</View>
			) : null}

			{/* The panel's own way in: full-bleed, 56 pt, a hairline under it. The
			 *  home's one staging slot means this never stages a SECOND draft — it
			 *  closes the panel and hands the composer back (P-4: a control that
			 *  overwrote typed text would be a data-loss control). */}
			{!noSessionsYet ? (
				<Pressable
					accessibilityRole={ROLE.button}
					accessibilityLabel="New chat"
					onPress={() => {
						onNavigate?.();
						onNewChat?.();
					}}
					testID={CONTROL.sidebarNewChat}
					className="flex-row items-center gap-3 border-hairline border-b px-4"
					style={{ minHeight: 56 }}
				>
					<SquarePen size={20} color={newChatInk} />
					<Text className="text-body text-ink">New chat</Text>
				</Pressable>
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
				contentContainerClassName="grow px-4"
				data={items}
				keyExtractor={(item) => item.key}
				refreshControl={
					<RefreshControl refreshing={busy} onRefresh={onRefresh} />
				}
				ListHeaderComponent={
					staleMessage ? (
						<View className="pt-2">
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
				renderItem={({ item }) => {
					if (item.kind === "header") {
						return <SectionHeader label={item.label} testID={item.testID} />;
					}
					const session = item.session;
					/* The row's kind decides the live facts' SOURCE, and the two must not
					 * be mixed: a local row's `streaming`/`needs_attention`/`degraded` are
					 * the relay's local vocabulary, while a remote row's are the
					 * transport's `live_state`/`pending` VERBATIM (`session-projection`
					 * states the mapping). The boundary's defaults make a remote row READ
					 * as an idle local one, which is why every live field below is branched
					 * on the row's kind rather than read through the default. */
					const remote = isRemoteRow(session);
					return (
						<ListRow
							title={session.conversation_name.trim() || "untitled"}
							cwd={
								remote
									? undefined
									: homeDirectory
										? homeShortened(session.cwd, homeDirectory)
										: session.cwd
							}
							model={session.model_label}
							time={
								item.section === "running"
									? undefined
									: (relativeTimeFor(session, now) ?? undefined)
							}
							pending={
								remote
									? remoteAttention(session) !== null
									: session.needs_attention
							}
							attentionWord={attentionWord(session)}
							streaming={
								remote ? session.live_state === "busy" : session.streaming
							}
							unread={session.unseen}
							ended={session.ended === true}
							degraded={
								remote
									? session.live_state === "wedged"
									: session.degraded === true
							}
							subagentCount={session.subagents_running ?? 0}
							remote={
								remote
									? {
											device: remoteDeviceLabel(session),
											reachable: session.reachable !== false,
											indicatorTestID: remoteSessionRowId(session.session_id),
										}
									: undefined
							}
							onPress={() => activate(session)}
							onLongPress={() =>
								remote ? setMoveTarget(session) : setMenuTarget(session)
							}
							longPressAccessibilityHint={
								remote ? "Move or copy" : "Pin or open"
							}
							testID={sessionRowId(session.session_id)}
						/>
					);
				}}
				ListEmptyComponent={
					/* `flex-1` only while the empty state FITS. The pane's list owns its
					 *  own box (header, pill, New chat and footer are siblings), and when
					 *  the empty content is taller than the remainder a flexbox
					 *  `justify-center` overflows BOTH directions, riding up over the
					 *  header it sits under — the measured U-08 at 320 pt. At large text
					 *  the wrapper stops growing and the content flows naturally. */
					<View className={largeText ? "flex-none" : "flex-1"}>
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
								router.push("/tunnels");
							}}
						/>
					</View>
				}
			/>

			{/* The footer: the four secondary routes, each a 44 pt target. The
			 *  panel's own navigation, always visible — the desktop sidebar's
			 *  footer, phone-sized. `docs/ux/flows.md` draws `--|projects|` as a
			 *  PEER of `--|past|` off the conversations panel, so the entry point
			 *  belongs here rather than behind a settings row — and Schedules
			 *  (S17) reads the same way: the desktop sidebar carries it as a
			 *  top-level destination beside Projects.
			 *
			 *  THE PAIR WRAPS ON ITS OWN CONTENT, AND THAT IS THE RULE — there is no
			 *  scale threshold here on purpose. This footer used to switch
			 *  row-versus-column on `effectiveScale > LARGE_TEXT_SCALE` (1.4), and that
			 *  guard was answering a different question: the pair only broke ABOVE
			 *  1.4, so the band from 1.35 to 1.4 — inside the very branch the guard
			 *  was meant to protect — wrapped "Past sessions" onto two lines and
			 *  left-aligned it while "Computers" stayed one line and centred, so the
			 *  pair row read broken. Measured on the 320 pt phone at 1.3529411765
			 *  (iOS xxxLarge, the largest standard Dynamic Type step) and at 1.375
			 *  (the browser's own 22 px default) — both real user settings, and both
			 *  BELOW the guard that was supposed to cover them (design review round 2, D6).
			 *  The band existed because two numbers were being compared: a global
			 *  scale constant and a per-cell text box.
			 *
			 *  So the BOX makes the decision instead. Each cell is `flex-auto`, which
			 *  makes the flex line break on the label's own width: the two share a
			 *  row while both labels fit, and a label that stops fitting moves to its
			 *  own full-width row. Nothing here can drift the way the constant did,
			 *  because nothing here is compared — the layout measures the thing it is
			 *  laying out. (`flex-1` would NOT do: its zero base size means a wrap
			 *  never engages and the cell only squeezes, which is the behaviour the
			 *  older note here recorded, and it is still true of `flex-1`.) The
			 *  full-width controls beneath the pair keep that band, so the shape is
			 *  2+1+1 when the pair fits and 1+1+1+1 when it does not.
			 *
			 *  That is why the scale axis carries a step inside the old band
			 *  (`tools/visual/matrix.ts` SCALES, `135`): a re-capture at 100/150/200
			 *  could not show this defect at all, because both bracketing scales sit
			 *  outside it. */}
			<View className="gap-2 border-hairline border-t px-2 pb-2 pt-2">
				<View className="flex-row flex-wrap gap-2">
					<View className="flex-auto">
						<Button
							label="Past sessions"
							onPress={() => {
								onNavigate?.();
								router.push("/past");
							}}
							variant="quiet"
							size="sm"
							testID={CONTROL.sidebarPast}
						/>
					</View>
					<View className="flex-auto">
						<Button
							label="Computers"
							onPress={() => {
								onNavigate?.();
								router.push("/tunnels");
							}}
							variant="quiet"
							size="sm"
							testID={CONTROL.sidebarComputers}
						/>
					</View>
				</View>
				<View className="w-full">
					<Button
						label="Projects"
						onPress={() => {
							onNavigate?.();
							router.push("/projects");
						}}
						variant="quiet"
						size="sm"
						testID={CONTROL.sidebarProjects}
					/>
				</View>
				{/* The fourth route, for the same stated reason as Projects: the
				 *  machine-wide armed index (S17) is a peer of `past`/`projects` — a
				 *  view of what is running on the machine, not a row in Settings —
				 *  and the desktop sidebar carries Schedules as a top-level
				 *  destination beside them. Full-width beneath the pair, like Projects,
				 *  so the wrap band stays 2+1+1. */}
				<View className="w-full">
					<Button
						label="Schedules"
						onPress={() => {
							onNavigate?.();
							router.push("/schedules");
						}}
						variant="quiet"
						size="sm"
						testID={CONTROL.sidebarSchedules}
					/>
				</View>
			</View>

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
				<Skeleton lines={1} />
				<Skeleton lines={1} />
				<Skeleton lines={1} />
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
