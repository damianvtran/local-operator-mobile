import type { ReactNode } from "react";
import { Text } from "react-native";

/**
 * A heading with an explicit outline level.
 *
 * Every heading used to be `accessibilityRole="header"` alone, and on the web
 * build react-native-web renders a level-less heading as `<h1>`: a screen with a
 * title and two sections announced itself as three top-level headings, which
 * flattens the outline a screen-reader user navigates by. A level is therefore
 * REQUIRED rather than defaulted, so choosing one is a visible decision at each
 * call site.
 *
 * Level 1 is the screen title (one per screen, owned by `Screen`); 2 is a section
 * or an overlay's title (a sheet, a dialog); 3 sits inside a section.
 *
 * The typographic step is the caller's `className`, not the level: a level is
 * structure, and a dialog title is level 2 whatever size the kit gives it.
 *
 * `role="heading"` with `aria-level` is what react-native-web turns into `<hN>`.
 * Native maps `role` to the platform's heading trait; React Native has no native
 * heading-LEVEL channel, so on device the level is a no-op that is safe to pass.
 */
export type HeadingProps = {
	level: 1 | 2 | 3;
	className: string;
	children: ReactNode;
	numberOfLines?: number;
	testID?: string;
};

export const Heading = ({
	level,
	className,
	children,
	numberOfLines,
	testID,
}: HeadingProps) => (
	<Text
		role="heading"
		aria-level={level}
		className={className}
		numberOfLines={numberOfLines}
		testID={testID}
	>
		{children}
	</Text>
);
