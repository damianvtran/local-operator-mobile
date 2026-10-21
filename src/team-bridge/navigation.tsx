/**
 * A hub destination, not a relay capability. Always available as a gate even
 * before a computer is chosen; hiding it on a sleeping laptop defeats the
 * hub-only architecture. The same entry lives in the drawer and computer picker.
 */
import { useRouter } from "expo-router";
import { Text, View } from "react-native";
import { useTeamBridgeState } from "@/team-bridge/provider";
import { Button } from "@/ui/components/button";

export function TeamBridgeEntry({ onNavigate }: { onNavigate?: () => void }) {
	const router = useRouter();
	const unread = useTeamBridgeState((s) => s.totalUnread);
	return (
		<View className="gap-1">
			<Button
				label={unread > 0 ? `Team Bridge · ${unread} unread` : "Team Bridge"}
				variant="quiet"
				size="sm"
				testID="team-bridge-navigation"
				onPress={() => {
					onNavigate?.();
					router.push("/team-bridge" as never);
				}}
			/>
			<Text className="text-meta text-center text-ink-dim">
				Your organization, even with your computer asleep
			</Text>
		</View>
	);
}
