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
	/** A cap on the message's lines, for the one configuration where the banner is
	 *  the scarce resource rather than an addition to a screen that has room: a
	 *  320 pt phone at the platform's large text. The list's own degraded banner is
	 *  78 characters and measured 260.56 pt there — most of the 356.81 pt band the
	 *  list lives in — so the state that most needs rows on screen showed NONE
	 *  (QA round 4, Q4-2). Unset everywhere else: a banner that truncates when it has
	 *  room is a banner that hides its own remedy. `numberOfLines` clamps the paint,
	 *  not the DOM, so a screen reader still reads the sentence whole. */
	maxLines?: number;
	testID: string;
};

export const Banner = ({
	tone,
	message,
	action,
	maxLines,
	testID,
}: BannerProps) => (
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
			<Text className="flex-1 text-body-sm text-ink" numberOfLines={maxLines}>
				{message}
			</Text>
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
