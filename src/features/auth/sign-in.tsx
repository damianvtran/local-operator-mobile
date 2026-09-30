import { useRouter } from "expo-router";
import { Text, View } from "react-native";

import { useConnection } from "@/features/auth/connection-provider";
import { SignInPanel } from "@/features/auth/sign-in-panel";
import { CONTROL, ROLE, SCREEN } from "@/ui/a11y";
import { Button } from "@/ui/components/button";
import { Screen } from "@/ui/components/screen";

/**
 * Radient sign-in as a screen of its own (docs/ux/flows.md § 1; `C5` re-auth).
 *
 * **This route ships with a control, and that is a fix rather than a detail.**
 * The scaffold's version rendered a headline and nothing else, which the audit
 * harness reported as eight `BLOCKED` rows: a frame with no interactive node
 * cannot be judged for touch targets, accessible names, or label-in-name, and
 * `tools/audit/checks.mjs` refuses to call "no interactive nodes" a pass. A
 * sign-in screen with no way to sign in is also, plainly, a dead end.
 *
 * It is used for re-authentication (`C5`: the edge answered 401 with
 * `X-Radient-Login`, or a refresh handle has lapsed) and by a reader who opens
 * the app straight to this route. First run goes through `welcome`, which runs
 * the same flow in place — both render the same panel, so the two cannot drift.
 */
export default function SignIn() {
	const router = useRouter();
	const { signInWithRadient, signInState, busy } = useConnection();

	return (
		<Screen
			title="Sign in"
			testID={SCREEN.signIn}
			headerLeading={
				<Button
					label="Back"
					onPress={() => router.back()}
					variant="quiet"
					size="sm"
				/>
			}
		>
			<View className="gap-4 pt-2">
				<Text
					className="text-body text-ink-muted"
					accessibilityRole={ROLE.text}
				>
					Your browser finishes the sign-in, so the app never sees your
					password.
				</Text>

				<SignInPanel
					state={signInState}
					onStart={() => void signInWithRadient()}
					onUseAddress={() => undefined}
				/>

				{signInState.kind === "idle" ? (
					<Button
						label="Sign in with Radient"
						onPress={() => void signInWithRadient()}
						loading={busy}
						testID={CONTROL.signInStart}
					/>
				) : null}

				<Button
					label="Use an address and password"
					onPress={() => router.push("/custom")}
					variant="quiet"
					testID={CONTROL.welcomeCustomUrl}
				/>
			</View>
		</Screen>
	);
}
