import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { type ReactNode, useState } from "react";
import { Platform, Text, View } from "react-native";
import { useConnection } from "@/features/auth/connection-provider";
import { t } from "@/i18n";
import { useTeamBridge, useTeamBridgeState } from "@/team-bridge/provider";
import type { TeamBridgeState } from "@/team-bridge/store";
import { CONTROL, SURFACE, teamBridgeGateId } from "@/ui/a11y";
import { BackButton } from "@/ui/components/back-button";
import { Button } from "@/ui/components/button";
import { Screen } from "@/ui/components/screen";
import { Skeleton } from "@/ui/components/skeleton";
import { BridgeThreadTitle } from "./thread-chrome";

export function BridgeBack() {
	const router = useRouter();
	return (
		<BackButton
			accessibilityLabel={t("mobile.team_bridge.back")}
			testID={CONTROL.teamBridgeBack}
			onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
		/>
	);
}

/** The one sentence naming a closed gate; shared with the workspace drawer's
 * Bridge pane so the two never describe the same state differently. */
export function gateTitle(
	gate: Exclude<TeamBridgeState["gate"], "open">,
): string {
	return gate === "checking"
		? t("mobile.team_bridge.gate.checking")
		: gate === "signed_out"
			? t("mobile.team_bridge.gate.signed_out")
			: gate === "update_required"
				? t("mobile.team_bridge.gate.update_required")
				: gate === "plan_required"
					? t("mobile.team_bridge.gate.plan_required")
					: t("mobile.team_bridge.gate.unavailable");
}

/** The one line under `gateTitle` explaining that state — the copy the full
 * screen already shows below its heading, reused by the workspace drawer's
 * Bridge pane so the pane is not a bare heading plus a button (UX U2/U3). */
export function gateHelp(
	gate: Exclude<TeamBridgeState["gate"], "open">,
): string {
	return gate === "checking"
		? t("mobile.team_bridge.gate.connecting")
		: gate === "signed_out"
			? t("mobile.team_bridge.gate.signed_out_help")
			: gate === "update_required"
				? t("mobile.team_bridge.gate.update_help")
				: gate === "plan_required"
					? t("mobile.team_bridge.gate.plan_description")
					: t("mobile.team_bridge.gate.unavailable_help");
}

/** Admission wraps the entire surface: restricted accounts must not briefly see directory or composer chrome. */
export function BridgeGate({
	children,
	headerLeading = <BridgeBack />,
}: {
	children: ReactNode;
	/** The header's leading control while admission is not open. The list
	 *  screen keeps `BridgeBack` (it is a pushed destination from Home); a
	 *  thread passes its drawer button so a push or deep link never lands on a
	 *  back arrow (TestFlight 773). */
	headerLeading?: ReactNode;
}) {
	const gate = useTeamBridgeState((s) => s.gate);
	const { actions } = useTeamBridge();
	const connection = useConnection();
	const [error, setError] = useState<string | null>(null);
	if (gate === "open") return children;
	const title = gateTitle(gate);
	return (
		<Screen
			title={t("mobile.team_bridge.title")}
			titleNode={<BridgeThreadTitle title={t("mobile.team_bridge.title")} />}
			headerLeading={headerLeading}
			testID={teamBridgeGateId(gate)}
		>
			<View className="gap-4 px-4 py-6">
				<Text className="text-title text-ink" accessibilityRole="header">
					{title}
				</Text>
				{gate === "checking" && (
					<View
						accessibilityLabel={t("mobile.team_bridge.gate.loading")}
						className="gap-3"
						testID={SURFACE.teamBridgeGateSkeleton}
					>
						<Skeleton lines={3} />
						<Text className="text-body-sm text-ink-muted">
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
