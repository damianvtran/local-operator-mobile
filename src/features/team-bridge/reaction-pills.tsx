/**
 * Reaction pills under a Team Bridge message, and the one toggle every
 * reaction control goes through.
 *
 * WHY (operator: "there's no way to react … on mobile team bridge … port
 * [Slack and Discord] over"). Slack: "Any reactions you add … will be
 * highlighted in blue. Simply … tap the reaction to remove it"; Discord:
 * remove "by selecting the emoji you used to react". So a pill IS a toggle:
 * tap another's → +1 and mine; tap mine → back; my sole reaction → the pill
 * goes. Spec: lop-dev "Mobile Team Bridge: reactions and start-a-thread",
 * slice PR b — §4.3 pills, §4.5 haptics, §4.6 accessibility, §4.8 rollback.
 *
 * WHAT IT READS. The held message's `reactions` (the hub's summary), unless a
 * toggle for this message is in flight, in which case the store's optimistic
 * rows (`reactionPending`) — which is also why a poll landing mid-write cannot
 * flicker a pill back. A hub that does not serve reactions
 * (`reactionsUnserved`) renders nothing at all, not an error.
 *
 * ZERO COST AT REST. A message with no reactions renders `null`: no row, no
 * `+`, no added height (the entry point is the long-press sheet's quick row).
 */
import { SmilePlus } from "lucide-react-native";
import { memo, useCallback, useRef, useState } from "react";
import {
	AccessibilityInfo,
	ActivityIndicator,
	Pressable,
	Text,
	View,
} from "react-native";
import { type ShippedLocale, t } from "@/i18n";
import { haptic } from "@/lib/haptics";
import type { Message, Reaction } from "@/team-bridge/contract";
import { useTeamBridge, useTeamBridgeState } from "@/team-bridge/provider";
import { reactionTotal } from "@/team-bridge/reactions";
import { type ReactionTarget, reactionKey } from "@/team-bridge/store";
import {
	ROLE,
	SURFACE,
	teamBridgeReactionMeasureId,
	teamBridgeReactionPillId,
	teamBridgeReactionVisualId,
} from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { Sheet } from "@/ui/components/sheet";
import { cx } from "@/ui/variants";
import {
	collapsedReactionCount,
	sampledReactionDetails,
} from "./reaction-details";

const NO_REACTIONS: readonly Reaction[] = [];

/** Keep the 28 pt visual inside a real >=44x44 layout box. Slop alone neither
 * reserves horizontal space for the inline plus nor survives a parent boundary;
 * real boxes cannot overlap on wrapped lines or when reading direction flips. */
const PILL_HEIGHT = 28;
const PILL_TOUCH = { minWidth: 44, height: 44 } as const;
/* 16 pt glyph (spec §4.3). A style, not a type token: emoji are drawn by the
 *  system font and no text role in the kit is this size. */
const EMOJI_GLYPH = { fontSize: 16, lineHeight: 20 } as const;

/**
 * The toggle, with the feedback the store cannot give (it is Node-tested):
 * `selection` on the tap (spec §4.5), `warning` on a refusal, and a polite
 * announcement of the result (§4.6). A second tap while this message's write
 * is in flight is dropped here before any feedback, and again in the store.
 */
export function useReactionToggle() {
	const { actions, store } = useTeamBridge();
	return useCallback(
		async (target: ReactionTarget, emoji: string) => {
			const state = store.getState();
			if (state.reactionsUnserved || state.reactionPending[reactionKey(target)])
				return;
			haptic("selection");
			const outcome = await actions.toggleReaction(target, emoji);
			if (outcome === "failed") {
				haptic("warning");
				AccessibilityInfo.announceForAccessibility(
					t("mobile.team_bridge.reactions.failed"),
				);
			} else if (outcome === "added" || outcome === "removed") {
				AccessibilityInfo.announceForAccessibility(
					t(`mobile.team_bridge.reactions.${outcome}`),
				);
			}
		},
		[actions, store],
	);
}

/** The rows a message shows now: optimistic while a write is in flight. */
export function useShownReactions(
	tenantId: string,
	message: Pick<Message, "id" | "conversation_id" | "reactions">,
) {
	const key = reactionKey({
		tenantId,
		conversationId: message.conversation_id,
		messageId: message.id,
	});
	const pending = useTeamBridgeState((s) => s.reactionPending[key]);
	const failed = useTeamBridgeState((s) => s.reactionFailed[key] === true);
	const unserved = useTeamBridgeState((s) => s.reactionsUnserved);
	return {
		rows: pending?.rows ?? message.reactions ?? NO_REACTIONS,
		pendingEmoji: pending?.emoji ?? null,
		failed,
		unserved,
	};
}

/** A count as the app locale writes it; compact past 999 (spec §4.3, "many"). */
export const reactionCount = (count: number, locale: ShippedLocale): string =>
	new Intl.NumberFormat(locale, {
		notation: count >= 1000 ? "compact" : "standard",
	}).format(count);

/** The screen-reader name of one pill: one ICU message per state, so the word
 *  order is the translator's. The emoji is spoken by its system name. */
export const pillLabel = (reaction: Reaction): string =>
	t(
		reaction.reacted_by_me
			? "mobile.team_bridge.reactions.pill_mine"
			: "mobile.team_bridge.reactions.pill",
		{ emoji: reaction.emoji, count: reaction.count },
	);

export const ReactionPills = memo(function ReactionPills({
	message,
	tenantId,
	locale,
	canReact,
	onAdd,
	onLongPress,
}: {
	message: Message;
	tenantId: string;
	/** A prop, not a read, for the row's memo reason (`ThreadMessageRow`). */
	locale: ShippedLocale;
	/** False in a read-only conversation: pills show, but do not toggle. */
	canReact: boolean;
	/** The trailing `+`: opens the message-actions sheet at its quick row. */
	onAdd?: (origin: () => View | null) => void;
	/** Plus holds still open message actions. Pill holds inspect their own
	 * sampled summary instead; they must never toggle on release. */
	onLongPress?: () => void;
}) {
	const { rows, pendingEmoji, failed, unserved } = useShownReactions(
		tenantId,
		message,
	);
	const toggle = useReactionToggle();
	const plusColor = useTokenColor("ink-muted");
	const [inspecting, setInspecting] = useState<string | null>(null);
	const [expanded, setExpanded] = useState(false);
	const [width, setWidth] = useState(0);
	const [widths, setWidths] = useState<Record<string, number>>({});
	const addRef = useRef<View>(null);
	const limit = collapsedReactionCount(
		width,
		rows.map((r) => widths[r.emoji] ?? 0),
		canReact && onAdd ? 44 : 0,
	);
	const shown = expanded ? rows : rows.slice(0, limit);
	const detail = rows.find((r) => r.emoji === inspecting);
	const sample = detail ? sampledReactionDetails(detail) : null;
	if (unserved || (rows.length === 0 && !failed)) return null;
	const target = {
		tenantId,
		conversationId: message.conversation_id,
		messageId: message.id,
	};
	return (
		<View className="mt-1" testID={SURFACE.teamBridgeReactionPills}>
			<View
				className="absolute start-0 end-0 top-0 items-start opacity-0"
				pointerEvents="none"
				accessibilityElementsHidden
				importantForAccessibility="no-hide-descendants"
				aria-hidden
			>
				{rows.map((reaction) => (
					<View
						key={reaction.emoji}
						style={PILL_TOUCH}
						className="justify-center"
						testID={teamBridgeReactionMeasureId(reaction.emoji)}
						onLayout={(event) => {
							const measured = event.nativeEvent.layout.width;
							setWidths((old) =>
								old[reaction.emoji] === measured
									? old
									: { ...old, [reaction.emoji]: measured },
							);
						}}
					>
						<ReactionFace reaction={reaction} locale={locale} />
					</View>
				))}
			</View>
			{rows.length > 0 ? (
				<View
					testID={SURFACE.teamBridgeReactionWrap}
					className="flex-row flex-wrap items-center"
					// Match the packer's point gap even when web root rem size changes.
					style={{ columnGap: 6 }}
					onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
				>
					{/* The summary a screen reader lands on first (§4.6). Out of
					 *  the layout, still in the accessibility tree. */}
					<Text style={VISUALLY_HIDDEN} accessibilityRole={ROLE.text}>
						{t("mobile.team_bridge.reactions.summary", {
							count: reactionTotal(rows),
						})}
					</Text>
					{shown.map((reaction) => {
						const mine = reaction.reacted_by_me;
						const busy = pendingEmoji === reaction.emoji;
						return (
							<Pressable
								key={reaction.emoji}
								accessibilityRole={ROLE.button}
								accessibilityLabel={pillLabel(reaction)}
								accessibilityHint={
									canReact
										? t(
												mine
													? "mobile.team_bridge.reactions.hint_remove"
													: "mobile.team_bridge.reactions.hint_add",
											)
										: t("mobile.team_bridge.reactions.hint_inspect")
								}
								accessibilityState={{
									selected: mine,
									busy,
								}}
								testID={teamBridgeReactionPillId(reaction.emoji)}
								onPress={() => {
									if (canReact) void toggle(target, reaction.emoji);
									else setInspecting(reaction.emoji);
								}}
								onLongPress={() => {
									haptic("light");
									setInspecting(reaction.emoji);
								}}
								accessibilityActions={[
									{
										name: "longpress",
										label: t("mobile.team_bridge.reactions.details"),
									},
								]}
								onAccessibilityAction={(event) => {
									if (event.nativeEvent.actionName === "longpress")
										setInspecting(reaction.emoji);
								}}
								style={PILL_TOUCH}
								className="justify-center"
							>
								<ReactionFace
									reaction={reaction}
									locale={locale}
									busy={busy}
									testID={teamBridgeReactionVisualId(reaction.emoji)}
								/>
							</Pressable>
						);
					})}
					{rows.length > 0 && canReact && onAdd ? (
						<Pressable
							accessibilityRole={ROLE.button}
							ref={addRef}
							accessibilityLabel={t("mobile.team_bridge.reactions.add")}
							testID={SURFACE.teamBridgeReactionAdd}
							onPress={() => onAdd(() => addRef.current)}
							onLongPress={onLongPress}
							style={PILL_TOUCH}
							className="items-center justify-center"
						>
							<View
								style={{ height: PILL_HEIGHT, width: PILL_HEIGHT }}
								className="items-center justify-center rounded-full border border-border-control bg-elevated"
							>
								<SmilePlus size={16} color={plusColor} aria-hidden />
							</View>
						</Pressable>
					) : null}
				</View>
			) : null}
			<View className="flex-row items-center gap-1.5">
				{limit < rows.length ? (
					<Pressable
						accessibilityRole={ROLE.button}
						accessibilityState={{ expanded }}
						onPress={() => setExpanded((old) => !old)}
						style={{ minHeight: 44 }}
						testID={SURFACE.teamBridgeReactionsExpand}
						className="justify-center px-2"
					>
						<Text className="text-meta text-accent">
							{expanded
								? t("mobile.team_bridge.reactions.show_less")
								: t("mobile.team_bridge.reactions.show_more", {
										count: rows.length - limit,
									})}
						</Text>
					</Pressable>
				) : null}
			</View>
			<Sheet
				visible={detail !== undefined}
				onClose={() => setInspecting(null)}
				title={t("mobile.team_bridge.reactions.details")}
				testID={SURFACE.teamBridgeReactionDetails}
			>
				{detail && sample ? (
					<View className="gap-3 pb-4">
						<Text className="text-body text-ink">
							{t("mobile.team_bridge.reactions.pill", {
								emoji: detail.emoji,
								count: detail.count,
							})}
						</Text>
						{sample.labels.length > 0 ? (
							<Text className="text-body text-ink-muted">
								{t("mobile.team_bridge.reactions.sample", {
									labels: new Intl.ListFormat(locale, {
										style: "long",
										type: "conjunction",
									}).format(sample.labels),
									count: sample.others,
								})}
							</Text>
						) : (
							<Text className="text-body text-ink-muted">
								{t("mobile.team_bridge.reactions.sample_none")}
							</Text>
						)}
						<Text className="text-meta text-ink-muted">
							{t("mobile.team_bridge.reactions.sample_notice")}
						</Text>
						{sample.mine ? (
							<Text className="text-meta text-accent">
								{t("mobile.team_bridge.reactions.you_reacted")}
							</Text>
						) : null}
					</View>
				) : null}
			</Sheet>
			{failed ? (
				<Text
					className="mt-1 text-meta text-danger"
					testID={SURFACE.teamBridgeReactionError}
				>
					{t("mobile.team_bridge.reactions.failed")}
				</Text>
			) : null}
		</View>
	);
});

/** Out of the layout and out of sight, still in the accessibility tree (the
 *  composer's `VISUALLY_HIDDEN`, the web's `sr-only`). */
const VISUALLY_HIDDEN = {
	position: "absolute",
	width: 1,
	height: 1,
	overflow: "hidden",
} as const;

/** One visual face for both visible controls and inert width probes. Sharing the
 * exact markup keeps collapsed packing correct when hidden counts, locale or
 * dynamic text size change; clipping a live control would leave an invisible
 * accessibility target. Probes have no press handlers and are aria-hidden. */
function ReactionFace({
	reaction,
	locale,
	busy = false,
	testID,
}: {
	reaction: Reaction;
	locale: ShippedLocale;
	busy?: boolean;
	testID?: string;
}) {
	const mine = reaction.reacted_by_me;
	const spinner = useTokenColor("ink-muted");
	return (
		<View
			testID={testID}
			style={{ height: PILL_HEIGHT }}
			className={cx(
				"flex-row items-center gap-1 rounded-full border px-2.5",
				/* Mine carries an `accent-border` ring: its wash measured
				 *  1.01:1 on the light canvas, so the hue alone cannot say
				 *  "yours" outdoors (spec §4.3; contrast contract row
				 *  "team bridge own reaction pill"). */
				mine
					? "border-accent-border bg-accent-wash"
					: "border-border-control bg-elevated",
			)}
		>
			<Text style={EMOJI_GLYPH} aria-hidden>
				{reaction.emoji}
			</Text>
			<View>
				{/* Pending: the count is hidden IN PLACE under the spinner,
				 *  so the pill keeps its width (§4.3 "pending"). */}
				<Text
					className={cx(
						"text-meta tabular-nums",
						mine ? "font-semibold text-accent" : "text-ink-muted",
						busy && "opacity-0",
					)}
				>
					{reactionCount(reaction.count, locale)}
				</Text>
				{busy ? (
					<View className="absolute inset-0 items-center justify-center">
						<ActivityIndicator size="small" color={spinner} />
					</View>
				) : null}
			</View>
		</View>
	);
}
