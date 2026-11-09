import { Text, View } from "react-native";

import type { ComposedDirProps } from "@/ui/direction";

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
};

export const SectionHeader = ({
	label,
	testID,
	labelDir = {},
}: SectionHeaderProps) => {
	/* Widened to `object` for the reason `DirectionView` gives in
	 * `src/ui/direction.tsx`: `dir` is a react-native-web prop that React Native's
	 * `TextProps` does not declare, and a precise `{ dir }` type is rejected by
	 * TypeScript's weak-type check when it meets an all-optional prop type. */
	const web: object = labelDir;
	return (
		<View className="pb-1 pt-4" testID={testID}>
			<Text {...web} className="text-mono-label uppercase text-ink-dim">
				{label}
			</Text>
		</View>
	);
};
