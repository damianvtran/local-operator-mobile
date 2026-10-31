import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	AppState,
	FlatList,
	KeyboardAvoidingView,
	Platform,
	RefreshControl,
	Text,
	View,
	type ViewToken,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Markdown } from "@/features/session/components/markdown";
import { t } from "@/i18n";
import type { Notify } from "@/team-bridge/contract";
import * as model from "@/team-bridge/model";
import { useTeamBridge, useTeamBridgeState } from "@/team-bridge/provider";
import { setWatchedThread } from "@/team-bridge/push";
import { threadKey } from "@/team-bridge/store";
import {
	CONTROL,
	SCREEN,
	SURFACE,
	teamBridgeMessageId,
	teamBridgeNotifyId,
} from "@/ui/a11y";
import { Avatar, initialsOf } from "@/ui/components/avatar";
import { Button } from "@/ui/components/button";
import { Screen } from "@/ui/components/screen";
import { Sheet } from "@/ui/components/sheet";
import { Textarea } from "@/ui/components/textarea";
import { BridgeBack, BridgeGate } from "./gate";
import { createMessageSender } from "./message-sender";

const single = (value: string | string[] | undefined): string =>
	typeof value === "string" ? value : "";

function ThreadContent({
	tenantId,
	routeId,
	target,
	label,
}: {
	tenantId: string;
	routeId: string;
	target: Exclude<model.Target, { kind: "conversation" }> | null;
	label: string;
}) {
	const { actions, hub, store } = useTeamBridge();
	const state = useTeamBridgeState((s) => s);
	const insets = useSafeAreaInsets();
	const [createdId, setCreatedId] = useState<string | null>(null);
	const conversationId = createdId ?? (routeId === "new" ? null : routeId);
	const conversation = state.orgs[tenantId]?.conversations.find(
		(c) => c.id === conversationId,
	);
	const organization = state.organizations.find((o) => o.tenantId === tenantId);
	const thread = conversationId
		? state.threads[threadKey(tenantId, conversationId)]
		: undefined;
	const preview = !!conversation && model.isPreview(conversation);
	const admitted = !!organization && !!conversation && !preview;
	const readOnly =
		!!organization?.readOnly || conversation?.status === "archived";
	const [metadataLoading, setMetadataLoading] = useState(false);
	const [metadataError, setMetadataError] = useState<string | null>(null);
	const [draft, setDraft] = useState("");
	const [sending, setSending] = useState(false);
	const sendingRef = useRef(false);
	const [sendError, setSendError] = useState<string | null>(null);
	const [notifyOpen, setNotifyOpen] = useState(false);
	const [notifyError, setNotifyError] = useState<string | null>(null);
	const [notifyBusy, setNotifyBusy] = useState(false);
	const [joining, setJoining] = useState(false);
	const [joinError, setJoinError] = useState<string | null>(null);
	const [focused, setFocused] = useState(false);
	const [active, setActive] = useState(AppState.currentState === "active");
	const focusNow = useRef(false);
	const activeNow = useRef(AppState.currentState === "active");
	const mounted = useRef(true);
	const accountId = state.selfAccountId;
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	const isCurrent = useCallback(
		() =>
			mounted.current &&
			store.getState().gate === "open" &&
			store.getState().selfAccountId === accountId,
		[accountId, store],
	);
	const sender = useRef<ReturnType<typeof createMessageSender> | null>(null);
	if (!sender.current)
		sender.current = createMessageSender({
			tenantId,
			conversationId,
			target,
			create: hub.createConversation,
			send: actions.send,
			isCurrent,
			adopt: (answer) => {
				actions.adopt(answer);
				setCreatedId(answer.id);
			},
		});
	const items = useMemo(
		() => model.threadItems(thread?.messages ?? [], new Date()),
		[thread?.messages],
	);
	const people = state.orgs[tenantId]?.people ?? [];
	const directoryState = state.orgs[tenantId]?.peopleState;
	useEffect(() => {
		// Cold push/deep links bypass the list, so no directory has hydrated yet.
		// Resolve live names on this path too instead of exposing stale labels or
		// losing the agent's owner in "Aida (Ben)". The store coalesces this read.
		if (organization && (!directoryState || directoryState === "idle"))
			void actions.loadOrganization(tenantId, { silent: true });
	}, [actions, organization, directoryState, tenantId]);
	const title = conversation
		? (model.conversationTitle(conversation, state.selfAccountId) ??
			t("mobile.team_bridge.conversation"))
		: label || t("mobile.team_bridge.conversation");
	const loadMetadata = useCallback(async () => {
		if (!conversationId || !organization) return;
		setMetadataLoading(true);
		setMetadataError(null);
		try {
			const answer = await hub.getConversation(tenantId, conversationId);
			if (isCurrent()) actions.adopt(answer);
		} catch {
			setMetadataError(t("mobile.team_bridge.thread.metadata_error"));
		} finally {
			setMetadataLoading(false);
		}
	}, [actions, hub, tenantId, conversationId, organization, isCurrent]);
	useEffect(() => {
		if (conversationId && organization && !conversation) void loadMetadata();
	}, [conversationId, organization, conversation, loadMetadata]);
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
				setWatchedThread(null);
			};
		}, []),
	);
	useEffect(() => {
		if (!focused || !active || !admitted || !conversationId) return;
		setWatchedThread({ tenantId, conversationId });
		void actions.loadThread(tenantId, conversationId);
		// Hub messages do not ride the computer's relay stream. Poll only the visible,
		// active thread, so another sender appears even with the laptop closed.
		const timer = setInterval(() => {
			if (focusNow.current && activeNow.current)
				void actions.loadThread(tenantId, conversationId);
		}, 20_000);
		return () => {
			clearInterval(timer);
			setWatchedThread(null);
		};
	}, [focused, active, admitted, conversationId, tenantId, actions]);
	const visibleSeq = useRef(0);
	const list = useRef<FlatList<model.ThreadItem>>(null);
	const followTail = useRef(true);
	const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 20 }).current;
	const markRendered = useCallback(() => {
		if (
			focused &&
			active &&
			focusNow.current &&
			activeNow.current &&
			admitted &&
			conversationId &&
			visibleSeq.current > 0
		)
			void actions.markRead(tenantId, conversationId, visibleSeq.current);
	}, [focused, active, admitted, conversationId, tenantId, actions]);
	const rendered = useRef(markRendered);
	rendered.current = markRendered;
	const onViewableItemsChanged = useRef(
		({ viewableItems }: { viewableItems: ViewToken<model.ThreadItem>[] }) => {
			const seqs = viewableItems.flatMap((v) =>
				v.item.type === "message" ? [v.item.message.seq] : [],
			);
			visibleSeq.current = Math.max(0, ...seqs);
			rendered.current();
		},
	).current;
	useEffect(() => {
		markRendered();
	}, [markRendered]);

	const send = async () => {
		const body = draft.trim();
		if (
			!body ||
			sendingRef.current ||
			readOnly ||
			!organization ||
			preview ||
			(!conversationId && !target)
		)
			return;
		sendingRef.current = true;
		setSending(true);
		setSendError(null);
		try {
			if (await sender.current?.(body)) setDraft("");
		} catch {
			setSendError(t("mobile.team_bridge.thread.send_error"));
		} finally {
			sendingRef.current = false;
			setSending(false);
		}
	};
	const join = async () => {
		if (!conversationId || joining || readOnly) return;
		setJoining(true);
		setJoinError(null);
		try {
			const answer = await hub.joinConversation(tenantId, conversationId);
			if (!isCurrent()) return;
			actions.adopt(answer);
			if (model.isPreview(answer)) {
				setJoinError(t("mobile.team_bridge.thread.join_pending"));
				return;
			}
			await actions.loadThread(tenantId, conversationId);
			void actions.loadOrganization(tenantId, { silent: true });
		} catch {
			setJoinError(t("mobile.team_bridge.thread.join_error"));
		} finally {
			setJoining(false);
		}
	};
	const changeNotify = async (notify: Notify) => {
		if (!conversationId || notifyBusy) return;
		setNotifyBusy(true);
		setNotifyError(null);
		try {
			await actions.setNotify(tenantId, conversationId, notify);
			setNotifyOpen(false);
		} catch {
			setNotifyError(t("mobile.team_bridge.thread.notify_error"));
		} finally {
			setNotifyBusy(false);
		}
	};
	const reload = () => {
		if (conversationId && admitted)
			void actions.loadThread(tenantId, conversationId);
	};
	const renderItem = ({ item }: { item: model.ThreadItem }) => {
		if (item.type === "day")
			return (
				<Text
					accessibilityRole="header"
					className="px-4 py-4 text-center text-meta text-ink-muted"
					testID={SURFACE.teamBridgeDayDivider}
				>
					{item.label}
				</Text>
			);
		const sender = model.senderLabel(item.message.sender, people);
		return (
			<View
				className={`flex-row gap-3 px-4 ${item.continuation ? "py-1" : "pt-4 pb-1"}`}
				testID={teamBridgeMessageId(item.message.id)}
			>
				<View className="w-8">
					{!item.continuation && (
						<Avatar initials={initialsOf(sender)} size="sm" />
					)}
				</View>
				<View className="min-w-0 flex-1">
					{!item.continuation && (
						<View className="flex-row flex-wrap items-baseline gap-x-2">
							<Text className="text-body font-semibold text-ink">{sender}</Text>
							<Text className="text-meta text-ink-muted">
								{model.messageTime(item.message.created_at)}
							</Text>
						</View>
					)}
					{item.message.body === null ? (
						<Text className="text-body text-ink-muted">
							{t("mobile.team_bridge.thread.body_unavailable")}
						</Text>
					) : (
						<Markdown text={item.message.body} />
					)}
				</View>
			</View>
		);
	};
	const validDraft = routeId === "new" && !!target;
	return (
		<Screen
			title={title}
			headerLeading={<BridgeBack />}
			headerAction={
				admitted ? (
					<Button
						variant="quiet"
						label={t("mobile.team_bridge.thread.notifications")}
						testID={CONTROL.teamBridgeNotifications}
						onPress={() => setNotifyOpen(true)}
					/>
				) : undefined
			}
			scroll={false}
			testID={SCREEN.teamBridgeThread}
		>
			<KeyboardAvoidingView
				className="flex-1"
				behavior={Platform.OS === "ios" ? "padding" : undefined}
			>
				{!organization ? (
					<View className="gap-3 p-4">
						<Text className="text-body text-ink">
							{t("mobile.team_bridge.thread.organization_unavailable")}
						</Text>
						<Button
							label={t("mobile.team_bridge.thread.access_retry")}
							testID={CONTROL.teamBridgeThreadAccessRetry}
							onPress={() => {
								void actions.checkStatus();
							}}
						/>
					</View>
				) : (
					<>
						{metadataLoading && (
							<Text
								className="p-4 text-body text-ink-muted"
								testID={SURFACE.teamBridgeThreadLoading}
							>
								{t("mobile.team_bridge.thread.loading")}
							</Text>
						)}
						{metadataError && (
							<View className="gap-2 p-4">
								<Text accessibilityRole="alert" className="text-body text-ink">
									{metadataError}
								</Text>
								<Button
									label={t("mobile.team_bridge.thread.retry")}
									testID={CONTROL.teamBridgeMetadataRetry}
									onPress={() => {
										void loadMetadata();
									}}
								/>
							</View>
						)}
						{routeId === "new" && !target && !createdId && (
							<Text className="p-4 text-body text-ink">
								{t("mobile.team_bridge.thread.recipient_incomplete")}
							</Text>
						)}
						{preview ? (
							<View
								className="gap-4 p-4"
								testID={SURFACE.teamBridgeChannelPreview}
							>
								<Text className="text-title text-ink">{title}</Text>
								{!!conversation?.topic && (
									<Text className="text-body text-ink-muted">
										{conversation.topic}
									</Text>
								)}
								<Text className="text-body text-ink-muted">
									{t("mobile.team_bridge.thread.preview_help")}
								</Text>
								{!readOnly && (
									<Button
										label={t("mobile.team_bridge.thread.join")}
										testID={CONTROL.teamBridgeJoin}
										loading={joining}
										onPress={() => {
											void join();
										}}
									/>
								)}
								{joinError && (
									<Text
										accessibilityRole="alert"
										className="text-body text-ink"
									>
										{joinError}
									</Text>
								)}
							</View>
						) : admitted || validDraft ? (
							<>
								<FlatList
									testID={SURFACE.teamBridgeMessages}
									className="flex-1"
									data={items}
									keyExtractor={(item) => item.key}
									renderItem={renderItem}
									contentContainerClassName="pb-4"
									keyboardShouldPersistTaps="handled"
									onViewableItemsChanged={onViewableItemsChanged}
									viewabilityConfig={viewabilityConfig}
									ref={list}
									maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
									onScroll={(event) => {
										const { contentOffset, layoutMeasurement, contentSize } =
											event.nativeEvent;
										followTail.current =
											contentOffset.y + layoutMeasurement.height >=
											contentSize.height - 44;
									}}
									scrollEventThrottle={100}
									onContentSizeChange={() => {
										if (followTail.current)
											list.current?.scrollToEnd({ animated: false });
									}}
									refreshControl={
										<RefreshControl
											refreshing={thread?.state === "loading"}
											onRefresh={reload}
										/>
									}
									ListHeaderComponent={
										<View className="gap-2 px-4">
											{thread?.hasMore && (
												<Button
													label={
														thread.loadingOlder
															? t("mobile.team_bridge.thread.older_loading")
															: t("mobile.team_bridge.thread.older_load")
													}
													variant="outline"
													disabled={thread.loadingOlder}
													testID={CONTROL.teamBridgeLoadOlder}
													onPress={() => {
														if (conversationId)
															void actions.loadOlder(tenantId, conversationId);
													}}
												/>
											)}
											{thread?.olderError && (
												<>
													<Text
														accessibilityRole="alert"
														className="text-body text-ink"
													>
														{t("mobile.team_bridge.thread.older_error")}
													</Text>
													<Button
														label={t("mobile.team_bridge.thread.older_retry")}
														testID={CONTROL.teamBridgeOlderRetry}
														onPress={() => {
															if (conversationId)
																void actions.loadOlder(
																	tenantId,
																	conversationId,
																);
														}}
													/>
												</>
											)}
											{thread?.state === "error" && (
												<>
													<Text
														accessibilityRole="alert"
														className="text-body text-ink"
													>
														{t("mobile.team_bridge.thread.refresh_error")}
													</Text>
													<Button
														label={t(
															"mobile.team_bridge.thread.messages_retry",
														)}
														testID={CONTROL.teamBridgeMessagesRetry}
														onPress={reload}
													/>
												</>
											)}
										</View>
									}
									ListEmptyComponent={
										<Text
											className="p-4 text-body text-ink-muted"
											testID={SURFACE.teamBridgeThreadEmpty}
										>
											{!conversationId
												? t("mobile.team_bridge.thread.new_empty")
												: !thread ||
														thread.state === "idle" ||
														thread.state === "loading"
													? t("mobile.team_bridge.thread.messages_loading")
													: thread?.state === "error"
														? t("mobile.team_bridge.thread.messages_error")
														: t("mobile.team_bridge.thread.messages_empty")}
										</Text>
									}
								/>
								<View
									className="gap-3 border-t border-hairline px-4 pt-3"
									style={{ paddingBottom: Math.max(insets.bottom, 12) }}
									testID={SURFACE.teamBridgeComposer}
								>
									{readOnly ? (
										<Text className="text-body text-ink-muted">
											{conversation?.status === "archived"
												? t("mobile.team_bridge.thread.archived")
												: t("mobile.team_bridge.thread.readonly")}
										</Text>
									) : (
										<>
											{sendError && (
												<Text
													accessibilityRole="alert"
													className="text-body text-ink"
													testID={SURFACE.teamBridgeSendError}
												>
													{sendError}
												</Text>
											)}
											<Textarea
												label={t("mobile.team_bridge.thread.message")}
												placeholder={t(
													"mobile.team_bridge.thread.placeholder",
													{ title },
												)}
												value={draft}
												onChangeText={setDraft}
												disabled={sending}
												testID={CONTROL.teamBridgeMessageInput}
											/>
											<Button
												label={
													sendError
														? t("mobile.team_bridge.thread.send_retry")
														: t("mobile.team_bridge.thread.send")
												}
												loading={sending}
												disabled={!draft.trim() || sending}
												testID={CONTROL.teamBridgeSend}
												onPress={() => {
													void send();
												}}
											/>
										</>
									)}
								</View>
							</>
						) : null}
					</>
				)}
			</KeyboardAvoidingView>
			<Sheet
				visible={notifyOpen}
				onClose={() => setNotifyOpen(false)}
				title={t("mobile.team_bridge.thread.notify_sheet")}
				testID={SURFACE.teamBridgeNotifySheet}
			>
				<View className="gap-3 p-4">
					<Text className="text-body text-ink-muted">
						{t("mobile.team_bridge.thread.notify_current", {
							mode: conversation ? model.notifyOf(conversation) : "all",
						})}
					</Text>
					{(
						[
							["all", t("mobile.team_bridge.thread.notify_all")],
							["mention", t("mobile.team_bridge.thread.notify_mentions")],
							["mute", t("mobile.team_bridge.thread.notify_mute")],
						] as const
					).map(([value, text]) => (
						<Button
							key={value}
							label={text}
							variant="outline"
							disabled={notifyBusy}
							testID={teamBridgeNotifyId(value)}
							onPress={() => {
								void changeNotify(value);
							}}
						/>
					))}
					{notifyError && (
						<Text accessibilityRole="alert" className="text-body text-ink">
							{notifyError}
						</Text>
					)}
				</View>
			</Sheet>
		</Screen>
	);
}

export default function TeamBridgeThreadScreen() {
	const params = useLocalSearchParams<{
		tenantId?: string;
		conversationId?: string;
		kind?: string;
		accountId?: string;
		ownerAccountId?: string;
		endpointId?: string;
		label?: string;
	}>();
	const tenantId = single(params.tenantId);
	const routeId = single(params.conversationId);
	const label = single(params.label);
	const accountId = single(params.accountId);
	const ownerAccountId = single(params.ownerAccountId);
	const endpointId = single(params.endpointId);
	const kind = single(params.kind);
	const target = useMemo<Exclude<
		model.Target,
		{ kind: "conversation" }
	> | null>(() => {
		if (kind === "person" && accountId && label)
			return { kind, tenantId, accountId, label };
		if (kind === "agent" && ownerAccountId && endpointId && label)
			return { kind, tenantId, ownerAccountId, endpointId, label };
		return null;
	}, [kind, tenantId, accountId, ownerAccountId, endpointId, label]);
	return (
		<BridgeGate>
			<ThreadContent
				key={`${tenantId}/${routeId}/${kind}/${accountId}/${ownerAccountId}/${endpointId}`}
				tenantId={tenantId}
				routeId={routeId}
				target={target}
				label={label}
			/>
		</BridgeGate>
	);
}
