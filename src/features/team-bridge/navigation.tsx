/**
 * A hub destination, not a relay capability. Always available as a gate even
 * before a computer is chosen; hiding it on a sleeping laptop defeats the
 * hub-only architecture. The same entry lives in the drawer and computer picker.
 */
import { useRouter } from "expo-router";
import { MessagesSquare } from "lucide-react-native";
import { Text, View } from "react-native";
import { countLabel } from "@/features/notifications/notifications-model";
import { t } from "@/i18n";
import { useTeamBridgeState } from "@/team-bridge/provider";
import { CONTROL } from "@/ui/a11y";
import { Badge } from "@/ui/components/badge";
import { Button } from "@/ui/components/button";
import { IconButton } from "@/ui/components/icon-button";
import { useTextScale } from "@/ui/text-scale-provider";

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
	return (
		<View className="gap-1">
			<Button
				label={t("mobile.team_bridge.navigation.entry", { count: unread })}
				variant="quiet"
				size="sm"
				testID={CONTROL.teamBridgeNavigation}
				onPress={go}
			/>
			<Text className="text-meta text-center text-ink-dim">
				{t("mobile.team_bridge.navigation.caption")}
			</Text>
		</View>
	);
}
