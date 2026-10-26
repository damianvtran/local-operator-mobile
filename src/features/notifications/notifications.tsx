import { useRouter } from "expo-router";
import { CheckCheck, ChevronLeft, X } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	ActivityIndicator,
	FlatList,
	Pressable,
	RefreshControl,
	Text,
	View,
} from "react-native";

import type { NotificationItem } from "@/contracts";
import {
	useConnection,
	useListState,
} from "@/features/auth/connection-provider";
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
	conversationName,
	DISMISS_LABEL,
	dismissableTargets,
	EMPTY_ALL_BODY,
	FILTER_ALL,
	FILTER_UNREAD,
	footerControl,
	hasUnread,
	inboxEmpty,
	inboxRows,
	inboxSections,
	LOAD_MORE_LABEL,
	LOAD_MORE_RETRY,
	MARK_ALL_LABEL,
	MARK_READ_LABEL,
	MARK_UNREAD_LABEL,
	notificationsEnabled,
	READ_UNREACHABLE,
	RETRY_LABEL,
	relativeTime,
	rowAccessibilityLabel,
	rowKey,
	SELECT_DONE,
	SELECT_LABEL,
	selectedCountLabel,
	selectionTargets,
	toggleSelection,
	waitingSummary,
} from "@/features/notifications/notifications-model";
import { useConversationDismiss } from "@/features/notifications/use-conversation-dismiss";
import {
	skippedSentence,
	useNotifications,
} from "@/features/notifications/use-notifications";
import { AsksSheet } from "@/features/session/components/asks-sheet";
import { useSessionRuntime } from "@/features/session/use-session";
import {
	CONTROL,
	EMPTY,
	notificationAnswerId,
	notificationDismissId,
	notificationPriorityId,
	notificationRepeatId,
	notificationRowId,
	notificationSelectId,
	ROLE,
	SCREEN,
	SURFACE,
} from "@/ui/a11y";
import { Alert } from "@/ui/components/alert";
import { Badge } from "@/ui/components/badge";
import { Button } from "@/ui/components/button";
import { Dialog } from "@/ui/components/dialog";
import { EmptyState } from "@/ui/components/empty-state";
import { IconButton } from "@/ui/components/icon-button";
import { Screen } from "@/ui/components/screen";
import { SectionHeader } from "@/ui/components/section-header";
import { Segmented } from "@/ui/components/segmented";
import { Skeleton } from "@/ui/components/skeleton";
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
 * READS ARE EXPLICIT (D11). Nothing on this reel auto-reads: an in-view receipt
 * made rows vanish under the finger and the real relay refused it. Opening a
 * loaded detail is the explicit read, revision-bound, and a row stays on this
 * view until the next navigation or refresh rather than disappearing mid-touch.
 */
export default function Notifications() {
	const router = useRouter();
	const { relay } = useConnection();
	const client = relay();
	const capabilities = useListState((state) => state.capabilities);
	const frameCount = useListState((state) => state.frameCount);
	const enabled = notificationsEnabled(capabilities);
	/* UNKNOWN IS NOT "NO". Before the first list frame, `capabilities` is an
	 * empty bag: an absence there means "the relay has not spoken yet", so the
	 * screen keeps its skeleton. Only a frame that HAS arrived and still omits
	 * the flag earns the unsupported sentence — the contract's absence rule
	 * (`libraryEnabled`'s, applied to a screen as well as an entry point). */
	const unsupported = !enabled && frameCount > 0;
	const inbox = useNotifications(client, enabled && client !== null);
	const [answerSession, setAnswerSession] = useState<string | null>(null);
	const runtime = useSessionRuntime(answerSession ?? "");
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
	/** Set when Dismiss is pressed in selection mode, so the phase watcher can
	 *  tell a selection's dismissal from the From card's. */
	const selectionDismissed = useRef(false);

	/* NEITHER THE LIST NOR THE REEL AUTO-READS ANYTHING (D11).
	 *
	 * Round 3 removed the in-view receipt feed from this screen outright. Two
	 * independent reasons, either sufficient:
	 *
	 *  - the relay refuses a phone's read receipt. Its `POST /api/notifications/seen`
	 *    answers 422 `relay_seen_unsupported` ("no relay/native auto-read in v1",
	 *    contract §6.4), so every automatic write was a 2 Hz retry loop under a
	 *    permanent red banner (NC2/ND2);
	 *  - reading a reel row on touch made it vanish under the finger, on the one
	 *    filter where the reader is working through a pile (ND1).
	 *
	 * What replaces it is the explicit act the contract names: opening an item's
	 * LOADED detail marks that item read, with the revision it rendered
	 * (`notification-detail.tsx`). Nothing on this screen writes a read.
	 */

	const response = inbox.response;
	/* The footer's single control, decided in the model so it cannot be two. */
	const footer = footerControl({
		loadingMore: inbox.loadingMore,
		hasCursor: response !== null && response.next_cursor !== null,
		error: inbox.loadMoreError,
	});
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

	/* A confirmed multi-select dismissal must leave the bar. Otherwise it stays up
	 * over a selection of rows that no longer exist, and the reader reads "Nothing
	 * selected" under a receipt (code review round 2 minor 3). The single-selection
	 * door clears itself; the confirm door ends asynchronously and says nothing
	 * about which door began it, so the phase is watched with a ref that records
	 * whether a selection was what went to the dialog. */
	useEffect(() => {
		if (!selectionDismissed.current) return;
		if (dismissAll.phase.kind !== "done") return;
		selectionDismissed.current = false;
		if (dismissAll.phase.receipt.changed.length > 0) clearSelection();
	}, [dismissAll.phase, clearSelection]);

	/** Dismiss the selection: a dialog when it can remove more than one row, the
	 *  direct receipt when it removes exactly one. */
	const onDismissSelection = useCallback(() => {
		const targets = dismissableTargets(selection, rows);
		if (targets.length === 0) return;
		selectionDismissed.current = true;
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
	const answerItem = useCallback((item: NotificationItem) => {
		/* The session's existing ask sheet owns answering, including secret fields
		 * and the atomic submit. A notification detail is read-only context, not a
		 * second answer form. */
		setAnswerSession(item.session.id);
	}, []);

	const pressRow = useCallback(
		(item: NotificationItem) => {
			if (selecting) {
				setSelection((held) => toggleSelection(held, item));
				return;
			}
			openItem(item);
		},
		[openItem, selecting],
	);

	const selectedCount = selectionTargets(selection, rows).length;
	const skipped = skippedSentence(inbox.skipped);

	/* --------------------------------------------------------------- render -- */

	const body = (() => {
		if (unsupported) {
			return (
				<EmptyState
					headline="Notifications aren't available here"
					next="This computer's relay does not offer the inbox. Update Local Operator on it to use notifications."
					testID={EMPTY.notifications}
				/>
			);
		}
		if (inbox.loading && response === null) {
			/* THE SKELETON HOLDS THE TOOLBAR'S SPACE. Without the verb row, the count
			 * and the section label, the first card jumped 110 pt when the read
			 * landed — once per visit (design review D5, measured on iphone-15 at
			 * 100 %: first skeleton bar 229 pt, first card 339 pt). */
			return (
				<View className="gap-2 px-4 pt-3" testID={SURFACE.inboxLoading}>
					{/* THE SKELETON HOLDS EVERY STRIP ABOVE THE FIRST CARD, not just the
					 *  filter. Round 2 measured the filter placeholder landing 3 pt from
					 *  the real control while the card block still began 84 pt high
					 *  (243 vs 327), because the verb row, the count line and the section
					 *  label had no placeholder (design review round 2, D5 residual).
					 *  Each strip is the real element's own height and the container's
					 *  `gap-2` supplies the rhythm, so the two states line up. */}
					<Skeleton lines={1} barClassName="h-12 w-full" />
					<View className="flex-row items-center gap-2">
						<Skeleton lines={1} barClassName="h-8" widthClassName="w-24" />
						<Skeleton lines={1} barClassName="h-8" widthClassName="w-16" />
					</View>
					<View className="pt-3">
						<Skeleton lines={1} barClassName="h-4" widthClassName="w-2/5" />
					</View>
					<View className="gap-2">
						{[0, 1, 2].map((index) => (
							<View key={index} className="gap-2 rounded-md bg-elevated p-3">
								<Skeleton lines={1} barClassName="h-5" widthClassName="w-4/5" />
								<Skeleton
									lines={1}
									barClassName="h-4"
									widthClassName="w-full"
								/>
								<Skeleton lines={1} barClassName="h-4" widthClassName="w-2/5" />
							</View>
						))}
					</View>
				</View>
			);
		}
		if (inbox.refused !== null) {
			return (
				<View className="gap-3 px-4 pt-4" testID={SURFACE.inboxError}>
					<Alert severity="error" title="Couldn't load notifications">
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
				<View className="gap-2 px-4 pt-3">
					<SegmentedFilter value={inbox.filter} onChange={inbox.setFilter} />
					<EmptyState
						headline={ALL_CAUGHT_UP_TITLE}
						next={ALL_CAUGHT_UP_BODY}
						action={{
							label: "Show all notifications",
							onPress: () => inbox.setFilter("all"),
							testID: CONTROL.inboxFilterAll,
						}}
						testID={EMPTY.notifications}
					/>
				</View>
			) : (
				<EmptyState
					headline="Nothing here yet"
					next={EMPTY_ALL_BODY}
					testID={EMPTY.notificationsAll}
				/>
			);
		}
		/* The populated case is the FlatList below. Rows never report reads on
		 *  their own: a reader may scroll this pile without clearing it (D11). */
		if (response !== null) return null;
		/* No answer, no failure: the read has not landed yet (an older frame's
		 * first tick). The skeleton above covers the common path; this is the
		 * honest blank rather than an invented empty state. */
		return <View className="flex-1" />;
	})();

	return (
		<Screen
			title="Notifications"
			titleLines={1}
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
			headerAction={
				/* THE VERBS LIVE IN THE HEADER. As an in-scroll row above the reel
				 * they cost 48 pt of the height the rows need (design review ND11:
				 * ≥ 4 rows above the fold on iPhone 15), and they are screen-level
				 * actions rather than list content, so the header is where a reader
				 * looks for them. */
				<View className="flex-row items-center gap-2">
					{response !== null && hasUnread(response) && !selecting ? (
						/* The DOUBLE CHECK, with the words as its accessible name: as a
						 * labelled button beside Select it needed ~100 pt, which pushed
						 * the screen's own title into "Notificat…" at 390 pt. The icon
						 * costs 44, the name still says exactly what it does, and the
						 * action stays one tap from the reel. */
						<IconButton
							accessibilityLabel={MARK_ALL_LABEL}
							onPress={() => void onMarkAll()}
							disabled={writing}
							icon={({ color, size }) => (
								<CheckCheck color={color} size={size} />
							)}
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
								selecting ? CONTROL.inboxSelectionDone : CONTROL.inboxSelect
							}
						/>
					) : null}
				</View>
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
						/* Sections and rows share one data array so the platform owns
						 *  scrolling and row identity. No visibility callback is attached:
						 *  merely viewing a reel row never reads it (D11). */
						data={entries}
						keyExtractor={(entry) => entry.id}
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
										onDismiss={() => void dismissOne(entry.item)}
										onAnswer={() => answerItem(entry.item)}
										onWrite={(op, item) => {
											void inbox.write(op, [
												{ id: item.id, revision: item.revision },
											]);
										}}
										onDismissConversation={() =>
											void dismissAll.askFresh(
												entry.item.session.id,
												conversationName(entry.item.session.title),
											)
										}
									/>
								</View>
							)
						}
						ListHeaderComponent={
							<View className="gap-2 px-4 pb-1 pt-3">
								<SegmentedFilter
									value={inbox.filter}
									onChange={inbox.setFilter}
									unreadCount={response?.unread_count ?? 0}
								/>
								{/* NO SEPARATE COUNT LINE. The pile's size rides the filter's
								 *  own label ("Unread 4"), the way the desktop words it, so the
								 *  number is stated once instead of twice — the second line cost
								 *  28 pt of the height the reel needs for its rows (design
								 *  review ND11: 4 rows above the fold on iPhone 15). */}
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
							</View>
						}
						ListFooterComponent={
							<View className="gap-2 px-4 pt-2">
								{/* EXACTLY ONE CONTROL (review round 5, m3/m5). `footerControl`
								 *  owns the choice, so the spinner, the retry and "Load more"
								 *  cannot co-exist — two buttons that re-issue the same cursor
								 *  would be one verb twice. */}
								{footer === "spinner" ? (
									<View className="items-center py-4">
										<ActivityIndicator />
									</View>
								) : footer === "loadMore" ? (
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
								{/* A PAGE THAT FAILED IS A STATED FAILURE (QA round 3, Q7), AND
								 *  ONE CONTROL (review round 4, m3). While the sentence is up the
								 *  "Load more" button is suppressed — two buttons that both
								 *  re-issue the same cursor would be the same verb twice, with
								 *  only one of them promising to retry the failure the reader is
								 *  reading about. The retry re-issues the SAME cursor: `loadMore`
								 *  reads it from the held answer, so nothing about the window
								 *  moves. */}
								{footer === "retry" && inbox.loadMoreError !== null ? (
									<View
										className="gap-2 pb-4"
										testID={SURFACE.inboxLoadMoreFailed}
									>
										<Alert severity="warning">{inbox.loadMoreError}</Alert>
										<Button
											label={LOAD_MORE_RETRY}
											onPress={() => inbox.loadMore()}
											variant="outline"
											testID={CONTROL.inboxLoadMoreRetry}
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
						testID={CONTROL.inboxList}
					/>
				) : (
					/* Every other state — loading, refused, unreachable, empty — draws
					 * its own view, so an unreadable inbox can never look like an
					 * empty one. */
					body
				)}

				{/* Receipts live in the pinned footer, never in the scrolled-away
				 * list header: a one-click dismiss at the bottom of the reel must still
				 * show its sentence and Undo (ND3). */}
				<DismissReceipt dismissAll={dismissAll} />
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
			<AsksSheet
				visible={answerSession !== null}
				onClose={() => setAnswerSession(null)}
				client={runtime.source.endpoints}
				currentSessionId={answerSession ?? undefined}
				onOpenConversation={(target) => {
					setAnswerSession(null);
					router.push(`/session/${target}`);
				}}
			/>
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
	unreadCount = 0,
}: {
	value: "unread" | "all";
	onChange: (value: "unread" | "all") => void;
	unreadCount?: number;
}) {
	return (
		<Segmented
			label="Show"
			options={[
				{
					value: "unread",
					label:
						unreadCount > 0 ? `${FILTER_UNREAD} ${unreadCount}` : FILTER_UNREAD,
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
	onDismiss,
	onAnswer,
	onDismissConversation,
	onWrite,
}: {
	item: NotificationItem;
	nowMs: number;
	selecting: boolean;
	selected: boolean;
	onPress: () => void;
	onDismiss: () => void;
	onAnswer: () => void;
	onDismissConversation: () => void;
	onWrite: (op: "read" | "unread", item: NotificationItem) => void;
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
						label: dismissAllActionLabel(conversationName(item.session.title)),
					},
				]
			: undefined;
	/* Swipe gestures are deliberately not implemented here: this app has no
	 * swipe primitive or motion implementation to reuse, and adding one would
	 * introduce a second interaction stack. The equivalent platform actions are
	 * available to assistive technology on every update and ask row. */
	const rowActions = [
		...(conversationAction ?? []),
		...(!isAsk && !selecting
			? [
					{ name: "markRead", label: item.read ? "Mark unread" : "Mark read" },
					...(canDismiss(item)
						? [{ name: "dismiss", label: DISMISS_LABEL }]
						: []),
				]
			: []),
		...(isAsk ? [{ name: "answer", label: "Answer" }] : []),
	];
	const onRowAction = (name: string) => {
		if (name === "dismissConversation") onDismissConversation();
		else if (name === "markRead") onWrite(item.read ? "unread" : "read", item);
		else if (name === "dismiss") onDismiss();
		else if (name === "answer") onAnswer();
	};
	const seenLabel =
		item.read_via === "in_view"
			? "Seen in conversation"
			: item.read_via === "watching"
				? "Seen live"
				: null;
	return (
		<Pressable
			onPress={onPress}
			accessibilityActions={rowActions}
			onAccessibilityAction={(event) =>
				onRowAction(event.nativeEvent.actionName)
			}
			accessibilityRole={ROLE.button}
			accessibilityState={selecting ? { selected } : undefined}
			accessibilityLabel={rowAccessibilityLabel({
				selecting,
				selected,
				item,
				nowMs,
			})}
			className={cx(
				"rounded-md border-hairline bg-elevated p-3",
				selected ? "bg-row-selected" : null,
			)}
			testID={notificationRowId(item.id)}
		>
			<View className="flex-row items-start gap-2">
				{/* AN OPEN ASK GETS NO CHECKBOX. It cannot be dismissed (the relay refuses
				 *  it: `skipped: live_ask`) and it is not read — it is answered — so a
				 *  selectable box would offer an action the model then drops, and it
				 *  moved the confirmation threshold while doing it: "2 items selected"
				 *  opened no dialog and dismissed one row, with no skipped sentence
				 *  (design review round 2 D9). The row's own action is Answer. */}
				{selecting && item.source !== "ask" ? (
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
						{!item.read ? (
							<View className="h-2 w-2 shrink-0 rounded-full bg-accent" />
						) : null}
						{item.priority === "high" ? (
							<Badge
								label="High"
								tone="warning"
								testID={notificationPriorityId(item.id)}
							/>
						) : null}
						<Text
							numberOfLines={1}
							className={cx(
								"min-w-0 flex-1 text-body",
								item.read ? "text-ink-dim" : "text-ink",
							)}
						>
							{item.title}
						</Text>
					</View>
					{item.excerpt.length > 0 ? (
						<Text numberOfLines={1} className="text-meta text-ink-muted">
							{item.excerpt}
						</Text>
					) : null}
					{/* THE META LINE CARRIES THE TIME AND THE VERB. In the title row they
					 *  competed with the title and the priority chip for a 288 pt column,
					 *  and at the 320 pt phone / 135-200 % text the row's own min-content
					 *  was 12 pt wider than the viewport (audit U-06, four rows on each of
					 *  four CI cells). Here the session label is the only shrinking
					 *  element; the clock, the repeat count and the control have their
					 *  own boxes and none can push the row out. */}
					<View className="mt-1 flex-row items-center gap-2">
						<Text
							className="min-w-0 flex-1 text-meta text-ink-dim"
							numberOfLines={1}
						>
							{isAsk
								? `${conversationName(item.session.title)} · ${item.ask?.question_count ?? 1} question${(item.ask?.question_count ?? 1) === 1 ? "" : "s"}`
								: conversationName(item.session.title)}
							{seenLabel !== null ? ` · ${seenLabel}` : ""}
						</Text>
						{/* No clock is no age: `relativeTime` answers `""` for a zero stamp,
						 *  and the element is not drawn at all rather than reserving an empty
						 *  slot (QA round 4, O2). */}
						{relativeTime(item.updated_at, nowMs) !== "" ? (
							<Text className="shrink-0 text-meta text-ink-dim">
								{relativeTime(item.updated_at, nowMs)}
							</Text>
						) : null}
						{item.repeat_count > 1 ? (
							<Badge
								label={`×${item.repeat_count}`}
								tone="neutral"
								testID={notificationRepeatId(item.id)}
							/>
						) : null}
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
