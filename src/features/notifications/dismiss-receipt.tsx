import { View } from "react-native";

import { CONTROL, SURFACE } from "@/ui/a11y";
import { Alert } from "@/ui/components/alert";
import { Button } from "@/ui/components/button";

import { UNDO_LABEL } from "./conversation-dismiss";
import { dismissReceiptShowing } from "./notifications-model";
import type { ConversationDismiss } from "./use-conversation-dismiss";

/** What the last dismiss-all (or its Undo) actually did, with Undo while it can
 *  still name what changed. Shared by the detail and the list. */
export function DismissReceipt({
	dismissAll,
}: {
	dismissAll: ConversationDismiss;
}) {
	const { phase } = dismissAll;
	/* The rule the list's footer also reads, so the footer is occupied exactly
	 *  when this draws (code review m1). */
	if (!dismissReceiptShowing(phase)) return null;
	/* A multi-page walk takes seconds on a large conversation. The row's rotor
	 *  action has no other surface, so it says what it is doing rather than
	 *  looking inert (code review n4). */
	if (phase.kind === "counting") {
		return (
			<View className="gap-2" testID={SURFACE.inboxDismissAllReceipt}>
				<Alert severity="info">{`Counting ${phase.title}'s updates…`}</Alert>
			</View>
		);
	}
	/* A COMPLETED dismissal is a success, not a neutral note (design review D6:
	 *  `info`'s leading glyph is "·", which in the frame reads as a stray bullet
	 *  before the sentence). A partial one is a warning, a failure an error. */
	const severity =
		phase.kind === "failed"
			? "error"
			: (phase.kind === "done" || phase.kind === "undone") && !phase.complete
				? "warning"
				: "success";
	return (
		<View className="gap-2" testID={SURFACE.inboxDismissAllReceipt}>
			<Alert severity={severity}>{phase.sentence}</Alert>
			{phase.kind === "done" && phase.receipt.changed.length > 0 ? (
				<Button
					label={UNDO_LABEL}
					onPress={() => void dismissAll.undo()}
					variant="outline"
					size="sm"
					testID={CONTROL.inboxDismissAllUndo}
				/>
			) : null}
		</View>
	);
}
