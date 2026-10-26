import { useFocusEffect, useRouter } from "expo-router";
import { ChevronLeft, X } from "lucide-react-native";
import { useCallback, useMemo, useRef, useState } from "react";
import {
	ActivityIndicator,
	FlatList,
	Pressable,
	RefreshControl,
	Text,
	useWindowDimensions,
	View,
} from "react-native";

import type { NotificationItem } from "@/contracts";
import { useConnection } from "@/features/auth/connection-provider";
import {
	confirmBodyFor,
	confirmTitleFor,
	DISMISS_CONFIRM_LABEL,
	dismissAllActionLabel,
} from "@/features/notifications/conversation-dismiss";
import { DismissReceipt } from "@/features/notifications/dismiss-receipt";
import type { InboxEntry } from "@/features/notifications/notifications-model";
import {
	ALL_CAUGHT_UP_BODY,
	ALL_CAUGHT_UP_TITLE,
	canDismiss,
	DISMISS_LABEL,
	dismissableTargets,
	EMPTY_ALL_BODY,
	FILTER_ALL,
	FILTER_UNREAD,
	hasUnread,
	inboxEmpty,
	inboxRows,
	inboxSections,
	LOAD_MORE_LABEL,
	MARK_ALL_BUSY,
	MARK_ALL_LABEL,
	MARK_READ_LABEL,
	MARK_UNREAD_LABEL,
	READ_UNREACHABLE,
	RETRY_LABEL,
	relativeTime,
	rowKey,
	SELECT_DONE,
	SELECT_LABEL,
	selectedCountLabel,
	selectionTargets,
	toggleSelection,
	unreadSummary,
	waitingSummary,
} from "@/features/notifications/notifications-model";
import { useConversationDismiss } from "@/features/notifications/use-conversation-dismiss";
import {
	skippedSentence,
	useNotifications,
} from "@/features/notifications/use-notifications";
import {
	useReceiptFeed,
	VIEWABILITY_CONFIG,
} from "@/features/notifications/use-receipt-feed";
import {
	CONTROL,
	EMPTY,
	notificationAnswerId,
	notificationDismissId,
	notificationRowId,
	notificationSelectId,
	ROLE,
	SCREEN,
	SURFACE,
} from "@/ui/a11y";
import { Alert } from "@/ui/components/alert";
import { Button } from "@/ui/components/button";
import { Dialog } from "@/ui/components/dialog";
import { EmptyState } from "@/ui/components/empty-state";
import { IconButton } from "@/ui/components/icon-button";
import { Screen } from "@/ui/components/screen";
import { SectionHeader } from "@/ui/components/section-header";
import { Segmented } from "@/ui/components/segmented";
import { Skeleton } from "@/ui/components/skeleton";
import { useTextScale } from "@/ui/text-scale-provider";
import { cx } from "@/ui/variants";

/**
 * The notifications inbox (design §10; contract §5.4).
 *
 * ONE LIST, TWO PILES. Open asks are pinned under "Waiting on you" because they
 * are the items an agent is blocked on; everything else is grouped by when it
 * was last touched. The badge, the pinned section and the grouped rows all come
 * from the same read, so the number at the entry point and the list inside
 * cannot disagree.
 *
 * WHAT A GESTURE MEANS. An update carries a one-click dismiss; an open ask
 * offers Answer instead, because the relay refuses to dismiss one — settling it
 * belongs to the ask's own reasoned door, which tells the agent (contract
 * §2.3). Multi-select exists for volume: select rows, then mark them read or
 * dismiss them together. Every write names the revision it rendered, so a row
 * that moved under the gesture survives and is reported rather than silently
 * cleared.
 *
 * THE AUTOMATIC PATH IS THE ONLY SUBTLE THING HERE. A row can be marked read
 * without a tap, but only when the app is active, this screen is focused,
 * nothing covers the list, the exact row+revision rendered, a real touch or
 * scroll arrived AFTER it rendered, and it stayed for a second. Anything
 * unknown sends nothing (`notifications-read-receipts.ts`); a mount alone reads
 * nothing, and this file contains no session-wide sweep.
 */
export default function Notifications() {
	const router = useRouter();
	const { relay } = useConnection();
	const client = relay();
	const inbox = useNotifications(client, client !== null);
	/* The row's "Dismiss all from <conversation>" accessibility action. It walks
	 *  the conversation's full scope itself (the list holds one page), so the
	 *  confirmation's number is the number applied; the detail's From card runs
	 *  the same hook, so the two doors cannot disagree. */
	const { reload } = inbox;
	const dismissAll = useConversationDismiss(client, () =>
		reload({ silent: true }),
	);

	/** Multi-select mode. Off by default: the list is for reading, and a screen
	 *  that opened in selection mode would make the first tap mean the wrong
	 *  thing. */
	const [selecting, setSelecting] = useState(false);
	const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
	const [writing, setWriting] = useState(false);

	/** Whether this route is the focused one. The receipt feed refuses to send
	 *  anything while a pushed detail screen is over this list. */
	const [isFocused, setIsFocused] = useState(false);
	useFocusEffect(
		useCallback(() => {
			setIsFocused(true);
			return () => setIsFocused(false);
		}, []),
	);

	/** The evidenced read path: ONE feed, driven by the list's own viewability
	 *  answers plus the screen's presence facts. It lives in `use-receipt-feed`
	 *  because round 1 defined this callback and attached it to nothing — the
	 *  evidenced path was dead on both platforms while the detail's unevidenced
	 *  mount read was the only write that reached the relay (code review B1,
	 *  QA Q1). */
	const { feed: receipts, noteInput } = useReceiptFeed({
		send: (targets, evidence) => inbox.seen(targets, evidence),
		/* A dialog over the list covers the rows it is asking about. */
		covered:
			dismissAll.phase.kind === "confirming" ||
			dismissAll.phase.kind === "applying",
		focused: isFocused,
		enabled: client !== null,
	});

	/**
	 * The list's viewability answers, narrowed to the rows they contain.
	 *
	 * The callback identity must be STABLE for the life of the list — React Native
	 * throws if it changes between renders — which is why it is a `useRef` value
	 * rather than a fresh closure. Round 1's failure was the opposite kind: the
	 * callback existed and nothing was given it.
	 */
	const viewability = useRef(
		(info: {
			viewableItems: Array<{ item?: InboxEntry | null } | null | undefined>;
		}) => {
			const visible = [];
			for (const entry of info.viewableItems) {
				const item = entry?.item;
				if (item === undefined || item === null) continue;
				if (item.kind !== "row") continue;
				visible.push({ id: item.item.id, revision: item.item.revision });
			}
			receipts.render(visible, Date.now());
		},
	).current;

	const response = inbox.response;
	const rows = useMemo<NotificationItem[]>(
		() => (response === null ? [] : inboxRows(response)),
		[response],
	);
	const sections = useMemo(
		() =>
			response === null
				? []
				: inboxSections(response, inbox.nowMs).map((section) => ({
						id: section.id,
						title: section.title,
						data: section.items,
					})),
		[response, inbox.nowMs],
	);
	/**
	 * The list's flat data: section headings and rows in reading order.
	 *
	 * `FlatList` needs ONE array, and the viewability answers index into it, so
	 * the sections are flattened here (`inboxRows` stays the source of the row
	 * list the writes use, so the two can never disagree about which rows exist).
	 */
	const entries = useMemo<InboxEntry[]>(() => {
		const out: InboxEntry[] = [];
		for (const section of sections) {
			out.push({ kind: "header", id: `h:${section.id}`, title: section.title });
			for (const item of section.data) {
				out.push({ kind: "row", id: `r:${rowKey(item)}`, item });
			}
		}
		return out;
	}, [sections]);

	/* ------------------------------------------------------------- the acts -- */

	const clearSelection = useCallback(() => {
		setSelection(new Set());
		setSelecting(false);
	}, []);

	/**
	 * Mark selected rows read or unread. No dialog: this verb is reversible by its
	 * own counterpart, so it needs neither confirmation nor Undo.
	 */
	const onWrite = useCallback(
		async (op: "read" | "unread") => {
			const targets = selectionTargets(selection, rows);
			if (targets.length === 0) return;
			setWriting(true);
			try {
				const outcome = await inbox.write(op, targets);
				/* Only a write that landed clears the selection. A refusal leaves the
				 * rows selected and says why (code review M3 / QA Q3). */
				if (outcome.ok) clearSelection();
			} finally {
				setWriting(false);
			}
		},
		[clearSelection, inbox, rows, selection],
	);

	/**
	 * Dismiss ONE row: no dialog, but the same receipt and the same undo as every
	 * other dismiss. A single dismiss is not worth an interruption, and it is not
	 * worth being unrecoverable either — the relay reverses it with `undismiss`
	 * (design review D2).
	 */
	const dismissOne = useCallback(
		(item: NotificationItem) =>
			dismissAll.dismissNow([
				{
					id: item.id,
					revision: item.revision,
				},
			]),
		[dismissAll],
	);

	/** Dismiss the selection: a dialog when it can remove more than one row, the
	 *  direct receipt when it removes exactly one. */
	const onDismissSelection = useCallback(() => {
		const targets = dismissableTargets(selection, rows);
		if (targets.length === 0) return;
		if (targets.length === 1) {
			void dismissAll.dismissNow(targets).then((ok) => {
				if (ok) clearSelection();
			});
			return;
		}
		dismissAll.askTargets(targets);
	}, [clearSelection, dismissAll, rows, selection]);

	/** Mark all read, then keep the selection state honest about whether it landed. */
	const onMarkAll = useCallback(async () => {
		setWriting(true);
		try {
			await inbox.markAllRead();
		} finally {
			setWriting(false);
		}
	}, [inbox]);

	const openItem = useCallback(
		(item: NotificationItem) => {
			router.push(`/notifications/${encodeURIComponent(item.id)}`);
		},
		[router],
	);

	const pressRow = useCallback(
		(item: NotificationItem) => {
			noteInput("press");
			if (selecting) {
				setSelection((held) => toggleSelection(held, item));
				return;
			}
			openItem(item);
		},
		[noteInput, openItem, selecting],
	);

	/* A SHORT VIEWPORT OR A LARGE TEXT SCALE COLLAPSES THE TOOLBAR. Measured on
	 *  the shipped frames: iphone-15-landscape at 100 % spent 72 % of its 390 pt
	 *  on chrome before the first card, and at 200 % showed no row at all; the
	 *  in-scroll stack (filter + verbs + count + heading) was the larger share
	 *  (design review D4). The threshold is the first row's own height plus the
	 *  header, i.e. below this the stack cannot leave room for one card. */
	const { height: viewportHeight, width: viewportWidth } =
		useWindowDimensions();
	const { effectiveScale } = useTextScale();
	/* ONE ROW ONLY WHERE ONE ROW FITS. Short landscape (844×390) has the width for
	 *  filter-beside-verbs and needs the height, which is the case design review D4
	 *  measured (72 % chrome at 100 %, no row at all at 200 %). A 320 pt phone at
	 *  200 % is short in neither dimension — it is NARROW, and side-by-side there
	 *  overlapped the segmented control's own label over the verbs (caught by the
	 *  audit's U-08 on the frame), so the stack stays. */
	const compactToolbar = viewportHeight < 450 && viewportWidth >= 600;

	const selectedCount = selectionTargets(selection, rows).length;
	const skipped = skippedSentence(inbox.skipped);

	/* --------------------------------------------------------------- render -- */

	const body = (() => {
		if (inbox.loading && response === null) {
			/* THE SKELETON HOLDS THE TOOLBAR'S SPACE. Without the verb row, the count
			 * and the section label, the first card jumped 110 pt when the read
			 * landed — once per visit (design review D5, measured on iphone-15 at
			 * 100 %: first skeleton bar 229 pt, first card 339 pt). */
			return (
				<View className="gap-2 px-4 pt-3" testID={SURFACE.inboxLoading}>
					{/* The filter's own box, then the verb row, then the count. */}
					<Skeleton lines={1} barClassName="h-12 w-full" />
					<View className="flex-row items-center gap-2">
						<Skeleton lines={1} barClassName="h-8 w-2/5" />
						<Skeleton lines={1} barClassName="h-8 w-1/4" />
					</View>
					<View className="gap-3 pt-3">
						{[0, 1, 2, 3].map((index) => (
							<Skeleton key={index} lines={2} />
						))}
					</View>
				</View>
			);
		}
		if (inbox.refused !== null) {
			return (
				<View className="gap-3 px-4 pt-4" testID={SURFACE.inboxError}>
					<Alert severity="error" title="That did not work">
						{inbox.refused}
					</Alert>
					<Button
						label={RETRY_LABEL}
						onPress={() => inbox.reload()}
						variant="outline"
						testID={CONTROL.inboxRetry}
					/>
				</View>
			);
		}
		if (inbox.unreachable) {
			return (
				<View className="gap-3 px-4 pt-4" testID={SURFACE.inboxError}>
					<Alert severity="error">{READ_UNREACHABLE}</Alert>
					<Button
						label={RETRY_LABEL}
						onPress={() => inbox.reload()}
						variant="outline"
						testID={CONTROL.inboxRetry}
					/>
				</View>
			);
		}
		if (response !== null && inboxEmpty(response)) {
			/* Two different sentences for the same empty answer: "all caught up" is
			 * the unread pile's verdict, and the All view saying it would claim the
			 * store holds nothing when it holds read history. */
			return inbox.filter === "unread" ? (
				<EmptyState
					headline={ALL_CAUGHT_UP_TITLE}
					next={ALL_CAUGHT_UP_BODY}
					testID={EMPTY.notifications}
				/>
			) : (
				<EmptyState
					headline="Nothing here yet"
					next={EMPTY_ALL_BODY}
					testID={EMPTY.notificationsAll}
				/>
			);
		}
		/* The populated case is the FlatList in the render below, not a branch
		 *  here: the list owns the rows so the platform can answer "which are on
		 *  screen", which is the whole read receipt. */
		if (response !== null) return null;
		/* No answer, no failure: the read has not landed yet (an older frame's
		 * first tick). The skeleton above covers the common path; this is the
		 * honest blank rather than an invented empty state. */
		return <View className="flex-1" />;
	})();

	return (
		<Screen
			title="Notifications"
			testID={SCREEN.notifications}
			scroll={false}
			headerLeading={
				<IconButton
					accessibilityLabel="Back"
					onPress={() => router.back()}
					icon={({ color, size }) => <ChevronLeft color={color} size={size} />}
					testID={CONTROL.inboxBack}
				/>
			}
		>
			<View className="flex-1">
				{/* ONE scroll region for the toolbar and the rows, with only the
				 *  selection bar pinned below it. With the toolbar fixed above a
				 *  scrolling list, a short landscape phone at 200 % text spent its
				 *  whole 390 pt on the filter, the two verbs, the count and the
				 *  selection bar: the list's own height measured zero, so no row could
				 *  be reached or selected (capture S18/multi-select, iphone-15-landscape
				 *  at 200 %: the first row's checkbox "unreachable"). Scrolling the
				 *  toolbar away is what gives the rows the screen back. */}
				{response !== null && entries.length > 0 ? (
					<FlatList
						className="flex-1"
						contentContainerStyle={{ paddingBottom: 24 }}
						/* The platform's own answer to "which rows are on screen", which is
						 *  the ONLY thing that feeds the read receipt (B1). `data` carries the
						 *  section headings as well as the rows, so the callback's `item` is
						 *  narrowed by `kind` before the feed sees it. */
						data={entries}
						keyExtractor={(entry) => entry.id}
						viewabilityConfig={VIEWABILITY_CONFIG}
						onViewableItemsChanged={viewability}
						renderItem={({ item: entry }) =>
							entry.kind === "header" ? (
								<View className="gap-2 px-4 pt-3">
									<SectionHeader
										label={
											entry.id === "h:waiting" && response !== null
												? waitingSummary(response.waiting_count)
												: entry.title
										}
									/>
								</View>
							) : (
								<View className="px-4 pt-2">
									<InboxRow
										item={entry.item}
										nowMs={inbox.nowMs}
										selecting={selecting}
										selected={selection.has(rowKey(entry.item))}
										onPress={() => pressRow(entry.item)}
										onPressIn={() => noteInput("press")}
										onDismiss={() => void dismissOne(entry.item)}
										onAnswer={() => openItem(entry.item)}
										onDismissConversation={() =>
											void dismissAll.askFresh(
												entry.item.session.id,
												entry.item.session.title,
											)
										}
									/>
								</View>
							)
						}
						ListHeaderComponent={
							<View className="gap-2 px-4 pb-1 pt-3">
								<View
									className={
										compactToolbar ? "flex-row items-center gap-2" : "gap-2"
									}
								>
									<View className={compactToolbar ? "flex-1" : undefined}>
										<SegmentedFilter
											value={inbox.filter}
											onChange={inbox.setFilter}
										/>
									</View>
									<View className="flex-row items-center gap-2">
										{response !== null && hasUnread(response) && !selecting ? (
											<Button
												label={writing ? MARK_ALL_BUSY : MARK_ALL_LABEL}
												onPress={() => void onMarkAll()}
												variant="quiet"
												size="sm"
												disabled={writing}
												testID={CONTROL.inboxMarkAll}
											/>
										) : null}
										{rows.length > 0 ? (
											<Button
												label={selecting ? SELECT_DONE : SELECT_LABEL}
												onPress={() =>
													selecting ? clearSelection() : setSelecting(true)
												}
												variant="quiet"
												size="sm"
												testID={
													selecting
														? CONTROL.inboxSelectionDone
														: CONTROL.inboxSelect
												}
											/>
										) : null}
									</View>
								</View>
								{/* The count line is folded away in the compact form: on a
								 *  landscape phone at 200 % it was one of the rows that
								 *  pushed the first card off screen entirely (design review
								 *  D4). */}
								{!compactToolbar && response !== null && hasUnread(response) ? (
									<Text className="text-meta text-ink-dim">
										{unreadSummary(response.unread_count)}
									</Text>
								) : null}
								{inbox.writeError !== null ? (
									<View testID={SURFACE.inboxSkipped}>
										<Alert severity="error">{inbox.writeError}</Alert>
									</View>
								) : null}
								{skipped !== null ? (
									<View testID={SURFACE.inboxSkipped}>
										<Alert severity="warning">{skipped}</Alert>
									</View>
								) : null}
								<DismissReceipt dismissAll={dismissAll} />
							</View>
						}
						ListFooterComponent={
							<View className="px-4 pt-2">
								{inbox.loadingMore ? (
									<View className="items-center py-4">
										<ActivityIndicator />
									</View>
								) : response !== null && response.next_cursor !== null ? (
									/* A cursor page is a reader's explicit act, not a scroll
									 *  trigger the list guesses at. */
									<View className="items-center py-4">
										<Button
											label={LOAD_MORE_LABEL}
											onPress={() => inbox.loadMore()}
											variant="outline"
											testID={CONTROL.inboxLoadMore}
										/>
									</View>
								) : null}
							</View>
						}
						refreshControl={
							response !== null ? (
								<RefreshControl
									refreshing={inbox.busy && !writing}
									onRefresh={() => inbox.reload({ silent: true })}
								/>
							) : undefined
						}
						onScrollBeginDrag={() => noteInput("scroll")}
						/* A touch anywhere on the rows is the trusted gesture the receipt
						 *  needs; it is recorded on the list, not on each row, so a swipe
						 *  that starts between two rows still counts. */
						onTouchStart={() => noteInput("touch")}
						testID={CONTROL.inboxList}
					/>
				) : (
					/* Every other state — loading, refused, unreachable, empty — draws
					 * its own view, so an unreadable inbox can never look like an
					 * empty one. */
					body
				)}

				{selecting ? (
					<View
						/* In the layout, not over it: an absolute bar covers the last rows,
						 *  and a control that covers content is an overlap the reader pays
						 *  for (the audit scores it, and it hid the very items the
						 *  selection was made from). */
						/* WRAPS rather than widening the screen. At 200 % text on a 320 pt
						 *  phone the count plus two outline buttons is 367 pt in one row;
						 *  the document grew past the viewport, mobile Chrome widened the
						 *  layout viewport to fit, and the screen's own ground stopped
						 *  covering it (CI run 40229891769: canvas measured transparent on
						 *  S18/multi-select at iphone-se 200 %, with U-06 +47 pt on the
						 *  same frames). The count keeps its natural width; the verbs are
						 *  one group that drops to its own line, and wraps inside it, when
						 *  they cannot share the count's. */
						className="flex-row flex-wrap items-center gap-2 border-hairline border-t bg-canvas px-4 py-3"
						testID={SURFACE.inboxSelectionBar}
					>
						<Text className="grow text-meta text-ink-dim">
							{selectedCountLabel(selectedCount)}
						</Text>
						<View className="shrink flex-row flex-wrap items-center gap-2">
							<Button
								label={MARK_READ_LABEL}
								onPress={() => void onWrite("read")}
								variant="outline"
								size="sm"
								disabled={selectedCount === 0 || writing}
								testID={CONTROL.inboxMarkRead}
							/>
							{inbox.filter === "all" ? (
								<Button
									label={MARK_UNREAD_LABEL}
									onPress={() => void onWrite("unread")}
									variant="outline"
									size="sm"
									disabled={selectedCount === 0 || writing}
									testID={CONTROL.inboxMarkUnread}
								/>
							) : null}
							<Button
								label={DISMISS_LABEL}
								onPress={onDismissSelection}
								variant="outline"
								size="sm"
								disabled={selectedCount === 0 || writing}
								testID={CONTROL.inboxDismiss}
							/>
						</View>
					</View>
				) : null}
			</View>
			<Dialog
				visible={dismissAll.phase.kind === "confirming"}
				testID={CONTROL.inboxDismissAllDialog}
				title={confirmTitleFor(dismissAll.phase)}
				body={confirmBodyFor(dismissAll.phase)}
				confirmLabel={DISMISS_CONFIRM_LABEL}
				destructive
				onConfirm={() => void dismissAll.confirm()}
				onCancel={dismissAll.cancel}
			/>
		</Screen>
	);
}

/** The filter control, in its own component so the segmented group's generic is
 *  fixed once rather than at the call site. */
function SegmentedFilter({
	value,
	onChange,
}: {
	value: "unread" | "all";
	onChange: (value: "unread" | "all") => void;
}) {
	return (
		<Segmented
			label="Show"
			options={[
				{
					value: "unread",
					label: FILTER_UNREAD,
					testID: CONTROL.inboxFilterUnread,
				},
				{ value: "all", label: FILTER_ALL, testID: CONTROL.inboxFilterAll },
			]}
			value={value}
			onChange={onChange}
			testID={CONTROL.inboxFilterUnread}
		/>
	);
}

/**
 * One row.
 *
 * The title truncates and the meta line never yields — the shipped client's rule
 * (`list-row.tsx`): a shorter string that is itself valid ("59m 59s" → "59m")
 * looks correct while saying something false.
 */
function InboxRow({
	item,
	nowMs,
	selecting,
	selected,
	onPress,
	onPressIn,
	onDismiss,
	onAnswer,
	onDismissConversation,
}: {
	item: NotificationItem;
	nowMs: number;
	selecting: boolean;
	selected: boolean;
	onPress: () => void;
	onPressIn: () => void;
	onDismiss: () => void;
	onAnswer: () => void;
	onDismissConversation: () => void;
}) {
	const isAsk = item.source === "ask" || item.ask !== null;
	/* The conversation verb rides on UPDATE rows only (design §10's rotor
	 *  entries): an ask row's verb is Answer, and offering "dismiss all" from a
	 *  row the action would skip reads as a promise it cannot keep. Off in
	 *  selection mode, where a row's activation means "toggle". */
	const conversationAction =
		!isAsk && !selecting
			? [
					{
						name: "dismissConversation",
						label: dismissAllActionLabel(item.session.title),
					},
				]
			: undefined;
	return (
		<Pressable
			onPress={onPress}
			onPressIn={onPressIn}
			accessibilityActions={conversationAction}
			onAccessibilityAction={(event) => {
				if (event.nativeEvent.actionName === "dismissConversation") {
					onDismissConversation();
				}
			}}
			accessibilityRole={ROLE.button}
			accessibilityState={selecting ? { selected } : undefined}
			accessibilityLabel={
				selecting
					? `${selected ? "Selected" : "Not selected"}: ${item.title}`
					: `${item.title}. ${item.session.title}. ${relativeTime(item.updated_at * 1000, nowMs)}`
			}
			className={cx(
				"rounded-md border-hairline bg-elevated p-3",
				selected ? "bg-row-selected" : null,
			)}
			testID={notificationRowId(item.id)}
		>
			<View className="flex-row items-start gap-2">
				{selecting ? (
					<View
						className={cx(
							/* A REAL BORDER, NOT `border-hairline`: that token carries a
							 * colour but resolves to `border-width: 0` on the web target, so
							 * the unchecked box measured 1.00:1 against its own card in both
							 * themes — invisible in the one state where the reader is being
							 * asked to choose rows (design review D1). 2 pt of `ink-dim`
							 * clears the 3:1 boundary bar on both cards (5.73:1 light,
							 * 4.7:1 dark, measured in that review). */
							"mt-1 h-5 w-5 items-center justify-center rounded-sm border-2 border-ink-dim",
							selected ? "border-transparent bg-accent" : "bg-elevated",
						)}
						testID={notificationSelectId(item.id)}
					>
						{selected ? <Text className="text-meta text-canvas">✓</Text> : null}
					</View>
				) : null}
				{/* `min-w-0` is load-bearing on the web target: a flex child's default
				 *  min-width is its content, so without it a long excerpt pushes the
				 *  trailing time and the dismiss control off the row instead of
				 *  ellipsizing (measured on the 320 pt phone frame). */}
				<View className="min-w-0 flex-1">
					<View className="flex-row items-center gap-2">
						<Text
							className={cx(
								"min-w-0 flex-1 text-body",
								item.read ? "text-ink-dim" : "text-ink",
							)}
						>
							{item.title}
						</Text>
						<Text className="shrink-0 text-meta text-ink-dim">
							{relativeTime(item.updated_at * 1000, nowMs)}
						</Text>
					</View>
					{item.excerpt.length > 0 ? (
						<Text className="text-meta text-ink-muted">{item.excerpt}</Text>
					) : null}
					<View className="mt-1 flex-row items-center gap-2">
						<Text
							className="min-w-0 flex-1 text-meta text-ink-dim"
							numberOfLines={1}
						>
							{isAsk
								? `${item.session.title} · ${item.ask?.question_count ?? 1} question${(item.ask?.question_count ?? 1) === 1 ? "" : "s"}`
								: item.session.title}
						</Text>
						{isAsk ? (
							<Button
								label="Answer"
								onPress={onAnswer}
								variant="outline"
								size="sm"
								testID={notificationAnswerId(item.id)}
							/>
						) : canDismiss(item) && !selecting ? (
							<IconButton
								accessibilityLabel="Dismiss"
								onPress={onDismiss}
								icon={({ color, size }) => <X color={color} size={size} />}
								size={14}
								testID={notificationDismissId(item.id)}
							/>
						) : null}
					</View>
				</View>
			</View>
		</Pressable>
	);
}
