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
	/** The decorative brand mark. Default true. A caller inside a SHEET at
	 *  large text turns it off: the mark is the first thing to yield when the
	 *  surface is ~300 pt tall, and the sentence beneath it is the information
	 *  the state exists to deliver. */
	mark?: boolean;
	/** Inline rather than full-surface. A full-surface empty grows (`flex-1`)
	 *  and centres in the space it is given; inside a sheet's scrolling body
	 *  that space is the body, so the block floated to the middle and its second
	 *  line — the sentence a reader needs — sat under the fold at 200 %. The
	 *  compact form takes its own natural height, in reading order. */
	compact?: boolean;
};

export const EmptyState = ({
	headline,
	next,
	action,
	testID,
	mark = true,
	compact = false,
}: EmptyStateProps) => {
	const markColor = useTokenColor("ink-dim");
	return (
		<View
			className={compact ? "items-center gap-2 px-4 py-2" : emptyStateClasses}
			testID={testID}
		>
			{mark ? <BrandMark size={48} color={markColor} /> : null}
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
