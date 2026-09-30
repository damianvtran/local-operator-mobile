import { EMPTY, SCREEN } from "@/ui/a11y";
import { EmptyState, Screen } from "@/ui/components";

/**
 * Radient sign-in. No action control yet on purpose: the flow runs in the system
 * browser through the connection layer, and a button that does nothing is worse
 * than an absent one.
 */
export default function SignIn() {
	return (
		<Screen title="Sign in" testID={SCREEN.signIn}>
			<EmptyState
				headline="Sign in with Radient."
				next="Your browser finishes the sign-in, so the app never sees your password."
				testID={EMPTY.signIn}
			/>
		</Screen>
	);
}
