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
	/** A cap on the message's lines, for a caller whose band is genuinely scarce.
	 *  The history is the list's own banner: at large text its 73–80 character
	 *  sentences (80 for `degraded: ["sessions"]`, the widest of the three)
	 *  measured 260.56 pt on a 320 pt phone — most of the 356.81 pt band the list
	 *  lives in — so the state that most needs rows on screen showed NONE (QA
	 *  round 4, Q4-2). Where the cap bites, the caller shortens the COPY rather
	 *  than accepting a truncation — the sentence it paints has to be one the
	 *  reader can act on (design round 5, D29) — and `numberOfLines` clamps the
	 *  paint rather than the DOM. The list no longer sets this cap: its large-text
	 *  copy was shortened to fit it, and the moment the drawer began to scale, the
	 *  2-line cap cut that short sentence ("Some rows may be …" at 200 %; U-04,
	 *  PR #34 review round 2) — so the SHORT sentence, painted whole, is the bound
	 *  now, and this prop stays for a caller with a truly scarce band and copy
	 *  sized to the cap. Unset everywhere else: a banner that truncates when it
	 *  has room is a banner that hides its own remedy. */
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
