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
	/**
	 * The name a screen reader reads, when the visible text is an abbreviation or a
	 * state rather than the thing itself. Defaults to `label` — that was the whole
	 * contract until a chip whose text is `n/a` was announced as "n/a", which names
	 * neither the field nor the reason (design round 2, D14).
	 */
	accessibilityLabel?: string;
	accessibilityHint?: string;
	leadingIcon?: ReactNode;
	/** Paint the chip as a quiet disclosure on an existing surface: no fill and no
	 *  visible border at rest, states only. For a chip that lives ON a tonal panel
	 *  (the composer), where the default pill would be a box inside a box. The
	 *  target geometry is unchanged — quiet is a paint decision, never a smaller
	 *  thumb target. */
	quiet?: boolean;
	/** Let a narrow toolbar shrink the chip instead of painting over its neighbours. */
	shrink?: boolean;
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
	quiet = false,
	shrink = false,
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
		/* The CAP must sit on the flex item itself (the Pressable), because a
		 *  `max-width: 100%` inside it resolves against the button's own
		 *  shrink-to-fit box — 100 % of 205 px is 205 px, which changed nothing and
		 *  the chip still painted over the stop and send buttons (U-08, measured
		 *  48x41 at 320 pt / 200 %). On the item, 100 % is the receipt's width. */
		style={shrink ? { maxWidth: "100%" } : undefined}
	>
		{({ pressed }) => (
			<View
				className={`${chipClasses({ selected, disabled, pressed }, { quiet })}${shrink ? " min-w-0 max-w-full overflow-hidden" : ""}`}
				/* Same rule as the fields and the Button: the floor is real geometry,
				 *  per platform, and the audit reads the box. BOTH axes: a chip sized to
				 *  its label measured 33.2×48 pt for a lone `~` — a thumb target under
				 *  the floor the control's own contract claims (design D4/D3). */
				/* `shrink` is for a chip in a narrow toolbar: without it the label's
				 *  min-content width wins over the flex line, the chip paints OUTSIDE its
				 *  row box and lands on the controls beside it (U-08: a model chip drawn
				 *  over the stop button at 320 pt / 135 %). The floor stays, the label
				 *  ellipsizes, and the full value is still the accessible name. */
				style={{
					minHeight: TOUCH_FLOOR,
					minWidth: TOUCH_FLOOR,
					...(shrink ? { maxWidth: "100%" as const } : {}),
				}}
			>
				{leadingIcon ? <View pointerEvents="none">{leadingIcon}</View> : null}
				<Text
					className={`text-mono-sm ${chipLabelClasses({ selected, disabled })}${shrink ? " min-w-0 truncate" : ""}`}
					numberOfLines={shrink ? 1 : undefined}
					ellipsizeMode={shrink ? "tail" : undefined}
				>
					{label}
				</Text>
			</View>
		)}
	</Pressable>
);
