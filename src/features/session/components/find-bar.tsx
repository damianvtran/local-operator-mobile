import { ChevronDown, ChevronUp, Search, X } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import { CONTROL, ROLE, SURFACE } from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { IconButton } from "@/ui/components";

/**
 * The find session's navigate bar: `n of m`, prev/next, close, pinned above
 * the composer while a hit is landed.
 *
 * This is the mode the phone has and the desktop does not: the desktop keeps
 * its results panel over the transcript, and a 320 pt column cannot show both,
 * so the phone splits the flow — the bar is what stays when the sheet closes,
 * and its count segment (`find-edit`) is the way back to the results with the
 * query intact. Prev/next wrap (the find-bar convention `find.ts` ports), so
 * overshooting costs one more press rather than a dead end.
 *
 * The count is `active + 1`, never `active`: the reader counts messages from
 * one, and `0 of 7` would read as "nothing found".
 */
export type FindBarProps = {
	/** The landed hit's index (>= 0 while the bar is up). */
	active: number;
	/** How many hits the current query has. */
	count: number;
	onEdit: () => void;
	onStep: (delta: 1 | -1) => void;
	onExit: () => void;
};

export const FindBar = ({
	active,
	count,
	onEdit,
	onStep,
	onExit,
}: FindBarProps) => {
	const ink = useTokenColor("ink-muted");
	return (
		<View
			testID={SURFACE.findBar}
			className="min-h-12 flex-row items-center gap-1 border-t border-hairline px-3"
		>
			{/* The edit segment is a full 48 pt target (`min-h-12`): it is the one
			 * way back to the results, and the turn bar's rule — the stricter
			 * platform of the two — is the house's answer for a control that
			 * matters. */}
			<Pressable
				testID={CONTROL.findEdit}
				accessibilityRole={ROLE.button}
				accessibilityLabel={`Message ${active + 1} of ${count}. Edit search.`}
				onPress={onEdit}
				className="min-h-12 flex-row items-center gap-1 pr-3"
			>
				<Search color={ink} size={16} />
				<Text className="text-body-sm text-ink tabular-nums">
					{active + 1} of {count}
				</Text>
			</Pressable>
			<View className="flex-1" />
			<IconButton
				accessibilityLabel="Previous match"
				testID={CONTROL.findPrev}
				onPress={() => onStep(-1)}
				icon={({ color, size }) => <ChevronUp color={color} size={size} />}
			/>
			<IconButton
				accessibilityLabel="Next match"
				testID={CONTROL.findNext}
				onPress={() => onStep(1)}
				icon={({ color, size }) => <ChevronDown color={color} size={size} />}
			/>
			<IconButton
				accessibilityLabel="Close search"
				testID={CONTROL.findClose}
				onPress={onExit}
				icon={({ color, size }) => <X color={color} size={size} />}
			/>
		</View>
	);
};
