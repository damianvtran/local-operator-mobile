import { useFocusEffect, useRouter } from "expo-router";
import { ChevronLeft, X } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	ActivityIndicator,
	AppState,
	Pressable,
	RefreshControl,
	ScrollView,
	Text,
	View,
	type ViewToken,
} from "react-native";

import type { NotificationItem } from "@/contracts";
import { useConnection } from "@/features/auth/connection-provider";
import {
	ALL_CAUGHT_UP_BODY,
	ALL_CAUGHT_UP_TITLE,
	canDismiss,
	DISMISS_LABEL,
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
import {
	ReadReceiptTracker,
	reviewToken,
} from "@/features/notifications/notifications-read-receipts";
import {
	skippedSentence,
	useNotifications,
} from "@/features/notifications/use-notifications";
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
import { EmptyState } from "@/ui/components/empty-state";
import { IconButton } from "@/ui/components/icon-button";
import { Screen } from "@/ui/components/screen";
import { SectionHeader } from "@/ui/components/section-header";
import { Segmented } from "@/ui/components/segmented";
import { Skeleton } from "@/ui/components/skeleton";
import { cx } from "@/ui/variants";

/** The receipt loop's cadence: the completion-ack loop's own 500 ms, for the same
 *  reason — a receipt should not wait a visible tick to land. */
const RECEIPT_CHECK_MS = 500;

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

	/** Multi-select mode. Off by default: the list is for reading, and a screen
	 *  that opened in selection mode would make the first tap mean the wrong
	 *  thing. */
	const [selecting, setSelecting] = useState(false);
	const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
	const [writing, setWriting] = useState(false);

	/** The receipt engine, one per screen instance. Its `settled` set is what
	 *  stops a second touch re-sending what the relay already accepted. */
	const receipts = useRef(new ReadReceiptTracker()).current;
	const receiptInFlight = useRef(false);
	/** The newest `seen` sender, so the loop below never calls a stale closure. */
	const sendSeen = useRef(inbox.seen);
	sendSeen.current = inbox.seen;

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

	/* ---- presence: the three facts the receipt engine cannot know by itself ---- */

	useEffect(() => {
		receipts.setAppActive(AppState.currentState === "active");
		const subscription = AppState.addEventListener("change", (next) => {
			receipts.setAppActive(next === "active");
		});
		return () => subscription.remove();
	}, [receipts]);

	useFocusEffect(
		useCallback(() => {
			receipts.setScreenFocused(true);
			/* A covering surface is a SHEET or a dialog. This screen opens neither:
			 * the multi-select bar sits in the layout, not over it, so it cannot hide
			 * a row. The flag is set explicitly rather than left to a default, so the
			 * day a sheet lands here the omission is visible. */
			receipts.setCovered(false);
			return () => {
				receipts.setScreenFocused(false);
				receipts.resetView();
			};
		}, [receipts]),
	);

	/** A trusted gesture — a touch, a drag, a press. Never a navigation and never
	 *  a timer: neither says a person was there. */
	const noteInput = useCallback(
		(kind: "touch" | "press" | "scroll") => {
			receipts.noteInput(Date.now(), kind);
		},
		[receipts],
	);

	/** Viewability is the platform's own answer to "is this row on screen", at
	 *  the 50 % threshold the doctrine uses. */
	const onViewable = useRef((info: { viewableItems: ViewToken[] }) => {
		const visible = info.viewableItems
			.map((token) => token.item as NotificationItem | undefined)
			.filter((item): item is NotificationItem => item !== undefined)
			.map((item) => ({ id: item.id, revision: item.revision }));
		receipts.render(visible, Date.now());
	}).current;

	useEffect(() => {
		const timer = setInterval(() => {
			const now = Date.now();
			const targets = receipts.due(now);
			if (targets.length === 0 || receiptInFlight.current) return;
			const presence = receipts.evidence(now);
			if (presence === null) return;
			receiptInFlight.current = true;
			void sendSeen
				.current(targets, {
					surface: "native",
					input_kind: presence.input_kind,
					input_at_ms: presence.input_at_ms,
					visible_since_ms: now,
				})
				.then((outcome) => {
					if (!outcome.ok) return;
					const accepted = new Set(outcome.changed);
					receipts.settle(
						targets.filter((target) => accepted.has(reviewToken(target))),
					);
				})
				.finally(() => {
					receiptInFlight.current = false;
				});
		}, RECEIPT_CHECK_MS);
		return () => clearInterval(timer);
	}, [receipts]);

	/* ------------------------------------------------------------- the acts -- */

	const clearSelection = useCallback(() => {
		setSelection(new Set());
		setSelecting(false);
	}, []);

	const onWrite = useCallback(
		async (op: "read" | "unread" | "dismiss") => {
			const targets = selectionTargets(selection, rows);
			if (targets.length === 0) return;
			setWriting(true);
			try {
				await inbox.write(
					op,
					/* Dismiss skips the rows the relay does not admit, rather than sending
					 * them to be refused: an open ask is settled through its own door. */
					op === "dismiss"
						? targets.filter((target) => {
								const row = rows.find(
									(candidate) => candidate.id === target.id,
								);
								return row !== undefined && canDismiss(row);
							})
						: targets,
				);
				clearSelection();
			} finally {
				setWriting(false);
			}
		},
		[clearSelection, inbox, rows, selection],
	);

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

	const selectedCount = selectionTargets(selection, rows).length;
	const skipped = skippedSentence(inbox.skipped);

	/* --------------------------------------------------------------- render -- */

	const body = (() => {
		if (inbox.loading && response === null) {
			return (
				<View className="gap-3 px-4 pt-4" testID={SURFACE.inboxLoading}>
					{[0, 1, 2, 3].map((index) => (
						<Skeleton key={index} lines={2} />
					))}
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
					testID={EMPTY.notifications}
				/>
			);
		}
		if (response !== null) {
			return (
				<ScrollView
					contentContainerStyle={{ paddingBottom: selecting ? 96 : 24 }}
					refreshControl={
						<RefreshControl
							refreshing={inbox.busy && !writing}
							onRefresh={() => inbox.reload({ silent: true })}
						/>
					}
					onTouchStart={() => noteInput("touch")}
					onScrollBeginDrag={() => noteInput("scroll")}
					testID={CONTROL.inboxList}
				>
					{sections.map((section) => (
						<View key={section.id} className="gap-2 px-4 pt-3">
							<SectionHeader label={section.title} />
							{section.data.map((item) => (
								<InboxRow
									key={rowKey(item)}
									item={item}
									nowMs={inbox.nowMs}
									selecting={selecting}
									selected={selection.has(rowKey(item))}
									onPress={() => pressRow(item)}
									onPressIn={() => noteInput("press")}
									onDismiss={() =>
										void inbox.write("dismiss", [
											{ id: item.id, revision: item.revision },
										])
									}
									onAnswer={() => openItem(item)}
								/>
							))}
						</View>
					))}
					{inbox.loadingMore ? (
						<View className="items-center py-4">
							<ActivityIndicator />
						</View>
					) : response !== null && response.next_cursor !== null ? (
						/* A cursor page is a reader's explicit act, not a scroll trigger
						 *  the list guesses at: the relay mints `next_cursor`, and asking
						 *  for one more page is what the button says. */
						<View className="items-center px-4 py-4">
							<Button
								label={LOAD_MORE_LABEL}
								onPress={() => inbox.loadMore()}
								variant="outline"
								testID={CONTROL.inboxLoadMore}
							/>
						</View>
					) : null}
				</ScrollView>
			);
		}
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
				<View className="gap-2 px-4 pb-2 pt-3">
					<SegmentedFilter value={inbox.filter} onChange={inbox.setFilter} />
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
									selecting ? CONTROL.inboxSelectionDone : CONTROL.inboxSelect
								}
							/>
						) : null}
					</View>
				</View>
				{response !== null && hasUnread(response) ? (
					<Text className="px-4 pb-2 text-meta text-ink-dim">
						{unreadSummary(response.unread_count)}
					</Text>
				) : null}
				{skipped !== null ? (
					<View className="px-4 pb-2" testID={SURFACE.inboxSkipped}>
						<Alert severity="warning">{skipped}</Alert>
					</View>
				) : null}
				{body}
				{selecting ? (
					<View
						/* In the layout, not over it: an absolute bar covers the last rows,
						 *  and a control that covers content is an overlap the reader pays
						 *  for (the audit scores it, and it hid the very items the
						 *  selection was made from). */
						className="flex-row items-center gap-2 border-hairline border-t bg-canvas px-4 py-3"
						testID={SURFACE.inboxSelectionBar}
					>
						<Text className="flex-1 text-meta text-ink-dim">
							{selectedCountLabel(selectedCount)}
						</Text>
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
							onPress={() => void onWrite("dismiss")}
							variant="outline"
							size="sm"
							disabled={selectedCount === 0 || writing}
							testID={CONTROL.inboxDismiss}
						/>
					</View>
				) : null}
			</View>
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
}: {
	item: NotificationItem;
	nowMs: number;
	selecting: boolean;
	selected: boolean;
	onPress: () => void;
	onPressIn: () => void;
	onDismiss: () => void;
	onAnswer: () => void;
}) {
	const isAsk = item.source === "ask" || item.ask !== null;
	return (
		<Pressable
			onPress={onPress}
			onPressIn={onPressIn}
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
							"mt-1 h-5 w-5 items-center justify-center rounded-sm border-hairline",
							selected ? "bg-accent" : "bg-elevated",
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
