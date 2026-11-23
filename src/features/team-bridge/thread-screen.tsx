import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Bell, BellOff, Check } from "lucide-react-native";
import {
	memo,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import {
	Animated,
	AppState,
	Easing,
	FlatList,
	Platform,
	Pressable,
	RefreshControl,
	Text,
	View,
	type ViewToken,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocaleFrame } from "@/features/auth/connection-provider";
import { createAttachmentSheetHandoff } from "@/features/session/attach-handoff";
import type { AttachSource } from "@/features/session/attach-rule";
import { AttachSheet } from "@/features/session/components/attach-sheet";
import { Markdown } from "@/features/session/components/markdown";
import type { HostSelection } from "@/features/session/components/selectable-message";
import {
	activeTextSelection,
	subscribeTextSelection,
	textSelectionContainerScroll,
	textSelectionContainerTouch,
	textSelectionContainerTouchCancel,
	textSelectionContainerTouchEnd,
	usesSelectionMode,
} from "@/features/session/text-selection";
import { activeLocale, type ShippedLocale, t } from "@/i18n";
import { useUiStore } from "@/state/ui-store";
import {
	canSend,
	messageAttachments,
	sendableAttachmentIds,
} from "@/team-bridge/attachments";
import { type HubClient, isHubError } from "@/team-bridge/client";
import type { DirectoryMember, Message, Notify } from "@/team-bridge/contract";
import { isGoneStatus } from "@/team-bridge/last-target";
import * as model from "@/team-bridge/model";
import { type ProfileSubject, senderSubject } from "@/team-bridge/profile";
import { useTeamBridge, useTeamBridgeState } from "@/team-bridge/provider";
import { setWatchedThread } from "@/team-bridge/push";
import {
	replyThreadPath,
	replyThreadSummary,
} from "@/team-bridge/reply-threads";
import { threadKey } from "@/team-bridge/store";
import {
	readTeamBridgeDraft,
	type TeamBridgeDraft,
	teamBridgeDraftKey,
	writeTeamBridgeDraft,
} from "@/team-bridge/thread-drafts";
import { teamBridgeViewerFixture } from "@/testing/team-bridge-fixture";
import { threadViewportTrace } from "@/testing/thread-viewport-trace";
import {
	state as a11yState,
	CONTROL,
	ROLE,
	SCREEN,
	SURFACE,
	teamBridgeAttachSourceId,
	teamBridgeMessageId,
	teamBridgeNotifyId,
	teamBridgeProfileOpenId,
} from "@/ui/a11y";
import { useReducedMotion, useTokenColor } from "@/ui/appearance";
import { Alert } from "@/ui/components/alert";
import { Button } from "@/ui/components/button";
import { useChromeGlass } from "@/ui/components/chrome-surface";
import { IconButton } from "@/ui/components/icon-button";
import { Screen } from "@/ui/components/screen";
import { Sheet } from "@/ui/components/sheet";
import { Skeleton } from "@/ui/components/skeleton";
import { useShadow } from "@/ui/elevation";
import { TOUCH_FLOOR, useCompactChrome } from "@/ui/layout";
import { effectiveDuration, parseCubicBezier } from "@/ui/motion";
import { DURATIONS, EASINGS } from "@/ui/tokens.gen";
import { CONTROL_DISABLED_INK, cx } from "@/ui/variants";
import {
	addDraftImages,
	createAttachmentDraft,
	type HeldDraft,
	sendBlockedReason,
	sendFailureOf,
	syncDraft,
} from "./attachment-draft";
import {
	pasteTeamBridgeImage,
	pickTeamBridgeImages,
	prepareTeamBridgeImage,
	releaseTeamBridgeSource,
	takeTeamBridgePhoto,
} from "./attachment-source";
import { ComposerAttachments, MessageAttachments } from "./attachment-views";
import { BridgeComposerDock } from "./composer-dock";
import { BridgeThreadDrawerButton } from "./drawer-adapter";
import { BridgeGate } from "./gate";
import { useRememberedThread } from "./last-target-hooks";
import { buildMentionCandidates, memberKeys } from "./mentions/candidates";
import {
	MentionNotice,
	MentionStrip,
	mentionNoticeText,
} from "./mentions/mention-strip";
import { serializeMentions } from "./mentions/tokens";
import { useMentions } from "./mentions/use-mentions";
import {
	bridgeSelectionId,
	type MessageActionsController,
	messageActionAccessibility,
	useMessageActions,
} from "./message-actions-sheet";
import { MessageDelivery } from "./message-delivery";
import { createMessageSender } from "./message-sender";
import {
	ProfileAuthorName,
	ProfileAuthorPhoto,
	ProfileSheet,
	UnknownSenderAvatar,
} from "./profile-card";
import { ReactionPills } from "./reaction-pills";
import { ReplyThreadChip } from "./reply-thread-chip";
import { parseThreadAnchor, type ThreadAnchor } from "./thread-anchor";
import { BridgeComposerField, BridgeThreadTitle } from "./thread-chrome";
import {
	createThreadViewport,
	landingRenderCount,
	showsMetadataOverlay,
	type ThreadViewport,
} from "./thread-viewport";
import { useThreadAnchor } from "./use-thread-anchor";

const single = (value: string | string[] | undefined): string =>
	typeof value === "string" ? value : "";

/**
 * Memoized message row: typing in the composer updates `draft` on every
 * keystroke, so isolating each message's `<Markdown>` parse behind `memo`
 * avoids re-rendering every message cell in the thread while composing.
 */
/**
 * The web scroll host's geometry, read synchronously: react-native-web scrolls
 * the DOM node in place, so after a move (or a commit) its numbers are current
 * even when no scroll or layout event will fire. Null on native, where the
 * platform's own events report it.
 */
function readWebHost(
	list: FlatList<model.ThreadItem> | null,
): { y: number; viewport: number; content: number } | null {
	if (Platform.OS !== "web") return null;
	const node = list?.getScrollableNode?.() as
		| { scrollTop?: unknown; clientHeight: number; scrollHeight: number }
		| undefined;
	return node && typeof node.scrollTop === "number"
		? {
				y: node.scrollTop,
				viewport: node.clientHeight,
				content: node.scrollHeight,
			}
		: null;
}

/**
 * "This is the one you came for" on an anchored landing (round-1 D1 / U1-3 /
 * Q1-2, D2). The fill alone was `row-selected` on the thread canvas, 1.06:1
 * in light (1.02-1.33:1 across the 61 palettes), so the landing was all but
 * invisible; `variants.ts` documents that step as ~1.0x luminance. This is
 * the agent chat's find-landing treatment (`transcript-list.tsx`): keep the
 * fill and add a 2 px accent edge at the start side (accent on canvas >= 4.71:1
 * in every palette, above WCAG 1.4.11's 3:1, and not colour-fill alone). Both
 * sit on ONE absolutely positioned layer painted beneath the row's content, so
 * the landing shifts no geometry, `start-0` mirrors in RTL, and its opacity
 * eases out after the hold (`DURATIONS.draw`, `in-out`) instead of cutting
 * off; reduced motion caps that fade (`effectiveDuration`), never zeroes it.
 */
function AnchorHighlight({
	fading,
	fadeMs,
}: {
	fading: boolean;
	fadeMs: number;
}) {
	const opacity = useRef(new Animated.Value(1)).current;
	useEffect(() => {
		if (!fading) return;
		const fade = Animated.timing(opacity, {
			toValue: 0,
			duration: fadeMs,
			easing: Easing.bezier(...parseCubicBezier(EASINGS["in-out"])),
			useNativeDriver: Platform.OS !== "web",
		});
		fade.start();
		return () => fade.stop();
	}, [fading, fadeMs, opacity]);
	return (
		<Animated.View
			pointerEvents="none"
			aria-hidden
			className="absolute inset-0 bg-row-selected"
			style={{ opacity }}
			testID={SURFACE.teamBridgeAnchorHighlight}
		>
			<View className="absolute bottom-0 start-0 top-0 w-0.5 bg-accent" />
		</Animated.View>
	);
}

/** One empty directory for every render: a fresh `[]` per render was a new
 *  `people` prop on every memoised row (Bridge thread flicker). */
const NO_PEOPLE: readonly DirectoryMember[] = [];

/** Team Bridge's rows in the shared add-image sheet: every source its upload
 *  pipeline can bound (no Files — see AttachSheet's `sources`). */
const TEAM_BRIDGE_ATTACH_SOURCES: readonly AttachSource[] = [
	"library",
	"camera",
	"paste",
];

export const ThreadMessageRow = memo(function ThreadMessageRow({
	message,
	onOpenReplyThread,
	continuation,
	people,
	hub,
	tenantId,
	initialViewerIndex,
	onOpenProfile,
	onDeliveryHelp,
	highlight = null,
	fadeMs = DURATIONS.draw,
	onAnchorLayout,
	locale,
	actions,
	actionsOpen = false,
}: {
	message: Message;
	continuation: boolean;
	/** The screen's message-actions sheet (`message-actions-sheet.tsx`):
	 *  long-press opens it, and its actions ride on the body leaves for screen
	 *  readers. Absent: the row is inert to long-press. */
	actions?: MessageActionsController;
	/** This row's sheet is open: the row holds the selected tint so the
	 *  reader keeps the referent while choosing (spec §4.2). */
	actionsOpen?: boolean;
	/** The app language the row renders in. A PROP rather than an
	 *  `activeLocale()` read because this row is `memo()`: a read inside it is
	 *  only re-run when some other prop changes, so a language frame would leave
	 *  painted rows with the previous language's times and copy (review M1).
	 *  Passing it in makes the language part of the memo's comparison. */
	locale: ShippedLocale;
	/** The message an anchored open landed on: held for `ANCHOR_HIGHLIGHT_MS`,
	 *  then fading over `fadeMs`. */
	highlight?: "hold" | "fade" | null;
	fadeMs?: number;
	/** The landed row's height, so a tall row is re-placed clear of "Jump to
	 *  newest" (`anchorPlacement`). Passed to that one row only. */
	onAnchorLayout?: (messageId: string, height: number) => void;
	people: readonly DirectoryMember[];
	hub: HubClient;
	tenantId: string;
	initialViewerIndex?: number;
	onOpenProfile: (subject: ProfileSubject) => void;
	onDeliveryHelp: (opener: string) => void;
	/** Opens this ROOT's reply thread. Absent where a row must not offer it
	 *  (the reply thread's own rows: threads are one level deep). */
	onOpenReplyThread?: (rootId: string) => void;
}) {
	const origin = useRef<View>(null);
	const sender = model.senderLabel(message.sender, people);
	const replies = onOpenReplyThread ? replyThreadSummary(message) : null;
	// A sender the directory no longer knows renders a neutral silhouette + inert name.
	const subject = senderSubject(message.sender, people);
	const attachments = messageAttachments(message);
	/* The body hands its long-press and screen-reader actions to the row
	 *  (`HostSelection`): long-press now opens the actions sheet instead of
	 *  entering selection directly, which moved into the sheet as "Select
	 *  text" (Slack's pattern). Recomputed on a language change so the action
	 *  labels follow it (`locale` is in the deps for exactly that). */
	// biome-ignore lint/correctness/useExhaustiveDependencies: `locale` is a TRIGGER: the action labels are read live through t()
	const host = useMemo<HostSelection | undefined>(
		() =>
			actions
				? {
						id: bridgeSelectionId(actions.scope, message.id),
						onLongPress: () => actions.open(message, () => origin.current),
						accessibility: messageActionAccessibility(
							actions.list(message),
							(action) => actions.run(action, message),
							/* "React" opens the same sheet at its quick row, so reacting
							 *  never needs a hold (spec §4.6). */
							actions.reactable
								? () => actions.open(message, () => origin.current)
								: undefined,
						),
					}
				: undefined,
		[actions, message, locale],
	);
	/* A message with no text has no body leaf to carry the screen-reader
	 *  actions: its timestamp, its "no text" line and its attachment tiles do
	 *  instead. The tiles matter for a same-sender continuation, which renders
	 *  no timestamp (PR #339 round 1, M2). */
	const bodylessAccessibility =
		host && !message.body?.trim() ? host.accessibility : undefined;
	/* Off iOS, "Select text" only makes the leaves selectable — nothing you can
	 *  see (design round 1, D2: 0 pixels changed). The row holds the same
	 *  referent layer while it is in the mode, so the reader can see which
	 *  message is armed and that a tap elsewhere ends it. iOS swaps in its own
	 *  visible selection view, so it is excluded. */
	const hostId = host?.id;
	const selecting = useSyncExternalStore(
		subscribeTextSelection,
		() =>
			hostId !== undefined &&
			!usesSelectionMode() &&
			activeTextSelection() === hostId,
	);
	const referent = actionsOpen || selecting;
	return (
		<Pressable
			ref={origin}
			tabIndex={-1}
			className={`flex-row gap-3 px-4 ${continuation ? "py-0.5" : "pt-3 pb-0.5"}`}
			testID={teamBridgeMessageId(message.id)}
			onLongPress={host?.onLongPress}
			/* NOT one accessibility element: an accessible container hides its
			 *  children on iOS, swallowing the author link, the body's links and
			 *  the attachments. Screen readers reach the actions on the leaves. */
			accessible={false}
			onLayout={
				onAnchorLayout
					? (event) =>
							onAnchorLayout(message.id, event.nativeEvent.layout.height)
					: undefined
			}
		>
			{referent ? (
				/* Painted beneath the content on its own layer, like the anchor
				 *  highlight, so opening the sheet shifts no geometry.
				 *  The ACCENT start edge is what survives the sheet's scrim (design
				 *  round 1, D3): `row-selected` is 1.06:1 against the canvas, and
				 *  under the 70 % scrim it measured 1.03:1 (light) / 1.04:1 (dark) —
				 *  the pressed row could not be picked out. `border-s` is logical,
				 *  so the edge follows the reading start in RTL. */
				<View
					pointerEvents="none"
					aria-hidden
					className="absolute inset-0 border-s-4 border-accent bg-row-selected"
					testID={SURFACE.teamBridgeMessageActionsTint}
				/>
			) : null}
			{highlight ? (
				<AnchorHighlight fading={highlight === "fade"} fadeMs={fadeMs} />
			) : null}
			<View className="w-8">
				{!continuation &&
					(subject ? (
						<ProfileAuthorPhoto
							subject={subject}
							onOpen={onOpenProfile}
							onLongPress={host?.onLongPress}
						/>
					) : (
						<View className="mt-0.5">
							<UnknownSenderAvatar kind={message.sender.kind} size="sm" />
						</View>
					))}
			</View>
			<View className="min-w-0 flex-1">
				{!continuation && (
					/* `relative z-10`: the author name pads its box to the touch
					 * floor with a negative margin (`AUTHOR_NAME_TOUCH_BOX`), so its
					 * bottom edge overhangs the body below. As a later sibling the
					 * body would paint (and hit-test) over that overhang and the
					 * focus ring (design round 2 D6, restored per review R1-4). */
					<View className="relative z-10 flex-row flex-wrap items-baseline gap-x-2">
						{subject ? (
							<ProfileAuthorName
								subject={subject}
								label={sender}
								onOpen={onOpenProfile}
								testID={teamBridgeProfileOpenId(message.id)}
								onLongPress={host?.onLongPress}
							/>
						) : (
							<Text className="py-0.5 text-body-read font-semibold text-ink">
								{sender}
							</Text>
						)}
						<Text
							className="text-meta text-ink-muted"
							/* A message with no text has no body leaf to carry the
							 *  actions (an image-only root): its time does instead, so
							 *  "Reply in thread" stays reachable without a hold. */
							{...bodylessAccessibility}
						>
							{/* The APP language, not the device default: with no locale
							 *  `toLocaleTimeString` follows the device, so a Spanish-UI
							 *  reader on an English device got English times. */}
							{model.messageTime(message.created_at, locale)}
						</Text>
					</View>
				)}
				{message.body === null ? (
					<Text
						className="text-body-read italic text-ink-dim"
						{...bodylessAccessibility}
					>
						{t("mobile.team_bridge.thread.body_unavailable")}
					</Text>
				) : message.body.trim() === "" ? (
					/*
					 * An image-only message has `body: ""`. With its images listed
					 * below, the images ARE the message. With none (a kind of content
					 * this build does not render), say so instead of an empty bubble.
					 */
					attachments.length === 0 ? (
						<Text
							className="text-body-read italic text-ink-dim"
							{...bodylessAccessibility}
						>
							{t("mobile.team_bridge.attachment.unsupported_content")}
						</Text>
					) : null
				) : (
					<Markdown text={message.body} host={host} />
				)}
				<MessageAttachments
					hub={hub}
					tenantId={tenantId}
					conversationId={message.conversation_id}
					messageId={message.id}
					attachments={attachments}
					initialViewerIndex={initialViewerIndex}
					onLongPress={host?.onLongPress}
					accessibility={bodylessAccessibility}
				/>
				<MessageDelivery message={message} onHelp={onDeliveryHelp} />
				{/* Under the body and delivery line, above the reply chip (spec
				 *  §4.3). Renders nothing for a message without reactions. */}
				<ReactionPills
					message={message}
					tenantId={tenantId}
					locale={locale}
					canReact={actions?.reactable === true}
					onAdd={
						actions ? (control) => actions.open(message, control) : undefined
					}
					onLongPress={host?.onLongPress}
				/>
				{replies && onOpenReplyThread ? (
					<ReplyThreadChip
						rootId={message.id}
						summary={replies}
						people={people}
						locale={locale}
						onOpen={onOpenReplyThread}
						onLongPress={host?.onLongPress}
					/>
				) : null}
			</View>
		</Pressable>
	);
});

function ThreadContent({
	tenantId,
	routeId,
	target,
	label,
	anchor = null,
	restored = false,
}: {
	tenantId: string;
	routeId: string;
	target: Exclude<model.Target, { kind: "conversation" }> | null;
	label: string;
	/** An explicit push/deep-link message to land on (`thread-anchor.ts`). */
	anchor?: ThreadAnchor | null;
	/** Opened from the remembered last target, not by the reader's choice:
	 *  a gone conversation then falls back to the list (`last-target.ts`). */
	restored?: boolean;
}) {
	const { actions, hub, store } = useTeamBridge();
	const state = useTeamBridgeState((s) => s);
	const insets = useSafeAreaInsets();
	/* The composer shell's fill: glass on iOS 26 with Reduce Transparency off,
	 *  solid otherwise — the agent screen's host pattern (`home.tsx`,
	 *  `session/[id].tsx`): the host decides once and passes it down. */
	const chromeGlass = useChromeGlass();
	const compact = useCompactChrome();
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
	const accountId = state.selfAccountId;
	const draftStorageKey = useMemo(
		() =>
			teamBridgeDraftKey({
				accountId,
				tenantId,
				routeId: conversationId ?? routeId,
				kind: target?.kind,
				targetAccountId:
					target?.kind === "person" ? target.accountId : undefined,
				endpointId: target?.kind === "agent" ? target.endpointId : undefined,
			}),
		[accountId, tenantId, conversationId, routeId, target],
	);
	const [composerDraft, setDraftState] = useState(() =>
		readTeamBridgeDraft(draftStorageKey),
	);
	const draft = composerDraft.text;
	const setDraft = useCallback(
		(next: TeamBridgeDraft) => {
			setDraftState(next);
			writeTeamBridgeDraft(draftStorageKey, next.text, next.tokens);
		},
		[draftStorageKey],
	);
	const [sending, setSending] = useState(false);
	const sendingRef = useRef(false);
	const [sendError, setSendError] = useState<string | null>(null);
	const [notifyOpen, setNotifyOpen] = useState(false);
	const [profile, setProfile] = useState<ProfileSubject | null>(null);
	const [deliveryHelp, setDeliveryHelp] = useState<{
		identity: string;
		opener: string;
		open: boolean;
	} | null>(null);
	const [notifyError, setNotifyError] = useState<string | null>(null);
	const [notifyBusy, setNotifyBusy] = useState(false);
	const [joining, setJoining] = useState(false);
	const [joinError, setJoinError] = useState<string | null>(null);
	const [focused, setFocused] = useState(false);
	const [active, setActive] = useState(AppState.currentState === "active");
	const focusNow = useRef(false);
	const activeNow = useRef(AppState.currentState === "active");
	const mounted = useRef(true);
	const checkColor = useTokenColor("accent");
	// Derive visibility synchronously from the actual account/route identity,
	// not a passive reset effect: even the first boundary render cannot display
	// another account's help or return focus to its opener.
	const deliveryHelpIdentity = JSON.stringify([accountId, routeId, tenantId]);
	const currentDeliveryHelp =
		deliveryHelp?.identity === deliveryHelpIdentity ? deliveryHelp : null;

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
				// Clear the initial `new` route key before adopting the created conversation id.
				writeTeamBridgeDraft(draftStorageKey, "");
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
	// Web fixture builds only (`null` everywhere else): opens a viewer on load.
	const viewerFixture = useMemo(() => teamBridgeViewerFixture(), []);
	const [, setDraftVersion] = useState(0);
	const [attachOpen, setAttachOpen] = useState(false);
	/* The attach sheet's picker launch waits for the sheet's native dismissal on
	 *  iOS (`attach-handoff.ts` has the why): launching PHPicker on the same tick
	 *  as the close presents it from a dismissing controller, and it never
	 *  appears. Cancelled on unmount so a late `onDismiss` launches nothing. */
	const attachHandoff = useRef(createAttachmentSheetHandoff()).current;
	useEffect(() => () => attachHandoff.cancel(), [attachHandoff]);
	const openAttach = () => {
		// Explicit reopen is the only re-admission point for a fresh choice.
		attachHandoff.cancel();
		setAttachOpen(true);
	};
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
				upload: (bytes) => actions.uploadAttachment(tenantId, uploadTo, bytes),
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
	const addImages = async (source: "library" | "camera" | "paste") => {
		setAttachOpen(false);
		setAttachNotice(null);
		const draft = images;
		if (!draft) return;
		await addDraftImages(draft, source, {
			pick: pickTeamBridgeImages,
			capture: takeTeamBridgePhoto,
			paste: pasteTeamBridgeImage,
			// A capability/conversation replacement can happen while the screen
			// remains mounted, so mounted ownership alone is not enough.
			isCurrent: () => isCurrent() && draftImages.current?.draft === draft,
			release: (raw) => {
				void releaseTeamBridgeSource(raw);
			},
			notice: setAttachNotice,
		});
	};
	/* Day dividers follow the app language: "Today"/"Yesterday" come from the
	 * catalogue and the dated fallback is formatted in this same locale, so a
	 * divider never mixes a translated word with a device-default date.
	 *
	 * `language` is the SUBSCRIPTION (`useLocaleFrame`, connection-provider.tsx):
	 * `activeLocale()` reads the locale at call time but cannot re-render this
	 * screen, so without it a language frame left the dividers, times and the
	 * memoised rows in the previous language until unrelated state moved (review
	 * M1). It is a TRIGGER in the memo below, the same shape as home.tsx's. */
	const language = useLocaleFrame();
	const locale = activeLocale();
	/* "Today"/"Yesterday" dividers are derived from the clock. An unchanged
	 *  poll no longer rebuilds the rows (Bridge thread flicker), so re-derive
	 *  them when the local day turns over instead (design r1 D1). A timer that
	 *  fires late after a backgrounded app still lands on the new day. */
	const [today, setToday] = useState(() => model.localDay(new Date()));
	/* Re-armed on every FIRE, not on a day change: a timer that fires early
	 *  (clock set back, timezone moved west) must still arm the next one
	 *  (review r2 MINOR / QA r2 Q4). `setToday` with an unchanged day is a
	 *  no-op render, so an early fire costs nothing. */
	const [dayTick, setDayTick] = useState(0);
	// biome-ignore lint/correctness/useExhaustiveDependencies: each fire bumps `dayTick` to arm the next timer.
	useEffect(() => {
		const timer = setTimeout(() => {
			setToday(model.localDay(new Date()));
			setDayTick((tick) => tick + 1);
		}, model.msUntilNextLocalDay(new Date()) + 1000);
		return () => clearTimeout(timer);
	}, [dayTick]);
	/* Both `language` and `today` are TRIGGERS: `t()` reads the locale live and
	 *  the labels are derived from `new Date()`, so neither appears in the body
	 *  yet each must re-run the memo (merge of O3-a locale frame + #286 day turn). */
	// biome-ignore lint/correctness/useExhaustiveDependencies: `language` and `today` are TRIGGERS (see above)
	const items = useMemo(
		() => model.threadItems(thread?.messages ?? [], new Date(), locale),
		[thread?.messages, locale, language, today],
	);
	const people = state.orgs[tenantId]?.people ?? NO_PEOPLE;
	const directoryState = state.orgs[tenantId]?.peopleState;
	/*
	 * @-mention candidates, from what is already held: the cached directory
	 * (kept through a 429 or any other error, so it is used whenever it is
	 * non-empty, whatever `peopleState` says) and this conversation's members.
	 * Opening the strip never fetches (`mentions/candidates.ts`).
	 *
	 * NONE IN A DRAFT DM. Before the first send creates it there is no
	 * membership to resolve a mention against, and an agent member may start
	 * INVITED (awaiting acceptance), which the hub would refuse for the whole
	 * message. The recipient of a 1:1 is notified by the message itself, so
	 * nothing is lost; suggestions appear once the conversation exists.
	 */
	const mentionCandidates = useMemo(
		() =>
			conversation
				? buildMentionCandidates({
						conversation,
						people,
						selfAccountId: state.selfAccountId,
					})
				: [],
		[conversation, people, state.selfAccountId],
	);
	const directoryMissing = !!conversation && people.length === 0;
	const mentions = useMentions({
		value: composerDraft,
		setValue: setDraft,
		candidates: mentionCandidates,
		directoryMissing,
	});
	useEffect(() => {
		// Cold push/deep links bypass the list, so no directory has hydrated yet.
		// Resolve live names on this path too instead of exposing stale labels or
		// losing the agent's owner in "Aida (Ben)". The store coalesces this read.
		if (organization && (!directoryState || directoryState === "idle"))
			void actions.loadOrganization(tenantId, { silent: true });
	}, [actions, organization, directoryState, tenantId]);
	const rawTitle = conversation
		? (model.conversationTitle(conversation, state.selfAccountId) ??
			t("mobile.team_bridge.conversation"))
		: label || t("mobile.team_bridge.conversation");
	const title =
		conversation?.kind === "channel" && !rawTitle.startsWith("#")
			? `# ${rawTitle}`
			: rawTitle;
	const notifyMode = conversation ? model.notifyOf(conversation) : "all";
	// Records this open as the last target; `gone` handles a 403/404 (`last-target-hooks.ts`).
	const gone = useRememberedThread({
		admitted,
		accountId,
		tenantId,
		conversationId,
		restored,
		threadErrorStatus: thread?.error?.status,
	});
	const loadMetadata = useCallback(async () => {
		if (!conversationId || !organization) return;
		setMetadataLoading(true);
		setMetadataError(null);
		try {
			const answer = await hub.getConversation(tenantId, conversationId);
			if (isCurrent()) actions.adopt(answer);
		} catch (error) {
			if (isHubError(error) && isGoneStatus(error.status) && isCurrent())
				gone();
			setMetadataError(t("mobile.team_bridge.thread.metadata_error"));
		} finally {
			setMetadataLoading(false);
		}
	}, [actions, hub, tenantId, conversationId, organization, isCurrent, gone]);
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
	const suspendMentions = mentions.suspend;
	useFocusEffect(
		useCallback(() => {
			focusNow.current = true;
			setFocused(true);
			return () => {
				focusNow.current = false;
				setFocused(false);
				suspendMentions();
				setWatchedThread(null);
			};
		}, [suspendMentions]),
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
	const list = useRef<FlatList<model.ThreadItem>>(null);
	const [positioned, setPositioned] = useState(false);
	/* A newer message arrived while the reader's own scroll held the list or
	 *  they rest in history (TestFlight 1139): the pill offers the way down
	 *  instead of the list yanking them there. */
	const [newBelow, setNewBelow] = useState(false);
	// The controller is created once per mounted thread, so it reads the latest
	// render's thread through refs rather than a stale closure.
	const newestSeq = useRef(0);
	newestSeq.current = Math.max(
		0,
		...(thread?.messages ?? []).map((m) => m.seq),
	);
	const viewport = useRef<ThreadViewport | null>(null);
	const showToast = useUiStore((s) => s.showToast);
	const reduceMotion = useReducedMotion();
	const jumpShadow = useShadow("overlay");
	// Message-anchored opens (`use-thread-anchor.ts`): hold open-at-newest until landed.
	const anchorState = useThreadAnchor({
		anchor,
		conversationId,
		thread,
		items,
		list,
		viewport,
		loadOlder: () => {
			if (conversationId) void actions.loadOlder(tenantId, conversationId);
		},
		/* Proven gone only (history ran out, or a seq walk passed it): the
		 *  reader opens at newest and is told once, so they do not scroll up
		 *  hunting for it (round-1 U1-1). A failed page stays silent. */
		onGone: () => showToast(t("mobile.team_bridge.thread.anchor_missing")),
		fadeMs: effectiveDuration(DURATIONS.draw, reduceMotion),
	});
	// The controller is created once; it reaches the latest hook callback here.
	const followChanged = useRef(anchorState.followChanged);
	followChanged.current = anchorState.followChanged;
	const readyForPosition =
		!anchorState.pending &&
		(!conversationId || !!thread?.messages.length || thread?.state === "ready");
	const dataReady = useRef(false);
	dataReady.current = readyForPosition;
	// Which rows a content measurement describes (`dataKey`): keys, not the
	// array, so a 20 s poll that returns the same rows keeps a measurement valid.
	const itemsKey = useRef("");
	itemsKey.current = useMemo(
		() => items.map((item) => item.key).join("\n"),
		[items],
	);
	if (!viewport.current)
		viewport.current = createThreadViewport({
			// Exact measured offset, not scrollToEnd's estimated frame offset.
			scrollTo: (offset) => {
				list.current?.scrollToOffset({ offset, animated: false });
				return readWebHost(list.current);
			},
			measure: () => readWebHost(list.current),
			positioned: () => setPositioned(true),
			read: () => rendered.current(),
			newestSeq: () => newestSeq.current,
			dataReady: () => dataReady.current,
			dataKey: () => itemsKey.current,
			trace: threadViewportTrace,
			web: Platform.OS === "web",
			followChanged: (following) => followChanged.current(following),
			newBelow: setNewBelow,
		});
	// Admission need not change content height. Web can remeasure the committed
	// rows now; native still waits for their own content measurement rather than
	// trusting a skeleton's geometry (the controller's contentReady guard).
	useEffect(() => {
		if (readyForPosition && items.length > 0) viewport.current?.dataChanged();
	}, [items, readyForPosition]);
	// Proof-only (`thread-viewport-trace.ts`): the screen-level flips that move
	// the list, alongside the viewport's own events. Null outside the proof job.
	useEffect(() => {
		threadViewportTrace?.("screen", {
			admitted,
			metadataLoading,
			readyForPosition,
			anchorPending: anchorState.pending,
			items: items.length,
		});
	}, [admitted, metadataLoading, readyForPosition, anchorState.pending, items]);
	// The controller may hold one pending native re-check; never run it after unmount.
	useEffect(() => () => viewport.current?.dispose(), []);
	const {
		showJump,
		highlightId,
		highlightFading,
		fadeMs,
		clearHighlight,
		measureRow,
		onScrollToIndexFailed,
	} = anchorState;
	useEffect(() => {
		// Empty admitted threads have no message layout event to wait for.
		if (
			!conversationId ||
			(thread?.state === "ready" && thread.messages.length === 0)
		)
			viewport.current?.settledEmpty();
	}, [conversationId, thread?.state, thread?.messages.length]);
	// Loading/empty/error copy remains visible; only unpositioned message rows
	// are concealed, so a failed initial request never becomes a blank screen.
	const initialRowsHidden = !positioned && items.length > 0;
	const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 20 }).current;
	// readSeq stays 0 until the viewport is positioned, so this needs no
	// `positioned` dependency (which would post a second mark on landing).
	const markRendered = useCallback(() => {
		const seq = viewport.current?.readSeq ?? 0;
		if (
			focused &&
			active &&
			focusNow.current &&
			activeNow.current &&
			admitted &&
			conversationId &&
			seq > 0
		)
			void actions.markRead(tenantId, conversationId, seq);
	}, [focused, active, admitted, conversationId, tenantId, actions]);
	const rendered = useRef(markRendered);
	rendered.current = markRendered;
	const onViewableItemsChanged = useRef(
		({ viewableItems }: { viewableItems: ViewToken<model.ThreadItem>[] }) => {
			viewport.current?.visible(
				viewableItems.flatMap((v) =>
					v.item.type === "message" ? [v.item.message.seq] : [],
				),
			);
		},
	).current;
	useEffect(() => {
		markRendered();
	}, [markRendered]);

	const sendable = canSend(draft, chips);
	/*
	 * Whether images block Send. The WHY is the strip's single status line
	 * (`stripSummary`, design D9): it always names what to do before Send works.
	 */
	const blockedBy = sendBlockedReason(chips);
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
		/*
		 * Only notifying tokens of ACTIVE members, filtered at the last moment:
		 * the hub refuses the whole message for any other row, so a member who
		 * left after the pick cannot turn this send into a 400.
		 */
		const currentConversation = store
			.getState()
			.orgs[tenantId]?.conversations.find((c) => c.id === conversationId);
		const mentionRows = serializeMentions(
			composerDraft.tokens,
			memberKeys(currentConversation?.members, "active"),
		);
		try {
			if (await sender.current?.(body, ids, mentionRows)) {
				setDraft({ text: "", tokens: [] });
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
				// The chips carry the reason and the strip's one status line says
				// it (design D9): no second send-error sentence for the same fix.
				images?.markExpired();
			} else {
				setSendError(t("mobile.team_bridge.thread.send_error"));
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
	const openDeliveryHelp = useCallback(
		(opener: string) => {
			setDeliveryHelp({
				identity: deliveryHelpIdentity,
				opener,
				open: true,
			});
		},
		[deliveryHelpIdentity],
	);
	const router = useRouter();
	/* Stable across renders so the memoised rows are not re-rendered by it. */
	const openReplyThread = useCallback(
		(rootId: string) => {
			if (!conversationId) return;
			router.push(
				replyThreadPath({ tenantId, conversationId, rootId }) as never,
			);
		},
		[router, tenantId, conversationId],
	);
	/* The actions sheet's "Reply in thread": the chip's route plus `compose`,
	 *  so the thread screen lands with its composer focused. This is the only
	 *  way to START a thread from the timeline — the chip renders only once a
	 *  root has replies. Not offered read-only: that thread has no composer. */
	const startReplyThread = useCallback(
		(rootId: string) => {
			if (!conversationId) return;
			router.push(
				replyThreadPath(
					{ tenantId, conversationId, rootId },
					{ compose: true },
				) as never,
			);
		},
		[router, tenantId, conversationId],
	);
	const messageActions = useMessageActions({
		scope: "timeline",
		tenantId,
		canReplyInThread: !readOnly && !!conversationId,
		canReact: !readOnly && !!conversationId,
		onReplyInThread: startReplyThread,
	});
	const actionsController = messageActions.controller;
	const actionsOpenId = messageActions.openMessageId;
	const renderItem = useCallback(
		({ item }: { item: model.ThreadItem }) => {
			if (item.type === "day")
				return (
					<View
						className="flex-row items-center gap-3 px-4 py-3"
						testID={SURFACE.teamBridgeDayDivider}
					>
						<View className="h-px flex-1 bg-hairline" aria-hidden />
						<Text
							accessibilityRole="header"
							className="text-center text-meta font-medium text-ink-muted"
						>
							{item.label}
						</Text>
						<View className="h-px flex-1 bg-hairline" aria-hidden />
					</View>
				);
			return (
				<ThreadMessageRow
					message={item.message}
					continuation={item.continuation}
					people={people}
					hub={hub}
					tenantId={tenantId}
					initialViewerIndex={
						viewerFixture?.messageId === item.message.id
							? viewerFixture.index
							: undefined
					}
					onOpenProfile={setProfile}
					onDeliveryHelp={openDeliveryHelp}
					onOpenReplyThread={openReplyThread}
					highlight={
						item.message.id === highlightId
							? highlightFading
								? "fade"
								: "hold"
							: null
					}
					fadeMs={fadeMs}
					onAnchorLayout={
						item.message.id === highlightId ? measureRow : undefined
					}
					locale={locale}
					actions={actionsController}
					actionsOpen={item.message.id === actionsOpenId}
				/>
			);
		},
		[
			people,
			hub,
			tenantId,
			viewerFixture,
			openDeliveryHelp,
			highlightId,
			highlightFading,
			fadeMs,
			measureRow,
			locale,
			openReplyThread,
			actionsController,
			actionsOpenId,
		],
	);
	const validDraft = routeId === "new" && !!target;
	const jumpToNewest = useCallback(() => {
		clearHighlight();
		viewport.current?.jumpToNewest();
	}, [clearHighlight]);
	return (
		<Screen
			title={title}
			/* The session header's title style, one line beside back and two
			 *  only when the header stacks (`BridgeThreadTitle`, operator on
			 *  TestFlight 753: "way too large"). `compact` is passed to `Screen`
			 *  too, so the row and the title agree in short landscape exactly as
			 *  the session screen's do. */
			titleNode={
				/* `#` is drawn for sighted readers only: announced, it is
				 *  "number sign humans" (review R1-10). */
				<BridgeThreadTitle
					title={title}
					accessibilityLabel={title === rawTitle ? undefined : rawTitle}
				/>
			}
			compact={compact}
			/* Stacked (320 pt / large text), the one trailing icon sits on the
			 *  back row at the edge, as the session header's cluster does,
			 *  instead of a third header row under the title (measured on the
			 *  #208 build at 320: the bell alone on its own 48 pt row). */
			stackedActionsBeside
			/* The hamburger, never a back arrow (operator, TestFlight 773: "remove
			 *  the back UX there and replace with the sidebar access"). The SAME
			 *  control and unread badge the session header leads with
			 *  (`app/(app)/session/[id].tsx`), opened straight into the drawer's
			 *  Team Bridge mode so the channel list is one tap away; a channel
			 *  picked there REPLACES this thread (`useOpenTarget`). */
			headerLeading={<BridgeThreadDrawerButton />}
			headerAction={
				admitted ? (
					// Icon-only so a 390 px header gives the channel name the width the
					// 122 px text button took (PR #208 D3). The label stays the
					// accessible name; IconButton's box is the platform touch floor
					// (48 on web/Android, 44 pt on iOS).
					<IconButton
						accessibilityLabel={t("mobile.team_bridge.thread.notifications")}
						icon={({ color, size }) =>
							notifyMode === "mute" ? (
								<BellOff color={color} size={size} />
							) : (
								<Bell color={color} size={size} />
							)
						}
						testID={CONTROL.teamBridgeNotifications}
						onPress={() => setNotifyOpen(true)}
					/>
				) : undefined
			}
			scroll={false}
			testID={SCREEN.teamBridgeThread}
		>
			{/* A plain column, NOT a `KeyboardAvoidingView` (operator, TestFlight 800:
			 *  the composer did not rise above the keyboard like the agent's). The
			 *  composer's dock lifts itself from #216's keyboard store
			 *  (`BridgeComposerDock`), the agent screen's mechanism. */}
			<View className="flex-1">
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
						{/* LAID OVER the list, like the anchor walk's loading block
						 *  below: a warm notification tap mounts the thread before the
						 *  org's conversations resolve, and in normal layout this block
						 *  took ~120 pt from the list while it loaded, so the list
						 *  re-laid out under rows it was still landing (#304 QA R4
						 *  Q1). Laid over, it pushes nothing down, so it shows only where
						 *  the area is otherwise blank (`showsMetadataOverlay`): never
						 *  over the preview or the list's own loading/empty/error block
						 *  (#315 design D1), nor over positioned rows. */}
						{showsMetadataOverlay({
							metadataLoading,
							content: preview || admitted || validDraft,
							list: !preview && (admitted || validDraft),
							rows: items.length,
							positioned,
						}) && (
							<View
								pointerEvents="none"
								className="absolute start-0 end-0 top-0 gap-3 p-4"
								testID={SURFACE.teamBridgeThreadLoading}
							>
								<Skeleton lines={3} />
								<Text className="text-body-sm text-ink-dim">
									{t("mobile.team_bridge.thread.loading")}
								</Text>
							</View>
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
								{anchorState.pending && items.length > 0 && !metadataLoading ? (
									/* The rows are held back (`initialRowsHidden`) while an
									 *  anchored open fetches older pages to find its message;
									 *  without this the reader saw a header over an empty
									 *  canvas for the whole walk (round-1 U1-2). The thread's
									 *  own loading block and copy, laid OVER the list so it
									 *  takes no height from it and the landing measures the
									 *  list it lands in. */
									<View
										pointerEvents="none"
										className="absolute start-0 end-0 top-0 gap-3 p-4"
										testID={SURFACE.teamBridgeAnchorLoading}
									>
										<Skeleton lines={3} />
										<Text className="text-body-sm text-ink-dim">
											{t("mobile.team_bridge.thread.loading")}
										</Text>
									</View>
								) : null}
								<FlatList
									testID={SURFACE.teamBridgeMessages}
									className="flex-1"
									data={items}
									keyExtractor={(item) => item.key}
									renderItem={renderItem}
									/* 8 pt here plus the dock's own 8 pt = a 16 pt rect gap
									 *  (~22 pt of ink with the row's leading), the same rest
									 *  the agent chat's last line has above the same dock
									 *  (PR #230 design D1; `pb-4` read ~30 pt, a visible step
									 *  when switching screens). Not tighter: 12 pt puts
									 *  descenders against the card's rounded top. */
									/* Grow only AFTER positioning: doing so for skeletons
									 * can keep content height unchanged on admission and
									 * suppress the measurement that reveals hidden rows. */
									contentContainerClassName={
										positioned ? "grow justify-end pb-2" : "pb-2"
									}
									keyboardShouldPersistTaps="handled"
									onViewableItemsChanged={onViewableItemsChanged}
									viewabilityConfig={viewabilityConfig}
									ref={list}
									// Anchoring helps prepends only AFTER initial-tail authority has
									// positioned the list; otherwise it can pin the initial top row.
									maintainVisibleContentPosition={
										positioned ? { minIndexForVisible: 0 } : undefined
									}
									// Mount the whole held page before landing, so the landing never
									// measures (and reveals) a partial page (`landingRenderCount`).
									initialNumToRender={landingRenderCount(
										items.length,
										positioned,
									)}
									style={{ opacity: initialRowsHidden ? 0 : 1 }}
									accessibilityElementsHidden={initialRowsHidden}
									importantForAccessibility={
										initialRowsHidden ? "no-hide-descendants" : "auto"
									}
									// Every list callback is the viewport controller's, so the tests
									// that drive these handlers drive the shipping wiring.
									{...viewport.current.handlers}
									/* Drag-to-select (iOS mode, `text-selection.ts`): a TAP
									 *  outside the selecting message ends it, as in iMessage; a
									 *  scroll keeps it so the reader can reach a long message's
									 *  far handle (design R1, D3). Wraps — never replaces — the
									 *  viewport's intent. */
									/* Web touch scrolls hold the list through POINTER events
									 *  (the viewport's handlers, PR #289), so these stay the
									 *  text-selection wiring alone. */
									onTouchStart={textSelectionContainerTouch}
									onTouchEnd={textSelectionContainerTouchEnd}
									onTouchCancel={textSelectionContainerTouchCancel}
									onScrollBeginDrag={() => {
										textSelectionContainerScroll();
										viewport.current?.handlers.onScrollBeginDrag();
									}}
									onScrollToIndexFailed={onScrollToIndexFailed}
									scrollEventThrottle={100}
									refreshControl={
										<RefreshControl
											refreshing={thread?.state === "loading"}
											onRefresh={reload}
										/>
									}
									ListHeaderComponent={
										<View className="gap-2 px-4 pt-2">
											{thread?.hasMore && (
												<View className="self-center">
													<Button
														label={
															thread.loadingOlder
																? t("mobile.team_bridge.thread.older_loading")
																: t("mobile.team_bridge.thread.older_load")
														}
														variant="quiet"
														size="sm"
														disabled={thread.loadingOlder}
														testID={CONTROL.teamBridgeLoadOlder}
														onPress={() => {
															if (!conversationId) return;
															// A prepend must not pull a history reader down.
															viewport.current?.releaseFollow();
															void actions.loadOlder(tenantId, conversationId);
														}}
													/>
												</View>
											)}
											{thread?.olderError && (
												<Alert
													severity="warning"
													action={{
														label: t("mobile.team_bridge.thread.older_retry"),
														testID: CONTROL.teamBridgeOlderRetry,
														onPress: () => {
															if (!conversationId) return;
															viewport.current?.releaseFollow();
															void actions.loadOlder(tenantId, conversationId);
														},
													}}
												>
													{t("mobile.team_bridge.thread.older_error")}
												</Alert>
											)}
											{thread?.state === "error" && (
												<Alert
													severity="warning"
													action={{
														label: t(
															"mobile.team_bridge.thread.messages_retry",
														),
														testID: CONTROL.teamBridgeMessagesRetry,
														onPress: reload,
													}}
												>
													{t("mobile.team_bridge.thread.refresh_error")}
												</Alert>
											)}
										</View>
									}
									ListEmptyComponent={
										conversationId &&
										(!thread ||
											thread.state === "idle" ||
											thread.state === "loading") ? (
											<View
												className="gap-3 px-4 py-6"
												testID={SURFACE.teamBridgeThreadEmpty}
											>
												<Skeleton lines={4} />
												<Text className="text-body-sm text-ink-dim">
													{t("mobile.team_bridge.thread.messages_loading")}
												</Text>
											</View>
										) : (
											<View
												className="items-center justify-center px-6 py-12"
												testID={SURFACE.teamBridgeThreadEmpty}
											>
												<Text
													className={cx(
														"text-center text-body-sm",
														thread?.state === "error"
															? "text-danger"
															: "text-ink-muted",
													)}
												>
													{!conversationId
														? t("mobile.team_bridge.thread.new_empty")
														: thread?.state === "error"
															? t("mobile.team_bridge.thread.messages_error")
															: t("mobile.team_bridge.thread.messages_empty")}
												</Text>
											</View>
										)
									}
								/>
								<BridgeComposerDock
									/* The agent composer's dock, not a footer bar (operator,
									 *  TestFlight 773): NO top hairline rule — he had that line
									 *  removed above the agent composer, and the shell's own
									 *  edge is the boundary. The dock pays the agent's 12 pt
									 *  sides and `composerOuterGap` (inset + 8 with the keyboard
									 *  down, 8 alone above it) and lifts by the keyboard's
									 *  overlap (TestFlight 800; `composer-dock.tsx`). */
									bottomInset={insets.bottom}
									className="gap-2 pt-2"
									testID={SURFACE.teamBridgeComposer}
								>
									{showJump || newBelow ? (
										/* Above the dock's top edge, over the list's foot, so it
										 *  rides the keyboard lift with the composer and takes no
										 *  row from the transcript (no reflow when it goes). After
										 *  an anchored open, and (TestFlight 1139) when a newer
										 *  message arrives while the reader is away from the end,
										 *  instead of the list pulling them down; it goes once
										 *  they are back at the newest edge. */
										<View
											pointerEvents="box-none"
											className="absolute start-0 end-0 items-center pb-2"
											style={{ bottom: "100%" }}
										>
											{/* The outline pill's fill is ~1.05:1 on the canvas, so
											 *  over moving text only its hairline separated it: the
											 *  kit's `overlay` elevation makes it read as floating
											 *  (round-1 D6). On a box matching the button's own shape
											 *  and `surface` fill, which Android's elevation needs to
											 *  draw a shadow at all. */}
											<View
												className="rounded-sm bg-surface"
												style={jumpShadow ?? undefined}
											>
												<Button
													label={t("mobile.team_bridge.thread.jump_newest")}
													variant="outline"
													size="sm"
													testID={CONTROL.teamBridgeJumpNewest}
													onPress={jumpToNewest}
												/>
											</View>
										</View>
									) : null}
									{readOnly ? (
										<View className="mx-1 rounded-md border border-hairline bg-surface px-3.5 py-2.5">
											<Text className="text-body-sm text-ink-muted">
												{conversation?.status === "archived"
													? t("mobile.team_bridge.thread.archived")
													: t("mobile.team_bridge.thread.readonly")}
											</Text>
										</View>
									) : (
										<>
											{sendError && (
												<Alert
													severity="error"
													testID={SURFACE.teamBridgeSendError}
												>
													{sendError}
												</Alert>
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
											{mentions.view ? (
												<MentionStrip
													view={mentions.view}
													directoryMissing={directoryMissing}
													onPick={mentions.pick}
													shadow={jumpShadow}
												/>
											) : null}
											<BridgeComposerField
												glass={chromeGlass}
												label={t("mobile.team_bridge.thread.message")}
												/* The label, not "Message {channel}": the title above
												 *  names the channel, and a one-line placeholder must
												 *  never wrap or cut (`BridgeComposerField`). */
												placeholder={t("mobile.team_bridge.thread.message")}
												draft={draft}
												onDraftChange={mentions.onChangeText}
												onSelectionChange={mentions.onSelectionChange}
												selection={mentions.selection}
												sending={sending}
												attachLabel={
													images
														? t("mobile.team_bridge.attachment.add")
														: undefined
												}
												attachDisabled={!images || images.remaining() === 0}
												onAttach={images ? openAttach : undefined}
												// "Retry send" only when pressing it can succeed: while
												// images block the send, the control is plain "Send" (D4).
												sendLabel={
													sendError && !blockedBy
														? t("mobile.team_bridge.thread.send_retry")
														: t("mobile.team_bridge.thread.send")
												}
												sendDisabled={!sendable}
												onSend={() => {
													void send();
												}}
											/>
											{mentions.notice ? (
												<MentionNotice
													text={mentionNoticeText(mentions.notice)}
													onDismiss={mentions.dismissNotice}
												/>
											) : null}
										</>
									)}
								</BridgeComposerDock>
							</>
						) : null}
					</>
				)}
			</View>
			<ProfileSheet
				subject={profile}
				tenantId={tenantId}
				onClose={() => setProfile(null)}
				currentConversationId={conversationId}
			/>
			{messageActions.sheet}
			<Sheet
				visible={currentDeliveryHelp?.open === true}
				onClose={() =>
					setDeliveryHelp((current) =>
						current ? { ...current, open: false } : null,
					)
				}
				onDismiss={() =>
					setDeliveryHelp((current) =>
						current?.identity === deliveryHelpIdentity && !current.open
							? null
							: current,
					)
				}
				focusTitle
				titleLines={2}
				returnFocusTestID={currentDeliveryHelp?.opener}
				title={t("mobile.team_bridge.delivery.help_title")}
				testID={SURFACE.teamBridgeDeliveryHelpSheet}
			>
				<Text className="py-2 text-body-read text-ink-muted">
					{t("mobile.team_bridge.delivery.help")}
				</Text>
			</Sheet>
			{/* The session composer's AttachSheet, not a Team Bridge copy: one
			 *  add-image menu across the app, Take Photo included. Files is left
			 *  out because this pipeline bounds images from a URI with known
			 *  dimensions (AttachSheet's `sources`). The sheet asks for camera
			 *  permission on the press; the launch still waits for the iOS
			 *  dismissal through the shared handoff (and the sheet closes with no
			 *  exit animation for it — `Sheet`'s `exitInstantly`), and the bytes
			 *  still go through Team Bridge's own upload path. The existing test
			 *  IDs are kept so automation keeps addressing them. */}
			<AttachSheet
				visible={attachOpen}
				onClose={() => setAttachOpen(false)}
				onDismiss={attachHandoff.dismissed}
				onHidden={attachHandoff.hidden}
				title={t("mobile.team_bridge.attachment.add")}
				sources={TEAM_BRIDGE_ATTACH_SOURCES}
				testID={SURFACE.teamBridgeAttachSheet}
				optionId={teamBridgeAttachSourceId}
				onChoose={(source) => {
					if (source === "files") return;
					// Closed first; the picker opens over a dismissed sheet.
					setAttachOpen(false);
					attachHandoff.choose(() => {
						void addImages(source);
					}, Platform.OS);
				}}
			/>
			<Sheet
				visible={notifyOpen}
				onClose={() => setNotifyOpen(false)}
				title={t("mobile.team_bridge.thread.notify_sheet")}
				testID={SURFACE.teamBridgeNotifySheet}
			>
				<View className="gap-2 pb-2">
					<Text className="px-1 text-body-sm text-ink-dim">
						{t("mobile.team_bridge.thread.notify_current", {
							mode: notifyMode,
						})}
					</Text>
					<View className="gap-1">
						{(
							[
								["all", t("mobile.team_bridge.thread.notify_all")],
								["mention", t("mobile.team_bridge.thread.notify_mentions")],
								["mute", t("mobile.team_bridge.thread.notify_mute")],
							] as const
						).map(([value, text]) => {
							const activeOption = notifyMode === value;
							return (
								<Pressable
									key={value}
									accessibilityRole={ROLE.button}
									accessibilityLabel={text}
									accessibilityState={a11yState({
										selected: activeOption,
										disabled: notifyBusy,
									})}
									disabled={notifyBusy}
									testID={teamBridgeNotifyId(value)}
									onPress={() => {
										void changeNotify(value);
									}}
									style={{ minHeight: TOUCH_FLOOR }}
								>
									{({ pressed }) => (
										<View
											className={cx(
												"flex-1 flex-row items-center gap-3 rounded-sm px-3 py-2",
												activeOption
													? "bg-row-selected"
													: pressed && !notifyBusy
														? "bg-row-hover"
														: "bg-transparent",
											)}
										>
											<Text
												className={cx(
													"min-w-0 flex-1 text-body",
													notifyBusy
														? CONTROL_DISABLED_INK
														: activeOption
															? "font-semibold text-ink"
															: "text-ink",
												)}
											>
												{text}
											</Text>
											{activeOption ? (
												<Check size={18} color={checkColor} aria-hidden />
											) : null}
										</View>
									)}
								</Pressable>
							);
						})}
					</View>
					{notifyError && <Alert severity="error">{notifyError}</Alert>}
				</View>
			</Sheet>
		</Screen>
	);
}

export default function TeamBridgeThreadScreen() {
	const selfAccountId = useTeamBridgeState((state) => state.selfAccountId);
	const params = useLocalSearchParams<{
		tenantId?: string;
		conversationId?: string;
		kind?: string;
		accountId?: string;
		ownerAccountId?: string;
		endpointId?: string;
		label?: string;
		messageId?: string;
		seq?: string;
		restored?: string;
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
	const messageId = single(params.messageId);
	const seq = single(params.seq);
	const anchor = useMemo(
		() => parseThreadAnchor({ messageId, seq }),
		[messageId, seq],
	);
	// Set by the list's restore (`useRestoreLastTarget`), never by a push or
	// the app's own links. A hand-made deep link can carry `?restored=1`; that
	// is harmless — it only turns that open's 403/404 into the list fallback
	// instead of the error screen (round-1 R1-4b / D7).
	const restored = single(params.restored) === "1";
	return (
		<BridgeGate headerLeading={<BridgeThreadDrawerButton />}>
			<ThreadContent
				key={`${selfAccountId}/${tenantId}/${routeId}/${kind}/${accountId}/${ownerAccountId}/${endpointId}/${messageId}/${seq}`}
				tenantId={tenantId}
				routeId={routeId}
				target={target}
				label={label}
				anchor={anchor}
				restored={restored}
			/>
		</BridgeGate>
	);
}
