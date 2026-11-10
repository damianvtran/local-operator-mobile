import { Pressable, Text, View } from "react-native";

import {
	TRACE_BAR_PAD_CLASS,
	TRACE_COLUMN_GAP_CLASS,
	TRACE_GLYPH_BOX_CLASS,
	TRACE_ROW_OUTER_CLASS,
} from "@/features/session/components/trace-rail";
import {
	groupAccessibleName,
	groupPhrases,
	type QuietGroup,
} from "@/features/session/turn-condensing";
import { quietGroupId, ROLE } from "@/ui/a11y";
import { TOUCH_FLOOR } from "@/ui/layout";
import { cx } from "@/ui/variants";

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
 *
 * The disclosure and its label identify the interaction, like an ordinary
 * tool trace. A receipt group is not a card: adding a filled, bordered box
 * makes background coordination louder than the conversation it belongs to.
 * Keep the full touch target and expanded accessibility state without that box.
 */
export type QuietGroupBarProps = {
	/** The group's `qg:<first row id>` — the stable key the latch and the
	 *  reader's expansion are held by, and the bar's identifier. */
	groupKey: string;
	group: QuietGroup;
	open: boolean;
	onToggle: (open: boolean) => void;
};

const unbreakable = (detail: string): string => detail.replace(/ /g, "\u00A0");

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
		<View className={TRACE_ROW_OUTER_CLASS}>
			<Pressable
				testID={quietGroupId(groupKey)}
				accessibilityRole={ROLE.button}
				accessibilityLabel={groupAccessibleName(group)}
				accessibilityState={{ expanded: open }}
				onPress={() => onToggle(!open)}
				style={{ minHeight: TOUCH_FLOOR }}
				className="justify-center"
			>
				{({ pressed }) => (
					<View
						className={cx(
							"flex-row items-start py-2",
							pressed && "bg-row-hover",
							TRACE_BAR_PAD_CLASS,
							TRACE_COLUMN_GAP_CLASS,
						)}
					>
						<Text
							className={cx(TRACE_GLYPH_BOX_CLASS, "text-ink-dim")}
							aria-hidden
						>
							↔
						</Text>
						<Text className="min-w-0 flex-1 text-trace text-ink-muted">
							{what}
							{details.length > 0 ? (
								<Text className="font-mono text-mono-sm text-ink-dim tabular-nums">
									{` · ${details.map(unbreakable).join(" · ")}`}
								</Text>
							) : null}
						</Text>
						<Text className="text-trace" aria-hidden>
							<Text className="font-mono text-mono-sm text-ink-dim">
								{open ? "▾" : "▸"}
							</Text>
						</Text>
					</View>
				)}
			</Pressable>
		</View>
	);
};
