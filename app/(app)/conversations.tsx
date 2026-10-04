import { useLocalSearchParams } from "expo-router";
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
 *
 * **`notice` is how the one sentence arrives.** The pane renders it under the
 * panel's header (`SURFACE.sidebarNotice`, `conversations-pane.tsx`), and
 * nothing can pass a notice unless the route reads one — the review round 1
 * finding (M1) was exactly that gap: an accessibility claim and no carrier. A
 * deep-link resolver (or any future caller) lands here with
 * `?notice=<sentence>`.
 */
export default function ConversationsRoute() {
	const params = useLocalSearchParams<{ notice?: string | string[] }>();
	const notice =
		typeof params.notice === "string" && params.notice.length > 0
			? params.notice
			: null;
	return (
		<View className="flex-1" testID={SCREEN.sessions}>
			<Home forcePanelOpen notice={notice} />
		</View>
	);
}
