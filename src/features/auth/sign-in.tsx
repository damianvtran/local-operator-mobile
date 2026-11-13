import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import {
	useConnection,
	useConnectionState,
} from "@/features/auth/connection-provider";
import { leaveScreen } from "@/features/auth/leave-screen";
import { SignInPanel } from "@/features/auth/sign-in-panel";
import { t } from "@/i18n";
import { CONTROL, ROLE, SCREEN } from "@/ui/a11y";
import { BackButton } from "@/ui/components/back-button";
import { Button } from "@/ui/components/button";
import { Screen } from "@/ui/components/screen";
import { useComposedDir } from "@/ui/direction";
import { signInPresentation } from "./sign-in-presentation";

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
	/* `Radient …` leads the Urdu label, so `dir="auto"` would resolve it left-to-right
	 * on an RTL page (M3 S1 design D2); the button states the page's base. */
	const composedDir = useComposedDir();
	const {
		signInWithRadient,
		signInState,
		signInDiagnostics,
		restoredAccount,
		busy,
	} = useConnection();
	const routed = useConnectionState((state) => state.route !== null);
	const [initiated, setInitiated] = useState(false);
	const start = () => {
		setInitiated(true);
		void signInWithRadient();
	};
	const presentation = signInPresentation({
		initiated,
		restoredAccount,
		busy,
		routed,
		state: signInState,
	});
	/* Home when the sign-in opened the reader's computer, else Computers. */
	useEffect(() => {
		if (presentation.navigate) router.replace(presentation.destination);
	}, [presentation.navigate, presentation.destination, router]);

	return (
		<Screen
			title={t("mobile.signin.title")}
			testID={SCREEN.signIn}
			headerLeading={
				<BackButton
					testID={CONTROL.signInBack}
					onPress={() => leaveScreen(router)}
				/>
			}
		>
			<View className="gap-4 pt-2">
				<Text
					className="text-body text-ink-muted"
					accessibilityRole={ROLE.text}
				>
					{t("mobile.signin.intro")}
				</Text>

				<SignInPanel
					state={presentation.state}
					diagnostics={signInDiagnostics}
					onStart={start}
					onUseAddress={() => undefined}
				/>

				{presentation.state.kind === "idle" ? (
					<Button
						label={t("mobile.signin.start")}
						labelDir={composedDir}
						onPress={start}
						loading={busy}
						testID={CONTROL.signInStart}
					/>
				) : null}

				<Button
					label={t("mobile.signin.use_address")}
					onPress={() => router.push("/custom")}
					variant="quiet"
					testID={CONTROL.welcomeCustomUrl}
				/>
			</View>
		</Screen>
	);
}
