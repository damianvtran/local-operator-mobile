import { useRouter } from "expo-router";
import { Text, View } from "react-native";

import { useConnection } from "@/features/auth/connection-provider";
import { SignInPanel } from "@/features/auth/sign-in-panel";
import { CONTROL, REGION, ROLE, SCREEN } from "@/ui/a11y";
import { Button } from "@/ui/components/button";
import { Screen } from "@/ui/components/screen";

/**
 * First run (docs/ux/flows.md § 1, F-1).
 *
 * One sentence about what runs where, and two ways in. Deliberately no feature
 * tour: the product reveals itself in the list, and three onboarding panels
 * delay the only thing the reader came for.
 *
 * **The Radient hand-off starts HERE rather than on a screen of its own.** The
 * system browser sheet is presented over this screen and dismissing it returns
 * here with the reader's place kept — which is what `e2e/maestro/flows/01-first-run-sign-in.yaml`
 * asserts by pressing `back` after the hand-off and expecting this screen's
 * second route (`welcome-custom-url`) to still be there. A redirect to a separate
 * sign-in route would make `back` land on a screen the reader never chose.
 * `(auth)/sign-in` still exists as a route: it is where a re-auth lands (C5) and
 * where a reader arriving from a notification is put.
 *
 * The two routes are not equal and are not presented as equal: signing in finds
 * the reader's computers on its own; an address and password is the escape hatch
 * for a machine Radient does not know about (F-3), so it is quieter and below.
 */
export default function Welcome() {
	const router = useRouter();
	const { signInWithRadient, signInState, busy } = useConnection();

	return (
		<Screen title="Local Operator" testID={SCREEN.welcome}>
			<View className="flex-1 justify-center gap-6 pb-12">
				<View className="items-center gap-4">
					<Text
						className="text-center text-title text-ink"
						accessibilityRole={ROLE.header}
						testID={REGION.welcomeHeadline}
					>
						Your agent runs on your computer.
					</Text>
					<Text className="text-center text-body text-ink-muted">
						This app drives the sessions on your own machine and shows what it
						did. Your code never leaves it.
					</Text>
				</View>

				<SignInPanel
					state={signInState}
					onStart={() => void signInWithRadient()}
					onUseAddress={() => undefined}
				/>

				{/* The two routes are hidden once the hand-off is running: offering a
				 * second route mid-flow is how a reader ends up in two of them. */}
				{signInState.kind === "idle" ? (
					<View className="gap-3">
						<Button
							label="Sign in with Radient"
							onPress={() => void signInWithRadient()}
							loading={busy}
							testID={CONTROL.welcomeConnect}
						/>
						{/* The first-run entry to the self-hosted path. It says what the
						 *  reader gets rather than what they must type: this is the door a
						 *  reader with no Radient account — and no intention of making one —
						 *  has to be able to find from the first screen. */}
						<Button
							label="Set up your own tunnel"
							onPress={() => router.push("/own-tunnel")}
							variant="quiet"
							testID={CONTROL.welcomeCustomUrl}
						/>
					</View>
				) : null}
			</View>
		</Screen>
	);
}
