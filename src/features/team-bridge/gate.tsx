import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { type ReactNode, useState } from "react";
import { Platform, Text, View } from "react-native";
import { useConnection } from "@/features/auth/connection-provider";
import { useTeamBridge, useTeamBridgeState } from "@/team-bridge/provider";
import { CONTROL, SURFACE, teamBridgeGateId } from "@/ui/a11y";
import { Button } from "@/ui/components/button";
import { Screen } from "@/ui/components/screen";

export function BridgeBack() {
	const router = useRouter();
	return (
		<Button
			label="Back"
			variant="quiet"
			testID={CONTROL.teamBridgeBack}
			onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
		/>
	);
}

/** Admission wraps the entire surface: restricted accounts must not briefly see directory or composer chrome. */
export function BridgeGate({ children }: { children: ReactNode }) {
	const gate = useTeamBridgeState((s) => s.gate);
	const { actions } = useTeamBridge();
	const connection = useConnection();
	const [error, setError] = useState<string | null>(null);
	if (gate === "open") return children;
	const title =
		gate === "checking"
			? "Checking Team Bridge…"
			: gate === "signed_out"
				? "Sign in to Team Bridge"
				: gate === "update_required"
					? "Update required"
					: gate === "plan_required"
						? "Team Bridge requires a Radient Team plan"
						: "Team Bridge is unavailable";
	return (
		<Screen
			title="Team Bridge"
			headerLeading={<BridgeBack />}
			testID={teamBridgeGateId(gate)}
		>
			<View className="gap-5 px-4 py-6">
				<Text className="text-title text-ink" accessibilityRole="header">
					{title}
				</Text>
				{gate === "checking" && (
					<View
						accessibilityLabel="Loading Team Bridge"
						className="gap-3"
						testID={SURFACE.teamBridgeGateSkeleton}
					>
						<View className="h-6 rounded-sm bg-surface" />
						<View className="h-6 rounded-sm bg-surface" />
						<Text className="text-body text-ink-muted">
							Connecting to Radient. Your computer can stay closed.
						</Text>
					</View>
				)}
				{gate === "plan_required" && (
					<>
						<Text className="text-body text-ink">
							Communicate with your team members and their agents, and let
							agents collaborate with other agents in your organization.
						</Text>
						<Text className="text-body text-ink-muted">
							Channels for your organization · Direct messages · Chiefs of staff
							· Team notifications
						</Text>
						{/* Store companion-app rules prohibit a native purchase affordance, including an external purchase link. */}
						{Platform.OS === "web" ? (
							<Button
								label="Upgrade to Team"
								testID={CONTROL.teamBridgeUpgrade}
								onPress={() => {
									void WebBrowser.openBrowserAsync(
										"https://console.radienthq.com/dashboard/team",
									).catch(() =>
										setError("Could not open the Radient console."),
									);
								}}
							/>
						) : (
							<Text
								className="text-body text-ink-muted"
								testID={SURFACE.teamBridgePlanConsole}
							>
								Manage your plan in the Radient console
							</Text>
						)}
					</>
				)}
				{gate === "signed_out" && (
					<>
						<Text className="text-body text-ink-muted">
							Connect directly to your team, even when your computer is closed.
						</Text>
						<Button
							label="Sign in"
							testID={CONTROL.teamBridgeSignIn}
							onPress={() => {
								void connection
									.signInWithRadient()
									.catch(() =>
										setError("Sign-in did not complete. Try again."),
									);
							}}
						/>
					</>
				)}
				{gate === "update_required" && (
					<Text className="text-body text-ink-muted">
						This version cannot read the Team Bridge service. Update the app to
						continue.
					</Text>
				)}
				{gate === "unavailable" && (
					<>
						<Text className="text-body text-ink-muted">
							We could not reach Team Bridge. Your conversations have not been
							changed.
						</Text>
						<Button
							label="Retry"
							testID={CONTROL.teamBridgeGateRetry}
							onPress={() => {
								void actions.checkStatus();
							}}
						/>
					</>
				)}
				{error && (
					<Text accessibilityRole="alert" className="text-body text-ink">
						{error}
					</Text>
				)}
			</View>
		</Screen>
	);
}
