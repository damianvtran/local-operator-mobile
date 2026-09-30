import type { ReactNode } from "react";
import { View } from "react-native";

import { SPLIT_PANE_WIDTH, TOUCH_FLOOR, useLayout } from "@/ui/layout";

/**
 * The two adaptive layout primitives, in one file because they are one decision
 * seen from two sides: how wide a line of content may be, and when a list and a
 * detail deserve to be side by side.
 *
 * They exist as primitives (not as per-screen styles) because two streams have to
 * agree: D2's session view sits inside the detail pane of `SplitView`, and a
 * screen that computed its own measure would disagree with the pane it is drawn
 * in — which is how a tablet ends up as a phone layout stretched across 1366 px.
 */

export type ReadableColumnProps = {
	children: ReactNode;
	/** Overrides the layout's own measure. Passing `null` means "full width", for a
	 *  pane that already constrains itself. */
	measure?: number | null;
	/** Extra bottom room, for a screen whose footer is measured separately. */
	paddingBottom?: number;
	testID?: string;
};

/**
 * A centred column with a readable measure.
 *
 * On a phone the measure IS the screen: this renders a plain flex container and
 * adds no margin, so nothing changes for the layout that most readers see. On a
 * tablet or a wide landscape window it caps the line length and centres the
 * column, because 1,300 pt of prose is not a layout — it is a defect with a lot
 * of white space in it.
 */
export const ReadableColumn = ({
	children,
	measure,
	paddingBottom,
	testID,
}: ReadableColumnProps) => {
	const layout = useLayout();
	const cap = measure === undefined ? layout.measure : measure;
	return (
		<View
			className="flex-1"
			testID={testID}
			style={{
				alignSelf: cap === null ? "stretch" : "center",
				width: "100%",
				maxWidth: cap ?? undefined,
				paddingBottom,
			}}
		>
			{children}
		</View>
	);
};

export type SplitViewProps = {
	/** The list side: a nav-like column of rows. Fixed width, always visible. */
	list: ReactNode;
	/** The detail side. `null` means nothing is selected yet, and the pane says so
	 *  rather than showing an empty screen. */
	detail: ReactNode | null;
	/** What the empty detail pane says. */
	emptyDetail: ReactNode;
	/** Width of the list pane. Defaults to `SPLIT_PANE_WIDTH`. */
	paneWidth?: number;
	testID?: string;
};

/**
 * Two panes on a screen with room for them; one pane everywhere else.
 *
 * The rule is `layout.split` — width AND height — and that matters: a landscape
 * phone (844x390) is wide and short, and two panes there are two slivers with the
 * keyboard covering a third of one. Below it this renders the list alone, which
 * is the navigation the phone already has, so a compact screen is untouched by
 * this component's existence.
 */
export const SplitView = ({
	list,
	detail,
	emptyDetail,
	paneWidth = SPLIT_PANE_WIDTH,
	testID,
}: SplitViewProps) => {
	const layout = useLayout();
	if (!layout.split) {
		return (
			<View className="flex-1" testID={testID}>
				{list}
			</View>
		);
	}
	return (
		<View className="flex-1 flex-row" testID={testID}>
			<View style={{ width: paneWidth }} className="border-r border-hairline">
				{list}
			</View>
			<View className="flex-1">{detail ?? emptyDetail}</View>
		</View>
	);
};

/** A pane's own header, so the two sides of a split share one geometry. */
export const PaneHeader = ({ children }: { children: ReactNode }) => (
	<View
		className="flex-row items-center gap-2 px-4"
		style={{ minHeight: TOUCH_FLOOR }}
	>
		{children}
	</View>
);
