import { Text, View } from "react-native";

import { type ComposedDirProps, useDirection } from "@/ui/direction";

/**
 * A list section heading — Pinned · Active · Previous (`docs/ux/flows.md` § 5).
 *
 * The heading is a REGION, not a control: it carries an identifier because the
 * native flows assert that the sections exist, and a flow that taps a heading is
 * a flow testing the wrong thing.
 *
 * `mono-label` upper-case rather than a display step: the sections are a
 * sort order the relay chose, not a title the reader asked for, and giving them
 * `title` weight would put four titles on a list screen.
 *
 * A COMPOSED LABEL MUST STATE ITS DIRECTION. A heading that splices a translated
 * count to a fixed word (`Wakes · 5 شیڈول شدہ`) begins with a Latin character, so
 * react-native-web's `dir="auto"` lays the whole line out left-to-right under an
 * RTL page and the heading lands on the trailing edge. Such a caller passes
 * `labelDir` — `useComposedDir()` from `@/ui/direction` — while a single-script
 * label passes nothing, because `auto` is already right for it.
 */
export type SectionHeaderProps = {
	label: string;
	testID?: string;
	labelDir?: ComposedDirProps;
	/** A longer spoken name when the painted label is composed from data — the
	 *  tag groups' `{name} · {count}` — so a screen reader hears sentences
	 *  ("Research, 4 conversations") rather than a dot and a bare number. */
	accessibilityLabel?: string;
};

/** The label's classes. `ink-muted`, the kit's PANEL-HEADER ink (tokens.json
 *  § color.ink), not `ink-dim`: `ink-dim` is the caption ink, and an 11 pt
 *  upper-case mono label in it read fainter than the body text it heads (UX
 *  pass, settings). Exported so the Node test can pin the role it paints. */
export const SECTION_HEADER_LABEL_CLASS =
	"text-mono-label uppercase text-ink-muted";

export const SectionHeader = ({
	label,
	testID,
	labelDir = {},
	accessibilityLabel,
}: SectionHeaderProps) => {
	const direction = useDirection();
	/* Tracking separates Urdu's cursive joins. Limit the override to Arabic-script
	 * text on an RTL surface so Latin headings keep the kit's mono-label spacing.
	 * Merge rather than replace labelDir.style: native composed labels still need
	 * its writingDirection, while this inline value overrides the token on web. */
	const style =
		direction === "rtl" && /\p{Script=Arabic}/u.test(label)
			? [labelDir.style, { letterSpacing: 0 }]
			: labelDir.style;
	/* Widened to `object` for the reason `DirectionView` gives in
	 * `src/ui/direction.tsx`: `dir` is a react-native-web prop that React Native's
	 * `TextProps` does not declare, and a precise `{ dir }` type is rejected by
	 * TypeScript's weak-type check when it meets an all-optional prop type. */
	const web: object = labelDir;
	return (
		<View className="pb-1 pt-4" testID={testID}>
			<Text
				{...web}
				accessibilityLabel={accessibilityLabel}
				className={SECTION_HEADER_LABEL_CLASS}
				style={style}
			>
				{label}
			</Text>
		</View>
	);
};
