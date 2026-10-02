import { Pressable, Text, View } from "react-native";

import { ROLE, state } from "@/ui/a11y";
import { TOUCH_FLOOR } from "@/ui/layout";
import {
	segmentedItemClasses,
	segmentedLabelWeight,
	segmentedTrackClasses,
} from "@/ui/variants";

/**
 * A segmented control: choose ONE value from a small set (the theme preference,
 * the effort rung).
 *
 * Not a tab bar. Tabs switch VIEWS and move an indicator; a segmented control
 * picks a value and does not animate, because there is no position change to
 * read (docs/design/components.md § 11).
 *
 * Selection is never colour alone: the selected item also takes the heavier label
 * weight. An accent tint is close to a 1.0x luminance ratio against the track, so
 * for a low-vision reader the tint alone is not a difference.
 */
export type SegmentedOption<T extends string> = {
	value: T;
	label: string;
	/** The Maestro selector for this option, so a flow can press it by name. */
	testID: string;
};

export type SegmentedProps<T extends string> = {
	/** The group's accessible name — what is being chosen. */
	label: string;
	options: ReadonlyArray<SegmentedOption<T>>;
	value: T;
	onChange: (value: T) => void;
	disabled?: boolean;
	/** Optional: a screen that does not name the group is still addressable. */
	testID: string;
};

export const Segmented = <T extends string>({
	label,
	options,
	value,
	onChange,
	disabled = false,
	testID,
}: SegmentedProps<T>) => {
	/* The track WRAPS, and its options keep their natural width.
	 *
	 * Measured before this: at 200 % text every label on the Settings Appearance row
	 * truncated to a single character with an ellipsis — 7 of 7 labels on a 320 pt and
	 * a 390 pt phone, 5 of 7 at 150 % — because three EQUAL thirds cannot hold
	 * "System"/"Dark"/"Light" at double size. Nothing overflowed the viewport, so an
	 * overflow check cannot see it; the fix is geometry, not a scale query:
	 *
	 *  - `flex-wrap` on the track, so an option that no longer fits moves to its own
	 *    line instead of being squeezed into a truncated sliver;
	 *  - `grow shrink-0` on the option, so a label is never shrunk below its words
	 *    while `grow` still fills the track when there is room — which is what the
	 *    equal-width rule was there for (`flex-1` alone collapsed the options to their
	 *    labels: measured at 390, 191 px of labels in a 358 px track).
	 *
	 * No scale hook: the layout answers for itself at every size, and a control that
	 * asked how large the type is would break on the first platform whose answer
	 * differs.
	 */
	return (
		<View
			className={`${segmentedTrackClasses} flex-wrap`}
			accessibilityRole={ROLE.radiogroup}
			accessibilityLabel={label}
			testID={testID}
		>
			{options.map((option) => {
				const selected = option.value === value;
				return (
					<Pressable
						key={option.value}
						accessibilityRole={ROLE.radio}
						accessibilityLabel={option.label}
						accessibilityState={state({ selected, disabled })}
						// react-native-web does not read `accessibilityState`, so on the web
						// build a radio with only that had no checked state at all and a
						// screen reader could not tell which value was chosen (measured:
						// `aria-checked` was absent, before and after a click). `aria-checked`
						// is the ARIA state for role=radio; native ignores it in favour of the
						// state above, so the two are written together, not chosen between.
						aria-checked={selected}
						// `flex-1` belongs HERE, on the touchable, not on the pill inside it: the
						// touchable is the track's flex child, so a class on the inner view sizes
						// nothing and the options collapse to their labels, leaving the rest of
						// the well empty (measured at 390: 191 px of labels in a 358 px track).
						className="grow shrink-0"
						disabled={disabled}
						testID={option.testID}
						onPress={() => onChange(option.value)}
					>
						{({ pressed }) => (
							<View
								className={segmentedItemClasses({
									selected,
									disabled,
									pressed,
								})}
								/* The floor is real geometry, not slop: react-native-web has no
								 *  `hitSlop` on `Pressable`, so a track that reached the floor by
								 *  slop had none on the web build the audit measures (QA round 1
								 *  measured these segments at 44 pt where this build takes 48). */
								style={{ minHeight: TOUCH_FLOOR }}
							>
								<Text
									className={`text-label ${segmentedLabelWeight(selected)} ${
										disabled
											? "text-ink-disabled"
											: selected
												? "text-accent-active dark:text-accent-hover"
												: "text-ink-muted"
									}`}
									numberOfLines={1}
								>
									{option.label}
								</Text>
							</View>
						)}
					</Pressable>
				);
			})}
		</View>
	);
};
