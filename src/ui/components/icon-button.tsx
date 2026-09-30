import type { ReactNode } from "react";
import { Pressable, View } from "react-native";

import { ROLE, state } from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { TOUCH_FLOOR } from "@/ui/layout";
import { iconButtonClasses } from "@/ui/variants";

/**
 * An icon-only control: same 44×44 box as `Button` size `icon`, transparent fill,
 * `ink-muted` ink (docs/design/components.md § 3).
 *
 * `accessibilityLabel` is REQUIRED and cannot be derived — a glyph has no text.
 * Making it optional is how the app ends up with an unlabelled control, which is
 * anti-pattern 8 and also means Maestro cannot see it.
 *
 * The icon never receives the pointer: a press that lands on the glyph has to
 * resolve to the button, so the glyph sits in a `pointerEvents="none"` wrapper.
 */
export type IconButtonProps = {
	accessibilityLabel: string;
	onPress: () => void;
	icon: (props: { color: string; size: number }) => ReactNode;
	/** Sizes are 12 / 14 / 16 / 20 / 24; 12 is the floor (§ 3). */
	size?: 12 | 14 | 16 | 20 | 24;
	disabled?: boolean;
	/** Adds `border-control` where the icon alone does not carry the affordance. */
	outlined?: boolean;
	accessibilityHint?: string;
	/** Optional: the control's own identifier is the fallback, so a screen
	 *  that does not name a control is still addressable. */
	testID: string;
};

export const IconButton = ({
	accessibilityLabel,
	onPress,
	icon,
	size = 20,
	disabled = false,
	outlined = false,
	accessibilityHint,
	testID,
}: IconButtonProps) => {
	const color = useTokenColor(disabled ? "ink-disabled" : "ink-muted");

	return (
		<Pressable
			accessibilityRole={ROLE.button}
			accessibilityLabel={accessibilityLabel}
			accessibilityHint={accessibilityHint}
			accessibilityState={state({ disabled })}
			disabled={disabled}
			testID={testID}
			onPress={onPress}
			/* On the PRESSABLE, not on its inner box: the audit measures the
			 * interactive element, and an icon button whose visual is 32 pt with a
			 * 44 pt child reported as a 32x32 button below the floor (a real FAIL, 36
			 * cells). The hit area is the thing that has to meet it. */
			style={{ minHeight: TOUCH_FLOOR, minWidth: TOUCH_FLOOR }}
		>
			{({ pressed }) => (
				<View
					className={iconButtonClasses({ pressed, disabled }, { outlined })}
				>
					<View pointerEvents="none">{icon({ color, size })}</View>
				</View>
			)}
		</Pressable>
	);
};
