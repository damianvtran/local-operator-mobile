import { View } from "react-native";

import Home from "@/features/home/home";
import { SCREEN } from "@/ui/a11y";

/**
 * The conversations panel's route: the home with the panel open, and the
 * destination ADR 0006 § 6.6 names for a deep link that resolves to nothing —
 * "land on the conversations sidebar with one honest sentence" and no error
 * state.
 *
 * The panel is not a separate screen (it is an overlay over the composer), so
 * this route renders the SAME home with `forcePanelOpen`, and carries
 * `SCREEN.sessions` on its wrapper: the sessions surface's route/root is here
 * now, and the audit's screen table moved with it.
 */
export default function ConversationsRoute() {
	return (
		<View className="flex-1" testID={SCREEN.sessions}>
			<Home forcePanelOpen />
		</View>
	);
}
