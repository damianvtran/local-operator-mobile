import type { ReactNode } from "react";
import { Text, View } from "react-native";
import type { ProfileCard } from "@/team-bridge/profile";
import { SURFACE } from "@/ui/a11y";
import { Badge } from "@/ui/components/badge";

/**
 * The card's body: only what `ProfileCard` carries, in the desktop's order
 * (local-operator-ui v0.44.0 `team-bridge-profile-card.tsx`): photo beside the
 * FULL name, then the job title, then the badge; then description and local
 * time. Split from the sheet, in a module that imports only kit primitives, so
 * the web-target render test can assert exactly what text reaches the screen
 * (`profile-details.test.ts`), pronouns included by absence.
 *
 * THE NAME IS HERE, NOT ONLY IN THE SHEET TITLE (design round 1, D1). The sheet
 * title is one line and truncates; a card that exists to say who someone is
 * must never cut their name. It wraps, and so does every other value: the
 * sheet body scrolls when the card is taller than the window.
 *
 * On an agent card the title, description and local time are the OWNER's, so
 * they sit under an "About {owner}" heading (D5) instead of reading as the
 * agent's own job title.
 */
export function ProfileDetails({
	card,
	photo,
	clock,
}: {
	card: ProfileCard;
	photo: ReactNode;
	/** The glyph that leads "Local time" (D4); a slot so this stays icon-free. */
	clock?: ReactNode;
}) {
	const details = (
		<>
			{card.description && (
				<Text className="text-body text-ink-muted">{card.description}</Text>
			)}
			{card.localTime && (
				<View className="flex-row items-center gap-2">
					{clock && (
						<View
							accessibilityElementsHidden
							importantForAccessibility="no-hide-descendants"
						>
							{clock}
						</View>
					)}
					<Text className="min-w-0 flex-1 text-meta text-ink-muted">
						Local time {card.localTime}
					</Text>
				</View>
			)}
		</>
	);
	return (
		<View className="gap-3 p-4">
			<View className="flex-row items-start gap-4">
				{photo}
				<View className="min-w-0 flex-1 items-start gap-1">
					<Text
						accessibilityRole="header"
						className="text-title text-ink"
						testID={SURFACE.teamBridgeProfileName}
					>
						{card.name}
					</Text>
					{!card.detailsLabel && card.title && (
						<Text className="text-body text-ink">{card.title}</Text>
					)}
					<Badge label={card.badge} />
					{card.owner && (
						<Text className="text-meta text-ink-muted">{card.owner}</Text>
					)}
				</View>
			</View>
			{card.detailsLabel
				? (card.title || card.description || card.localTime) && (
						<View className="gap-2">
							<Text accessibilityRole="header" className="text-label text-ink">
								{card.detailsLabel}
							</Text>
							{card.title && (
								<Text className="text-body text-ink">{card.title}</Text>
							)}
							{details}
						</View>
					)
				: details}
		</View>
	);
}
