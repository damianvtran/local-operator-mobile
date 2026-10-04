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
	/** `mono-label` for a machine string (a version, an id), so the machine voice is
	 * the same as every other machine string here. The label's CASE is preserved:
	 * a badge that uppercased it rendered an identifier wrong (`v0.62.0` became
	 * `V0.62.0`), and case is part of what an identifier says. A word that should be
	 * upper case is the caller's copy to write that way. */
	mono?: boolean;
	testID?: string;
	/** The accessible name, for a badge whose label is only meaningful sighted
	 *  (a bare count). The label stays the rendering; this is what assistive
	 *  tech is told instead of the numeral. */
	accessibilityLabel?: string;
};

export const Badge = ({
	label,
	tone = "neutral",
	mono = false,
	testID,
	accessibilityLabel,
}: BadgeProps) => (
	<View
		className={badgeClasses(tone)}
		testID={testID}
		accessible={accessibilityLabel !== undefined}
		accessibilityLabel={accessibilityLabel}
	>
		<Text
			// `leading-4` on BOTH variants, because the two steps' own line heights
			// differ by 3.6 px and the kit caps a badge at 22: the label box has to be
			// bound once (16 px) for the mono and the sans badge to be the same height.
			className={`leading-4 ${mono ? "text-mono-label" : "text-meta"} ${badgeInkClasses(tone)}`}
			// When the call site names the badge, the visible label is a rendering of
			// that name, not a second name: hidden from assistive tech on every
			// platform (the same shape as `Avatar`'s initials).
			accessibilityElementsHidden={accessibilityLabel !== undefined}
			aria-hidden={accessibilityLabel !== undefined}
			importantForAccessibility={
				accessibilityLabel !== undefined ? "no" : "auto"
			}
		>
			{label}
		</Text>
	</View>
);
