import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import {
	TRACE_COLUMN_GAP_CLASS,
	TRACE_GLYPH_BOX_CLASS,
	TRACE_GLYPH_ROW_CLASS,
	TRACE_GLYPH_SLOT_CLASS,
	TRACE_PRESS_WASH_CLASS,
	TRACE_PRESSABLE_BESIDE_GLYPH_CLASS,
	TRACE_ROW_OUTER_CLASS,
	TRACE_TEXT_RAIL_INSET_CLASS,
} from "@/features/session/components/trace-rail";
import {
	groupAccessibleName,
	groupPhrases,
	type QuietGroup,
} from "@/features/session/turn-condensing";
import { quietGroupId, ROLE } from "@/ui/a11y";
import { useComposedDir } from "@/ui/direction";
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
	// A composed line (label + counts): state the page's base, never `auto` (Q2-1).
	const composedDir = useComposedDir();
	/* The press wash lives on the row holding the glyph AND the button
	 * (`TRACE_PRESS_WASH_CLASS`, `trace-rail.ts`), so it is lifted here. */
	const [pressed, setPressed] = useState(false);
	return (
		/* Glyph outside the pressable, baseline-aligned (`TRACE_GLYPH_ROW_CLASS`
		 * in `trace-rail.ts`): every text line the button owns starts on the
		 * 40 pt rail, so a wrapped bar keeps one rail under U-41. */
		<View className={TRACE_ROW_OUTER_CLASS}>
			<View
				className={cx(TRACE_GLYPH_ROW_CLASS, pressed && TRACE_PRESS_WASH_CLASS)}
			>
				<View
					className={TRACE_GLYPH_SLOT_CLASS}
					pointerEvents="none"
					aria-hidden
				>
					<Text
						className={cx(TRACE_GLYPH_BOX_CLASS, "text-ink-dim")}
						aria-hidden
					>
						↔
					</Text>
				</View>
				<Pressable
					testID={quietGroupId(groupKey)}
					accessibilityRole={ROLE.button}
					accessibilityLabel={groupAccessibleName(group)}
					accessibilityState={{ expanded: open }}
					onPress={() => onToggle(!open)}
					onPressIn={() => setPressed(true)}
					onPressOut={() => setPressed(false)}
					style={{ minHeight: TOUCH_FLOOR }}
					className={cx(TRACE_PRESSABLE_BESIDE_GLYPH_CLASS, "justify-center")}
				>
					<View
						className={cx(
							"flex-row items-start py-2",
							TRACE_TEXT_RAIL_INSET_CLASS,
							TRACE_COLUMN_GAP_CLASS,
						)}
					>
						<Text
							className="min-w-0 flex-1 text-trace text-ink-muted"
							{...composedDir}
						>
							{what}
							{details.length > 0 ? (
								/* Proportional, not `font-mono`: localized words (Q1-3 — the
								 * monospace stack breaks Urdu's cursive joins). */
								<Text className="text-meta text-ink-dim tabular-nums">
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
				</Pressable>
			</View>
		</View>
	);
};
