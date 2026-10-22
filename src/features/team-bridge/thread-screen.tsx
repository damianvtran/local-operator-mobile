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
import {
	canSend,
	messageAttachments,
	sendableAttachmentIds,
} from "@/team-bridge/attachments";
import type { Notify } from "@/team-bridge/contract";
import * as model from "@/team-bridge/model";
import { useTeamBridge, useTeamBridgeState } from "@/team-bridge/provider";
import { setWatchedThread } from "@/team-bridge/push";
import { threadKey } from "@/team-bridge/store";
import {
	CONTROL,
	SCREEN,
	SURFACE,
	teamBridgeAttachSourceId,
	teamBridgeMessageId,
	teamBridgeNotifyId,
} from "@/ui/a11y";
import { Avatar, initialsOf } from "@/ui/components/avatar";
import { Button } from "@/ui/components/button";
import { Screen } from "@/ui/components/screen";
import { Sheet } from "@/ui/components/sheet";
import { Textarea } from "@/ui/components/textarea";
import {
	createAttachmentDraft,
	type HeldDraft,
	sendFailureOf,
	syncDraft,
} from "./attachment-draft";
import {
	pasteTeamBridgeImage,
	pickTeamBridgeImages,
	prepareTeamBridgeImage,
	releaseTeamBridgeSource,
} from "./attachment-source";
import { ComposerAttachments, MessageAttachments } from "./attachment-views";
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
	/*
	 * Staged images. Offered only when the hub advertised `status.attachments`
	 * (`state.attachments`), and only once the conversation exists: an upload is
	 * addressed to a conversation id, and a draft DM has none until its first
	 * send creates it. The controller lives for this mounted composer; leaving
	 * with unsent images releases them on the hub.
	 */
	const attachLimits = state.attachments;
	const [, setDraftVersion] = useState(0);
	const [attachOpen, setAttachOpen] = useState(false);
	const [attachNotice, setAttachNotice] = useState<string | null>(null);
	const draftImages = useRef<HeldDraft | null>(null);
	draftImages.current = syncDraft(
		draftImages.current,
		attachLimits,
		conversationId,
		(limits, uploadTo) =>
			createAttachmentDraft({
				maxCount: limits.maxCount,
				prepare: (raw) =>
					prepareTeamBridgeImage(
						raw as Parameters<typeof prepareTeamBridgeImage>[0],
					),
				upload: (bytes) => hub.uploadAttachment(tenantId, uploadTo, bytes),
				discard: (attachmentId) =>
					hub.deleteAttachment(tenantId, uploadTo, attachmentId),
				releaseSource: (raw) => {
					void releaseTeamBridgeSource(
						raw as Parameters<typeof releaseTeamBridgeSource>[0],
					);
				},
				onChange: () => {
					if (mounted.current) setDraftVersion((n) => n + 1);
				},
			}),
	);
	useEffect(() => () => draftImages.current?.draft.dispose(), []);
	// One condition gates both what is shown and what a send carries.
	const images =
		attachLimits && conversationId
			? (draftImages.current?.draft ?? null)
			: null;
	const chips = images?.chips() ?? [];
	const addImages = async (source: "library" | "paste") => {
		setAttachOpen(false);
		setAttachNotice(null);
		const draft = images;
		if (!draft) return;
		const room = draft.remaining();
		if (room === 0) {
			setAttachNotice(draft.limitNotice());
			return;
		}
		try {
			if (source === "library") {
				const picked = await pickTeamBridgeImages(room);
				if (picked.length > 0) setAttachNotice(draft.add(picked));
			} else {
				const pasted = await pasteTeamBridgeImage();
				if (pasted === null) setAttachNotice("No image was pasted.");
				else setAttachNotice(draft.add([pasted]));
			}
		} catch {
			setAttachNotice("That image could not be read.");
		}
	};
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
			"Conversation")
		: label || "Conversation";
	const loadMetadata = useCallback(async () => {
		if (!conversationId || !organization) return;
		setMetadataLoading(true);
		setMetadataError(null);
		try {
			const answer = await hub.getConversation(tenantId, conversationId);
			if (isCurrent()) actions.adopt(answer);
		} catch {
			setMetadataError(
				"This conversation could not load. It may no longer be available to you.",
			);
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

	const sendable = canSend(draft, chips);
	const send = async () => {
		const body = draft.trim();
		if (
			!canSend(draft, chips) ||
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
		const ids = sendableAttachmentIds(
			attachLimits,
			conversationId,
			images?.attachmentIds() ?? [],
		);
		const settle = images?.beginSend(ids);
		try {
			if (await sender.current?.(body, ids)) {
				setDraft("");
				images?.clearSent();
				setAttachNotice(null);
			}
		} catch (error) {
			/*
			 * A staged image expired or was already used: retrying the same ids
			 * repeats the 404, so the chips say so and the reader removes them;
			 * the text stays in the draft. Every other failure keeps the safe-retry
			 * copy (`sendFailureOf` has the code-level why).
			 */
			if (sendFailureOf(error, ids) === "expired") {
				images?.markExpired();
				setSendError(
					"An attached image expired before it was sent. Remove it, then send again.",
				);
			} else {
				setSendError(
					"Your message was not confirmed. Your draft is saved here. Retry sends the same message safely.",
				);
			}
		} finally {
			settle?.();
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
				setJoinError(
					"Joining has not completed. Try again before reading this channel.",
				);
				return;
			}
			await actions.loadThread(tenantId, conversationId);
			void actions.loadOrganization(tenantId, { silent: true });
		} catch {
			setJoinError("Could not join this channel. Try again.");
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
			setNotifyError("Notification settings were not saved. Try again.");
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
							Message body unavailable.
						</Text>
					) : item.message.body.trim() === "" ? (
						/*
						 * An image-only message has `body: ""`. With its images listed
						 * below, the images ARE the message. With none (a kind of content
						 * this build does not render), say so instead of an empty bubble.
						 */
						messageAttachments(item.message).length === 0 ? (
							<Text className="text-body text-ink-muted">
								This message has content this version of the app cannot show.
							</Text>
						) : null
					) : (
						<Markdown text={item.message.body} />
					)}
					<MessageAttachments
						hub={hub}
						tenantId={tenantId}
						conversationId={item.message.conversation_id}
						messageId={item.message.id}
						attachments={messageAttachments(item.message)}
					/>
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
						label="Notifications"
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
							This organization is not available to this account.
						</Text>
						<Button
							label="Retry access"
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
								Loading conversation…
							</Text>
						)}
						{metadataError && (
							<View className="gap-2 p-4">
								<Text accessibilityRole="alert" className="text-body text-ink">
									{metadataError}
								</Text>
								<Button
									label="Retry conversation"
									testID={CONTROL.teamBridgeMetadataRetry}
									onPress={() => {
										void loadMetadata();
									}}
								/>
							</View>
						)}
						{routeId === "new" && !target && !createdId && (
							<Text className="p-4 text-body text-ink">
								This message recipient is incomplete. Go back and choose a
								person or chief of staff.
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
									Join this channel to read its history and send messages.
								</Text>
								{!readOnly && (
									<Button
										label="Join channel"
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
															? "Loading older messages…"
															: "Load older messages"
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
														Older messages could not load.
													</Text>
													<Button
														label="Retry older messages"
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
														Messages could not refresh. Previously loaded
														messages are shown.
													</Text>
													<Button
														label="Retry messages"
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
												? "No messages yet. Your first send starts the conversation."
												: !thread ||
														thread.state === "idle" ||
														thread.state === "loading"
													? "Loading messages…"
													: thread?.state === "error"
														? "No messages could be loaded."
														: "No messages yet. Start the conversation."}
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
												? "This conversation is archived."
												: "This organization is read only."}{" "}
											You can read history, but cannot send messages.
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
											<ComposerAttachments
												chips={chips}
												summary={images?.summary() ?? ""}
												onRemove={(key) => images?.remove(key)}
												onRetry={(key) => images?.retry(key)}
											/>
											{attachNotice && (
												<Text
													accessibilityRole="alert"
													className="text-meta text-ink-muted"
												>
													{attachNotice}
												</Text>
											)}
											<Textarea
												label="Message"
												placeholder={`Message ${title}`}
												value={draft}
												onChangeText={setDraft}
												disabled={sending}
												testID={CONTROL.teamBridgeMessageInput}
											/>
											<View className="flex-row gap-2">
												{images ? (
													<Button
														variant="outline"
														label="Add image"
														disabled={sending || images.remaining() === 0}
														testID={CONTROL.teamBridgeAttach}
														onPress={() => setAttachOpen(true)}
													/>
												) : null}
												<View className="flex-1">
													<Button
														label={sendError ? "Retry send" : "Send"}
														loading={sending}
														disabled={!sendable || sending}
														testID={CONTROL.teamBridgeSend}
														onPress={() => {
															void send();
														}}
													/>
												</View>
											</View>
										</>
									)}
								</View>
							</>
						) : null}
					</>
				)}
			</KeyboardAvoidingView>
			<Sheet
				visible={attachOpen}
				onClose={() => setAttachOpen(false)}
				title="Add image"
				testID={SURFACE.teamBridgeAttachSheet}
			>
				<View className="gap-2">
					<Button
						variant="outline"
						label="Photo Library"
						testID={teamBridgeAttachSourceId("library")}
						onPress={() => {
							void addImages("library");
						}}
					/>
					<Button
						variant="outline"
						label="Paste image"
						testID={teamBridgeAttachSourceId("paste")}
						onPress={() => {
							void addImages("paste");
						}}
					/>
				</View>
			</Sheet>
			<Sheet
				visible={notifyOpen}
				onClose={() => setNotifyOpen(false)}
				title="Conversation notifications"
				testID={SURFACE.teamBridgeNotifySheet}
			>
				<View className="gap-3 p-4">
					<Text className="text-body text-ink-muted">
						Current: {conversation ? model.notifyOf(conversation) : "all"}
					</Text>
					{(
						[
							["all", "All messages"],
							["mention", "Mentions only"],
							["mute", "Mute"],
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
