import { Text, View } from "react-native";

import { Button } from "@/ui/components/button";
import { bannerClasses, bannerGlyph, bannerInkClasses } from "@/ui/variants";

/**
 * The page's own status: a full-width banner at the top of a list when the relay
 * is unreachable (docs/design/components.md § 21).
 *
 * Two rules with teeth:
 *
 *   - **Exactly one action.** A banner with two actions is a screen, and the
 *     reader has to choose under time pressure.
 *   - **It dismisses on the first successful poll, never on a manual dismiss.**
 *     A dismiss control would let a reader hide a real failure and then wonder why
 *     nothing loads, so there is deliberately no dismiss prop: the banner goes
 *     away when the condition does.
 *
 * The copy states what happened and on whose machine ("Your computer can't be
 * reached"), never a status code alone (docs/ux/flows.md § 11).
 */
export type BannerProps = {
	tone: "danger" | "warning";
	message: string;
	action?: {
		label: string;
		onPress: () => void;
		loading?: boolean;
		testID: string;
	};
	testID?: string;
};

export const Banner = ({ tone, message, action, testID }: BannerProps) => (
	<View
		className={bannerClasses(tone)}
		testID={testID}
		accessibilityRole="alert"
		accessibilityLiveRegion="polite"
	>
		<View className="flex-1 flex-row items-start gap-2">
			<Text className={`text-mono ${bannerInkClasses(tone)}`} aria-hidden>
				{bannerGlyph(tone)}
			</Text>
			<Text className="flex-1 text-body-sm text-ink">{message}</Text>
		</View>
		{action ? (
			<Button
				label={action.label}
				onPress={action.onPress}
				testID={action.testID}
				loading={action.loading}
				variant="quiet"
				size="sm"
			/>
		) : null}
	</View>
);
