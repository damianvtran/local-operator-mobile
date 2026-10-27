import Constants from "expo-constants";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	AccessibilityInfo,
	findNodeHandle,
	Platform,
	type ScrollView,
	Text,
	View,
} from "react-native";

import { RADIENT_CONSOLE_TUNNELS_URL } from "@/connection";
import { useComputerSwitcher } from "@/features/auth/computer-switcher-sheet";
import {
	ADD_COMPUTER_HREF,
	discoveryFailureMessage,
	rowState,
} from "@/features/auth/computers-view";
import {
	connectionStore,
	useConnection,
	useConnectionState,
} from "@/features/auth/connection-provider";
import { useUiStore } from "@/state/ui-store";
import { CONTROL, computerRowIds, REGION, ROLE, SCREEN } from "@/ui/a11y";
import { Avatar, initialsOf } from "@/ui/components/avatar";
import { Badge } from "@/ui/components/badge";
import { Button } from "@/ui/components/button";
import { Card } from "@/ui/components/card";
import {
	ConnectionPill,
	type ConnectionPillState,
} from "@/ui/components/connection-pill";
import { Dialog } from "@/ui/components/dialog";
import { Divider } from "@/ui/components/divider";
import { RefusalSurface } from "@/ui/components/refusal-surface";
import { Screen } from "@/ui/components/screen";
import { SectionHeader } from "@/ui/components/section-header";
import { Segmented } from "@/ui/components/segmented";
import { LARGE_TEXT_SCALE } from "@/ui/text-scale";
import { TEXT_SCALE_OPTIONS, useTextScale } from "@/ui/text-scale-provider";
import type { ThemePreference } from "@/ui/tokens.gen";
import { AccountRoutingSection } from "./account-routing-section";
import { NotificationsSection } from "./notifications-section";
import { OwnTunnelSettings } from "./own-tunnel-settings";
import {
	refusalAppeared,
	refusalOutOfView,
	refusalRevealReady,
	refusalScrollY,
	retryLanded,
	retryStillOwned,
} from "./refusal-in-view";

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
		signInWithRadient,
		streamHealth,
		lastError,
		discovering,
	} = useConnection();
	const switcher = useComputerSwitcher();
	const computers = useConnectionState((state) => state.computers);
	const route = useConnectionState((state) => state.route);
	const tunnelId = useConnectionState((state) => state.tunnelId);
	const phase = useConnectionState((state) => state.phase);
	const accountLabel = useConnectionState((state) => state.accountLabel);
	const discoveryFailure = useConnectionState(
		(state) => state.discoveryFailure,
	);

	const { theme, setPreference } = useThemePreference();
	const textScale = useTextScale();
	const showToast = useUiStore((state) => state.showToast);

	const [confirmSignOut, setConfirmSignOut] = useState(false);

	const version = Constants.expoConfig?.version ?? "0.0.0";

	/* The RENDERED text scale (`textScale.effectiveScale`): on the web the platform's
	 * own signal multiplies through `rem`, so this is the number a reader perceives
	 * and the one a layout decision has to be made against. */
	const accountStacked = textScale.effectiveScale > LARGE_TEXT_SCALE;

	/* The Status row's word AND colour, derived once from the state the account card
	 *  above reads. See `statusFor` for why one derivation rather than two fields. */
	const status = statusFor({
		health: streamHealth,
		refused: refusal !== null,
		routed: route !== null,
		minting: phase === "minting",
	});

	/* U16: a refusal that appears scrolls into view, once — AFTER the switcher's
	 *  web dismissal, not just `visible=false`. RNW restores focus to the opener
	 *  during the later modal unmount, and that focus can scroll an apparently
	 *  visible refusal off-screen. Measuring on dismissal is the ordering contract;
	 *  no timer can provide it. Native has no dismissal event and uses close. */
	const scrollRef = useRef<ScrollView | null>(null);
	const refusalRef = useRef<View | null>(null);
	const statusRef = useRef<View | null>(null);
	const wasRefused = useRef(refusal !== null);
	const [bringRefusalIntoView, setBringRefusalIntoView] = useState(false);
	const refusalDismissal = useRef(switcher.dismissalCount);
	useEffect(() => {
		if (refusalAppeared(wasRefused.current, refusal !== null)) {
			/* The count AT this refusal: a reveal armed by an earlier open must not be
			 *  satisfied by a dismissal that happened before the panel even appeared. */
			refusalDismissal.current = switcher.dismissalCount;
			setBringRefusalIntoView(true);
		}
		if (refusal === null) setBringRefusalIntoView(false);
		wasRefused.current = refusal !== null;
	}, [refusal, switcher.dismissalCount]);
	useEffect(() => {
		if (
			!bringRefusalIntoView ||
			!refusalRevealReady({
				platform: Platform.OS,
				sheetVisible: switcher.visible,
				sheetDismissedSinceRefusal:
					switcher.dismissalCount > refusalDismissal.current,
			})
		)
			return;
		setBringRefusalIntoView(false);
		const scroller = scrollRef.current;
		const panel = refusalRef.current;
		const content = scroller?.getInnerViewNode?.();
		if (!scroller || !panel || !content) return;
		const viewportBox =
			(scroller.getNativeScrollRef?.() as View | null) ??
			(scroller as unknown as View);
		panel.measureLayout(content, (_x, layoutY) => {
			panel.measureInWindow((_px, top, _pw, height) => {
				viewportBox.measureInWindow((_vx, viewTop, _vw, viewHeight) => {
					if (
						refusalOutOfView(
							{ top, height },
							{ top: viewTop, height: viewHeight },
						)
					)
						scroller.scrollTo({ y: refusalScrollY(layoutY), animated: false });
				});
			});
		});
	}, [bringRefusalIntoView, switcher.visible, switcher.dismissalCount]);

	/* U18: after THIS screen's Try now works, focus goes to the Status row that now
	 *  says so — the button it was on unmounted with the refusal, and focus fell to
	 *  the document body. `retryTarget` is the computer this retry re-ran, because a
	 *  pick from the switcher changes it and that pick's own focus return must not
	 *  be read as this retry landing (review round 4, R4-m1). */
	const retriedHere = useRef(false);
	const retrySettled = useRef(false);
	const retryTarget = useRef<string | null>(null);
	const disarmRetry = useCallback(() => {
		retriedHere.current = false;
		retrySettled.current = false;
		retryTarget.current = null;
	}, []);
	const retryHere = useCallback(() => {
		retriedHere.current = true;
		retrySettled.current = false;
		const target = connectionStore.getState().tunnelId;
		retryTarget.current = target;
		void retry().finally(() => {
			retrySettled.current = true;
			/* Read the STORE, not this render's closures: they predate the retry and
			 *  cannot describe its outcome. A retry that settles without going live
			 *  drops the intent here — no state change follows a failed retry, so the
			 *  effect below would never re-run to notice, and a later unrelated
			 *  success would move focus on its behalf. */
			const now = connectionStore.getState();
			if (
				!retryStillOwned({
					retriedHere: true,
					retrySettled: true,
					refused: now.surface !== null,
					live: now.phase === "live",
					sameTarget: now.tunnelId === target,
				})
			)
				disarmRetry();
		});
	}, [disarmRetry, retry]);
	useEffect(() => {
		if (!retriedHere.current) return;
		const sameTarget = tunnelId === retryTarget.current;
		if (
			retryLanded({
				retriedHere: true,
				refused: refusal !== null,
				live: phase === "live",
			}) &&
			sameTarget
		) {
			disarmRetry();
			const row = statusRef.current;
			if (!row) return;
			/* The web moves keyboard focus (the row's `focusable` makes it addressable);
			 *  a phone moves the screen reader's. */
			if (Platform.OS === "web") row.focus();
			else {
				const handle = findNodeHandle(row);
				if (handle !== null) AccessibilityInfo.setAccessibilityFocus(handle);
			}
			return;
		}
		if (
			!retryStillOwned({
				retriedHere: true,
				retrySettled: retrySettled.current,
				refused: refusal !== null,
				live: phase === "live",
				sameTarget,
			})
		)
			disarmRetry();
	}, [disarmRetry, phase, refusal, tunnelId]);

	const doSignOut = useCallback(async () => {
		setConfirmSignOut(false);
		// A failed remote logout keeps its refusal/retry on this screen; do not
		// claim revocation or navigate away merely because local readiness ended.
		if (!(await signOut())) return;
		showToast("Signed out. The session was revoked on your computer.");
		router.replace("/welcome");
	}, [router, showToast, signOut]);

	return (
		<Screen
			title="Settings"
			testID={SCREEN.settings}
			scrollRef={scrollRef}
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
						<View
							className={
								accountStacked ? "min-w-0 w-full gap-1" : "min-w-0 flex-1 gap-1"
							}
						>
							<Text className="text-body text-ink">
								{accountLabel ?? "Not signed in with Radient"}
							</Text>
							<Text
								className="text-body-sm text-ink-dim"
								numberOfLines={1}
								ellipsizeMode="tail"
							>
								{route
									? route.mode === "radient"
										? `Through your Radient tunnel`
										: `Connected directly to ${route.baseUrl}`
									: "No connection yet"}
							</Text>
						</View>
					</View>
				</Card>

				{/* -------------------------------------------------------- connection */}
				<View className="gap-2" testID={REGION.settingsConnection}>
					<SectionHeader label="Connection" />
					<View
						ref={statusRef}
						/* Programmatically focusable, never a Tab stop: the target of U18's
						 *  focus move after Try now, and nothing else. */
						tabIndex={-1}
						className="flex-row items-center justify-between"
					>
						<Text className="text-body-sm text-ink-muted">Status</Text>
						{/* The WORD, not just the dot. In the list the connected state is
						 *  deliberately silent (it is furniture there), but this is the VALUE
						 *  of a row whose label is "Status", and it was a 22x14 pt dot with an
						 *  accessible name of "Connection: " — the one state a reader looks
						 *  for, carried by colour alone, which the kit forbids in the same
						 *  file. The prop already existed. */}
						{/* ONE function gives the row both its word and its colour, from the same
						 *  state the line above reads. They used to come from two places — the
						 *  colour from `streamHealth`, the word from the literal "Connected" — so
						 *  three rows under the heading "No computer connected" painted a green
						 *  dot and the word "Connected" (design round 2, D12, frame
						 *  `dark390-surface`: pill 90x25, dot rgb(87,199,133)). Splitting the two
						 *  was the defect; one derivation is the fix. */}
						<ConnectionPill state={status.state} message={status.message} />
					</View>
					{/* The route's refusal, under the Status it explains and above the list.
					 *  The switcher opens from here and CLOSES on a failed pick so the reason
					 *  is readable behind it (PR #122 M1/U2) — but this screen had nothing
					 *  behind it except "Not connected", and the reason was painted on the
					 *  hidden Home (QA round 2, Q6; UX U11). The same surface Computers and
					 *  Home render, so every entry point shows one sentence for one failure;
					 *  its own rules decide which remedy a cause gets (no prominent retry for
					 *  a console-side cause), and "Switch computer" stays just below it. */}
					{refusal ? (
						/* The wrapper is what is measured and scrolled to (U16, above);
						 *  the surface keeps its own `role=alert` live region. */
						<View ref={refusalRef} collapsable={false}>
							<RefusalSurface
								kind={refusal.kind}
								subject={refusal.subject}
								detail={refusal.detail}
								remedy={refusal.remedy}
								retryAfterMs={refusal.retryAfterMs}
								/* The provider's retry re-runs what failed — for a pick, that
								 *  same computer (`noteError`'s closure in `selectComputer`). */
								onRetry={retryHere}
								onSignIn={() => void signInWithRadient()}
								onOpenConsole={() =>
									void WebBrowser.openBrowserAsync(RADIENT_CONSOLE_TUNNELS_URL)
								}
								onUseAnotherAddress={() => router.push("/custom")}
							/>
						</View>
					) : null}
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
									{/* The picker's own row state, so a pick still minting or
									 *  refused is not badged "active" here while the store says
									 *  otherwise (PR #121 UX round 1, U3). */}
									{rowState(computer, { tunnelId, phase }) === "active" ? (
										<Badge label="active" tone="success" mono />
									) : rowState(computer, { tunnelId, phase }) ===
										"connecting" ? (
										<Badge label="connecting" tone="info" mono />
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
					{/* A failed Refresh is an ACCOUNT failure now, not a route refusal (PR
					 *  #121, D2), so it no longer surfaces as this screen's refusal: the
					 *  line under the list is where this screen's Refresh reports it. Same
					 *  sentence as the Computers banner, from one place. */}
					{discoveryFailure ? (
						<Text
							className="text-body-sm text-warning"
							testID={REGION.settingsDiscoveryFailure}
						>
							{discoveryFailureMessage(discoveryFailure, computers.length > 0)}
						</Text>
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
							/* A discovery, not a pick: the same flag the Computers header
							 *  uses, which also absorbs repeat taps while one is in flight
							 *  (U4). */
							loading={discovering}
						/>
						{/* Every computer this phone knows, own-address ones included — the
						 *  rows above are only the account's Radient computers. */}
						<Button
							testID={CONTROL.settingsSwitchComputer}
							label="Switch computer"
							onPress={switcher.open}
							variant="quiet"
							size="sm"
						/>
						<Button
							testID={CONTROL.settingsAddComputer}
							label="Add a computer"
							/* The set-up paths, not the list: the list has no add path once
							 *  the account has a computer (UX round 2, U12), and the switcher's
							 *  own "Add a computer" goes to the same place. */
							onPress={() => router.push(ADD_COMPUTER_HREF)}
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
				<AccountRoutingSection />
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

				{/* ------------------------------------------------------ notifications */}
				<NotificationsSection />

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
					{/* No second retry here: the refusal surface under Status carries
					 *  this refusal's remedy, Try again included where retrying can work,
					 *  and it is always rendered with it. The old Diagnostics retry
					 *  beside it was two controls for one refusal (PR #122 review round 3,
					 *  R3-m1) — and offered a retry for the console-side causes the
					 *  surface deliberately gives none. */}
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

/**
 * The Status row's state AND its word, from the connection state this screen already
 * has.
 *
 * One function for both, because two is what went wrong: the colour came from the
 * stream and the word was the literal "Connected", so with no route at all — the
 * `signed-out` phase, where `streamHealth` is still `idle` — the row fell through to
 * `connected` and agreed with itself while disagreeing with the card above it. The
 * heading reads `route`, so this does too, and "No connection yet" is what the row
 * says when that is the fact (design round 2, D12).
 *
 * The noun "computer" is deliberately NOT used here. It names the machine the
 * reader drives — the thing `/tunnels` lists and "Add a computer" adds — and a
 * connection state is not that (design round 3, D20: one noun had three
 * referents). So the value describes the CONNECTION in connection words, and the
 * machine keeps the noun everywhere it is the referent.
 *
 * The words are short on purpose: this is the VALUE half of a label/value row, so a
 * sentence here would wrap the row at 200 % and push the label off its own line.
 */
function statusFor(input: {
	health: ReturnType<typeof useConnection>["streamHealth"];
	refused: boolean;
	routed: boolean;
	/** A computer was picked and its session is still being minted. */
	minting: boolean;
}): {
	state: ConnectionPillState;
	message: string;
} {
	if (!input.routed) return { state: "inactive", message: "No connection yet" };
	if (input.refused) return { state: "offline", message: "Not connected" };
	/* No stream exists yet while a session is minted, and an idle stream fell
	 *  through to "Connected" (U3). */
	if (input.minting) return { state: "reconnecting", message: "Connecting…" };
	switch (input.health) {
		case "connecting":
			return { state: "reconnecting", message: "Connecting…" };
		case "offline":
			return { state: "offline", message: "Offline" };
		case "degraded":
			return { state: "degraded", message: "Not answering" };
		default:
			return { state: "connected", message: "Connected" };
	}
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
