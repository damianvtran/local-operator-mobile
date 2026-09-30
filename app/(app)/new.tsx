import { SCREEN } from "@/ui/a11y";
import { EmptyState, Screen } from "@/ui/components";

/**
 * New session (docs/ux/flows.md F-8). The directory picker reads the connected
 * computer's own list, so with no connection there is nothing to show and no
 * placeholder list to invent.
 */
export default function NewSession() {
	return (
		<Screen title="New session" testID={SCREEN.newSession}>
			<EmptyState
				headline="Choose where to run."
				next="The directory list comes from the computer you are connected to."
				testID="new-session-empty"
			/>
		</Screen>
	);
}
