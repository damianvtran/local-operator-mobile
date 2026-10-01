import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

import { ROLE, state } from "@/ui/a11y";
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
	/**
	 * The name a screen reader reads, when the visible text is an abbreviation or a
	 * state rather than the thing itself. Defaults to `label` — that was the whole
	 * contract until a chip whose text is `n/a` was announced as "n/a", which names
	 * neither the field nor the reason (design round 2, D14).
	 */
	accessibilityLabel?: string;
	accessibilityHint?: string;
	leadingIcon?: ReactNode;
	testID: string;
};

export const Chip = ({
	label,
	onPress,
	selected = false,
	disabled = false,
	accessibilityLabel,
	accessibilityHint,
	leadingIcon,
	testID,
}: ChipProps) => (
	<Pressable
		accessibilityRole={ROLE.button}
		accessibilityLabel={accessibilityLabel ?? label}
		accessibilityHint={accessibilityHint}
		accessibilityState={state({ selected, disabled })}
		disabled={disabled}
		testID={testID}
		onPress={onPress}
	>
		{({ pressed }) => (
			<View className={chipClasses({ selected, disabled, pressed })}>
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
