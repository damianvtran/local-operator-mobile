import * as Clipboard from "expo-clipboard";
import Constants from "expo-constants";
import { useLocalSearchParams, useRouter } from "expo-router";
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
	discoveryFailureKey,
	rowState,
} from "@/features/auth/computers-view";
import {
	connectionStore,
	type StreamHealth,
	useConnection,
	useConnectionState,
} from "@/features/auth/connection-provider";
import { diagnosticReason } from "@/features/auth/stream-health-reason";
import { TransientNotice } from "@/features/auth/transient-notice";
import {
	diagnosticsReasonValue,
	diagnosticsText,
} from "@/features/settings/diagnostics-text";
import { t } from "@/i18n";
import type { ThemeMode } from "@/state/theme-preference";
import { useUiStore } from "@/state/ui-store";
import { CONTROL, computerRowIds, REGION, ROLE, SCREEN } from "@/ui/a11y";
import { BackButton } from "@/ui/components/back-button";
import { Badge } from "@/ui/components/badge";
import { Button } from "@/ui/components/button";
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
import {
	STATUS_LABEL_STYLE,
	STATUS_PILL_SLOT_STYLE,
	statusRowClass,
	statusRowStacked,
} from "@/ui/components/status-pill-layout";
import {
	LTR_WRITING,
	TEXT_END_CLASS,
	useComposedDir,
	useIsRTL,
} from "@/ui/direction";
import { LARGE_TEXT_SCALE } from "@/ui/text-scale";
import { TEXT_SCALE_OPTIONS, useTextScale } from "@/ui/text-scale-provider";
import { AccountCard } from "./account-card";
import { AccountRoutingSection } from "./account-routing-section";
import { type CopyFeedback, createCopyFeedback } from "./copy-feedback";
import { NotificationsSection } from "./notifications-section";
import { OwnTunnelSettings } from "./own-tunnel-settings";
import {
	refusalOutOfView,
	refusalScrollY,
	retryLanded,
	retryStillOwned,
	retryTargetMatches,
} from "./refusal-in-view";
import { SidebarSettingsSection } from "./sidebar-section";
import { ThemeRow } from "./theme-row";
import { useRefusalReveal } from "./use-refusal-reveal";

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
		streamHealthReason,
		lastError,
		diagnosticError,
		transient,
		discovering,
	} = useConnection();
	const switcher = useComputerSwitcher();
	const computers = useConnectionState((state) => state.computers);
	const route = useConnectionState((state) => state.route);
	const tunnelId = useConnectionState((state) => state.tunnelId);
	const phase = useConnectionState((state) => state.phase);
	const discoveryFailure = useConnectionState(
		(state) => state.discoveryFailure,
	);

	const { theme, setPreference } = useThemePreference();
	const textScale = useTextScale();
	const showToast = useUiStore((state) => state.showToast);

	const [confirmSignOut, setConfirmSignOut] = useState(false);
	const [signingOut, setSigningOut] = useState(false);
	/* "Copy diagnostics" feedback: shows for ~2 s, then the label returns, and a
	 *  refused clipboard says so (PR #261 R7/U7/D9; `copy-feedback.ts`). */
	const [copyFeedback, setCopyFeedback] = useState<CopyFeedback>("idle");
	const copierRef = useRef<ReturnType<typeof createCopyFeedback> | null>(null);
	useEffect(() => {
		const copier = createCopyFeedback({
			write: (text) => Clipboard.setStringAsync(text),
			onChange: setCopyFeedback,
		});
		copierRef.current = copier;
		return () => copier.dispose();
	}, []);
	/* This is SETTINGS's action, not global connection busy (which also covers
	 * discovery/picks). Keep the screen responsive and the pending explanation
	 * visible while bounded push retirement runs. The ref closes the same-tick
	 * double-confirm window before React has committed disabled={signingOut}. */
	const signingOutRef = useRef(false);

	const version = Constants.expoConfig?.version ?? "0.0.0";

	/* The RENDERED text scale (`textScale.effectiveScale`): on the web the platform's
	 * own signal multiplies through `rem`, so this is the number a reader perceives
	 * and the one a layout decision has to be made against. The Status row stacks
	 * above LARGE_TEXT_SCALE, as the account card does: side by side at 200 % a
	 * long locale's label leaves the pill a glyph or two. */
	const statusStacked = statusRowStacked(textScale.effectiveScale);

	/* The Status row's word AND colour, derived once from the state the account card
	 *  above reads. See `statusFor` for why one derivation rather than two fields. */
	const status = statusFor({
		health: streamHealth,
		refused: refusal !== null,
		routed: route !== null,
		minting: phase === "minting",
	});

	/* U16: a refusal that appears scrolls into view, once — AFTER every closing
	 *  modal's web dismissal (the switcher's and the sign-out Dialog's, Q9), not
	 *  just `visible=false`. RNW restores focus to the opener during the later
	 *  modal unmount, and that focus can scroll an apparently visible refusal
	 *  off-screen. Measuring on dismissal is the ordering contract; no timer can
	 *  provide it. Native has no dismissal event and uses close. */
	const scrollRef = useRef<ScrollView | null>(null);
	/* The drawer's "More sidebar settings" link lands here with
	 *  `?section=sidebar`; scroll that section into view once, on its first
	 *  layout, and never again (a later relayout must not yank the reader). */
	const { section: landingSection } = useLocalSearchParams<{
		section?: string;
	}>();
	const landed = useRef(false);
	const onSidebarLayout = useCallback(
		(y: number) => {
			if (landingSection !== "sidebar" || landed.current) return;
			landed.current = true;
			scrollRef.current?.scrollTo({ y, animated: false });
		},
		[landingSection],
	);
	const refusalRef = useRef<View | null>(null);
	const statusRef = useRef<View | null>(null);
	/* The arm / disarm / dismissal wait lives in `useRefusalReveal`, so the Node
	 *  suite drives it beside the real kit modals; this is only the measuring. */
	useRefusalReveal(refusal !== null, switcher.visible, () => {
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
	});

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
					sameTarget: retryTargetMatches(retryTarget.current, now.tunnelId),
				})
			)
				disarmRetry();
		});
	}, [disarmRetry, retry]);
	useEffect(() => {
		if (!retriedHere.current) return;
		/* An account-side retry (started with no computer) adopts the computer its
		 *  restore lands on, so a later pick of another one still disarms (R5-m2). */
		if (
			retryTarget.current === null &&
			tunnelId !== null &&
			!retrySettled.current
		)
			retryTarget.current = tunnelId;
		const sameTarget = retryTargetMatches(retryTarget.current, tunnelId);
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
		if (signingOutRef.current) return;
		signingOutRef.current = true;
		setSigningOut(true);
		setConfirmSignOut(false);
		try {
			// A failed logout keeps its refusal/retry on this screen; do not claim
			// revocation or navigate away merely because local readiness ended.
			if (!(await signOut())) return;
			showToast(t("mobile.settings.sign_out.done"));
			router.replace("/welcome");
		} finally {
			signingOutRef.current = false;
			setSigningOut(false);
		}
	}, [router, showToast, signOut]);

	return (
		<Screen
			title={t("mobile.settings.screen_title")}
			testID={SCREEN.settings}
			scrollRef={scrollRef}
			headerLeading={
				<BackButton
					testID={CONTROL.settingsBack}
					onPress={() => router.back()}
				/>
			}
		>
			<View className="gap-4 pt-2">
				{/* ---------------------------------------------------------- account */}
				{/* The account card and its Radient sign-in: see `account-card.tsx`
				 *  for why the button keys on `radientSignedIn` and confirms first. */}
				<AccountCard />

				{/* -------------------------------------------------------- connection */}
				<View className="gap-2" testID={REGION.settingsConnection}>
					<SectionHeader label={t("mobile.settings.section.connection")} />
					<View
						ref={statusRef}
						/* Programmatically focusable, never a Tab stop: the target of U18's
						 *  focus move after Try now, and nothing else. */
						tabIndex={-1}
						/* `statusRowClass` (min-w-0) + a shrinkable pill slot capped
						 *  relative to the row + a label that keeps its word: "Not
						 *  answering" ran past the right edge on an iPhone (Sherman's
						 *  report via Aida). Above LARGE_TEXT_SCALE the row stacks rather than cut
						 *  the word to a glyph. `statusPillFit` is the rule;
						 *  `status-pill-layout.test.ts` checks it at 320 pt / 200 %. */
						className={statusRowClass(statusStacked)}
					>
						<Text
							className="text-body-sm text-ink-muted"
							style={STATUS_LABEL_STYLE}
						>
							{t("mobile.settings.connection.status")}
						</Text>
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
						<View style={STATUS_PILL_SLOT_STYLE}>
							<ConnectionPill
								state={status.state}
								message={status.message}
								singleLine
							/>
						</View>
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
								copy={refusal.copy}
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
					{/* A wait the computer named while the stream retries (Q3): said,
					 *  not blocking. Renders nothing while a refusal shows. */}
					<TransientNotice />
					{computers.length > 0 ? (
						<View className="gap-2 pt-1">
							<Text className="text-body-sm text-ink-muted">
								{t("mobile.settings.connection.computers")}
							</Text>
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
										<Badge
											label={t("mobile.computers.badge.active")}
											tone="success"
											mono
										/>
									) : rowState(computer, { tunnelId, phase }) ===
										"connecting" ? (
										<Badge
											label={t("mobile.computers.badge.connecting")}
											tone="info"
											mono
										/>
									) : (
										<Button
											testID={CONTROL.settingsUseComputer}
											label={t("mobile.settings.connection.use")}
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
							{t(discoveryFailureKey(discoveryFailure, computers.length > 0))}
						</Text>
					) : null}
					{/* `flex-wrap`: two controls side by side are 2 x (label + padding) wide,
					 *  and at 200 % text that is wider than a 320 pt phone — the row ran to
					 *  399 px (`U-06`, measured). Wrapping keeps both reachable. */}
					<View className="flex-row flex-wrap gap-2 pt-1">
						<Button
							testID={CONTROL.settingsRefresh}
							label={t("mobile.settings.connection.refresh")}
							onPress={() => void refreshComputers()}
							/* ONE STYLE FOR THE THREE (visual audit D15). Refresh was
							 *  outlined while its two neighbours were plain text, which
							 *  ranked a background re-read above "Switch computer" — the
							 *  action a reader actually comes here for. None of the three
							 *  is the section's primary action, so all three are quiet. */
							variant="quiet"
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
							label={t("mobile.computers.switch")}
							onPress={switcher.open}
							variant="quiet"
							size="sm"
						/>
						<Button
							testID={CONTROL.settingsAddComputer}
							label={t("mobile.computers.add")}
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
					<SectionHeader label={t("mobile.settings.section.appearance")} />
					{/* The mode stays here, one tap away, as it was; WHICH palette each
					 *  side paints is the Theme screen behind the row below (decision
					 *  record § 5). The Segmented keeps its ids, so the settings flows
					 *  and proofs that drive it are unchanged. */}
					{/* VISIBLE LABELS (visual audit D15). Both segmented controls had
					 *  an accessible name and no visible one, so a sighted reader met
					 *  "System / Dark / Light" directly above "System / 100% / 150% /
					 *  200%" and had to infer which was which from the options. The
					 *  label is the control's own accessible name, drawn — so the two
					 *  cannot drift (WCAG 2.5.3) — and hidden from assistive tech,
					 *  which already hears it as the group's name. The theme control
					 *  says "Theme mode", not "Theme": the row right under it is
					 *  already labelled "Theme" and opens the palette picker. */}
					<View className="gap-2">
						<Text aria-hidden className="text-label text-ink-muted">
							{t("mobile.settings.theme.mode_label")}
						</Text>
						<Segmented<ThemeMode>
							testID={CONTROL.settingsThemeGroup}
							label={t("mobile.settings.theme.mode_label")}
							value={theme}
							onChange={setPreference}
							options={[
								{
									value: "system",
									label: t("mobile.settings.theme.mode_system"),
									testID: CONTROL.settingsThemeSystem,
								},
								{
									value: "dark",
									label: t("mobile.settings.theme.mode_dark"),
									testID: CONTROL.settingsThemeDark,
								},
								{
									value: "light",
									label: t("mobile.settings.theme.mode_light"),
									testID: CONTROL.settingsThemeLight,
								},
							]}
						/>
					</View>
					<ThemeRow />
					<View className="gap-2">
						<Text aria-hidden className="text-label text-ink-muted">
							{t("mobile.settings.text_size.label")}
						</Text>
						<Segmented
							testID={CONTROL.settingsTextScaleGroup}
							label={t("mobile.settings.text_size.label")}
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
					</View>
					<Text className="text-body-sm text-ink-dim">
						{textScale.preference === "system"
							? t("mobile.settings.text_size.following", {
									percent: Math.round(textScale.platformScale * 100),
								})
							: t("mobile.settings.text_size.overridden", {
									percent: Math.round(textScale.platformScale * 100),
								})}
					</Text>
				</View>

				<Divider />

				{/* ------------------------------------------------------------ sidebar */}
				<SidebarSettingsSection onLayoutY={onSidebarLayout} />

				<Divider />

				{/* ------------------------------------------------------ notifications */}
				<NotificationsSection />

				<Divider />

				{/* -------------------------------------------------------- diagnostics */}
				<View className="gap-2" testID={REGION.settingsDiagnostics}>
					<SectionHeader label={t("mobile.settings.section.diagnostics")} />
					<DiagnosticRow
						label={t("mobile.settings.diagnostics.route")}
						value={
							route
								? route.mode === "radient"
									? t("mobile.settings.diagnostics.route_radient")
									: t("mobile.settings.diagnostics.route_direct")
								: t("mobile.settings.diagnostics.none")
						}
					/>
					<DiagnosticRow
						label={t("mobile.settings.diagnostics.stream")}
						value={streamWord(streamHealth)}
					/>
					{/* The raw code behind "Not answering"/"Asleep" — which degraded input
					 *  the app actually received (a stall, a gateway reason, a relay code,
					 *  a transport failure). Shown as `reason: <code>`, untranslated and
					 *  selectable, because it is what a support thread greps for; only the
					 *  label is keyed. See `stream-health-reason.ts`. */}
					<DiagnosticRow
						label={t("mobile.settings.diagnostics.reason")}
						value={(() => {
							const code = diagnosticReason({
								health: streamHealth,
								healthReason: streamHealthReason,
								lastError,
								refused: refusal !== null,
							});
							/* Through Copy diagnostics' `redact` (PR #261): the code is
							 *  identifier-shaped by construction, but a 48-64 character
							 *  opaque identifier still passes that shape, and this row is
							 *  selectable, so it is copied out by hand. */
							return code
								? diagnosticsReasonValue(code)
								: t("mobile.settings.diagnostics.none");
						})()}
						selectable
						testID={CONTROL.settingsDiagnosticsReason}
					/>
					<DiagnosticRow
						label={t("mobile.settings.diagnostics.last_error")}
						/* The diagnostics-only record (PR #261 R1/U3): a retrying or
						 *  stalled stream's cause as well as a terminal one, so "Not
						 *  answering" is never next to "None". */
						value={
							diagnosticError
								? diagnosticError.summary
								: t("mobile.settings.diagnostics.none")
						}
					/>
					{/* WHICH tunnel this phone is on, so whoever is helping can compare
					 *  it with the computer's Phone access block (Settings → Radient account) — no terminal on
					 *  either side. A wrong id here is the "phone on the old tunnel"
					 *  case that otherwise reads as a sleeping computer. */}
					{route?.mode === "radient" ? (
						<>
							<DiagnosticRow
								label={t("mobile.settings.diagnostics.tunnel")}
								value={route.tunnelId}
							/>
							<DiagnosticRow
								label={t("mobile.settings.diagnostics.address")}
								value={route.hostname}
							/>
						</>
					) : null}
					{/* Full size, not `sm` (PR #261 D5): this is the one control a
					 *  helper asks the reader to tap, and `sm` drew a 32 pt pill. */}
					<Button
						testID={CONTROL.settingsCopyDiagnostics}
						label={t(
							copyFeedback === "copied"
								? "mobile.settings.diagnostics.copied"
								: copyFeedback === "failed"
									? "mobile.settings.diagnostics.copy_failed"
									: "mobile.settings.diagnostics.copy",
						)}
						variant="outline"
						onPress={() =>
							void copierRef.current?.copy(
								diagnosticsText({
									route,
									computerName:
										computers.find((computer) => computer.tunnelId === tunnelId)
											?.name ?? null,
									/* What the reader SEES, so a helper on a call reads the same
									 *  words (U7): the Status word and the cause on screen. */
									status: status.message,
									cause: refusal?.copy?.cause ?? transient?.cause ?? null,
									stream: streamWord(streamHealth),
									lastError: diagnosticError?.summary ?? null,
									lastErrorAt: diagnosticError?.at ?? null,
									version,
									platform: Platform.OS,
								}),
							)
						}
					/>
					<Text className="text-body-sm text-ink-dim">
						{t("mobile.settings.diagnostics.privacy_note")}
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
					<SectionHeader label={t("mobile.settings.section.about")} />
					<DiagnosticRow
						label={t("mobile.settings.about.version")}
						value={version}
					/>
					<Text className="text-body-sm text-ink-dim">
						{t("mobile.settings.about.blurb")}
					</Text>
				</View>

				{/* -------------------------------------------------- sign out, delete */}
				<View className="gap-3 pt-2">
					<Button
						label={
							signingOut
								? t("mobile.computers.signing_out")
								: t("mobile.computers.sign_out")
						}
						loading={signingOut}
						disabled={signingOut}
						onPress={() => setConfirmSignOut(true)}
						variant="outline"
						testID={CONTROL.settingsSignOut}
					/>
					<Button
						label={t("mobile.settings.account.delete")}
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
						{t("mobile.settings.account.delete_help")}
					</Text>
				</View>
			</View>

			<Dialog
				visible={confirmSignOut}
				title={t("mobile.settings.sign_out.title")}
				body={t("mobile.settings.sign_out.body")}
				confirmLabel={t("mobile.settings.sign_out.confirm")}
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
	theme: ThemeMode;
	setPreference: (preference: ThemeMode) => void;
} {
	const theme = useUiStore((state) => state.themeSelection.mode);
	const setPreference = useUiStore((state) => state.setThemeMode);
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
	if (!input.routed)
		return {
			state: "inactive",
			message: t("mobile.settings.status.no_connection"),
		};
	if (input.refused)
		return {
			state: "offline",
			message: t("mobile.settings.status.not_connected"),
		};
	/* No stream exists yet while a session is minted, and an idle stream fell
	 *  through to "Connected" (U3). */
	if (input.minting) {
		return { state: "reconnecting", message: t("mobile.computers.connecting") };
	}
	switch (input.health) {
		case "connecting":
			return {
				state: "reconnecting",
				message: t("mobile.computers.connecting"),
			};
		case "offline":
			return { state: "offline", message: t("mobile.settings.status.offline") };
		case "degraded":
			return {
				state: "degraded",
				message: t("mobile.settings.status.not_answering"),
			};
		default:
			return {
				state: "connected",
				message: t("mobile.settings.status.connected"),
			};
	}
}

/** The Diagnostics "Stream" value: the stream health enum, as a keyed word. A
 *  switch rather than a template key so the typed catalogue surface still
 *  checks every key, and a new `StreamHealth` member fails to compile here. */
function streamWord(health: StreamHealth): string {
	switch (health) {
		case "idle":
			return t("mobile.settings.diagnostics.stream_idle");
		case "connecting":
			return t("mobile.settings.diagnostics.stream_connecting");
		case "live":
			return t("mobile.settings.diagnostics.stream_live");
		case "degraded":
			return t("mobile.settings.diagnostics.stream_degraded");
		case "offline":
			return t("mobile.settings.diagnostics.stream_offline");
	}
}

/** One line of the diagnostics block. A label and a value, never only a value:
 *  "degraded" alone tells a reader nothing to act on. */
const DiagnosticRow = ({
	label,
	value,
	selectable = false,
	testID,
}: {
	label: string;
	value: string;
	/** Long-press copy, for a value a reader pastes into a support thread. */
	selectable?: boolean;
	testID?: string;
}) => (
	<View className="flex-row items-start justify-between gap-4">
		<Text className="text-body-sm text-ink-muted">{label}</Text>
		<Text
			className={`flex-1 ${TEXT_END_CLASS} text-mono-sm text-ink-dim`}
			accessibilityRole={ROLE.text}
			numberOfLines={2}
			selectable={selectable}
			testID={testID}
			/* `minWidth: 0` lets this column shrink below its content's width — the
			 *  one lever RN-web honours on every platform for a flex child (`overflow-
			 *  Wrap` is web-only and is not in the `TextStyle` type). */
			/* MIXED CONTENT: a diagnostic value is a path, a hostname, a model id or a
			 *  version — left-to-right by its own grammar even inside an Urdu screen.
			 *  `LTR_WRITING` states that direction without moving the column: the cell
			 *  keeps its trailing alignment (`TEXT_END_CLASS` above), which flips with the
			 *  layout while the value inside it stays readable. */
			style={{ minWidth: 0, ...LTR_WRITING }}
		>
			{value}
		</Text>
	</View>
);
