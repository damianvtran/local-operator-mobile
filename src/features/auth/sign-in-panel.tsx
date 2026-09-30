import { useRouter } from "expo-router";
import { Text, View } from "react-native";

import { REGION } from "@/ui/a11y";
import { Button } from "@/ui/components/button";
import { Shimmer } from "@/ui/components/shimmer";

import type { SignInState } from "./radient-sign-in";

/**
 * What Radient sign-in looks like while it runs, and when it cannot.
 *
 * The states are `docs/ux/flows.md` § 1's (browser open / cancelled / callback
 * received / callback failed) plus the one the platform adds — a build that
 * cannot receive a loopback callback at all. Two rules are load-bearing:
 *
 *  1. **The hand-off region exists as soon as the flow starts.** The native flow
 *     asserts it, and more importantly a reader who taps "Sign in with Radient"
 *     must see that something is being attempted before a system sheet slides
 *     over the page: a sheet that appears with no prior state is a sheet from
 *     nowhere.
 *  2. **The unavailable state is actionable, never a spinner.** On a platform
 *     whose callback cannot come back, waiting is waiting for something that
 *     will not arrive. The panel says which module is missing and offers the
 *     route that works today.
 */
export const SignInPanel = ({
	state,
	onStart,
	onUseAddress,
	testID = "sign-in-panel",
}: {
	state: SignInState;
	onStart: () => void;
	onUseAddress: () => void;
	testID?: string;
}) => {
	const router = useRouter();
	const useAddress = () => {
		onUseAddress();
		router.push("/custom");
	};

	if (state.kind === "idle") return null;

	return (
		<View className="gap-3" testID={testID}>
			<View
				className="gap-1 rounded-sm border border-hairline bg-surface p-4"
				testID={REGION.signInHandoff}
				// The browser is another app, so this region is the only thing that
				// changes while the reader is away: announced so a screen-reader user is
				// not left waiting in silence.
				accessibilityLiveRegion="polite"
			>
				{state.kind === "starting" ? (
					<Shimmer active>
						<Text className="text-body text-ink">Opening your browser…</Text>
					</Shimmer>
				) : null}
				{state.kind === "waiting-for-browser" ? (
					<>
						<Text className="text-body text-ink">
							Waiting for your browser.
						</Text>
						<Text className="text-body-sm text-ink-muted">
							Finish signing in there, then come back to this app.
						</Text>
					</>
				) : null}
				{state.kind === "exchanging" ? (
					<Shimmer active>
						<Text className="text-body text-ink">Finishing sign-in…</Text>
					</Shimmer>
				) : null}
				{state.kind === "cancelled" ? (
					<>
						<Text className="text-body text-ink">Sign-in was cancelled.</Text>
						<Text className="text-body-sm text-ink-muted">
							Nothing was changed on your account.
						</Text>
					</>
				) : null}
				{state.kind === "unavailable" ? (
					<>
						<Text className="text-body text-ink">
							This build cannot finish a Radient sign-in.
						</Text>
						<Text className="text-body-sm text-ink-muted">{state.detail}</Text>
						<Text className="text-body-sm text-ink-muted">
							You can still connect with the relay's address and password.
						</Text>
					</>
				) : null}
				{state.kind === "failed" ? (
					<Text className="text-body text-ink">{state.detail}</Text>
				) : null}
			</View>

			{state.kind === "cancelled" || state.kind === "failed" ? (
				<Button label="Try again" onPress={onStart} variant="outline" />
			) : null}
			{state.kind === "unavailable" ? (
				<>
					<Button label="Use an address and password" onPress={useAddress} />
					<Button label="Try again anyway" onPress={onStart} variant="quiet" />
				</>
			) : null}
		</View>
	);
};
