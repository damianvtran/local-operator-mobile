import { useEffect } from "react";
import {
	AccessibilityInfo,
	Pressable,
	Text,
	useWindowDimensions,
} from "react-native";

import { TRANSCRIPT_FADE_PT } from "@/features/session/transcript-presence";
import { t } from "@/i18n";
import { CONTROL, ROLE } from "@/ui/a11y";
import { TOUCH_FLOOR } from "@/ui/layout";
import { useTextScale } from "@/ui/text-scale-provider";

/**
 * "Jump to latest": the way back to the end that a reader who scrolled up is
 * offered INSTEAD of being yanked there (operator, 2026-11-21).
 *
 * It is an overlay, not a row: absolute inside the transcript's own viewport,
 * above the bottom edge fade's 24 pt band, so showing or hiding it never
 * changes the space the rows get. Its own box is the only thing it occupies —
 * no full-width rail — so nothing under or beside it loses a tap.
 *
 * Below 360 pt the readable label no longer fits beside a row's own text
 * without crowding it, so the visible label shortens to "Latest". The width
 * that decides is the width the TEXT gets, so it is divided by the font scale
 * (design round 1, D2): at 200 % text a 390 pt phone shows the full sentence
 * across a whole row and buries the turn header's trailing counter. The
 * ACCESSIBLE name is always the full sentence: a screen reader has no width,
 * and it is a separate key because the visible strings carry the "↓" glyph,
 * which a reader would hear as "down arrow" (QA/design/UX round 1, Q3).
 */

/** The width below which the full label gives way (the 320 pt phone class). */
export const JUMP_CHIP_NARROW_PT = 360;
/**
 * The shortest transcript viewport that can hold the chip AND the fade band
 * under it (design round 1, D1). A compact-landscape phone leaves the transcript
 * a strip a few points tall; anchored to its bottom edge the chip then spills
 * ABOVE the transcript and covers the activity-summary row (measured: U-08 FAIL,
 * 116×27 pt at 100 %, 205×29 pt at 200 %). Below this height there is no room
 * for an overlay at all, so the chip is not offered — the layout that shrinks
 * the transcript is the one that gives the reader another way to its end.
 */
export const JUMP_CHIP_MIN_VIEWPORT_PT =
	TOUCH_FLOOR + TRANSCRIPT_FADE_PT + 2 * 8;
/** Gap from the viewport edge; also the gap above the fade band. */
const CHIP_EDGE_PT = 8;

export const JumpToLatestChip = ({
	onPress,
	viewportPt,
}: {
	onPress: () => void;
	/** The transcript viewport's own height: the space this overlay may use. */
	viewportPt: number;
}) => {
	const { width } = useWindowDimensions();
	/* The width the text actually gets, so large text falls back to the short
	 * label before it has to be clipped or to cover a row's trailing control. The
	 * scale is the app's own resolved one, not `useWindowDimensions().fontScale`:
	 * that is a constant 1 on web, where the scale arrives as the root font size
	 * (`text-scale-provider.tsx`). */
	const { effectiveScale } = useTextScale();
	const narrow =
		width / (effectiveScale > 0 ? effectiveScale : 1) < JUMP_CHIP_NARROW_PT;
	const shown = viewportPt >= JUMP_CHIP_MIN_VIEWPORT_PT;
	/* THE ARRIVAL IS SAID (UX round 1, U2). A VoiceOver reader who left the end
	 * hears nothing when output lands below them — the chip appearing is a
	 * visual event only. Announcing on the appearance (never on a mount that has
	 * no chip to show) is the same "say the change" rule `session-health.tsx`
	 * follows; its words are this control's accessible name, so nothing new has
	 * to be translated for it. */
	useEffect(() => {
		if (!shown) return;
		AccessibilityInfo.announceForAccessibility(
			t("mobile.session.jump_to_latest_name"),
		);
	}, [shown]);
	if (!shown) return null;
	return (
		<Pressable
			accessibilityRole={ROLE.button}
			accessibilityLabel={t("mobile.session.jump_to_latest_name")}
			onPress={onPress}
			testID={CONTROL.transcriptJumpToLatest}
			className="absolute items-center justify-center rounded-full border border-border-control bg-elevated px-3"
			/* `end`, not `right`: the chip belongs on the reading order's trailing
			 * edge, and the physical-edge guard is what keeps that true in RTL. It is
			 * painted above the list it is declared before (reading order first, tab
			 * stop first — UX U2) and above the fades. */
			style={{
				end: CHIP_EDGE_PT,
				bottom: TRANSCRIPT_FADE_PT + CHIP_EDGE_PT,
				minHeight: TOUCH_FLOOR,
				zIndex: 1,
			}}
		>
			<Text className="text-meta text-ink" numberOfLines={1}>
				{narrow
					? t("mobile.session.jump_to_latest_short")
					: t("mobile.session.jump_to_latest")}
			</Text>
		</Pressable>
	);
};
