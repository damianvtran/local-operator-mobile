import { useRouter } from "expo-router";
import { Search } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";

import { type RouteProfile, routeLabel } from "@/connection";
import type { SessionSummary } from "@/contracts";
import {
	useConnection,
	useConnectionState,
	useListState,
} from "@/features/auth/connection-provider";
import {
	attentionCount,
	attentionWord,
	degradedNote,
	degradedShortNote,
	splitSections,
	staleNote,
} from "@/features/sessions/session-projection";
import { homeShortened } from "@/lib/format";
import { useUiStore } from "@/state/ui-store";
import { CONTROL, EMPTY, REGION, ROLE, SCREEN, sessionRowId } from "@/ui/a11y";
import { ReadableColumn, SplitView } from "@/ui/components/adaptive";
import { Avatar, initialsOf } from "@/ui/components/avatar";
import { Badge } from "@/ui/components/badge";
import { Banner } from "@/ui/components/banner";
import { Button } from "@/ui/components/button";
import { ConnectionPill } from "@/ui/components/connection-pill";
import { EmptyState } from "@/ui/components/empty-state";
import { IconButton } from "@/ui/components/icon-button";
import { Input } from "@/ui/components/input";
import { ListRow } from "@/ui/components/list-row";
import { RefusalSurface } from "@/ui/components/refusal-surface";
import { Screen } from "@/ui/components/screen";
import { SectionHeader } from "@/ui/components/section-header";
import { Sheet } from "@/ui/components/sheet";
import { Skeleton } from "@/ui/components/skeleton";
import { TOUCH_FLOOR, useLayout } from "@/ui/layout";
import { LARGE_TEXT_SCALE } from "@/ui/text-scale";
import { useTextScale } from "@/ui/text-scale-provider";

/**
 * Sessions — the app's home screen (docs/ux/flows.md § 5, F-5).
 *
 * Four rules from the flow carry this screen, and each is a failure the shipped
 * web client had to learn:
 *
 *  1. **One state mark per row, by precedence** (`session-projection.ts`), so a
 *     row that is both streaming and blocked shows the block.
 *  2. **The empty state is not a dead end.** F-5's finding is that it was: it
 *     named the action and stopped. Here it names the machine, says what a
 *     session is, and offers whichever action actually changes the situation —
 *     connecting a computer when there is no route, starting one when there is.
 *  3. **Stale is not blank.** While the stream reconnects, the last known list
 *     stays on screen under a sentence carrying its age. `degraded: ["sessions"]`
 *     is a DIFFERENT fact: the relay could not walk the catalogue, so the list is
 *     incomplete rather than old, and saying "no sessions" for it would be a lie.
 *  4. **The 60-second rotation is invisible** (`C1`). The pill reads the stream's
 *     own status, and the connection layer never reports a rotation — so nothing
 *     here can flash once a minute.
 */
const ActionBar = ({
	onMeasure,
	primaryOnly = false,
}: {
	onMeasure: (height: number) => void;
	/** Just the primary action, when the list header carries the navigation.
	 *
	 *  Two measured reasons, both from the design round: at 200 % text on a 320 pt
	 *  phone the bar's two rows took 224 of 568 pt and left the list a 125 pt window
	 *  against a 130 pt row — no complete row on screen (D2); and at split width the
	 *  pane that lists is the one that should own "Past"/"Computers", not the empty
	 *  detail pane beside it (D8). */
	primaryOnly?: boolean;
}) => {
	const router = useRouter();

	return (
		<View
			className="gap-2 px-4 pb-2 pt-2"
			testID={CONTROL.sessionsFooter}
			accessibilityRole="none"
			/* A bar over content has to be MEASURED: whoever it overlaps pads by this
			 *  height, and the 320 pt @ 200 % frame showed the cost of guessing — a row
			 *  cut in half by the primary action. */
			onLayout={(event) => onMeasure(event.nativeEvent.layout.height)}
		>
			<Button
				label="New session"
				onPress={() => router.push("/new")}
				testID={CONTROL.sessionsNew}
			/>
			{primaryOnly ? null : (
				<View className="flex-row gap-2">
					<View className="flex-1">
						<Button
							label="Past"
							onPress={() => router.push("/past")}
							variant="quiet"
							testID={CONTROL.sessionsPast}
						/>
					</View>
					<View className="flex-1">
						<Button
							testID={CONTROL.sessionsComputers}
							label="Computers"
							onPress={() => router.push("/tunnels")}
							variant="quiet"
						/>
					</View>
				</View>
			)}
		</View>
	);
};

export default function Sessions() {
	const router = useRouter();
	const {
		refreshList,
		retry,
		relay,
		refusal,
		busy,
		streamHealth,
		coldStartSettled,
		savedTunnel,
		restoredAccount,
	} = useConnection();
	const showToast = useUiStore((state) => state.showToast);
	/* The split decision, read once: the SAME value drives the cap opt-out below and
	 *  `SplitView`'s own choice, so the two cannot disagree about whether this screen
	 *  has two panes. */
	const layout = useLayout();

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
	const [home, setHome] = useState<string | null>(null);
	const [menuTarget, setMenuTarget] = useState<SessionSummary | null>(null);
	/** The footer's measured height, so the list can clear it. */
	const [footerHeight, setFooterHeight] = useState(0);

	/* The home directory is the relay's own answer, not a guess: it is what makes
	 * a row's second line readable (a 60-character absolute path is otherwise
	 * mostly the same prefix on every row). */
	useEffect(() => {
		const client = relay();
		if (!client) return;
		let live = true;
		void client
			.directories()
			.then((directories) => {
				if (live) setHome(directories.home);
			})
			.catch(() => undefined);
		return () => {
			live = false;
		};
	}, [relay]);

	const filtered = useMemo(() => {
		const needle = query.trim().toLowerCase();
		if (needle.length === 0) return sessions;
		return sessions.filter(
			(session) =>
				session.conversation_name.toLowerCase().includes(needle) ||
				session.cwd.toLowerCase().includes(needle),
		);
	}, [query, sessions]);

	/* The RENDERED scale, not the preference: on the web the platform's factor
	 *  arrives through the root font size, so the preference alone reads 1. */
	const { effectiveScale } = useTextScale();
	const largeText = effectiveScale > LARGE_TEXT_SCALE;

	/* The list's navigation lives in ITS OWN header when the pinned bar cannot carry
	 *  it: at split width the pane that lists should own "Past"/"Computers" (D8), and
	 *  at large text the bar's second row is what left a 320 pt phone a 125 pt list
	 *  window against a 130 pt row (D2). One flag, one place. */
	const navInHeader = layout.split || largeText;
	/* The ONE configuration where the list's own chrome has to yield rather than
	 *  grow: a 320 pt phone with the platform's text at 200 %. Two decisions below
	 *  read it — which control leaves the header row, and how far the degraded
	 *  banner may run — so the predicate is written once, where both can see it,
	 *  rather than re-derived from `largeText` and `layout.split` at each site. */
	const phoneLargeText = largeText && !layout.split;
	/* The address line yields FIRST when the phone's band is the scarce resource.
	 *
	 *  At 320 pt with the platform text at 200 % it was measured at 0 pt wide (a
	 *  26 pt one in the design round's frames) with its own row overflowing the pane
	 *  by 44 pt, and it is the redundant control of the two: it navigates to
	 *  `/tunnels`, which is exactly what the "Computers" button beside it does, and
	 *  which computer is connected is carried by the avatar in the Screen header.
	 *  The split pane keeps it — there the address has room and names the list's
	 *  subject — so this is the phone-only half of the same rule as `navInHeader`. */
	const addressInHeader = !phoneLargeText;

	/* A cold start with no route belongs on the welcome surface.
	 *
	 * The store documents `signed-out` as "no route, no credentials: the welcome
	 * screen", the flows begin there, and the welcome screen is polished and was
	 * reachable only by typing its URL — while `/` showed three permanently pulsing
	 * skeletons and a "Not answering" pill for a computer that had never been asked
	 * (D3). */
	const routed = route !== null;
	const phase = useConnectionState((state) => state.phase);
	useEffect(() => {
		/* NOTHING TO RESUME, and the cold start has said so.
		 *
		 *  Every clause is load-bearing, and each one was measured against the
		 *  harness's cells before it was written:
		 *   - `coldStartSettled`: the store's INITIAL phase is `signed-out`, so the
		 *     first render of a connected launch looks exactly like a first run;
		 *   - `refusal === null`: a refused sign-in ALSO returns the phase to
		 *     `signed-out` (connection-store.ts), and a refusal has its own surface to
		 *     render on the list — bouncing it away would hide the reason;
		 *   - `savedTunnel === null`: a saved own-tunnel with no remembered password is
		 *     a configured computer whose password the list must ask for, not a
		 *     first run;
		 *   - `!routed`: a route exists, so the list is the screen;
		 *   - `restoredAccount`: a stored RADIENT credential was read and accepted on
		 *     this cold start, so the reader IS signed in and their computers are about to
		 *     arrive — the flows' `Launch →|credential cached| Computers` branch, which
		 *     would otherwise be bounced to a first-run surface and re-ask a question
		 *     the hand-off already answered (R3-3). A REFUSAL outranks it: the clause
		 *     above keeps a revoked credential's surface on this screen, which is where
		 *     the reader is told their session expired. */
		if (
			coldStartSettled &&
			!busy &&
			!routed &&
			refusal === null &&
			savedTunnel === null &&
			phase === "signed-out"
		) {
			router.replace(restoredAccount ? "/tunnels" : "/welcome");
		}
	}, [
		busy,
		coldStartSettled,
		phase,
		refusal,
		restoredAccount,
		router,
		routed,
		savedTunnel,
	]);

	const sections = useMemo(() => splitSections(filtered), [filtered]);
	const waiting = attentionCount(sessions);
	const degradedMessage = degradedNote(degraded);
	const staleMessage = staleNote({ stale, lastFrameAt });

	const onRefresh = useCallback(() => {
		void refreshList();
	}, [refreshList]);

	const togglePin = useCallback(
		async (session: SessionSummary) => {
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
		},
		[refreshList, relay, showToast],
	);

	const items = useMemo(() => buildItems(sections), [sections]);

	const header = (
		<View className="gap-3">
			{/* The switcher, and it is ALONE on its row.
			 *
			 * The screen's own controls (the waiting badge, search, Settings) live in the
			 * Screen header above, so this row has exactly one thing to fit. When all four
			 * shared a line, 200 % text on a 320 pt phone squeezed the label to nothing —
			 * measured in a captured frame, and the reason the controls moved up. */}
			<View className="flex-row items-center gap-2">
				{addressInHeader ? (
					<Pressable
						accessibilityRole={ROLE.button}
						accessibilityLabel={`${listLabel(computers, tunnelId, route)} — choose a computer`}
						onPress={() => router.push("/tunnels")}
						testID={CONTROL.computersButton}
						/* The floor is the PLATFORM's: 44 on iOS, 48 wherever `Platform.OS`
						 *  is not iOS — which includes the web/audit profile this build is
						 *  measured on, where `min-h-11` left the switcher at 44 (QA round 1).
						 *  A switcher a thumb has to aim at is not a dense row of text. */
						className="min-w-0 flex-1 justify-center"
						style={{ minHeight: TOUCH_FLOOR }}
					>
						{/* Mono: this label is a host or a computer name — a machine string the
						 *  reader matches against their own terminal (N1, brand-kit § 3.5). */}
						<Text
							className="text-mono-sm text-ink-muted"
							numberOfLines={1}
							ellipsizeMode="tail"
						>
							{listLabel(computers, tunnelId, route)}
						</Text>
					</Pressable>
				) : null}
				{/* The list's own navigation, when the pinned bar is not carrying it.
				 *
				 *  Split width: the pane that LISTS owns "Past"/"Computers" — the bar moved
				 *  to the detail pane, and navigation for the list read as belonging to an
				 *  empty detail pane beside it (D8). Large text: the bar's second row is
				 *  what left a 320 pt phone a 125 pt list window against a 130 pt row, so
				 *  the navigation moves up here and the bar keeps one row (D2). Both cases
				 *  are the same control in the same place, so they share this slot rather
				 *  than two layouts that would drift. */}
				{navInHeader ? (
					<>
						<Button
							label="Past"
							size="sm"
							variant="quiet"
							onPress={() => router.push("/past")}
							testID={CONTROL.sessionsPastInHeader}
						/>
						<Button
							label="Computers"
							size="sm"
							variant="quiet"
							onPress={() => router.push("/tunnels")}
							testID={CONTROL.sessionsComputersInHeader}
						/>
					</>
				) : null}
			</View>

			{searching ? (
				<Input
					label="Search sessions"
					value={query}
					onChangeText={setQuery}
					placeholder="Name or folder"
					autoFocus
					testID={CONTROL.sessionSearchField}
				/>
			) : null}

			{degradedMessage ? (
				<Banner
					tone="warning"
					/* A listing the relay could not walk is the state where the reader most
					 *  needs rows on screen, and the sentences run 73–80 characters: at 200 % on a
					 *  320 pt phone the longest measured 260.56 pt of a 356.81 pt band and left ZERO
					 *  complete rows (QA round 4, Q4-2). Two lines brings the banner to 98.19 pt,
					 *  which leaves the row complete — but two lines paint only about 52 of those
					 *  characters, so the reader saw `! Some conversations …`: a warning naming
					 *  neither cause nor consequence, at the one text size where it most needs
					 *  spelling out (design round 5, D29). In this configuration the SHORT sentence
					 *  is rendered instead — complete in itself, so nothing is lost to a screen
					 *  reader either — and `maxLines` stays as the structural guard that keeps a
					 *  future longer sentence from moving the rows again. */
					message={
						phoneLargeText ? degradedShortNote(degraded) : degradedMessage
					}
					maxLines={phoneLargeText ? 2 : undefined}
					testID={CONTROL.sessionsDegradedBanner}
				/>
			) : null}
			{staleMessage ? (
				/* Capped the way the banner is capped, and for the same reason: this line
				 *  sits in the same band, and the band is what decides how many rows are
				 *  complete. Unbounded, a `degraded`+`stale` listing would add this line's
				 *  full height under the banner and push row 1 back out — measured line
				 *  heights put it at ~530 pt against a band ending at 504 (review round 6,
				 *  M-B). One line is ~40.6 pt at this size, which lands row 1's foot at
				 *  ~490 pt: inside the band, by construction rather than by luck. Only in
				 *  the narrowest configuration — everywhere else the line has room and the
				 *  sentence is the connection layer's, not this screen's, to shorten. */
				<Text
					className="text-body-sm text-ink-dim"
					numberOfLines={phoneLargeText ? 1 : undefined}
				>
					{staleMessage}
				</Text>
			) : null}
		</View>
	);

	/* F-5 step 1's own list of controls, in the SCREEN header rather than in the
	 * list's, so the list's header row has one thing to fit (the switcher) and 200 %
	 * text cannot squeeze the label to nothing. */
	const detailColumn = (
		<ReadableColumn testID={CONTROL.sessionsDetailColumn}>
			<View className="flex-1 items-center justify-center gap-2 px-8">
				<Text className="text-heading text-ink" accessibilityRole={ROLE.header}>
					Choose a session
				</Text>
				<Text className="text-body text-ink-muted text-center">
					Its transcript, composer and approval cards open here.
				</Text>
			</View>
			{layout.split ? (
				<ActionBar onMeasure={setFooterHeight} primaryOnly />
			) : null}
		</ReadableColumn>
	);

	return (
		<Screen
			title="Sessions"
			testID={SCREEN.sessions}
			scroll={false}
			/* The cap comes OFF only when the split is real: on a phone (and on a
			 *  landscape phone, which is wide but short) `SplitView` renders one pane
			 *  and the readable measure still applies, so the single-column layout is
			 *  untouched. With two panes the measure belongs INSIDE the detail pane —
			 *  a cap on the whole screen is what squeezed a tablet into a 560 pt
			 *  column in the middle of 1366 pt. */
			capColumn={!layout.split}
			headerAction={
				<View className="flex-row items-center gap-1">
					{waiting > 0 ? (
						<Badge label={`${waiting}`} tone="danger" mono />
					) : null}
					<IconButton
						accessibilityLabel="Search sessions"
						onPress={() => setSearching((value) => !value)}
						icon={({ color, size }) => <Search color={color} size={size} />}
						testID={CONTROL.sessionSearchButton}
					/>
					{/* The avatar IS the Settings affordance, and its initials come from the
					 * same label the switcher shows, so the two cannot disagree. */}
					<Pressable
						accessibilityRole={ROLE.button}
						accessibilityLabel="Settings"
						onPress={() => router.push("/settings")}
						testID={CONTROL.settingsButton}
						style={{ minHeight: TOUCH_FLOOR, minWidth: TOUCH_FLOOR }}
					>
						<Avatar
							initials={initialsOf(listLabel(computers, tunnelId, route))}
							size="sm"
							accessibilityLabel="Settings"
						/>
					</Pressable>
				</View>
			}
		>
			{refusal ? (
				<View className="px-4">
					<RefusalSurface
						kind={refusal.kind}
						subject={refusal.subject}
						detail={refusal.detail}
						remedy={refusal.remedy}
						retryAfterMs={refusal.retryAfterMs}
						onRetry={() => void retry()}
						onUseAnotherAddress={() => router.push("/custom")}
					/>
				</View>
			) : null}

			{/* The connection pill belongs ABOVE the list, not inside it. Inside, it was
			 *  the list's own header: at 200 % text on a 320 pt phone the list's box is
			 *  smaller than its header, and the pill's box ended up under the pinned
			 *  footer (`U-08`, measured 8 pt into the New session button) — status that
			 *  scrolls away and collides with the bar above it. In the column it is a
			 *  sibling of the list and the footer, so the three cannot overlap by
			 *  construction, and the state stays on screen instead of scrolling off.
			 *
			 *  It appears only when it has something to say: a permanent "Connected" dot
			 *  is furniture the eye learns to skip (the first captured frame showed it as
			 *  a stray mark under the title). */}
			{routed && pillState(streamHealth, stale) !== "connected" ? (
				<View className="px-4 pb-2">
					<ConnectionPill
						state={pillState(streamHealth, stale)}
						message={staleNote({ stale, lastFrameAt }) ?? undefined}
					/>
				</View>
			) : null}

			{/* Two panes where the screen has room for them, and the phone's own
			 *  navigation everywhere else (`SplitView` decides, from `useLayout`). The
			 *  DETAIL pane is D2's session view: until it renders here, the pane states
			 *  what belongs in it rather than showing a blank half-screen. */}
			<SplitView
				testID={CONTROL.sessionsSplit}
				list={
					<FlatList
						className="flex-1"
						accessibilityRole="none"
						testID={REGION.sessionsList}
						contentContainerClassName="grow px-4"
						contentContainerStyle={{
							paddingBottom: layout.split ? 16 : footerHeight + 16,
						}}
						data={items}
						keyExtractor={(item) => item.key}
						ListHeaderComponent={header}
						refreshControl={
							<RefreshControl refreshing={busy} onRefresh={onRefresh} />
						}
						renderItem={({ item }) => {
							if (item.kind === "header") {
								return (
									<SectionHeader label={item.label} testID={item.testID} />
								);
							}
							return (
								<ListRow
									title={item.session.conversation_name.trim() || "untitled"}
									cwd={
										home
											? homeShortened(item.session.cwd, home)
											: item.session.cwd
									}
									model={item.session.model_label}
									pending={item.session.needs_attention}
									attentionWord={attentionWord(item.session)}
									streaming={item.session.streaming}
									unread={item.session.unseen}
									ended={item.session.ended === true}
									degraded={item.session.degraded === true}
									subagentCount={item.session.subagents_running ?? 0}
									onPress={() =>
										router.push(`/session/${item.session.session_id}`)
									}
									testID={sessionRowId(item.session.session_id)}
								/>
							);
						}}
						ListEmptyComponent={
							/* `flex-1` only while the empty state FITS. The list's header (the
							 *  computer switcher, the connection pill, the search field) is the
							 *  list's own header, so the empty state is centred in what is left —
							 *  and when its content is taller than that remainder, a flexbox
							 *  `justify-center` overflows in BOTH directions, riding up over the
							 *  header it sits under. At 200 % text it did exactly that: the
							 *  "Not answering" pill and the New session button overlapped by 8 pt
							 *  (`U-08`, measured at 320 pt). At large text the wrapper stops
							 *  growing, so the content flows below the header at its natural
							 *  height instead of centring itself into it. */
							<View className={largeText ? "flex-none" : "flex-1"}>
								<ListEmpty
									waiting={
										routed && frameCount === 0 && !loadFailed(streamHealth)
									}
									hasRoute={sessions.length > 0 || frameCount > 0}
									query={query}
									onClearSearch={() => setQuery("")}
									onNew={() => router.push("/new")}
									onConnect={() => router.push("/tunnels")}
									/* Split layouts only: see `showNewAction`. */
									showNewAction={layout.split}
								/>
							</View>
						}
					/>
				}
				detail={layout.split ? detailColumn : null}
				emptyDetail={detailColumn}
			/>

			{/* The action bar belongs to the DETAIL pane when there is one: "New session"
			 *  and its neighbours act on the transcript side of the screen, and pinned
			 *  across the whole screen it drew a 1,366 pt bar under both panes — the layout
			 *  a designer reads as a phone bar stretched. The list pane's own way in is its
			 *  empty state's action (`ListEmpty`), which is why that action renders on a
			 *  split and the phone bar does not repeat it (D16). */}
			{layout.split ? null : (
				<ActionBar onMeasure={setFooterHeight} primaryOnly={navInHeader} />
			)}

			{/* Long-press rather than a swipe: the same action, a gesture a reader
			 *  discovers by trying it, and a sheet that names what it is about to do. */}
			<Sheet
				visible={menuTarget !== null}
				onClose={() => setMenuTarget(null)}
				title={menuTarget?.conversation_name.trim() || "untitled"}
			>
				<View className="gap-2 pb-4">
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
					<Button
						testID={CONTROL.sessionOpenPrevious}
						label="Open"
						onPress={() => {
							const target = menuTarget;
							setMenuTarget(null);
							if (target) router.push(`/session/${target.session_id}`);
						}}
					/>
				</View>
			</Sheet>
		</Screen>
	);
}

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

/**
 * The header's label: what this app is looking at.
 *
 * Three honest cases, and the third is the one that matters: a custom route has
 * no account and no computer list, so calling it "Connect a computer" on an
 * already-connected relay would be a lie the reader cannot act on.
 */
function listLabel(
	computers: readonly { tunnelId: string; name: string }[],
	tunnelId: string | null,
	route: RouteProfile | null,
): string {
	const active = computers.find((computer) => computer.tunnelId === tunnelId);
	if (active) return active.name;
	if (route?.mode === "custom") return routeLabel(route);
	if (route?.mode === "radient") return "Choose a computer";
	return "Connect a computer";
}

type Item =
	| { kind: "header"; key: string; label: string; testID?: string }
	| { kind: "row"; key: string; session: SessionSummary };

/**
 * The flat list the list renders.
 *
 * `Active` and `Previous` are emitted whenever either has a row — including the
 * empty one, whose heading then carries a sentence. The native flow set asserts
 * both by name (`session-section-active`, `session-section-previous`), and more
 * to the point a reader whose conversations have all ended should see where live
 * ones will appear rather than a list that silently has one section.
 */
function buildItems(sections: ReturnType<typeof splitSections>): Item[] {
	const items: Item[] = [];
	const push = (
		label: string,
		testID: string | undefined,
		rows: SessionSummary[],
	) => {
		items.push({ kind: "header", key: `h-${label}`, label, testID });
		for (const session of rows) {
			items.push({ kind: "row", key: session.session_id, session });
		}
	};
	if (sections.pinned.length > 0) {
		push("Pinned", undefined, sections.pinned);
	}
	if (sections.active.length + sections.previous.length > 0) {
		push("Active", REGION.sessionSectionActive, sections.active);
		push("Previous", REGION.sessionSectionPrevious, sections.previous);
	}
	return items;
}

/**
 * The three list states that are not a list: loading, no route, and no sessions.
 *
 * `waiting` is the load: three skeleton rows rather than a spinner page
 * (docs/ux/flows.md § 11). A search with no matches is its own state and says so
 * — an empty session list and a search that matched nothing are different facts.
 */
const ListEmpty = ({
	waiting,
	hasRoute,
	query,
	onClearSearch,
	onNew,
	onConnect,
	showNewAction,
}: {
	waiting: boolean;
	hasRoute: boolean;
	query: string;
	onClearSearch: () => void;
	onNew: () => void;
	onConnect: () => void;
	/** Whether this state renders its own "New session" action.
	 *
	 *  False on a phone, where the action bar below carries the same control: two
	 *  identical actions a row apart is noise, not an affordance (design round 2, D16 —
	 *  the frame showed both). True on a split layout, where the bar belongs to the
	 *  DETAIL pane and this empty state is the list pane's only way in. */
	showNewAction: boolean;
}) => {
	if (waiting) {
		return (
			<View className="gap-3 py-3">
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
					 *  replaces: this shipped as `onPress: () => undefined`, so the empty state
					 *  offered a way out of a search it could not clear. The predicate is the
					 *  one this branch renders on, passed through so the button's enabled state
					 *  cannot disagree with there being something to clear. */
					onPress: onClearSearch,
					disabled: query.trim().length === 0,
					testID: CONTROL.sessionsClearSearchAction,
				}}
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
			action={
				showNewAction
					? {
							label: "New session",
							onPress: onNew,
							testID: CONTROL.sessionsNewAction,
						}
					: undefined
			}
			testID={EMPTY.sessions}
		/>
	);
};
