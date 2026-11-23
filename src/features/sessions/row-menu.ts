import { t } from "@/i18n";
import { CONTROL } from "@/ui/a11y";

export type RowMenuActionKey = "pin" | "move" | "tags" | "open";

export type RowMenuAction = {
	key: RowMenuActionKey;
	label: string;
	testID: string;
};

/**
 * The entries of a local conversation row's long-press menu, in order.
 *
 * An ACTION LIST, not a button stack: every entry is one row style and none is
 * the sheet's primary. Tapping the row already opens the conversation, so `Open`
 * is what the reader did NOT long-press for — it stays reachable (a keyboard or
 * switch reader who arrived here by accident needs a way on) but comes last,
 * after the row's own actions. The testIDs are the flows' and the capture
 * matrix's, unchanged; `sessionOpenCurrent` is the pin entry for history's sake.
 *
 * Tags appears only where the relay advertises the routes: an older relay has
 * no `/api/sessions/{id}/tags`, and a control that 404s is the dead-control
 * pattern the pane already rejects for move.
 */
export const rowMenuActions = ({
	pinned,
	tagsAssignable,
}: {
	pinned: boolean;
	tagsAssignable: boolean;
}): RowMenuAction[] => [
	{
		key: "pin",
		label: pinned
			? t("mobile.sidebar.menu.unpin")
			: t("mobile.sidebar.menu.pin"),
		testID: CONTROL.sessionOpenCurrent,
	},
	{
		key: "move",
		label: t("mobile.sidebar.menu.move"),
		testID: CONTROL.sessionMoveOpen,
	},
	...(tagsAssignable
		? [
				{
					key: "tags" as const,
					label: t("mobile.sidebar.menu.tags"),
					testID: CONTROL.sessionTagsAction,
				},
			]
		: []),
	{
		key: "open",
		label: t("mobile.sidebar.menu.open"),
		testID: CONTROL.sessionOpenPrevious,
	},
];
