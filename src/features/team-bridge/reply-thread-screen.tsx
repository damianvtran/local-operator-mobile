/**
 * One message's REPLY thread: the root, its replies oldest-first, and a
 * composer that replies in the thread. Route:
 * `/team-bridge/<tenant>/<conversation>/thread/<root>` (`replyThreadPath`).
 *
 * WHAT IT MIRRORS. The desktop's thread pane (`local-operator-ui`
 * `team-bridge-thread-pane.tsx` / `team-bridge-thread-read.ts`): the same hub
 * routes, the same identity check on the page, and the same READ RULE — a
 * reply advances this reader's thread cursor only once it has been on screen
 * while the app is in front, never because a page was fetched. Both clients
 * write the one hub cursor, so the root's unread clears on both.
 *
 * WHAT IT DELIBERATELY IS NOT. A second conversation screen. It reuses the
 * timeline's message row (`ThreadMessageRow`) so a reply looks exactly like a
 * message, but it has no anchored landing, no history walk and no images in
 * the composer: threads are short, and the desktop pane is text-first too.
 * Threads are one level deep, so its rows never offer a nested thread.
 */
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	AppState,
	FlatList,
	RefreshControl,
	Text,
	View,
	type ViewToken,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocaleFrame } from "@/features/auth/connection-provider";
import {
	textSelectionContainerScroll,
	textSelectionContainerTouch,
	textSelectionContainerTouchCancel,
	textSelectionContainerTouchEnd,
} from "@/features/session/text-selection";
import { activeLocale, t } from "@/i18n";
import type { DirectoryMember, Message } from "@/team-bridge/contract";
import * as model from "@/team-bridge/model";
import type { ProfileSubject } from "@/team-bridge/profile";
import { useTeamBridge, useTeamBridgeState } from "@/team-bridge/provider";
import {
	isReplyRootGone,
	newestDisplayedReplySeq,
	REPLY_THREAD_COMPOSE_PARAM,
	type ReplyThreadTarget,
	replyThreadKey,
} from "@/team-bridge/reply-threads";
import { CONTROL, SCREEN, SURFACE } from "@/ui/a11y";
import { Alert } from "@/ui/components/alert";
import { Button } from "@/ui/components/button";
import { useChromeGlass } from "@/ui/components/chrome-surface";
import { Screen } from "@/ui/components/screen";
import { Sheet } from "@/ui/components/sheet";
import { Skeleton } from "@/ui/components/skeleton";
import { useCompactChrome } from "@/ui/layout";
import { BridgeComposerDock } from "./composer-dock";
import { BridgeBack, BridgeGate } from "./gate";
import { useMessageActions } from "./message-actions-sheet";
import { ProfileSheet } from "./profile-card";
import { BridgeComposerField, BridgeThreadTitle } from "./thread-chrome";
import { ThreadMessageRow } from "./thread-screen";

const single = (value: string | string[] | undefined): string =>
	typeof value === "string" ? value : "";

const NO_PEOPLE: readonly DirectoryMember[] = [];

/** The conversation's 20 s poll (`thread-screen.tsx`): hub messages do not ride
 *  the relay stream, so a visible thread re-reads itself on the same cadence. */
const POLL_MS = 20_000;

/** The conversation a thread belongs to: where Back goes when a cold push or
 *  deep link left no history to pop (UX review U1). */
const conversationPath = (
	target: Pick<ReplyThreadTarget, "tenantId" | "conversationId">,
): string =>
	`/team-bridge/${encodeURIComponent(target.tenantId)}/${encodeURIComponent(target.conversationId)}`;

type Row =
	| { type: "message"; key: string; message: Message; root: boolean }
	| { type: "divider"; key: string; count: number };

function ReplyThreadContent({
	target,
	compose = false,
}: {
	target: ReplyThreadTarget;
	/** Opened from the actions sheet's "Reply in thread": focus the
	 *  composer on arrival (`replyThreadPath(…, { compose: true })`). */
	compose?: boolean;
}) {
	const { actions, hub } = useTeamBridge();
	const insets = useSafeAreaInsets();
	const chromeGlass = useChromeGlass();
	const compact = useCompactChrome();
	const key = replyThreadKey(target);
	const thread = useTeamBridgeState((s) => s.replyThreads[key]);
	const people = useTeamBridgeState(
		(s) => s.orgs[target.tenantId]?.people ?? NO_PEOPLE,
	);
	const conversation = useTeamBridgeState((s) =>
		s.orgs[target.tenantId]?.conversations.find(
			(c) => c.id === target.conversationId,
		),
	);
	const organization = useTeamBridgeState((s) =>
		s.organizations.find((o) => o.tenantId === target.tenantId),
	);
	const selfAccountId = useTeamBridgeState((s) => s.selfAccountId);
	const directoryState = useTeamBridgeState(
		(s) => s.orgs[target.tenantId]?.peopleState,
	);
	useLocaleFrame();
	const locale = activeLocale();
	useEffect(() => {
		/* A reply push opens this screen cold, past the list, so neither the
		 * conversation (the header's subtitle) nor the directory (`Aida (Ben)`
		 * on agent rows) has loaded. The conversation screen does the same
		 * read for the same reason; the store coalesces it. */
		if (organization && (!directoryState || directoryState === "idle"))
			void actions.loadOrganization(target.tenantId, { silent: true });
	}, [actions, organization, directoryState, target.tenantId]);
	/* The conversation's name, drawn the way the conversation header draws it
	 *  (`# humans` for a channel), so a thread opened from a notification says
	 *  where it is (design D3 / UX U2). Absent until the conversation is known. */
	const conversationName = conversation
		? model.conversationTitle(conversation, selfAccountId)
		: null;
	const subtitle =
		conversationName && conversation?.kind === "channel"
			? conversationName.startsWith("#")
				? conversationName
				: `# ${conversationName}`
			: (conversationName ?? undefined);
	const readOnly =
		!!organization?.readOnly || conversation?.status === "archived";

	/* Focus and foreground gate both the poll and the read cursor. Refs, because
	 *  the viewability callback FlatList holds is fixed at mount. */
	const [focused, setFocused] = useState(false);
	const [active, setActive] = useState(AppState.currentState === "active");
	const focusNow = useRef(false);
	const activeNow = useRef(AppState.currentState === "active");
	useEffect(() => {
		const subscription = AppState.addEventListener("change", (next) => {
			activeNow.current = next === "active";
			setActive(activeNow.current);
		});
		return () => subscription.remove();
	}, []);
	useFocusEffect(
		useCallback(() => {
			focusNow.current = true;
			setFocused(true);
			return () => {
				focusNow.current = false;
				setFocused(false);
			};
		}, []),
	);
	useEffect(() => {
		if (!focused || !active) return;
		void actions.loadReplyThread(target);
		const timer = setInterval(() => {
			if (focusNow.current && activeNow.current)
				void actions.loadReplyThread(target);
		}, POLL_MS);
		return () => clearInterval(timer);
	}, [focused, active, actions, target]);

	/*
	 * THE READ RULE. Replies the list reports visible (20 % of the row on
	 * screen, the timeline's own threshold) are the evidence; the newest of
	 * them is acknowledged once it is past the hub's cursor for this reader.
	 * `acked` only suppresses repeats; the cursor itself is the hub's.
	 */
	const visible = useRef<Message[]>([]);
	const acked = useRef(-1);
	const served = useRef<number | undefined>(undefined);
	served.current = thread?.root?.thread_last_read_seq;
	const acknowledge = useCallback(() => {
		if (!focusNow.current || !activeNow.current) return;
		const newest = newestDisplayedReplySeq(visible.current, target.rootId);
		if (newest === null) return;
		if (newest <= Math.max(acked.current, served.current ?? -1)) return;
		acked.current = newest;
		void actions.markReplyThreadRead(target, newest).then((ok) => {
			// A failed write may be retried by the next visibility change.
			if (!ok && acked.current === newest) acked.current = -1;
		});
	}, [actions, target]);
	const acknowledgeRef = useRef(acknowledge);
	acknowledgeRef.current = acknowledge;
	const onViewableItemsChanged = useRef(
		({ viewableItems }: { viewableItems: ViewToken<Row>[] }) => {
			visible.current = viewableItems.flatMap((token) =>
				token.item?.type === "message" && !token.item.root
					? [token.item.message]
					: [],
			);
			acknowledgeRef.current();
		},
	).current;
	const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 20 }).current;
	// Returning to the app (or to this screen) with replies already visible.
	useEffect(() => {
		if (focused && active) acknowledge();
	}, [focused, active, acknowledge]);

	const rows = useMemo<Row[]>(() => {
		if (!thread?.root) return [];
		const root = thread.root;
		// The SERVED count, never `replies.length`: a page can hold fewer.
		const count = root.reply_count ?? 0;
		return [
			{ type: "message", key: root.id, message: root, root: true },
			/* No "0 replies" divider over the empty line ("No replies yet. Start
			 *  the thread."): it said the same thing twice, and "Reply in
			 *  thread" made that the first frame of the headline flow (PR #339
			 *  design round 1, D5). Kept when replies are loaded even if the
			 *  served count lags behind them. */
			...(count === 0 && thread.replies.length === 0
				? []
				: [{ type: "divider" as const, key: "divider", count }]),
			...thread.replies.map(
				(message): Row => ({
					type: "message",
					key: message.id,
					message,
					root: false,
				}),
			),
		];
	}, [thread?.root, thread?.replies]);

	const [profile, setProfile] = useState<ProfileSubject | null>(null);
	const [deliveryHelp, setDeliveryHelp] = useState<string | null>(null);
	/* The timeline's actions sheet, minus "Reply in thread": threads are one
	 *  level deep (the hub refuses a reply as a root), and the root here is
	 *  already this thread. Copy and Select text on every row. */
	const messageActions = useMessageActions({
		scope: "reply",
		tenantId: target.tenantId,
		canReplyInThread: false,
		// The root and every reply take reactions, as on the desktop's thread pane.
		canReact: !readOnly,
	});
	const actionsController = messageActions.controller;
	const actionsOpenId = messageActions.openMessageId;
	const renderItem = useCallback(
		({ item }: { item: Row }) =>
			item.type === "divider" ? (
				<View className="flex-row items-center gap-3 px-4 py-3">
					<Text className="text-meta font-medium text-ink-muted">
						{t("mobile.team_bridge.reply_thread.count", { count: item.count })}
					</Text>
					<View className="h-px flex-1 bg-hairline" aria-hidden />
				</View>
			) : (
				<ThreadMessageRow
					message={item.message}
					continuation={false}
					people={people}
					hub={hub}
					tenantId={target.tenantId}
					onOpenProfile={setProfile}
					onDeliveryHelp={setDeliveryHelp}
					locale={locale}
					actions={actionsController}
					actionsOpen={item.message.id === actionsOpenId}
				/>
			),
		[people, hub, target.tenantId, locale, actionsController, actionsOpenId],
	);

	/* The composer: one pending reply, idempotent on retry. The same text keeps
	 *  its `client_ref`, so a retry after a lost answer never posts twice; an
	 *  edited text mints a new one (the hub refuses a changed body on a reused
	 *  ref), the rule `message-sender.ts` follows for top-level sends. */
	const [draft, setDraft] = useState("");
	const [sending, setSending] = useState(false);
	const [sendError, setSendError] = useState(false);
	const attempt = useRef<{ body: string; ref: string } | null>(null);
	const send = useCallback(async () => {
		const body = draft.trim();
		if (!body || sending) return;
		if (attempt.current?.body !== body)
			attempt.current = { body, ref: model.newClientRef() };
		setSending(true);
		setSendError(false);
		try {
			await actions.sendReply(target, body, attempt.current.ref);
			attempt.current = null;
			setDraft("");
		} catch {
			setSendError(true);
		} finally {
			setSending(false);
		}
	}, [actions, draft, sending, target]);

	const failed = thread?.state === "error" && !thread.root;
	/* A 404 `message_not_found` is final: the root was deleted, so the thread
	 * says so in the conversation screen's own words and offers no Retry that
	 * could only repeat the error (UX review U3). Back is the next step. */
	const gone = failed && isReplyRootGone(thread.error);
	/* Pull-to-refresh shows its spinner until the page answers (UX review U4).
	 * The store keeps a `ready` thread `ready` through a reload, so the state
	 * cannot drive it the way the conversation screen's does. */
	const [refreshing, setRefreshing] = useState(false);
	const refresh = useCallback(() => {
		setRefreshing(true);
		void actions.loadReplyThread(target).finally(() => setRefreshing(false));
	}, [actions, target]);
	const back = <BridgeBack fallback={conversationPath(target)} />;
	return (
		<Screen
			title={t("mobile.team_bridge.reply_thread.title")}
			titleNode={
				<BridgeThreadTitle
					title={t("mobile.team_bridge.reply_thread.title")}
					subtitle={subtitle}
				/>
			}
			compact={compact}
			headerLeading={back}
			scroll={false}
			bottomInset="child"
			testID={SCREEN.teamBridgeReplyThread}
		>
			<View className="flex-1">
				{failed ? (
					<View
						className="gap-3 p-4"
						testID={SURFACE.teamBridgeReplyThreadError}
					>
						<Text accessibilityRole="alert" className="text-body text-ink">
							{gone
								? t("mobile.team_bridge.thread.anchor_missing")
								: t("mobile.team_bridge.reply_thread.error")}
						</Text>
						{gone ? null : (
							<Button
								label={t("mobile.team_bridge.reply_thread.retry")}
								testID={CONTROL.teamBridgeReplyThreadRetry}
								onPress={() => {
									void actions.loadReplyThread(target);
								}}
							/>
						)}
					</View>
				) : !thread?.root ? (
					<View
						className="gap-3 p-4"
						testID={SURFACE.teamBridgeReplyThreadLoading}
					>
						<Skeleton lines={3} />
						<Text className="text-body-sm text-ink-dim">
							{t("mobile.team_bridge.reply_thread.loading")}
						</Text>
					</View>
				) : (
					<FlatList
						testID={SURFACE.teamBridgeReplyThreadList}
						className="flex-1"
						contentContainerClassName="pb-2"
						data={rows}
						keyExtractor={(row) => row.key}
						renderItem={renderItem}
						onViewableItemsChanged={onViewableItemsChanged}
						viewabilityConfig={viewabilityConfig}
						/* The timeline's selection-mode container handlers: on
						 *  Android the hosted "Select text" mode ends only when these
						 *  see a tap outside the message, so without them it never
						 *  ended here and that row's hold started native selection
						 *  instead of opening the sheet (PR #339 round 1, m2). */
						onTouchStart={textSelectionContainerTouch}
						onTouchEnd={textSelectionContainerTouchEnd}
						onTouchCancel={textSelectionContainerTouchCancel}
						onScrollBeginDrag={textSelectionContainerScroll}
						refreshControl={
							<RefreshControl refreshing={refreshing} onRefresh={refresh} />
						}
						ListFooterComponent={
							thread.replies.length === 0 ? (
								<Text className="px-4 py-3 text-body-sm text-ink-dim">
									{t("mobile.team_bridge.reply_thread.empty")}
								</Text>
							) : thread.moreAfterSeq !== null ? (
								/* Past one load's 500-reply cap (agent review R2): the rest
								 *  is one tap away, never silently cut off. An explicit
								 *  control rather than end-reached paging, so a long thread
								 *  opened at its top never fetches its tail unasked. */
								<View className="px-4 py-3">
									<Button
										variant="outline"
										label={t("mobile.team_bridge.reply_thread.more")}
										testID={CONTROL.teamBridgeReplyThreadMore}
										onPress={() => {
											void actions.loadMoreReplies(target);
										}}
									/>
								</View>
							) : null
						}
					/>
				)}
				{thread?.root && !readOnly && selfAccountId ? (
					<BridgeComposerDock
						bottomInset={insets.bottom}
						className="gap-2 pt-2"
						testID={SURFACE.teamBridgeReplyComposer}
					>
						{sendError ? (
							<Alert severity="error" testID={SURFACE.teamBridgeSendError}>
								{t("mobile.team_bridge.thread.send_error")}
							</Alert>
						) : null}
						<BridgeComposerField
							glass={chromeGlass}
							label={t("mobile.team_bridge.reply_thread.reply")}
							placeholder={t("mobile.team_bridge.reply_thread.reply")}
							draft={draft}
							onDraftChange={setDraft}
							sending={sending}
							sendLabel={
								sendError
									? t("mobile.team_bridge.thread.send_retry")
									: t("mobile.team_bridge.thread.send")
							}
							sendDisabled={!draft.trim()}
							onSend={() => {
								void send();
							}}
							autoFocus={compose}
						/>
					</BridgeComposerDock>
				) : null}
			</View>
			<ProfileSheet
				subject={profile}
				tenantId={target.tenantId}
				onClose={() => setProfile(null)}
				currentConversationId={target.conversationId}
			/>
			{messageActions.sheet}
			<Sheet
				visible={deliveryHelp !== null}
				onClose={() => setDeliveryHelp(null)}
				focusTitle
				titleLines={2}
				returnFocusTestID={deliveryHelp ?? undefined}
				title={t("mobile.team_bridge.delivery.help_title")}
				testID={SURFACE.teamBridgeDeliveryHelpSheet}
			>
				<Text className="py-2 text-body-read text-ink-muted">
					{t("mobile.team_bridge.delivery.help")}
				</Text>
			</Sheet>
		</Screen>
	);
}

export default function TeamBridgeReplyThreadScreen() {
	const selfAccountId = useTeamBridgeState((state) => state.selfAccountId);
	const params = useLocalSearchParams<{
		tenantId?: string;
		conversationId?: string;
		rootId?: string;
		compose?: string;
	}>();
	const tenantId = single(params.tenantId);
	const conversationId = single(params.conversationId);
	const rootId = single(params.rootId);
	const target = useMemo(
		() => ({ tenantId, conversationId, rootId }),
		[tenantId, conversationId, rootId],
	);
	return (
		/* The gate leads with the same Back as the screen: a cold push that meets
		 *  a closed gate still backs out to the thread's conversation (U1). */
		<BridgeGate
			headerLeading={
				<BridgeBack fallback={conversationPath({ tenantId, conversationId })} />
			}
		>
			<ReplyThreadContent
				/* A new account or thread is a new screen: no cursor, draft or
				 *  visibility evidence survives into another one. */
				key={`${selfAccountId}/${tenantId}/${conversationId}/${rootId}`}
				target={target}
				compose={single(params[REPLY_THREAD_COMPOSE_PARAM]) === "1"}
			/>
		</BridgeGate>
	);
}
