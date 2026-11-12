import { useRouter } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import { t } from "@/i18n";
import { CONTROL, REGION, SURFACE } from "@/ui/a11y";
import { Button } from "@/ui/components/button";
import { Shimmer } from "@/ui/components/shimmer";
import type { SignInState } from "./radient-sign-in";
import { signInDiagnosticLabel } from "./sign-in-diagnostic-label";
import type { SignInDiagnostic } from "./sign-in-diagnostics";

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
	diagnostics = [],
	onStart,
	onUseAddress,
	testID = SURFACE.signInPanel,
}: {
	state: SignInState;
	diagnostics?: readonly SignInDiagnostic[];
	onStart: () => void;
	onUseAddress: () => void;
	testID?: string;
}) => {
	const router = useRouter();
	const [showDiagnostics, setShowDiagnostics] = useState(false);
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
						<Text className="text-body text-ink">
							{t("mobile.signin.panel.opening")}
						</Text>
					</Shimmer>
				) : null}
				{state.kind === "waiting-for-browser" ? (
					<>
						<Text className="text-body text-ink">
							{t("mobile.signin.panel.waiting")}
						</Text>
						<Text className="text-body-sm text-ink-muted">
							{t("mobile.signin.panel.waiting_help")}
						</Text>
					</>
				) : null}
				{state.kind === "exchanging" ? (
					<Shimmer active>
						<Text className="text-body text-ink">
							{t("mobile.signin.progress")}
						</Text>
					</Shimmer>
				) : null}
				{state.kind === "cancelled" ? (
					<>
						<Text className="text-body text-ink">
							{t("mobile.signin.panel.cancelled")}
						</Text>
						<Text className="text-body-sm text-ink-muted">
							{t("mobile.signin.panel.cancelled_help")}
						</Text>
					</>
				) : null}
				{state.kind === "unavailable" ? (
					<>
						<Text className="text-body text-ink">
							{t("mobile.signin.panel.unavailable")}
						</Text>
						<Text className="text-body-sm text-ink-muted">{state.detail}</Text>
						<Text className="text-body-sm text-ink-muted">
							{t("mobile.signin.panel.unavailable_alt")}
						</Text>
					</>
				) : null}
				{state.kind === "failed" ? (
					<Text className="text-body text-ink">{state.detail}</Text>
				) : null}
			</View>

			{state.kind === "cancelled" || state.kind === "failed" ? (
				<Button
					label={t("mobile.signin.retry")}
					onPress={onStart}
					variant="outline"
					testID={CONTROL.signInTryAgain}
				/>
			) : null}
			{state.kind === "unavailable" ? (
				<>
					<Button
						label={t("mobile.signin.use_address")}
						onPress={useAddress}
						testID={CONTROL.signInUseAddress}
					/>
					<Button
						label={t("mobile.signin.try_anyway")}
						onPress={onStart}
						variant="quiet"
						testID={CONTROL.signInTryAnyway}
					/>
				</>
			) : null}
			{state.kind === "failed" ||
			state.kind === "cancelled" ||
			state.kind === "unavailable" ? (
				<View className="gap-2">
					<Button
						label={t(
							showDiagnostics
								? "mobile.signin.hide_diagnostics"
								: "mobile.signin.show_diagnostics",
						)}
						expanded={showDiagnostics}
						testID={CONTROL.signInDiagnostics}
						variant="quiet"
						onPress={() => setShowDiagnostics((shown) => !shown)}
					/>
					{showDiagnostics ? (
						<Text
							className="text-meta text-ink-muted"
							testID={REGION.signInDiagnostics}
						>
							{diagnostics
								.map(
									(entry) =>
										`${signInDiagnosticLabel(entry.stage)}${entry.errorClass ? ` (${entry.errorClass})` : ""}`,
								)
								.join("\n")}
						</Text>
					) : null}
				</View>
			) : null}
		</View>
	);
};
