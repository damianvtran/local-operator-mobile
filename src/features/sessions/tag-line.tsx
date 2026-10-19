import { useState } from "react";
import { Pressable, View } from "react-native";

import type { TagRef } from "@/contracts";
import { tagAnnouncement, tagLineFor } from "@/features/sessions/tags";
import { ROLE } from "@/ui/a11y";
import { Badge } from "@/ui/components/badge";
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
 * The line is present ONLY when the row has tags. An empty line is a blank gap
 * inserted into every untagged row's geometry, and absence is the honest state.
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

	if (tags.length === 0) return null;
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
			accessibilityLabel={tagAnnouncement(tags)}
			accessibilityHint={accessibilityHint}
			onPress={onPress}
			testID={actionTestID ?? testID}
		>
			{content}
		</Pressable>
	);
};
