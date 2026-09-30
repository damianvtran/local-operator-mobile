import { Text, View } from "react-native";

import {
	badgeClasses,
	badgeInkClasses,
	type SemanticTone,
} from "@/ui/variants";

/**
 * A badge: static, never interactive (docs/design/components.md § 6).
 *
 * The rule is not stylistic. A badge's border against its own fill does not meet
 * the 3:1 non-text floor, which is legal only because a static badge is resolved
 * against the PAGE rather than against its own ground. Making one a control would
 * turn that pair into a requirement it fails.
 *
 * A badge carries a word or a count, so it is `meta` type by default; pass
 * `mono` for machine words (a version string, an id).
 */
export type BadgeProps = {
	label: string;
	tone?: SemanticTone;
	/** `mono-label` for an uppercase machine string, so the machine voice is
	 * consistent with every other machine string in the app. */
	mono?: boolean;
	testID?: string;
};

export const Badge = ({
	label,
	tone = "neutral",
	mono = false,
	testID,
}: BadgeProps) => (
	<View className={badgeClasses(tone)} testID={testID}>
		<Text
			// `leading-4` on BOTH variants, because the two steps' own line heights
			// differ by 3.6 px and the kit caps a badge at 22: the label box has to be
			// bound once (16 px) for the mono and the sans badge to be the same height.
			className={`leading-4 ${mono ? "text-mono-label uppercase" : "text-meta"} ${badgeInkClasses(tone)}`}
		>
			{label}
		</Text>
	</View>
);
