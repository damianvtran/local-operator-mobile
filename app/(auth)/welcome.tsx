import { useRouter } from "expo-router";

import { CONTROL, SCREEN } from "@/ui/a11y";
import { EmptyState, Screen } from "@/ui/components";

/**
 * First run. The shell renders this route; the finished screen (the mark, the
 * one-line explanation of what runs where, and the two ways to connect) belongs
 * to the screens stream.
 */
export default function Welcome() {
	const router = useRouter();
	return (
		<Screen title="Local Operator" testID={SCREEN.welcome}>
			<EmptyState
				headline="This app controls the agent sessions running on your own computer."
				next="Sign in to find your computers, or point the app at a tunnel URL."
				action={{
					label: "Sign in",
					onPress: () => router.push("/sign-in"),
				}}
				testID={CONTROL.welcomeContinue}
			/>
		</Screen>
	);
}
