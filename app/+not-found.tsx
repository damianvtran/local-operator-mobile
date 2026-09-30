import { useRouter } from "expo-router";

import { CONTROL, EMPTY, SCREEN } from "@/ui/a11y";
import { EmptyState, Screen } from "@/ui/components";

/**
 * Any URL that matches no route: a stale deep link, a mistyped path, a
 * notification for a screen that no longer exists.
 *
 * Without this file Expo Router renders its own "Unmatched Route" screen, which
 * is off-brand in both themes (a fixed black ground, a very large white heading,
 * blue links, the raw URL) and, measured at 320 px, clips its heading 16 px on
 * each side. This one is the design system's, and it does what every empty state
 * here does: says what happened and names the way out.
 *
 * It deliberately does not echo the URL. A deep link can carry an identifier
 * the reader did not type, and the screen has nothing to do with it.
 *
 * `replace`, not `push`: Back from the destination should not return to a page
 * that does not exist. The destination is the session list, which is where the
 * app opens today; when the connection provider lands it decides between that
 * and the welcome screen, and this route sends people to `/` and lets it decide.
 */
export default function NotFound() {
	const router = useRouter();
	return (
		<Screen title="Page not found" testID={SCREEN.notFound}>
			<EmptyState
				headline="That page does not exist."
				next="Go back to your sessions to carry on."
				action={{
					label: "Back to sessions",
					onPress: () => router.replace("/"),
					testID: CONTROL.notFoundHome,
				}}
				testID={EMPTY.notFound}
			/>
		</Screen>
	);
}
