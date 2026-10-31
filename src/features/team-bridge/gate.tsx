import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { type ReactNode, useState } from "react";
import { Platform, Text, View } from "react-native";
import { useConnection } from "@/features/auth/connection-provider";
import { t } from "@/i18n";
import { useTeamBridge, useTeamBridgeState } from "@/team-bridge/provider";
import { CONTROL, SURFACE, teamBridgeGateId } from "@/ui/a11y";
import { Button } from "@/ui/components/button";
import { Screen } from "@/ui/components/screen";

export function BridgeBack() {
	const router = useRouter();
	return (
		<Button
			label={t("mobile.team_bridge.back")}
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
			? t("mobile.team_bridge.gate.checking")
			: gate === "signed_out"
				? t("mobile.team_bridge.gate.signed_out")
				: gate === "update_required"
					? t("mobile.team_bridge.gate.update_required")
					: gate === "plan_required"
						? t("mobile.team_bridge.gate.plan_required")
						: t("mobile.team_bridge.gate.unavailable");
	return (
		<Screen
			title={t("mobile.team_bridge.title")}
			headerLeading={<BridgeBack />}
			testID={teamBridgeGateId(gate)}
		>
			<View className="gap-5 px-4 py-6">
				<Text className="text-title text-ink" accessibilityRole="header">
					{title}
				</Text>
				{gate === "checking" && (
					<View
						accessibilityLabel={t("mobile.team_bridge.gate.loading")}
						className="gap-3"
						testID={SURFACE.teamBridgeGateSkeleton}
					>
						<View className="h-6 rounded-sm bg-surface" />
						<View className="h-6 rounded-sm bg-surface" />
						<Text className="text-body text-ink-muted">
							{t("mobile.team_bridge.gate.connecting")}
						</Text>
					</View>
				)}
				{gate === "plan_required" && (
					<>
						<Text className="text-body text-ink">
							{t("mobile.team_bridge.gate.plan_description")}
						</Text>
						<Text className="text-body text-ink-muted">
							{t("mobile.team_bridge.gate.plan_features")}
						</Text>
						{/* Store companion-app rules prohibit a native purchase affordance, including an external purchase link. */}
						{Platform.OS === "web" ? (
							<Button
								label={t("mobile.team_bridge.gate.upgrade")}
								testID={CONTROL.teamBridgeUpgrade}
								onPress={() => {
									void WebBrowser.openBrowserAsync(
										"https://console.radienthq.com/dashboard/team",
									).catch(() =>
										setError(t("mobile.team_bridge.gate.console_error")),
									);
								}}
							/>
						) : (
							<Text
								className="text-body text-ink-muted"
								testID={SURFACE.teamBridgePlanConsole}
							>
								{t("mobile.team_bridge.gate.manage_plan")}
							</Text>
						)}
					</>
				)}
				{gate === "signed_out" && (
					<>
						<Text className="text-body text-ink-muted">
							{t("mobile.team_bridge.gate.signed_out_help")}
						</Text>
						<Button
							label={t("mobile.team_bridge.gate.sign_in")}
							testID={CONTROL.teamBridgeSignIn}
							onPress={() => {
								void connection
									.signInWithRadient()
									.catch(() =>
										setError(t("mobile.team_bridge.gate.sign_in_error")),
									);
							}}
						/>
					</>
				)}
				{gate === "update_required" && (
					<Text className="text-body text-ink-muted">
						{t("mobile.team_bridge.gate.update_help")}
					</Text>
				)}
				{gate === "unavailable" && (
					<>
						<Text className="text-body text-ink-muted">
							{t("mobile.team_bridge.gate.unavailable_help")}
						</Text>
						<Button
							label={t("mobile.team_bridge.retry")}
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
