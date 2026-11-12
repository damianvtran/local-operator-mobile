/**
 * A hub destination, not a relay capability. Always available as a gate even
 * before a computer is chosen; hiding it on a sleeping laptop defeats the
 * hub-only architecture. The same entry lives in the drawer and computer picker.
 */
import { useRouter } from "expo-router";
import { ChevronLeft, ChevronRight, MessagesSquare } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { countLabel } from "@/features/notifications/notifications-model";
import { t } from "@/i18n";
import { useTeamBridgeState } from "@/team-bridge/provider";
import { CONTROL, ROLE } from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { Badge } from "@/ui/components/badge";
import { IconButton } from "@/ui/components/icon-button";
import { useIsRTL } from "@/ui/direction";
import { useTextScale } from "@/ui/text-scale-provider";
import {
	avatarClasses,
	NAV_CARD_MIN_HEIGHT,
	navCardClasses,
} from "@/ui/variants";

export function TeamBridgeEntry({
	onNavigate,
	variant = "block",
}: {
	onNavigate?: () => void;
	/**
	 * `block` (default): the labelled button with its one-line explanation, for
	 * the screens where a reader has not chosen a computer yet and the caption
	 * is what tells them the hub works without one (welcome, computer picker).
	 *
	 * `compact`: ONE icon control with the unread count on its corner, for the
	 * drawer footer's workspace row (visual audit D11). There the entry is
	 * navigation the reader already knows, and the block form cost the
	 * conversation list ~74 pt for a sentence they had read. The accessible
	 * name is the same catalogue string the block form shows, count included,
	 * so nothing is announced differently.
	 */
	variant?: "block" | "compact";
}) {
	const router = useRouter();
	const unread = useTeamBridgeState((s) => s.totalUnread);
	const { effectiveScale } = useTextScale();
	const glyphInk = useTokenColor("ink");
	const chevronInk = useTokenColor("ink-dim");
	const rtl = useIsRTL();
	const go = () => {
		onNavigate?.();
		router.push("/team-bridge" as never);
	};
	if (variant === "compact")
		return (
			<View>
				<IconButton
					accessibilityLabel={t("mobile.team_bridge.navigation.entry", {
						count: unread,
					})}
					onPress={go}
					icon={({ color, size }) => (
						<MessagesSquare color={color} size={size} />
					)}
					testID={CONTROL.teamBridgeNavigation}
				/>
				{unread > 0 ? (
					/* Out of flow on the icon's corner, as the Inbox count is on its
					 *  destination: the control's box (and so the row) never changes
					 *  size when a message arrives. Hidden from assistive tech — the
					 *  button's own name already carries the count. */
					<View
						pointerEvents="none"
						className="absolute"
						style={{ top: 2, end: 2 }}
						aria-hidden
					>
						<Badge
							label={countLabel(unread)}
							scale={effectiveScale}
							tone="warning"
							emphasis
							mono
						/>
					</View>
				) : null}
			</View>
		);
	/* The block variant is a DESTINATION, so it is drawn as one (design D2): a
	 *  left-aligned card in the computer row's family (`navCardClasses`) with a
	 *  glyph, the name, what it is for, the unread badge and a chevron.
	 *  TestFlight 883 (Ola): the old quiet button was transparent `ink-muted` text
	 *  centred over a centred caption, and read as a subtitle, not a control. */
	return (
		/* `mb-2`: the "Your computers" header below must not crowd the card. */
		<View className="mb-2">
			<Pressable
				accessibilityRole={ROLE.button}
				/* Spoken as before ("Team Bridge · 2 unread"); the caption is the hint. */
				accessibilityLabel={t("mobile.team_bridge.navigation.entry", {
					count: unread,
				})}
				accessibilityHint={t("mobile.team_bridge.navigation.caption")}
				testID={CONTROL.teamBridgeNavigation}
				onPress={go}
			>
				{({ pressed }) => (
					<View
						className={navCardClasses({ pressed })}
						style={{ minHeight: NAV_CARD_MIN_HEIGHT }}
					>
						<View className={avatarClasses("sm")} aria-hidden>
							<MessagesSquare size={16} color={glyphInk} />
						</View>
						<View className="min-w-0 flex-1 gap-0.5">
							<Text className="text-label text-ink" numberOfLines={1}>
								{t("mobile.team_bridge.title")}
							</Text>
							<Text className="text-body-sm text-ink-muted">
								{t("mobile.team_bridge.navigation.caption")}
							</Text>
						</View>
						{unread > 0 ? (
							/* Hidden from assistive tech: the label already says the count. */
							<View aria-hidden>
								<Badge
									label={countLabel(unread)}
									scale={effectiveScale}
									tone="warning"
									emphasis
									mono
								/>
							</View>
						) : null}
						{rtl ? (
							<ChevronLeft size={18} color={chevronInk} aria-hidden />
						) : (
							<ChevronRight size={18} color={chevronInk} aria-hidden />
						)}
					</View>
				)}
			</Pressable>
		</View>
	);
}
