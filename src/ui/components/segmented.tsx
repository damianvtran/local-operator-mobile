import { Pressable, Text, View } from "react-native";

import { ROLE, state } from "@/ui/a11y";
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
	testID: string;
};

export const Segmented = <T extends string>({
	label,
	options,
	value,
	onChange,
	disabled = false,
	testID,
}: SegmentedProps<T>) => (
	<View
		className={segmentedTrackClasses}
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
					disabled={disabled}
					testID={option.testID}
					onPress={() => onChange(option.value)}
				>
					{({ pressed }) => (
						<View
							className={segmentedItemClasses({ selected, disabled, pressed })}
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
