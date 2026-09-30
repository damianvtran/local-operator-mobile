import type { ReactNode } from "react";
import { View } from "react-native";

import { CONTROL } from "@/ui/a11y";
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
				/* `alignSelf` is deliberately ALWAYS `stretch`, and the centring is done
				 *  with auto margins instead. In a ROW the cross axis is vertical, so
				 *  `alignSelf: "center"` stops the column inheriting a height — the
				 *  column collapsed to content height, the transcript's list then
				 *  measured an unbounded viewport and mounted 524 rows of 520 (measured:
				 *  5,606 DOM elements against 614 on a phone, and no screenshot can tell
				 *  524 rows from 51). Auto margins centre horizontally in a column and are
				 *  a no-op in a row, which is exactly the behaviour wanted. */
				alignSelf: "stretch",
				width: "100%",
				maxWidth: cap ?? undefined,
				marginLeft: "auto",
				marginRight: "auto",
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
	/** Which side the fixed pane sits on. A list-detail screen wants it FIRST (the
	 *  default): the navigation before the thing it navigates. A panels rail is a
	 *  TRAILING pane — rendering it first would put the panels to the LEFT of the
	 *  conversation they describe. */
	paneSide?: "start" | "end";
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
	paneSide = "start",
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
	/* `flexGrow: 0, flexShrink: 0` on the fixed pane is load-bearing, not tidiness:
	 *  react-native-web gives every `ScrollView` `flexGrow: 1`, so a rail that only
	 *  declared a width took a flex SHARE — measured 833 pt of rail beside a 533 pt
	 *  transcript in a 1366 pt window (the intended rail is 320). */
	const pane = (
		<View
			className={
				paneSide === "end"
					? "border-l border-hairline"
					: "border-r border-hairline"
			}
			style={{ width: paneWidth, flexGrow: 0, flexShrink: 0 }}
			testID={
				paneSide === "end" ? CONTROL.splitPaneEnd : CONTROL.splitPaneStart
			}
		>
			{list}
		</View>
	);
	const body = (
		<View className="flex-1" testID={CONTROL.splitBody}>
			{detail ?? emptyDetail}
		</View>
	);
	return (
		<View className="flex-1 flex-row" testID={testID}>
			{paneSide === "end" ? body : pane}
			{paneSide === "end" ? pane : body}
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
