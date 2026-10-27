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
	/** Filled accent/on-accent, for a count that must read against the page
	 *  rather than against a tinted badge (the desktop emphasis pill). */
	emphasis?: boolean;
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
	/** Rendered but not seen: a SPACER built from the badge's own metrics.
	 *
	 *  `opacity` on the badge ITSELF, not on a wrapper, because a wrapper would
	 *  leave the badge inside it a painted node the audit still judges — the
	 *  rail's mirrored count read as a colour-only status (U-03) exactly that way.
	 *  Nothing is announced either: the call site also hides the subtree. */
	hidden?: boolean;
};

export const Badge = ({
	label,
	tone = "neutral",
	emphasis = false,
	mono = false,
	testID,
	accessibilityLabel,
	hidden = false,
}: BadgeProps) => (
	<View
		className={`${
			emphasis
				? "self-start min-h-5 rounded-full border-0 bg-accent px-2 py-0.5"
				: badgeClasses(tone)
		}${hidden ? " opacity-0" : ""}`}
		testID={testID}
		accessible={accessibilityLabel !== undefined}
		accessibilityLabel={accessibilityLabel}
	>
		<Text
			/* THE LINE BOX FOLLOWS THE TYPE STEP, because a fixed one cannot. A pinned
			 *  `leading-4` (16 pt) held the two variants to one height at 100 %, but at
			 *  300 % text the digits are 33 pt on that 16 pt line and the ink ran 3.4 pt
			 *  above and 1.1 pt below the pill — the tops of the 9s effectively vanished
			 *  (design round 9, D25). `leading-none` lets each step carry its own line
			 *  box; the container's `min-h-5` keeps the 20 pt pill every existing caller
			 *  paints at 100 %, so the kit's own geometry is unchanged and only the
			 *  large-text case grows. */
			className={`leading-none ${mono ? "text-mono-label" : "text-meta"} ${emphasis ? "text-on-accent" : badgeInkClasses(tone)}`}
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
