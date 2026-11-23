/**
 * The Team Bridge message-actions sheet: long-press any message and a bottom
 * sheet rises with what you can do to it (operator: "there's no way to react
 * or post in a thread on mobile team bridge … port [Slack and Discord] over").
 *
 * WHY A SHEET ON LONG-PRESS. Both apps open their message menu with "tap and
 * hold the message" (Slack help 202931348, Discord 360057382374); a touch
 * screen has no hover toolbar like the desktop's. The spec this implements is
 * the lop-dev "Mobile Team Bridge: reactions and start-a-thread" design spec,
 * slice PR a (§4.2 sheet, §4.5 haptics, §4.6 accessibility). The quick-reaction
 * row that tops the sheet in Slack lands with reactions (slice b); this slice
 * ships the actions list only.
 *
 * WHAT IT OFFERS, in a fixed order (an omitted row closes the gap; nothing is
 * ever greyed out):
 *  - Reply in thread: ROOT rows only. It is the only way to START a thread —
 *    before this the timeline's only entry to a thread was the reply chip,
 *    which renders only once a root already has replies. Threads are one level
 *    deep (the hub refuses a reply as a root), so a reply row never offers it.
 *  - Copy text: the message as plain text (formatting markers dropped, the
 *    same projection "Select text" shows).
 *  - Select text: the existing drag-to-select mode. Long-press used to enter
 *    it directly; the sheet now owns long-press (Slack's own pattern, and the
 *    label Slack uses), so selection moved here. On Android that makes partial
 *    selection one tap further away, in Bridge only (`HostSelection`).
 *
 * THE QUICK-REACTION ROW (slice PR b, spec §4.2 item 1). Slack: "Choose a
 * frequently used reaction at the top of the menu, or tap the Add reaction
 * icon to find another one". The row is this account's most-used emoji
 * topped up from the desktop's quick set (`frequentEmoji`), as many as fit in
 * 44 pt cells (`quickReactionCells`), then `+`, which hands off to the system
 * emoji keyboard (`EmojiCapture`). A cell I already used on this message is
 * tinted and toggles it off — the row tells the truth about my state. The
 * row is absent in a read-only conversation and on a hub that does not serve
 * reactions.
 *
 * LONG-PRESS IS NEVER THE ONLY PATH. The same actions ride on every body leaf
 * as `accessibilityActions`, which VoiceOver's rotor and TalkBack's actions
 * menu reach without a hold (`messageActionAccessibility`).
 */
import * as Clipboard from "expo-clipboard";
import {
	Copy,
	MessageSquareReply,
	SmilePlus,
	TextCursor,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	type AccessibilityActionEvent,
	Platform,
	Pressable,
	Text,
	useWindowDimensions,
	View,
} from "react-native";
import { createAttachmentSheetHandoff } from "@/features/session/attach-handoff";
import type { SelectTextAccessibility } from "@/features/session/components/selectable-message";
import { requestTextSelection } from "@/features/session/components/selectable-message";
import { markdownPlainText } from "@/features/session/markdown";
import { t } from "@/i18n";
import { haptic } from "@/lib/haptics";
import { useUiStore } from "@/state/ui-store";
import type { Message } from "@/team-bridge/contract";
import { teamBridgeFrequentEmoji } from "@/team-bridge/emoji-usage";
import { useTeamBridgeState } from "@/team-bridge/provider";
import { reactionKey } from "@/team-bridge/store";
import {
	ROLE,
	SURFACE,
	teamBridgeMessageActionId,
	teamBridgeQuickReactionId,
} from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { Sheet } from "@/ui/components/sheet";
import { useIsRTL } from "@/ui/direction";
import { cx } from "@/ui/variants";
import { EmojiCapture } from "./emoji-capture";
import { captureReactionFocus } from "./reaction-focus";
import { useReactionToggle } from "./reaction-pills";

/**
 * How many cells the quick row holds at a window width (spec §4.2): 44 pt
 * cells with ≥ 4 pt between them inside the sheet's 16 pt padding, at most 8,
 * the last one always `+`. 320 pt → 6 (5 emoji + `+`); 430 pt → 8 (7 + `+`).
 * Fewer cells, never a wrap, is the narrow-screen answer.
 */
export const quickReactionCells = (width: number): number =>
	Math.max(2, Math.min(8, Math.floor((width - 32 + 4) / 48)));

export type MessageAction = "reply_in_thread" | "copy_text" | "select_text";

/** Which screen a row lives on. The timeline stays mounted under the reply
 *  thread, so one message can be on screen twice; the selection id must tell
 *  the two copies apart. */
export type MessageActionsScope = "timeline" | "reply";

/**
 * The actions a message offers, in display order. Pure, so the omission rules
 * are pinned without a renderer.
 */
export const messageActions = (
	message: Pick<Message, "body" | "thread_root_id">,
	options: {
		canReplyInThread: boolean;
		/** The body can already be drag-selected without entering a mode. */
		selectableAtRest?: boolean;
	},
): MessageAction[] => {
	const list: MessageAction[] = [];
	if (options.canReplyInThread && !message.thread_root_id)
		list.push("reply_in_thread");
	// An image-only message has `body: ""`: nothing to copy or select.
	if ((message.body ?? "").trim().length > 0) {
		list.push("copy_text");
		/* WEB OMITS IT (PR #339 round 2: UX U7, design D8, QA N1). Web bodies are
		 *  selectable at rest (round-1 Q3), so the row only added a tint, and the
		 *  mode's exits are touch handlers (`text-selection.ts`): with a mouse
		 *  nothing ended it and the row stayed tinted until the screen left. */
		if (!options.selectableAtRest) list.push("select_text");
	}
	return list;
};

/**
 * Whether a chosen action waits for the sheet's `onDismiss` before it runs.
 *
 * iOS: a push or a focused selection view started under a still-presented
 * modal is swallowed by it (the attach sheet's rule, `attach-handoff.ts`).
 *
 * WEB, TOO (PR #339 round 1, U1/D1/Q2): react-native-web's Modal returns
 * focus to the element that held it when the sheet OPENED, and it does that
 * after `visible` went false — while the closing sheet is still mounted, its
 * focus trap also pulls focus back to its own Close button. "Reply in thread"
 * pushed at once, the thread screen's `autoFocus` composer took focus, and
 * the closing sheet took it straight back (measured: composer focused at
 * 1197 ms, Close at 1198 ms, `body` once the sheet unmounted; focused on
 * arrival in 1 of 4 QA trials). The kit's web `onDismiss` fires only after
 * the sheet has left the DOM and after that focus return (`Sheet`,
 * `@/ui/modal-dismissal-ledger`; until round 2 it also fired once at the START
 * of the exit animation, which still let the trap win — pinned by
 * `sheet-dismiss-timing.test.tsx`), so an action
 * run from it — the push, the copy, the selection — is the last thing to
 * move focus. Deferring the navigation was chosen over suppressing the
 * sheet's focus return because the return is RNW's own (no kit seam turns
 * it off) and is correct for every action that does NOT navigate.
 *
 * ANDROID runs at once: it never fires `onDismiss`, and its Modal does no
 * DOM focus return. No timer fallback anywhere, for the attach sheet's
 * reason: a lost `onDismiss` drops the action, and a second press works.
 */
export const runsAfterDismissal = (os: string): boolean =>
	os === "ios" || os === "web";

/** The selection-mode id of one message on one screen (`HostSelection.id`). */
export const bridgeSelectionId = (
	scope: MessageActionsScope,
	messageId: string,
): string => `team-bridge:${scope}:${messageId}`;

/* 44 pt cells (`TOUCH_TARGET.minimum`) with a 28 pt glyph (spec §4.2). */
const QUICK_CELL = { width: 44, height: 44 } as const;
const QUICK_GLYPH = { fontSize: 28, lineHeight: 34 } as const;

const ACTION_LABEL: Record<MessageAction, () => string> = {
	reply_in_thread: () => t("mobile.team_bridge.actions.reply_in_thread"),
	copy_text: () => t("mobile.team_bridge.actions.copy_text"),
	select_text: () => t("mobile.team_bridge.actions.select_text"),
};

const ACTION_ICON = {
	reply_in_thread: MessageSquareReply,
	copy_text: Copy,
	select_text: TextCursor,
} as const;

/* The reply glyph's arrow points back at the message being answered, a
 *  reading-direction affordance like `BackIcon`'s, so it mirrors in RTL
 *  (design round 1, D6). Lucide has no mirrored twin of `MessageSquareReply`,
 *  so this one is flipped with a transform; Copy and the text cursor depict
 *  objects and stay as drawn. */
const MIRRORS_IN_RTL: ReadonlySet<MessageAction> = new Set(["reply_in_thread"]);

const NO_ACCESSIBILITY: SelectTextAccessibility = {};

/**
 * The screen-reader face of the sheet: one custom action per offered row, run
 * directly (there is no sheet to dismiss first). Labels are read at call time,
 * so the caller recomputes on a language change (the row's `locale` prop).
 */
export const messageActionAccessibility = (
	actions: readonly MessageAction[],
	run: (action: MessageAction) => void,
	/** "React" (spec §4.6): opens the same sheet, at its quick row. First,
	 *  because it is the action a reader reaches for most. */
	react?: () => void,
): SelectTextAccessibility =>
	actions.length === 0 && !react
		? NO_ACCESSIBILITY
		: {
				accessibilityActions: [
					...(react
						? [
								{
									name: REACT_ACTION,
									label: t("mobile.team_bridge.actions.a11y_react"),
								},
							]
						: []),
					...actions.map((name) => ({
						name,
						label: ACTION_LABEL[name](),
					})),
				],
				onAccessibilityAction: (event: AccessibilityActionEvent) => {
					const name = event.nativeEvent.actionName;
					if (name === REACT_ACTION) react?.();
					else if (actions.includes(name as MessageAction))
						run(name as MessageAction);
				},
			};

/** The custom accessibility action's name; not a sheet row. */
export const REACT_ACTION = "react";

/** What a row needs from its screen. Stable across renders while its inputs
 *  are, so the memoised rows are not re-rendered by it. */
export type MessageActionsController = {
	scope: MessageActionsScope;
	/** Reactions can be added here: a writable conversation on a hub that
	 *  serves them. False hides the quick row, `+` and "React". */
	reactable: boolean;
	list: (message: Message) => MessageAction[];
	open: (message: Message, origin?: () => View | null) => void;
	run: (action: MessageAction, message: Message) => void;
};

/**
 * One screen's sheet: its open state, the handoff out of it, and the actions.
 * Returns the controller for the rows, the id of the row whose sheet is open
 * (it holds the selected tint so the reader keeps the referent), and the
 * sheet element to mount beside the screen's other sheets.
 */
export function useMessageActions({
	scope,
	tenantId,
	canReplyInThread,
	canReact,
	onReplyInThread,
}: {
	scope: MessageActionsScope;
	tenantId: string;
	canReplyInThread: boolean;
	/** The conversation takes writes (not read-only or archived). */
	canReact: boolean;
	onReplyInThread?: (rootId: string) => void;
}) {
	const unserved = useTeamBridgeState((s) => s.reactionsUnserved);
	const selfAccountId = useTeamBridgeState((s) => s.selfAccountId);
	const reactable = canReact && !unserved;
	const toggle = useReactionToggle();
	/** The message whose `+` is waiting on the system emoji keyboard. */
	const [capturing, setCapturing] = useState<Message | null>(null);
	const returnFocus = useRef<(() => void) | null>(null);
	const restoreAfterCapture = useRef(false);
	// Commit the hidden input's removal before returning focus. No input focus,
	// modal re-open, or timeout race with the sheet's dismissal handoff.
	useEffect(() => {
		if (!capturing && restoreAfterCapture.current) {
			restoreAfterCapture.current = false;
			returnFocus.current?.();
			returnFocus.current = null;
		}
	}, [capturing]);
	const [target, setTarget] = useState<{
		message: Message;
		open: boolean;
	} | null>(null);
	const showToast = useUiStore((state) => state.showToast);
	/* The attach sheet's handoff, with one difference: here a choice waits for
	 *  the sheet's `onDismiss` on the web as well as on iOS
	 *  (`runsAfterDismissal`). Android, which never fires `onDismiss`, still
	 *  runs it at once. */
	const handoff = useRef(createAttachmentSheetHandoff()).current;
	useEffect(() => () => handoff.cancel(), [handoff]);
	const replyRef = useRef(onReplyInThread);
	replyRef.current = onReplyInThread;
	const replyable = canReplyInThread && onReplyInThread !== undefined;

	const list = useCallback(
		(message: Message) =>
			messageActions(message, {
				canReplyInThread: replyable,
				selectableAtRest: Platform.OS === "web",
			}),
		[replyable],
	);
	const run = useCallback(
		(action: MessageAction, message: Message) => {
			if (action === "reply_in_thread") {
				replyRef.current?.(message.id);
				return;
			}
			if (action === "copy_text") {
				void Clipboard.setStringAsync(
					markdownPlainText(message.body ?? ""),
				).then(() => showToast(t("mobile.team_bridge.actions.copied")));
				return;
			}
			requestTextSelection(bridgeSelectionId(scope, message.id));
		},
		[scope, showToast],
	);
	const open = useCallback(
		(message: Message, origin?: () => View | null) => {
			returnFocus.current = captureReactionFocus(origin);
			// The spec's long-press tick (§4.5): an action was taken.
			haptic("light");
			handoff.cancel();
			setTarget({ message, open: true });
		},
		[handoff],
	);
	const controller = useMemo<MessageActionsController>(
		() => ({ scope, reactable, list, open, run }),
		[scope, reactable, list, open, run],
	);

	const close = useCallback(
		() =>
			setTarget((current) => (current ? { ...current, open: false } : null)),
		[],
	);
	const dismissed = useCallback(() => {
		handoff.dismissed();
		setTarget((current) => (current && !current.open ? null : current));
	}, [handoff]);
	const message = target?.message ?? null;
	const choose = useCallback(
		(action: MessageAction) => {
			if (!message) return;
			close();
			const afterDismissal = runsAfterDismissal(Platform.OS);
			/* The shared handoff spells "wait for onDismiss" as the "ios"
			 *  platform; `runsAfterDismissal` decides which platforms take it. */
			handoff.choose(
				() => run(action, message),
				afterDismissal ? "ios" : Platform.OS,
			);
			// Android never fires `onDismiss`, so nothing else clears the
			// closed target there; keeping it would pin the row's tint.
			if (!afterDismissal)
				setTarget((current) => (current && !current.open ? null : current));
		},
		[message, close, handoff, run],
	);

	/* Which quick emoji are already mine on this message: the optimistic rows
	 *  while a write is in flight, else the held message's. */
	const pendingRows = useTeamBridgeState((s) =>
		message
			? s.reactionPending[
					reactionKey({
						tenantId,
						conversationId: message.conversation_id,
						messageId: message.id,
					})
				]?.rows
			: undefined,
	);
	const rows = pendingRows ?? message?.reactions ?? [];
	const { width } = useWindowDimensions();
	const pick = useCallback(
		(emoji: string, on: Message) => {
			void toggle(
				{ tenantId, conversationId: on.conversation_id, messageId: on.id },
				emoji,
			);
		},
		[toggle, tenantId],
	);
	const quick =
		reactable && message
			? {
					emoji: teamBridgeFrequentEmoji(selfAccountId, Date.now()).slice(
						0,
						quickReactionCells(width) - 1,
					),
					mine: new Set(
						rows.filter((r) => r.reacted_by_me).map((r) => r.emoji),
					),
					// A tap toggles at once: no navigation or focus to hand off.
					onPick: (emoji: string) => {
						close();
						// Android never fires `onDismiss` (see `choose`).
						if (!runsAfterDismissal(Platform.OS)) setTarget(null);
						pick(emoji, message);
					},
					/* `+` focuses a field, which a still-presented modal swallows on
					 *  iOS (and whose focus return wins on web): it waits for the
					 *  sheet's `onDismiss` like every other action here. */
					onMore: () => {
						close();
						const afterDismissal = runsAfterDismissal(Platform.OS);
						handoff.choose(
							() => setCapturing(message),
							afterDismissal ? "ios" : Platform.OS,
						);
						if (!afterDismissal) setTarget(null);
					},
				}
			: null;

	const sheet = (
		<>
			<MessageActionsSheet
				visible={target?.open === true}
				actions={message ? list(message) : []}
				quick={quick}
				onChoose={choose}
				onClose={() => {
					close();
					if (Platform.OS !== "ios") setTarget(null);
				}}
				onDismiss={dismissed}
			/>
			<EmojiCapture
				active={capturing !== null}
				onPick={(emoji) => {
					const on = capturing;
					restoreAfterCapture.current = true;
					setCapturing(null);
					if (on) pick(emoji, on);
				}}
				onCancel={() => {
					restoreAfterCapture.current = true;
					setCapturing(null);
				}}
			/>
		</>
	);
	return {
		controller,
		openMessageId: target?.open ? target.message.id : null,
		sheet,
	};
}

/** The sheet itself: a titled list of 48 pt rows (§4.2), 20 pt icons. */
export function MessageActionsSheet({
	visible,
	actions,
	quick = null,
	onChoose,
	onClose,
	onDismiss,
}: {
	visible: boolean;
	actions: readonly MessageAction[];
	/** The quick-reaction row; null where reactions are not offered. */
	quick?: {
		emoji: readonly string[];
		mine: ReadonlySet<string>;
		onPick: (emoji: string) => void;
		onMore: () => void;
	} | null;
	onChoose: (action: MessageAction) => void;
	onClose: () => void;
	onDismiss?: () => void;
}) {
	const iconColor = useTokenColor("ink-muted");
	const rtl = useIsRTL();
	return (
		<Sheet
			visible={visible}
			onClose={onClose}
			onDismiss={onDismiss}
			title={t("mobile.team_bridge.actions.title")}
			testID={SURFACE.teamBridgeMessageActionsSheet}
		>
			{quick ? (
				<View
					className="flex-row items-center justify-between border-b border-hairline pb-3"
					testID={SURFACE.teamBridgeQuickReactions}
				>
					{quick.emoji.map((emoji) => {
						const mine = quick.mine.has(emoji);
						return (
							<Pressable
								key={emoji}
								accessibilityRole={ROLE.button}
								accessibilityLabel={emoji}
								accessibilityHint={t("mobile.team_bridge.actions.a11y_react")}
								accessibilityState={{ selected: mine }}
								testID={teamBridgeQuickReactionId(emoji)}
								onPress={() => quick.onPick(emoji)}
								style={QUICK_CELL}
								className={cx(
									"items-center justify-center rounded-full",
									mine && "bg-accent-wash",
								)}
							>
								{({ pressed }) => (
									<Text style={[QUICK_GLYPH, pressed && { opacity: 0.6 }]}>
										{emoji}
									</Text>
								)}
							</Pressable>
						);
					})}
					<Pressable
						accessibilityRole={ROLE.button}
						accessibilityLabel={t("mobile.team_bridge.reactions.add")}
						testID={teamBridgeQuickReactionId("+")}
						onPress={quick.onMore}
						style={QUICK_CELL}
						className="items-center justify-center rounded-full"
					>
						<SmilePlus size={20} color={iconColor} aria-hidden />
					</Pressable>
				</View>
			) : null}
			<View className={cx("pb-2", quick && "pt-3")}>
				{actions.map((action) => {
					const Icon = ACTION_ICON[action];
					const label = ACTION_LABEL[action]();
					return (
						<Pressable
							key={action}
							accessibilityRole={ROLE.button}
							accessibilityLabel={label}
							testID={teamBridgeMessageActionId(action)}
							onPress={() => onChoose(action)}
							style={{ minHeight: 48 }}
						>
							{({ pressed }) => (
								<View
									className={cx(
										"flex-1 flex-row items-center gap-3 rounded-sm px-3",
										pressed ? "bg-row-hover" : "bg-transparent",
									)}
								>
									<View
										style={
											rtl && MIRRORS_IN_RTL.has(action)
												? { transform: [{ scaleX: -1 }] }
												: undefined
										}
									>
										<Icon size={20} color={iconColor} aria-hidden />
									</View>
									<Text className="min-w-0 flex-1 text-body text-ink">
										{label}
									</Text>
								</View>
							)}
						</Pressable>
					);
				})}
			</View>
		</Sheet>
	);
}
