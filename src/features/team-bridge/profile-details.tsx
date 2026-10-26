import type { ReactNode } from "react";
import { Text, View } from "react-native";
import type { ProfileCard } from "@/team-bridge/profile";
import { Badge } from "@/ui/components/badge";

/**
 * The card's body: only what `ProfileCard` carries, in reading order. Split
 * from the sheet, in a module that imports only kit primitives, so the
 * web-target render test can assert exactly what text
 * reaches the screen (`profile-details.test.ts`), pronouns included by absence.
 * The name is the sheet's title, so it is not repeated here.
 */
export function ProfileDetails({
	card,
	photo,
}: {
	card: ProfileCard;
	photo: ReactNode;
}) {
	return (
		<View className="gap-3 p-4">
			<View className="flex-row items-center gap-4">
				{photo}
				<View className="min-w-0 flex-1 items-start gap-1">
					<Badge label={card.badge} />
					{card.owner && (
						<Text className="text-meta text-ink-muted">{card.owner}</Text>
					)}
				</View>
			</View>
			{card.title && <Text className="text-body text-ink">{card.title}</Text>}
			{card.description && (
				<Text className="text-body text-ink-muted">{card.description}</Text>
			)}
			{card.localTime && (
				<Text className="text-meta text-ink-muted">
					Local time {card.localTime}
				</Text>
			)}
		</View>
	);
}
