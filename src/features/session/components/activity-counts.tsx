import { Bot, Hourglass, ListChecks } from "lucide-react-native";
import { memo } from "react";
import { Pressable, Text, View } from "react-native";
import {
	ACTIVITY_GLYPH_PT,
	type ActivityCount,
	activityCountsLabel,
} from "@/features/session/activity-counts";
import { t } from "@/i18n";
import { CONTROL, ROLE } from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { TOUCH_FLOOR } from "@/ui/layout";

const GLYPH = {
	tasks: ListChecks,
	agents: Bot,
	queued: Hourglass,
} as const;

/**
 * The activity line's trailing counts (see `activity-counts.ts` for why they
 * are here and not on a band of their own). ONE target for all of them: each
 * pair is far under the touch floor, three adjacent 44 pt targets would not fit
 * the line, and all three open the same sheet anyway.
 *
 * Glyph + number rather than `3/5 tasks`: the words are what made the old strip
 * truncate at 320 pt and at 200 % text, and they would need a translation that
 * is as short in eight languages. The words are the accessible name instead.
 * Mono and `ink-muted`, the line's own face, so the counts read as part of the
 * status and not as a second control style beside it.
 *
 * Memoised with primitive-shaped props (`counts` is rebuilt by the screen only
 * when a number moves): the screen re-renders ~10x a second while a turn
 * streams, and this row has nothing to say about a text delta.
 */
const ActivityCountsImpl = ({
	counts,
	onOpen,
}: {
	counts: readonly ActivityCount[];
	onOpen: () => void;
}) => {
	const ink = useTokenColor("ink-muted");
	if (counts.length === 0) return null;
	return (
		<Pressable
			accessibilityRole={ROLE.button}
			accessibilityLabel={activityCountsLabel(counts)}
			accessibilityHint={t("mobile.session.status_tray.hint")}
			onPress={onOpen}
			testID={CONTROL.sessionActivityCounts}
			className="shrink-0 flex-row items-center gap-3"
			/* The floor as real geometry on both axes (react-native-web has no
			 *  `hitSlop`; the audit reads the box). */
			style={{ minHeight: TOUCH_FLOOR, minWidth: TOUCH_FLOOR }}
		>
			{counts.map((count) => {
				const Glyph = GLYPH[count.kind];
				return (
					<View key={count.kind} className="flex-row items-center gap-1">
						<Glyph size={ACTIVITY_GLYPH_PT} color={ink} aria-hidden />
						<Text className="font-mono text-mono-sm text-ink-muted tabular-nums">
							{count.text}
						</Text>
					</View>
				);
			})}
		</Pressable>
	);
};

export const ActivityCounts = memo(ActivityCountsImpl);
