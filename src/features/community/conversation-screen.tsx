/**
 * One community conversation (a channel or a DM): history paging, the
 * composer, and the sender-only outcomes (RFC v2.4 §5.5; frames M2/M7b).
 *
 * WHAT THE COMPOSER PROMISES.
 *
 * - "Checking…" with Cancel while moderation runs. Cancel is best effort: if
 *   the server already posted, the message simply appears (canon).
 * - Outcomes are the SENDER's alone. A refusal shows its category and MOD
 *   reference here and nowhere else; it never enters the history list, which
 *   is only ever what the server serves.
 * - The draft stays in memory (store) until a publish spends it, so every
 *   other outcome — refused, limited, unavailable, dropped — keeps the text.
 * - Retry reuses the attempt's idempotency key (the store owns that rule).
 * - Images: the attach control is present (frame M2; the operator asked for
 *   attachments), but while the server refuses community images
 *   (`images_unavailable`, until the CSAM gate ships) it opens the existing
 *   "images can't be posted yet" explanation instead of a picker. A picker
 *   would let a reader choose a photo the send can only refuse, and lose that
 *   work (design review round 1, D3). When the gate ships, the control opens
 *   the picker and the explanation goes away; nothing else moves.
 * - 4000 characters is the contract's cap (`SubmissionForm.text`): the field
 *   stops there, and a server 400/413 is `invalid`, never a Retry loop.
 */
import { useLocalSearchParams } from "expo-router";
import { ImagePlus } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	KeyboardAvoidingView,
	Platform,
	Pressable,
	ScrollView,
	Text,
	View,
} from "react-native";
import type { CommunityMessage, Profile } from "@/community/contract";
import {
	postingBlock,
	SUBMISSION_MAX_CHARS,
	startsGroup,
} from "@/community/model";
import { useCommunity, useCommunityState } from "@/community/provider";
import { conversationKey } from "@/community/store";
import { useLocaleFrame } from "@/features/auth/connection-provider";
import { activeLocale, t } from "@/i18n";
import { messageTime } from "@/team-bridge/model";
import {
	CONTROL,
	communityAuthorId,
	communityMessageId,
	ROLE,
	SCREEN,
	SURFACE,
} from "@/ui/a11y";
import { Badge } from "@/ui/components/badge";
import { Button } from "@/ui/components/button";
import { IconButton } from "@/ui/components/icon-button";
import { Skeleton } from "@/ui/components/skeleton";
import { Textarea } from "@/ui/components/textarea";
import { TOUCH_FLOOR } from "@/ui/layout";
import { cx } from "@/ui/variants";
import { JoinSheet } from "./join-sheet";
import { attemptSentences, errorSentence } from "./labels";
import { MemberAvatar } from "./member-avatar";
import { CommunityFrame, LoadFailure } from "./parts";
import { ProfileSheet, ReportSheet, type ReportTarget } from "./profile-sheet";

export default function CommunityConversationScreen() {
	const { communityId = "", conversationId = "" } = useLocalSearchParams<{
		communityId: string;
		conversationId: string;
	}>();
	const joinedChannel = useCommunityState((s) =>
		s.channels[communityId]?.data.find((c) => c.id === conversationId),
	);
	const preview = useCommunityState(
		(s) => s.previews[conversationKey(communityId, conversationId)],
	);
	const channel = joinedChannel ?? preview;
	const direct = useCommunityState((s) =>
		s.directs[communityId]?.data.find(
			(d) => d.conversation_id === conversationId,
		),
	);
	const communityName = useCommunityState(
		(s) => s.bootstraps[communityId]?.data?.community.name,
	);
	const title = channel
		? /* The channel sigil is notation, not prose: no locale changes it. */
			`#${channel.name}`
		: (direct?.counterpart.display_name ?? "");
	return (
		<CommunityFrame
			title={title}
			headerDetail={
				channel && communityName ? (
					<Text className="text-meta text-ink-dim">
						{t("mobile.community.conversation.subtitle", {
							community: communityName,
						})}
					</Text>
				) : undefined
			}
			scroll={false}
			fallback={`/community/${encodeURIComponent(communityId)}`}
			testID={SCREEN.communityConversation}
		>
			<Conversation communityId={communityId} conversationId={conversationId} />
		</CommunityFrame>
	);
}

function Conversation({
	communityId,
	conversationId,
}: {
	communityId: string;
	conversationId: string;
}) {
	const { actions } = useCommunity();
	const key = conversationKey(communityId, conversationId);
	const thread = useCommunityState((s) => s.threads[key]);
	const boot = useCommunityState((s) => s.bootstraps[communityId]);
	const joinedChannel = useCommunityState((s) =>
		s.channels[communityId]?.data.find((c) => c.id === conversationId),
	);
	const preview = useCommunityState((s) => s.previews[key]);
	const channel = joinedChannel ?? preview;
	/* Opened from Browse without a seat (R1-6): read-only until an explicit Join. */
	const previewing = !joinedChannel && Boolean(preview) && !preview?.member;
	const [joining, setJoining] = useState(false);
	const [joinError, setJoinError] = useState<string | null>(null);
	const joinChannel = async () => {
		setJoining(true);
		setJoinError(null);
		const failure = await actions.joinChannel(communityId, conversationId);
		setJoining(false);
		if (failure) setJoinError(errorSentence(failure));
	};
	const direct = useCommunityState((s) =>
		s.directs[communityId]?.data.find(
			(d) => d.conversation_id === conversationId,
		),
	);
	const [profile, setProfile] = useState<Profile | null>(null);
	const [reportId, setReportId] = useState<string | null>(null);
	/* The APP language, not the device's (review round 1, R1-7): the same
	 * subscription + read pair as Team Bridge's thread (`thread-screen.tsx`). */
	useLocaleFrame();
	const locale = activeLocale();
	const [notice, setNotice] = useState<string | null>(null);
	const scroller = useRef<ScrollView | null>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: `boot` is read once to skip a duplicate bootstrap read; it must not re-run the loads when it arrives.
	useEffect(() => {
		if (!boot) void actions.loadBootstrap(communityId);
		/* A cold open (deep link, push) has no lists yet: they name the room. */
		void actions.loadChannels(communityId);
		void actions.loadDirects(communityId);
		void actions.loadThread(communityId, conversationId);
		return actions.watch(communityId);
	}, [actions, communityId, conversationId]);
	const newestSeq = thread?.messages.at(-1)?.seq;
	useEffect(() => {
		/* A previewed channel has no seat, so no read state to advance. */
		if (newestSeq !== undefined && !previewing)
			void actions.markRead(communityId, conversationId);
	}, [actions, communityId, conversationId, newestSeq, previewing]);
	const openProfile = async (publicId: string) => {
		const result = await actions.profile(communityId, publicId);
		if (result && "public_id" in result) setProfile(result);
		else setNotice(errorSentence(result, "read"));
	};
	const block = channel
		? postingBlock(channel, {
				role: null,
				readOnlyCommunity: boot?.data?.community.state === "read_only",
			})
		: direct?.closed
			? "locked"
			: null;
	return (
		<KeyboardAvoidingView
			className="flex-1"
			behavior={Platform.OS === "ios" ? "padding" : undefined}
		>
			<ScrollView
				ref={scroller}
				className="flex-1"
				testID={SURFACE.communityHistory}
				contentContainerClassName="gap-1 px-4 py-3"
				onContentSizeChange={() => {
					/* Land on the newest message, not the top of the page. */
					if (!thread?.loadingOlder)
						scroller.current?.scrollToEnd({ animated: false });
				}}
			>
				{thread?.olderCursor ? (
					<View className="items-center py-2">
						<Button
							label={t("mobile.community.conversation.load_older")}
							variant="quiet"
							size="sm"
							loading={thread.loadingOlder}
							onPress={() =>
								void actions.loadOlder(communityId, conversationId)
							}
							testID={CONTROL.communityLoadOlder}
						/>
						{thread.olderError ? (
							<Text
								accessibilityRole={ROLE.alert}
								className="text-meta text-danger"
							>
								{t("mobile.community.conversation.older_error")}
							</Text>
						) : null}
					</View>
				) : null}
				{!thread || (thread.state === "loading" && !thread.messages.length) ? (
					<View
						accessible
						accessibilityLabel={t("mobile.community.common.loading")}
					>
						<Skeleton lines={5} />
					</View>
				) : thread.state === "error" && !thread.messages.length ? (
					<LoadFailure
						error={thread.error}
						onRetry={() => void actions.loadThread(communityId, conversationId)}
					/>
				) : thread.messages.length ? (
					thread.messages.map((message, index) => (
						<MessageRow
							key={message.id}
							message={message}
							locale={locale}
							first={startsGroup(thread.messages[index - 1], message)}
							onAuthor={(id) => void openProfile(id)}
							onReport={() => setReportId(message.id)}
						/>
					))
				) : (
					<Text className="py-6 text-center text-body-sm text-ink-dim">
						{t("mobile.community.conversation.empty")}
					</Text>
				)}
				{notice ? (
					<Text
						accessibilityRole={ROLE.alert}
						className="text-meta text-danger"
					>
						{notice}
					</Text>
				) : null}
			</ScrollView>
			{previewing && channel ? (
				<View className="gap-2 border-t border-hairline px-4 py-3">
					<Text className="text-body-sm text-ink-muted">
						{t("mobile.community.conversation.join_prompt", {
							name: channel.name,
						})}
					</Text>
					<View className="self-start">
						<Button
							label={t("mobile.community.browse.join")}
							loading={joining}
							onPress={() => void joinChannel()}
							testID={CONTROL.communityChannelJoin}
						/>
					</View>
					{joinError ? (
						<Text
							accessibilityRole={ROLE.alert}
							className="text-body-sm text-danger"
						>
							{joinError}
						</Text>
					) : null}
				</View>
			) : (
				<Composer
					communityId={communityId}
					conversationId={conversationId}
					name={channel?.name ?? direct?.counterpart.display_name ?? ""}
					dm={!channel && Boolean(direct)}
					block={block}
				/>
			)}
			<ProfileSheet
				communityId={communityId}
				profile={profile}
				onClose={() => setProfile(null)}
			/>
			<ReportSheet
				communityId={communityId}
				target={reportTarget(
					reportId,
					!channel && Boolean(direct),
					thread?.messages,
				)}
				onRevisionChanged={() =>
					void actions.refreshThread(communityId, conversationId)
				}
				onClose={() => setReportId(null)}
			/>
		</KeyboardAvoidingView>
	);
}

/**
 * What a report of one message targets (review round 1, R1-1). In a DM the
 * message is reported as `dm` with the revision the reader is looking at: the
 * case copies exactly that revision to Trust & Safety (RFC §6.4), and a
 * `message` report of a DM is a 400 by contract. The revision is read from the
 * LIVE history, so after a `revision_changed` refresh the sheet consents to
 * the text now on screen.
 */
function reportTarget(
	messageId: string | null,
	dm: boolean,
	messages: readonly CommunityMessage[] | undefined,
): ReportTarget | null {
	if (!messageId) return null;
	if (!dm) return { kind: "message", id: messageId };
	const message = messages?.find((m) => m.id === messageId);
	return { kind: "dm", id: messageId, revision: message?.revision ?? 1 };
}

/**
 * One message. Long-press reports it. The author's AVATAR is the profile tap
 * target (design D1/D5): a 48 pt square around a 32 pt avatar, where the name
 * alone was a 20 pt-tall target.
 */
function MessageRow({
	message,
	locale,
	first,
	onAuthor,
	onReport,
}: {
	message: CommunityMessage;
	locale: string;
	first: boolean;
	onAuthor: (publicId: string) => void;
	onReport: () => void;
}) {
	const author = message.author;
	const name =
		author.kind === "former_member"
			? t("mobile.community.conversation.former_member")
			: author.display_name;
	const time = useMemo(
		() => messageTime(message.created_at, locale),
		[message.created_at, locale],
	);
	const deleted = message.deleted || author.kind === "deleted";
	const openable = Boolean(author.public_id) && author.kind !== "former_member";
	const avatar = (
		<MemberAvatar name={author.display_name} kind={author.kind} size="sm" />
	);
	return (
		<Pressable
			onLongPress={deleted ? undefined : onReport}
			accessibilityHint={
				deleted ? undefined : t("mobile.community.conversation.report")
			}
			testID={communityMessageId(message.id)}
			className={cx("flex-row gap-2", first ? "pt-2" : "")}
		>
			{/* The avatar column keeps its width on continuation rows so the text
			 *  of one speaker's run stays in one column. */}
			<View style={{ width: TOUCH_FLOOR }} className="items-center">
				{first ? (
					openable ? (
						<Pressable
							accessibilityRole={ROLE.button}
							accessibilityLabel={t(
								"mobile.community.conversation.view_profile",
								{
									name,
								},
							)}
							onPress={() => author.public_id && onAuthor(author.public_id)}
							testID={communityAuthorId(message.id)}
							style={{ minHeight: TOUCH_FLOOR, minWidth: TOUCH_FLOOR }}
							className="items-center justify-center"
						>
							{avatar}
						</Pressable>
					) : (
						<View
							style={{ minHeight: TOUCH_FLOOR }}
							className="items-center justify-center"
						>
							{avatar}
						</View>
					)
				) : null}
			</View>
			<View className="min-w-0 flex-1 justify-center py-1">
				{first ? (
					<View className="flex-row flex-wrap items-center gap-2">
						<Text
							className={cx(
								"text-body-sm font-semibold",
								openable ? "text-ink" : "text-ink-muted",
							)}
						>
							{name}
						</Text>
						{author.kind === "agent" ? (
							<Badge label={t("mobile.community.conversation.agent")} />
						) : null}
						<Text className="text-meta text-ink-dim">{time}</Text>
						{message.edited ? (
							<Text className="text-meta text-ink-dim">
								{t("mobile.community.conversation.edited")}
							</Text>
						) : null}
					</View>
				) : message.edited ? (
					<Text className="text-meta text-ink-dim">
						{t("mobile.community.conversation.edited")}
					</Text>
				) : null}
				{deleted ? (
					<Text className="text-body-sm italic text-ink-dim">
						{t("mobile.community.conversation.deleted")}
					</Text>
				) : (
					<Text className="text-body text-ink" selectable>
						{message.text ?? ""}
					</Text>
				)}
				{message.reply_count ? (
					<Text className="text-meta text-ink-dim">
						{t("mobile.community.conversation.replies", {
							count: message.reply_count,
						})}
					</Text>
				) : null}
			</View>
		</Pressable>
	);
}

function Composer({
	communityId,
	conversationId,
	name,
	dm,
	block,
}: {
	communityId: string;
	conversationId: string;
	name: string;
	dm: boolean;
	block: ReturnType<typeof postingBlock> | null;
}) {
	const { actions } = useCommunity();
	const key = conversationKey(communityId, conversationId);
	const draft = useCommunityState((s) => s.drafts[key] ?? "");
	const attempt = useCommunityState((s) => s.attempts[key]);
	const [now, setNow] = useState(Date.now());
	const [reaccepting, setReaccepting] = useState(false);
	const [imagesNote, setImagesNote] = useState(false);
	const limited =
		attempt?.state.kind === "limited" ? attempt.state.retryAt : null;
	useEffect(() => {
		if (limited === null) return;
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, [limited]);
	if (block) {
		const sentence =
			block === "read_only"
				? t("mobile.community.composer.blocked_read_only")
				: block === "archived"
					? t("mobile.community.composer.blocked_archived")
					: block === "locked"
						? t("mobile.community.composer.blocked_locked")
						: t("mobile.community.composer.blocked_staff_only");
		return (
			<View className="border-t border-hairline px-4 py-3">
				<Text className="text-body-sm text-ink-muted">{sentence}</Text>
			</View>
		);
	}
	const checking = attempt?.state.kind === "checking";
	const outcome = attempt ? attemptSentences(attempt.state, now) : null;
	const retryable =
		attempt &&
		(attempt.state.kind === "failed" ||
			attempt.state.kind === "unavailable" ||
			(attempt.state.kind === "limited" && attempt.state.retryAt <= now));
	const label = dm
		? t("mobile.community.composer.label_dm", { name })
		: t("mobile.community.composer.label", { name });
	return (
		<View className="gap-2 border-t border-hairline px-4 pb-3 pt-2">
			{outcome ? (
				<View
					testID={SURFACE.communityAttempt}
					accessibilityRole={checking ? undefined : ROLE.alert}
					className={cx(
						"gap-1 rounded-sm px-3 py-2",
						attempt?.state.kind === "refused" ? "bg-sunken" : "bg-elevated",
					)}
				>
					<Text
						className={cx(
							"text-body-sm",
							attempt?.state.kind === "refused"
								? "font-semibold text-danger"
								: "text-ink",
						)}
					>
						{outcome.headline}
					</Text>
					{outcome.detail ? (
						<Text className="text-meta text-ink-muted">{outcome.detail}</Text>
					) : null}
					<View className="flex-row flex-wrap gap-2">
						{checking ? (
							<Button
								label={t("mobile.community.composer.cancel")}
								variant="outline"
								size="sm"
								onPress={() => void actions.cancel(communityId, conversationId)}
								testID={CONTROL.communityAttemptCancel}
							/>
						) : null}
						{attempt?.state.kind === "limited" || retryable ? (
							<Button
								label={t("mobile.community.composer.retry")}
								variant="outline"
								size="sm"
								disabled={!retryable}
								onPress={() => void actions.retry(communityId, conversationId)}
								testID={CONTROL.communityAttemptRetry}
							/>
						) : null}
						{attempt?.state.kind === "guidelines" ? (
							<Button
								label={t("mobile.community.composer.review")}
								variant="outline"
								size="sm"
								onPress={() => setReaccepting(true)}
								testID={CONTROL.communityReaccept}
							/>
						) : null}
						{!checking ? (
							<Button
								label={t("mobile.community.composer.dismiss")}
								variant="quiet"
								size="sm"
								onPress={() =>
									actions.dismissAttempt(communityId, conversationId)
								}
								testID={CONTROL.communityAttemptDismiss}
							/>
						) : null}
					</View>
				</View>
			) : null}
			<View className="flex-row items-end gap-2">
				<View className="min-w-0 flex-1">
					<Textarea
						label={label}
						hideLabel
						placeholder={label}
						value={draft}
						onChangeText={(text) =>
							actions.setDraft(communityId, conversationId, text)
						}
						disabled={checking}
						maxLines={6}
						maxLength={SUBMISSION_MAX_CHARS}
						testID={CONTROL.communityComposerInput}
					/>
				</View>
				<IconButton
					accessibilityLabel={t("mobile.community.composer.attach")}
					icon={({ color, size }) => <ImagePlus color={color} size={size} />}
					disabled={checking}
					onPress={() => setImagesNote((open) => !open)}
					testID={CONTROL.communityAttach}
				/>
				<Button
					label={t("mobile.community.composer.send")}
					disabled={checking || !draft.trim()}
					onPress={() => void actions.send(communityId, conversationId)}
					testID={CONTROL.communitySend}
				/>
			</View>
			{imagesNote ? (
				/* The server's own refusal sentence for images, shown BEFORE any
				 * picking: nothing chosen, so nothing lost (D3). Polite, not an
				 * alert: it answers the reader's own tap. */
				<View
					testID={SURFACE.communityImagesNote}
					accessibilityLiveRegion="polite"
					className="flex-row items-start gap-2 rounded-sm bg-elevated px-3 py-2"
				>
					<Text className="min-w-0 flex-1 text-body-sm text-ink">
						{attemptSentences({ kind: "images_unavailable" }, now).headline}
					</Text>
					<Button
						label={t("mobile.community.composer.dismiss")}
						variant="quiet"
						size="sm"
						onPress={() => setImagesNote(false)}
						testID={CONTROL.communityImagesNoteDismiss}
					/>
				</View>
			) : null}
			<Text className="text-meta text-ink-dim">
				{dm
					? t("mobile.community.composer.audience_dm", { name })
					: t("mobile.community.composer.audience")}
			</Text>
			<JoinSheet
				communityId={communityId}
				visible={reaccepting}
				onClose={() => setReaccepting(false)}
			/>
		</View>
	);
}
