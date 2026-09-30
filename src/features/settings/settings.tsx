import Constants from "expo-constants";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useState } from "react";
import { Text, View } from "react-native";

import { RADIENT_CONSOLE_TUNNELS_URL } from "@/connection";
import {
	useConnection,
	useConnectionState,
} from "@/features/auth/connection-provider";
import { useUiStore } from "@/state/ui-store";
import { CONTROL, computerRowIds, REGION, ROLE, SCREEN } from "@/ui/a11y";
import { Avatar, initialsOf } from "@/ui/components/avatar";
import { Badge } from "@/ui/components/badge";
import { Button } from "@/ui/components/button";
import { Card } from "@/ui/components/card";
import { ConnectionPill } from "@/ui/components/connection-pill";
import { Dialog } from "@/ui/components/dialog";
import { Divider } from "@/ui/components/divider";
import { Screen } from "@/ui/components/screen";
import { SectionHeader } from "@/ui/components/section-header";
import { Segmented } from "@/ui/components/segmented";
import { LARGE_TEXT_SCALE } from "@/ui/text-scale";
import { TEXT_SCALE_OPTIONS, useTextScale } from "@/ui/text-scale-provider";
import type { ThemePreference } from "@/ui/tokens.gen";
import { OwnTunnelSettings } from "./own-tunnel-settings";

/**
 * Settings (docs/ux/flows.md § 10, F-10).
 *
 * Four things this screen must be honest about, and each one is a place a
 * settings screen usually lies:
 *
 *  1. **Sign out revokes.** `docs/adr/0002` makes the revoke part of ending a
 *     route, because a session left live at the control plane keeps a tunnel
 *     reachable from a phone that has forgotten it. So this is not "forget the
 *     password" — it ends the session on the server, and the button says so.
 *  2. **Account deletion happens on the web, and the screen says so.** App Store
 *     Review Guideline 5.1.1(v) requires an in-app path to delete an account; the
 *     account here is a Radient account, and there is no in-app deletion
 *     endpoint. The entry point links to the console and states plainly where the
 *     deletion happens and what it deletes. Pretending an in-app deletion exists
 *     would be a lie to a reviewer and to the reader.
 *  3. **Diagnostics show facts, not reassurance.** The active route, the stream's
 *     health, and the last typed error, with no status codes shown as the whole
 *     story and no token anywhere near them.
 *  4. **The text scale is a real control** (`U-04`): it drives the same hook the
 *     audit harness measures, so "200 %" in this screen and "200 %" in a capture
 *     are the same number.
 */
export default function Settings() {
	const router = useRouter();
	const {
		signOut,
		retry,
		refreshComputers,
		refusal,
		streamHealth,
		lastError,
		busy,
	} = useConnection();
	const computers = useConnectionState((state) => state.computers);
	const route = useConnectionState((state) => state.route);
	const tunnelId = useConnectionState((state) => state.tunnelId);
	const accountLabel = useConnectionState((state) => state.accountLabel);

	const { theme, setPreference } = useThemePreference();
	const textScale = useTextScale();
	const showToast = useUiStore((state) => state.showToast);

	const [confirmSignOut, setConfirmSignOut] = useState(false);

	const version = Constants.expoConfig?.version ?? "0.0.0";

	/* The RENDERED text scale (`textScale.effectiveScale`): on the web the platform's
	 * own signal multiplies through `rem`, so this is the number a reader perceives
	 * and the one a layout decision has to be made against. */
	const accountStacked = textScale.effectiveScale > LARGE_TEXT_SCALE;

	const doSignOut = useCallback(async () => {
		setConfirmSignOut(false);
		await signOut();
		showToast("Signed out. The session was revoked on your computer.");
		router.replace("/welcome");
	}, [router, showToast, signOut]);

	return (
		<Screen
			title="Settings"
			testID={SCREEN.settings}
			headerLeading={
				<Button
					testID={CONTROL.settingsBack}
					label="Back"
					onPress={() => router.back()}
					variant="quiet"
					size="sm"
				/>
			}
		>
			<View className="gap-4 pt-2">
				{/* ---------------------------------------------------------- account */}
				<Card>
					{/* A COLUMN above `LARGE_TEXT_SCALE`, not a `flex-wrap` — wrapping does
					 *  nothing here, because the text beside the avatar is `flex-1` and will
					 *  always take whatever width is left rather than move to a new line. At
					 *  200 % on a 320 pt phone that left it a 180 pt column and "Radient"
					 *  broke mid-word; stacking puts the identity under its own mark. */}
					<View
						className={
							accountStacked
								? "items-start gap-2"
								: "flex-row items-center gap-3"
						}
					>
						<Avatar
							initials={initialsOf(
								accountLabel ?? computers[0]?.name ?? "Local Operator",
							)}
							size="md"
							accessibilityLabel="Signed in"
						/>
						<View className="min-w-0 flex-1 gap-1">
							<Text className="text-body text-ink">
								{accountLabel ?? "Not signed in with Radient"}
							</Text>
							<Text className="text-body-sm text-ink-dim">
								{route
									? route.mode === "radient"
										? `Through your Radient tunnel`
										: `Connected directly to ${route.baseUrl}`
									: "No computer connected"}
							</Text>
						</View>
					</View>
				</Card>

				{/* -------------------------------------------------------- connection */}
				<View className="gap-2" testID={REGION.settingsConnection}>
					<SectionHeader label="Connection" />
					<View className="flex-row items-center justify-between">
						<Text className="text-body-sm text-ink-muted">Status</Text>
						<ConnectionPill state={pillFor(streamHealth, refusal !== null)} />
					</View>
					{computers.length > 0 ? (
						<View className="gap-2 pt-1">
							<Text className="text-body-sm text-ink-muted">Computers</Text>
							{computers.map((computer) => (
								<View
									key={computer.tunnelId}
									className="flex-row flex-wrap items-center gap-2"
									testID={computerRowIds(computer.hostname).row}
								>
									<Text
										className="flex-1 text-body-sm text-ink"
										numberOfLines={1}
									>
										{computer.name}
									</Text>
									{computer.tunnelId === tunnelId ? (
										<Badge label="active" tone="success" mono />
									) : (
										<Button
											testID={CONTROL.settingsUseComputer}
											label="Use"
											onPress={() => {
												/* Switching routes is the picker's job, so this hands
												 *  over rather than reimplementing it. */
												router.push("/tunnels");
											}}
											variant="quiet"
											size="sm"
										/>
									)}
								</View>
							))}
						</View>
					) : null}
					{/* `flex-wrap`: two controls side by side are 2 x (label + padding) wide,
					 *  and at 200 % text that is wider than a 320 pt phone — the row ran to
					 *  399 px (`U-06`, measured). Wrapping keeps both reachable. */}
					<View className="flex-row flex-wrap gap-2 pt-1">
						<Button
							testID={CONTROL.settingsRefresh}
							label="Refresh"
							onPress={() => void refreshComputers()}
							variant="outline"
							size="sm"
							loading={busy}
						/>
						<Button
							testID={CONTROL.settingsAddComputer}
							label="Add a computer"
							onPress={() => router.push("/tunnels")}
							variant="quiet"
							size="sm"
						/>
					</View>
				</View>

				{/* The self-hosted route is managed here as well as on the setup screen:
				 *  a reader who saved their own tunnel has no Radient account to go
				 *  looking for, and "change the address later" is the ordinary case —
				 *  a tunnel provider hands out a new hostname. */}
				<OwnTunnelSettings />

				<Divider />

				{/* -------------------------------------------------------- appearance */}
				<View className="gap-3" testID={REGION.settingsAppearance}>
					<SectionHeader label="Appearance" />
					<Segmented<ThemePreference>
						testID={CONTROL.settingsThemeGroup}
						label="Theme"
						value={theme}
						onChange={setPreference}
						options={[
							{
								value: "system",
								label: "System",
								testID: CONTROL.settingsThemeSystem,
							},
							{
								value: "dark",
								label: "Dark",
								testID: CONTROL.settingsThemeDark,
							},
							{
								value: "light",
								label: "Light",
								testID: CONTROL.settingsThemeLight,
							},
						]}
					/>
					<Segmented
						testID={CONTROL.settingsTextScaleGroup}
						label="Text size"
						value={textScale.preference}
						onChange={textScale.setPreference}
						options={TEXT_SCALE_OPTIONS.map((option) => ({
							value: option.value,
							label: option.label,
							testID:
								option.value === "100"
									? CONTROL.settingsTextScale100
									: option.value === "150"
										? CONTROL.settingsTextScale150
										: option.value === "200"
											? CONTROL.settingsTextScale200
											: CONTROL.settingsTextScaleSystem,
						}))}
					/>
					<Text className="text-body-sm text-ink-dim">
						This phone's own text size is{" "}
						{Math.round(textScale.platformScale * 100)}%.
						{textScale.preference === "system"
							? " Following it."
							: " Overridden above."}
					</Text>
				</View>

				<Divider />

				{/* -------------------------------------------------------- diagnostics */}
				<View className="gap-2" testID={REGION.settingsDiagnostics}>
					<SectionHeader label="Diagnostics" />
					<DiagnosticRow
						label="Route"
						value={
							route
								? route.mode === "radient"
									? "Radient tunnel"
									: "Direct relay"
								: "None"
						}
					/>
					<DiagnosticRow label="Stream" value={streamHealth} />
					<DiagnosticRow
						label="Last error"
						value={lastError ? lastError.summary : "None"}
					/>
					<Text className="text-body-sm text-ink-dim">
						These lines never include a token, a password, or a session's
						content.
					</Text>
					{refusal ? (
						<Button
							testID={CONTROL.settingsRetryLastAction}
							label="Try the last action again"
							onPress={() => void retry()}
							variant="outline"
							size="sm"
						/>
					) : null}
				</View>

				<Divider />

				{/* ------------------------------------------------------- about, legal */}
				<View className="gap-2">
					<SectionHeader label="About" />
					<DiagnosticRow label="Version" value={version} />
					<Text className="text-body-sm text-ink-dim">
						Local Operator is open source (MIT). Nothing from this phone is sent
						anywhere except to the relay you are connected to.
					</Text>
				</View>

				{/* -------------------------------------------------- sign out, delete */}
				<View className="gap-3 pt-2">
					<Button
						label="Sign out"
						onPress={() => setConfirmSignOut(true)}
						variant="outline"
						testID={CONTROL.settingsSignOut}
					/>
					<Button
						label="Delete my Radient account"
						onPress={() =>
							void WebBrowser.openBrowserAsync(
								RADIENT_CONSOLE_TUNNELS_URL.replace(
									"/dashboard/tunnels",
									"/dashboard/account",
								),
							)
						}
						variant="quiet"
						testID={CONTROL.settingsDeleteAccount}
					/>
					<Text className="text-body-sm text-ink-dim">
						Deleting your account happens in the Radient console, in the browser
						— this app cannot do it for you. It deletes the account and every
						tunnel on it. Sessions on your computer are not touched.
					</Text>
				</View>
			</View>

			<Dialog
				visible={confirmSignOut}
				title="Sign out?"
				body="This ends the session with the control plane as well as forgetting it here, so the tunnel stops accepting requests from this phone. Your computer is not touched."
				confirmLabel="Sign out"
				onConfirm={() => void doSignOut()}
				onCancel={() => setConfirmSignOut(false)}
				destructive
			/>
		</Screen>
	);
}

/** The theme preference, read through the UI store so this screen cannot hold a
 *  second copy of it. */
function useThemePreference(): {
	theme: ThemePreference;
	setPreference: (preference: ThemePreference) => void;
} {
	const theme = useUiStore((state) => state.themePreference);
	const setPreference = useUiStore((state) => state.setThemePreference);
	return { theme, setPreference };
}

function pillFor(
	health: ReturnType<typeof useConnection>["streamHealth"],
	refused: boolean,
): "connected" | "reconnecting" | "offline" | "degraded" {
	if (refused) return "offline";
	if (health === "connecting") return "reconnecting";
	if (health === "offline") return "offline";
	if (health === "degraded") return "degraded";
	return "connected";
}

/** One line of the diagnostics block. A label and a value, never only a value:
 *  "degraded" alone tells a reader nothing to act on. */
const DiagnosticRow = ({ label, value }: { label: string; value: string }) => (
	<View className="flex-row items-start justify-between gap-4">
		<Text className="text-body-sm text-ink-muted">{label}</Text>
		<Text
			className="flex-1 text-right text-mono-sm text-ink-dim"
			accessibilityRole={ROLE.text}
			numberOfLines={2}
			/* `minWidth: 0` lets this column shrink below its content's width — the
			 *  one lever RN-web honours on every platform for a flex child (`overflow-
			 *  Wrap` is web-only and is not in the `TextStyle` type). */
			style={{ minWidth: 0 }}
		>
			{value}
		</Text>
	</View>
);
