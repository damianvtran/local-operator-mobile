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
	splitSections,
	staleNote,
} from "@/features/sessions/session-projection";
import { homeShortened } from "@/lib/format";
import { useUiStore } from "@/state/ui-store";
import { CONTROL, EMPTY, REGION, ROLE, SCREEN, sessionRowId } from "@/ui/a11y";
import { SplitView } from "@/ui/components/adaptive";
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
import { TOUCH_FLOOR } from "@/ui/layout";
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
export default function Sessions() {
	const router = useRouter();
	const { refreshList, retry, relay, refusal, busy, streamHealth } =
		useConnection();
	const showToast = useUiStore((state) => state.showToast);

	const sessions = useListState((state) => state.sessions);
	const degraded = useListState((state) => state.degraded);
	const frameCount = useListState((state) => state.frameCount);
	const stale = useListState((state) => state.stale);
	const lastFrameAt = useListState((state) => state.lastFrameAt);
	const computers = useConnectionState((state) => state.computers);
	const tunnelId = useConnectionState((state) => state.tunnelId);
	const route = useConnectionState((state) => state.route);
	const _route = useConnectionState((state) => state.route);

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
				<Pressable
					accessibilityRole={ROLE.button}
					accessibilityLabel={`${listLabel(computers, tunnelId, route)} — choose a computer`}
					onPress={() => router.push("/tunnels")}
					testID={CONTROL.computersButton}
					/* `min-h-11`: the control meets the 44 pt floor itself rather than being
					 *  recorded as the rubric's dense-list exception, which it was in the
					 *  audit (a 36 pt hit area) — a switcher a thumb has to aim at is not a
					 *  dense row of text. */
					className="min-h-11 min-w-0 flex-1 justify-center"
				>
					<Text
						className="text-label text-ink-muted"
						numberOfLines={1}
						ellipsizeMode="tail"
					>
						{listLabel(computers, tunnelId, route)}
					</Text>
				</Pressable>
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
				<Banner tone="warning" message={degradedMessage} />
			) : null}
			{staleMessage ? (
				<Text className="text-body-sm text-ink-dim">{staleMessage}</Text>
			) : null}
		</View>
	);

	/* F-5 step 1's own list of controls, in the SCREEN header rather than in the
	 * list's, so the list's header row has one thing to fit (the switcher) and 200 %
	 * text cannot squeeze the label to nothing. */
	return (
		<Screen
			title="Sessions"
			testID={SCREEN.sessions}
			scroll={false}
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
			{pillState(streamHealth, stale) !== "connected" ? (
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
						contentContainerStyle={{ paddingBottom: footerHeight + 16 }}
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
									waiting={frameCount === 0 && !loadFailed(streamHealth)}
									hasRoute={sessions.length > 0 || frameCount > 0}
									query={query}
									onNew={() => router.push("/new")}
									onConnect={() => router.push("/tunnels")}
								/>
							</View>
						}
					/>
				}
				detail={null}
				emptyDetail={
					<View className="flex-1 items-center justify-center gap-2 px-8">
						<Text
							className="text-heading text-ink"
							accessibilityRole={ROLE.header}
						>
							Choose a session
						</Text>
						<Text className="text-body text-ink-muted text-center">
							Its transcript, composer and approval cards open here.
						</Text>
					</View>
				}
			/>

			<View
				className="gap-2 px-4 pb-2 pt-2"
				testID={CONTROL.sessionsFooter}
				accessibilityRole="none"
				/* The footer is a fixed bar over a scrolling list, so its height is
				 * MEASURED and the list is padded by it: without that the last row sits
				 * under the buttons, which the 320 pt @ 200 % frame showed as a row cut in
				 * half by the primary action. */
				onLayout={(event) => setFooterHeight(event.nativeEvent.layout.height)}
			>
				<Button
					label="New session"
					onPress={() => router.push("/new")}
					testID={CONTROL.sessionsNew}
				/>
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
							label="Computers"
							onPress={() => router.push("/tunnels")}
							variant="quiet"
						/>
					</View>
				</View>
			</View>

			{/* Long-press rather than a swipe: the same action, a gesture a reader
			 *  discovers by trying it, and a sheet that names what it is about to do. */}
			<Sheet
				visible={menuTarget !== null}
				onClose={() => setMenuTarget(null)}
				title={menuTarget?.conversation_name.trim() || "untitled"}
			>
				<View className="gap-2 pb-4">
					<Button
						label={menuTarget?.pinned ? "Unpin" : "Pin to the top"}
						onPress={() => {
							const target = menuTarget;
							setMenuTarget(null);
							if (target) void togglePin(target);
						}}
						variant="outline"
					/>
					<Button
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
	onNew,
	onConnect,
}: {
	waiting: boolean;
	hasRoute: boolean;
	query: string;
	onNew: () => void;
	onConnect: () => void;
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
				action={{ label: "Clear the search", onPress: () => undefined }}
			/>
		);
	}
	if (!hasRoute) {
		return (
			<EmptyState
				headline="No computer is connected yet."
				next="This app drives the sessions on your own computer, so it needs one first."
				action={{ label: "Connect a computer", onPress: onConnect }}
				testID={CONTROL.sessionsNoRoute}
			/>
		);
	}
	return (
		<EmptyState
			headline="No sessions yet."
			next="A session is one conversation with the agent on your machine. Start one and it will appear here."
			action={{ label: "New session", onPress: onNew }}
			testID={EMPTY.sessions}
		/>
	);
};
