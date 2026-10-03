import { Text, View } from "react-native";

import { useTokenColor } from "@/ui/appearance";
import { BrandMark } from "@/ui/components/brand-mark";
import { Button } from "@/ui/components/button";
import { emptyStateClasses } from "@/ui/variants";

/**
 * The empty state (docs/design/components.md § 20).
 *
 * **Empty is not an error.** No warning colour, no apology, no marketing line:
 * the headline says what the screen is for, and the second line names the ACTION
 * the reader can take. The second line is required by the type, not optional by
 * convention — an empty state with no second line is a dead end, and the type is
 * where that rule is enforced.
 */
export type EmptyStateProps = {
	headline: string;
	/** The action the reader can take. Required: see the note above. */
	next: string;
	action?: {
		label: string;
		onPress: () => void;
		/** Needed when the action's own precondition can be false while the state is
		 *  rendered — a "Clear the search" offered with nothing to clear is a control
		 *  whose enabled state disagrees with its label. Callers pass the same predicate
		 *  they render the state on, so the two cannot drift. */
		disabled?: boolean;
		testID: string;
	};
	testID?: string;
};

export const EmptyState = ({
	headline,
	next,
	action,
	testID,
}: EmptyStateProps) => {
	const markColor = useTokenColor("ink-dim");
	return (
		<View className={emptyStateClasses} testID={testID}>
			<BrandMark size={48} color={markColor} />
			<Text className="text-center text-body text-ink-muted">{headline}</Text>
			<Text className="text-center text-body-sm text-ink-dim">{next}</Text>
			{action ? (
				<Button
					label={action.label}
					onPress={action.onPress}
					testID={action.testID}
					variant="outline"
					size="md"
					disabled={action.disabled ?? false}
				/>
			) : null}
		</View>
	);
};
