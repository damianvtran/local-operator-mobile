import { useRouter } from "expo-router";
import { Settings } from "lucide-react-native";

import { CONTROL, EMPTY, SCREEN } from "@/ui/a11y";
import { EmptyState, IconButton, Screen } from "@/ui/components";

/**
 * Sessions. The list is genuinely empty in the shell: there is no connection, so
 * there is nothing to list and nothing is faked to look busy.
 *
 * The empty copy is the kit's own wording for this screen
 * (docs/design/components.md § 20): it names the action rather than apologising,
 * and it names the machine, because that is where the work would happen.
 */
export default function Sessions() {
	const router = useRouter();
	return (
		<Screen
			title="Sessions"
			testID={SCREEN.sessions}
			headerAction={
				<IconButton
					accessibilityLabel="Settings"
					testID={CONTROL.sessionsSettings}
					onPress={() => router.push("/settings")}
					icon={({ color, size }) => <Settings color={color} size={size} />}
				/>
			}
		>
			<EmptyState
				headline="No sessions yet."
				next="Start one from this app, or from the TUI on your machine."
				action={{
					label: "New session",
					onPress: () => router.push("/new"),
					testID: CONTROL.sessionsNew,
				}}
				testID={EMPTY.sessions}
			/>
		</Screen>
	);
}
