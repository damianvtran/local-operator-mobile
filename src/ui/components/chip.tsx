import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

import { ROLE, state } from "@/ui/a11y";
import { TOUCH_FLOOR } from "@/ui/layout";
import { chipClasses, chipLabelClasses } from "@/ui/variants";

/**
 * A chip: interactive, and it opens something (docs/design/components.md § 6).
 *
 * The difference from a Badge is functional, not visual — a chip is a control, so
 * it meets the full 44pt target and its border is a structural pair that clears
 * 3:1. It carries a machine word (model, effort) and is therefore `mono-sm`.
 *
 * Its grounds are `canvas`, `surface` and `elevated` — never the row states: on a
 * selected row the dark selected chip has no resolvable edge at all, so a chip
 * belongs in a header or a sheet, not inside a row.
 */
export type ChipProps = {
	label: string;
	onPress: () => void;
	/** Selection is never colour alone; the chip is also announced as selected. */
	selected?: boolean;
	disabled?: boolean;
	accessibilityHint?: string;
	leadingIcon?: ReactNode;
	testID: string;
};

export const Chip = ({
	label,
	onPress,
	selected = false,
	disabled = false,
	accessibilityHint,
	leadingIcon,
	testID,
}: ChipProps) => (
	<Pressable
		accessibilityRole={ROLE.button}
		accessibilityLabel={label}
		accessibilityHint={accessibilityHint}
		accessibilityState={state({ selected, disabled })}
		disabled={disabled}
		testID={testID}
		onPress={onPress}
	>
		{({ pressed }) => (
			<View
				className={chipClasses({ selected, disabled, pressed })}
				/* Same rule as the fields and the Button: the floor is real geometry,
				 *  per platform, and the audit reads the box. */
				style={{ minHeight: TOUCH_FLOOR }}
			>
				{leadingIcon ? <View pointerEvents="none">{leadingIcon}</View> : null}
				<Text
					className={`text-mono-sm ${chipLabelClasses({ selected, disabled })}`}
				>
					{label}
				</Text>
			</View>
		)}
	</Pressable>
);
