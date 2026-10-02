import { Text, View } from "react-native";

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
 */
export type SectionHeaderProps = {
	label: string;
	testID?: string;
};

export const SectionHeader = ({ label, testID }: SectionHeaderProps) => (
	<View className="pb-1 pt-4" testID={testID}>
		<Text className="text-mono-label uppercase text-ink-dim">{label}</Text>
	</View>
);
