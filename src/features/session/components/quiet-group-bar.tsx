import { Pressable, Text, View } from "react-native";

import {
	groupAccessibleName,
	groupPhrases,
	type QuietGroup,
} from "@/features/session/turn-condensing";
import { quietGroupId, ROLE } from "@/ui/a11y";

/**
 * The quiet group's bar: one row standing in for a run of delivery receipts.
 * `turn-condensing.ts`'s `groupPlan` owns every decision this renders — which
 * runs fold, what the bar says, and what freezes when the group closes — so
 * this file owns only the row, and the bar cannot disagree with the model
 * about the facts it states.
 *
 * **The glyph is the receipt's own.** The peer rows this bar stands for each
 * lead with "↔" (`transcript-row.tsx`); the bar leads with the same glyph, so
 * the fold reads as those rows collapsed rather than as a new kind of thing.
 *
 * **The target is 48 pt**, the same as the turn bar and for the same reason:
 * it is the only way back into a collapsed group, so it takes the stricter of
 * the platforms rather than a platform branch.
 */
export type QuietGroupBarProps = {
	/** The group's `qg:<first row id>` — the stable key the latch and the
	 *  reader's expansion are held by, and the bar's identifier. */
	groupKey: string;
	group: QuietGroup;
	open: boolean;
	onToggle: (open: boolean) => void;
};

export const QuietGroupBar = ({
	groupKey,
	group,
	open,
	onToggle,
}: QuietGroupBarProps) => {
	// The one copy function, shared with the tests: the first phrase is what
	// the fold is, the rest are its counts. Splitting here keeps the string
	// single-sourced rather than re-spelling "Peer messages" at the render
	// site — the turn bar's own split.
	const [what, ...details] = groupPhrases(group);
	return (
		<View className="px-3 py-1">
			<Pressable
				testID={quietGroupId(groupKey)}
				accessibilityRole={ROLE.button}
				accessibilityLabel={groupAccessibleName(group)}
				accessibilityState={{ expanded: open }}
				onPress={() => onToggle(!open)}
				className="min-h-12 flex-row items-center gap-1.5 rounded-sm border border-hairline bg-surface px-2.5"
			>
				<Text className="font-mono text-mono-sm text-ink-dim" aria-hidden>
					↔
				</Text>
				<Text className="min-w-0 flex-1 text-body-sm text-ink">
					{what}
					{details.length > 0 ? (
						<Text className="font-mono text-mono-sm text-ink-dim tabular-nums">
							{` · ${details.join(" · ")}`}
						</Text>
					) : null}
				</Text>
				<Text className="font-mono text-mono-sm text-ink-dim" aria-hidden>
					{open ? "▾" : "▸"}
				</Text>
			</Pressable>
		</View>
	);
};
