import { ChevronDown } from "lucide-react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import type { TagRef } from "@/contracts";
import {
	tagAnnouncement,
	tagLineFor,
	tagLineTargetHeightDp,
} from "@/features/sessions/tags";
import { ROLE } from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { Badge } from "@/ui/components/badge";
import { TOUCH_FLOOR } from "@/ui/layout";
import { useTextScale } from "@/ui/text-scale-provider";

/**
 * The compact conversation-tag line: one row, at most two labels and a `+N` cue.
 *
 * WHAT IT IS NOT. It is not a chip row. `Chip` is a CONTROL and its own contract
 * bars it from a row ("a chip belongs in a header or a sheet, not inside a row"):
 * its border pair is a 3:1 requirement only because it is interactive. A tag on
 * a row is a fact, so it paints as a `Badge` — static, and resolved against the
 * page. All labels are equal in ink: the tokens carry no primary treatment, and
 * inventing a colour for "primary" would be a semantic this kit has not defined.
 *
 * WHY THE STRING IS FITTED HERE. `numberOfLines` clamps, but react-native-web
 * ignores `ellipsizeMode`, so a long name's surviving END would be the platform's
 * choice rather than this app's. `tagLineFor` decides the painted string against
 * the row's measured width (`onLayout`), the same measurement-not-second-copy
 * approach as `metaLineFor`. The `Badge` is then given only what already fits.
 *
 * The line is present ONLY when the row has tags OR the line is the header's
 * disclosure. An empty line is a blank gap inserted into every untagged row's
 * geometry, and absence is the honest state for a READ-ONLY row. The disclosure
 * is the exception (review round 2, U8): a local conversation with zero tags
 * still needs a visible route to the sheet, so the interactive form paints a
 * labelled `Tags` control and a chevron even when there is nothing to list. The
 * label is what separates the action from the read-only `Badge` rows around it —
 * a row of badges is a fact, a labelled control is a fact you can press.
 */
export type SessionTagLineProps = {
	tags: readonly TagRef[];
	/** The caller's identifier: the row, header or past-row family it belongs to. */
	testID: string;
	/**
	 * Present when this line OPENS the assignment sheet. The whole line becomes
	 * one button — the session header's disclosure — and the label/hint below are
	 * what make it discoverable: a row of badges with no role is a fact, not a
	 * control.
	 */
	onPress?: () => void;
	/** The control id for the interactive form (`CONTROL.sessionHeaderTagsAction`).
	 *  The inner line keeps `testID`, so the capture marker and the flow selector
	 *  are both addressable without a second paint. */
	actionTestID?: string;
	accessibilityHint?: string;
	/**
	 * Whether this line is its own accessibility element. Default true. A caller
	 * that folds the announcement into an enclosing row or button passes false,
	 * so the reader hears one sentence rather than the same tags twice.
	 */
	announce?: boolean;
};

export const SessionTagLine = ({
	tags,
	testID,
	onPress,
	actionTestID,
	accessibilityHint,
	announce = true,
}: SessionTagLineProps) => {
	const [width, setWidth] = useState(0);
	/* The rendered scale, matching the row's own type maths: the paint happens at
	 *  the platform's factor, so the fit must use the same one. */
	const { effectiveScale } = useTextScale();
	/* A fixed-size chevron, like every other icon in the kit: it marks the label
	 *  as a disclosure without riding the text scale out of its row. */
	const chevronInk = useTokenColor("ink-muted");

	/* Absent for a READ-ONLY line with no tags. The interactive form is the
	 *  header's always-present route, so it must survive an empty assignment. */
	if (tags.length === 0 && onPress === undefined) return null;
	const line = tagLineFor(tags, width, effectiveScale);

	const content = (
		<View
			className="flex-row items-center gap-1"
			onLayout={(event) => {
				const measured = event.nativeEvent.layout.width;
				if (measured !== width) setWidth(measured);
			}}
			/* The enclosing control owns the announcement when there is one; the
			 * badges are then a painting, not a second stop in the reader's path. */
			accessible={onPress === undefined && announce}
			accessibilityRole={onPress === undefined ? ROLE.text : undefined}
			accessibilityLabel={
				onPress === undefined && announce ? tagAnnouncement(tags) : undefined
			}
			testID={testID}
		>
			{line.labels.map((label, index) => (
				<Badge key={tags[index]?.id ?? String(index)} label={label} />
			))}
			{line.more > 0 ? <Badge label={`+${line.more}`} /> : null}
		</View>
	);

	if (onPress === undefined) return content;
	return (
		<Pressable
			accessibilityRole={ROLE.button}
			/* `Tags` alone when nothing is assigned: the label must not claim a
			 *  state the reader cannot see. With tags it is the existing sentence,
			 *  and the inner badges are hidden so the reader hears it once. */
			accessibilityLabel={tags.length > 0 ? tagAnnouncement(tags) : "Tags"}
			accessibilityHint={accessibilityHint}
			/* A REAL 44+ dp box, not `hitSlop`: the badges are 22 dp tall, and
			 *  react-native-web drops `Pressable` hitSlop, so the audit measures the
			 *  painted box. The inner row keeps its own geometry; the target grows
			 *  around it (review round 2, R2-3). `flex-start` keeps the label and the
			 *  pills at the leading edge while the box itself spans the header column. */
			style={{
				minHeight: tagLineTargetHeightDp(TOUCH_FLOOR),
				flexDirection: "row",
				alignItems: "center",
				justifyContent: "flex-start",
				gap: 4,
			}}
			onPress={onPress}
			testID={actionTestID ?? testID}
		>
			{/* The visible word is the disclosure's affordance (U8); a second
			 *  `Tags:` name on the inner line would be the duplicate announcement
			 *  this file already avoids for rows. */}
			<Text
				className="text-label font-semibold text-ink"
				aria-hidden
				accessibilityElementsHidden
			>
				Tags
			</Text>
			<ChevronDown size={14} strokeWidth={2.5} color={chevronInk} aria-hidden />
			{tags.length > 0 ? (
				/* The badges are the control's PAINTING, not a second stop: the
				 *  accessible name already carries every tag, so the inner line is
				 *  hidden from assistive tech on all three platforms (web, iOS,
				 *  Android). Without this the AX tree exposed `Research` and
				 *  `Work` as StaticText beside the button, which a reader could
				 *  meet twice (review round 2, U8). */
				<View
					className="min-w-0 flex-1"
					aria-hidden
					accessibilityElementsHidden
					importantForAccessibility="no-hide-descendants"
				>
					{content}
				</View>
			) : null}
		</Pressable>
	);
};
