import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";

import { isPrivateHost } from "@/connection";
import {
	ownTunnelPrefill,
	passwordEntryExplanation,
} from "@/features/auth/computer-switcher-view";
import { useConnection } from "@/features/auth/connection-provider";
import { leaveScreen } from "@/features/auth/leave-screen";
import {
	connectRefusalSentence,
	saveRefusalSentence,
} from "@/features/auth/refusal";
import {
	COMPUTER_COMMANDS,
	TUNNEL_COMMANDS,
	TUNNEL_RULE,
} from "@/features/auth/tunnel-commands";
import { readSavedComputers } from "@/features/auth/tunnel-storage";
import { runTunnelTest } from "@/features/auth/tunnel-test";
import type { TunnelTestVerdict } from "@/features/auth/tunnel-verdict";
import { verdictSentence } from "@/features/auth/tunnel-verdict";
import { t } from "@/i18n";
import { sentencePlatform } from "@/lib/platform";
import { CONTROL, REGION, ROLE, SCREEN } from "@/ui/a11y";
import { Alert } from "@/ui/components/alert";
import { BackButton } from "@/ui/components/back-button";
import { Button } from "@/ui/components/button";
import { CommandBlock } from "@/ui/components/command-block";
import { Divider } from "@/ui/components/divider";
import { Input } from "@/ui/components/input";
import { Screen } from "@/ui/components/screen";
import { SectionHeader } from "@/ui/components/section-header";
import { useComposedDir } from "@/ui/direction";

/**
 * Set up your own tunnel — the self-hosted path, with no Radient account anywhere
 * in it.
 *
 * **Why it is a real screen and not a fallback.** A technical reader who already
 * runs their own tunnel can be using this app in two minutes; the only thing that
 * stood in their way was that the app's copy assumed an account. Nothing on this
 * screen needs one, and nothing here mints, bills or discovers: the address and the
 * password are the whole contract (ADR 0002 §4 — the relay's only credential is
 * its cookie).
 *
 * **The four steps are the four things that can be wrong**, which is why they are
 * in this order:
 *
 *  1. the daemon on the computer (nothing answers without it),
 *  2. the tunnel that publishes it (`cloudflared`, `ngrok`, or anything else),
 *  3. the address and password in the app,
 *  4. a REAL request that proves 1–3 end to end before anything is saved.
 *
 * Step 4 is the point of the screen: a saved-but-wrong tunnel is a dead app with a
 * spinner, and the verdict names which of the four steps is the broken one.
 */
/**
 * A numbered step on this screen, one level ABOVE the command labels.
 *
 * Measured before this: the four steps ("1. On the computer" … "4. Test it") and the
 * command blocks' own labels ("Install on the computer", "Or run it in the
 * foreground", "Check it") all rendered at the same `mono-label` 11 px in `ink-dim`,
 * so only the numeral told a reader which was the step and which the sub-step (D9).
 * The numeral stays mono — it is a machine-side marker — and the words take the
 * heading step, which is the level the command labels sit under.
 */
/*
 * The numeral and the words arrive SEPARATELY (M3 S2a): the header used to split
 * one English string on its first space, which has no meaning in a language
 * written without spaces, and would hand a translator a numeral to preserve
 * inside the sentence. The numeral is a fixed machine-side marker, so it stays a
 * literal; only the words are catalogue copy.
 */
const StepHeader = ({ numeral, label }: { numeral: string; label: string }) => {
	return (
		<View className="flex-row items-baseline gap-2">
			<Text className="text-mono-sm text-ink-dim">{numeral}</Text>
			<Text className="text-heading text-ink" accessibilityRole={ROLE.header}>
				{label}
			</Text>
		</View>
	);
};

export default function OwnTunnel() {
	const router = useRouter();
	/* The Urdu password placeholder opens with a Latin token, so the EMPTY field
	 *  needs the page's direction stated (`Input.placeholderDir`); typed text keeps
	 *  the field's own inferred base. */
	const composedDir = useComposedDir();
	const { saveCustomRoute, connectCustomOutcome } = useConnection();
	const { savedTunnel: saved } = useConnection();
	/* `?computer=<registry id>` is the computer switcher's hand-off for an
	 *  own-address computer with no stored password: only one password slot exists
	 *  until per-phone keys arrive with pairing, so a second saved address opens
	 *  here, pre-filled, rather than in a password store this app does not have.
	 *
	 *  The id ONLY: the address and the plain-http opt-in are read from the
	 *  registry. A `?url=` and `?insecure=1` this screen trusted could be set by any
	 *  link that opens it (review round 1, m1). An unknown id is ignored and the
	 *  screen is the ordinary set-up guide. */
	const { computer: computerParam } = useLocalSearchParams<{
		computer?: string;
	}>();
	const computerId =
		typeof computerParam === "string" && computerParam.length > 0
			? computerParam
			: null;
	const [known, setKnown] = useState<{ id: string; name: string } | null>(null);

	const [url, setUrl] = useState(computerId ? "" : (saved?.baseUrl ?? ""));
	const [password, setPassword] = useState(
		computerId ? "" : (saved?.password ?? ""),
	);
	const [allowInsecure, setAllowInsecure] = useState(
		computerId ? false : (saved?.allowInsecure ?? false),
	);
	useEffect(() => {
		if (computerId === null) return;
		let live = true;
		void readSavedComputers().then((entries) => {
			if (!live) return;
			const prefill = ownTunnelPrefill(
				entries,
				computerId,
				saved
					? {
							baseUrl: saved.baseUrl,
							password: saved.password,
							allowInsecure: saved.allowInsecure,
						}
					: null,
			);
			if (!prefill) return;
			setKnown({ id: prefill.computerId, name: prefill.name });
			setUrl(prefill.url);
			/* The slot's password only when the slot IS this address — never another
			 *  computer's (`ownTunnelPrefill`). */
			setPassword(prefill.password);
			/* The plain-http opt-in the reader already gave THIS address, as the
			 *  registry recorded it; never inferred from the host. */
			setAllowInsecure(prefill.allowInsecure);
		});
		return () => {
			live = false;
		};
	}, [computerId, saved]);
	const [testing, setTesting] = useState(false);
	const [saving, setSaving] = useState(false);
	const [verdict, setVerdict] = useState<TunnelTestVerdict | null>(null);
	/* Why the last Save and connect was refused, as the reader's sentence. */
	const [connectError, setConnectError] = useState<string | null>(null);
	/* Connected, but the keystore refused to keep the route: the sentence to show
	 *  before the reader moves on, since nothing on home would say it. */
	const [unsaved, setUnsaved] = useState<string | null>(null);

	/* An edit makes both the test result and the last refusal describe input that
	 *  is no longer in the fields (design D1 / UX U4, PR #220): a green "Connected"
	 *  for an address the reader has since changed, or a red reason for a password
	 *  they have already corrected. Clearing the verdict also re-gates Save and
	 *  connect on a test of what is actually typed, which is what `canSave` and its
	 *  "Test the connection first" hint already promise. The prefill effect above
	 *  uses the raw setters on purpose: loading the saved entry is not an edit. */
	const edited = useCallback(() => {
		setVerdict(null);
		setConnectError(null);
	}, []);
	const editUrl = useCallback(
		(value: string) => {
			setUrl(value);
			edited();
		},
		[edited],
	);
	const editPassword = useCallback(
		(value: string) => {
			setPassword(value);
			edited();
		},
		[edited],
	);
	const toggleInsecure = useCallback(() => {
		setAllowInsecure((value) => !value);
		edited();
	}, [edited]);

	const test = useCallback(async () => {
		setTesting(true);
		setVerdict(null);
		const result = await runTunnelTest({ url, password, allowInsecure });
		setVerdict(result.verdict);
		setTesting(false);
	}, [allowInsecure, password, url]);

	/* Home ONLY once the route is live. This used to `router.replace("/")` after
	 *  every attempt, so a refused connect dropped the reader on home's "Not
	 *  connected / Not answering" with no reason and with the address and password
	 *  they had just typed gone from view (diagnostic run 42855980853, PR #216). A
	 *  refusal now stays here: the fields keep their state (nothing below clears
	 *  them), the reason is shown inline beside the button, and Retry re-runs the
	 *  same draft. A superseded attempt says nothing — the newer action owns the
	 *  screen.
	 *
	 *  The previous refusal is NOT cleared when the attempt starts, only replaced
	 *  when its outcome arrives (UX U1, PR #220): clearing it first unmounted the
	 *  alert under the reader's finger, so Retry's own spinner never showed and
	 *  keyboard/screen-reader focus fell back to the top of the screen. */
	const saveAndConnect = useCallback(async () => {
		setSaving(true);
		setUnsaved(null);
		try {
			const stored = await saveCustomRoute({ url, password, allowInsecure });
			/* A known computer reconnects as ITSELF: the registry id goes through, so
			 *  the live route is recorded against this entry, not forked by address. */
			const outcome = await connectCustomOutcome({
				url,
				password,
				allowInsecure,
				...(known ? { computerId: known.id } : {}),
			});
			if (outcome.status === "refused") {
				setConnectError(connectRefusalSentence(outcome));
				return;
			}
			setConnectError(null);
			if (outcome.status === "superseded") return;
			if (stored?.storageRefusal) {
				setUnsaved(saveRefusalSentence(stored.storageRefusal));
				return;
			}
			router.replace("/");
		} finally {
			setSaving(false);
		}
	}, [
		allowInsecure,
		connectCustomOutcome,
		known,
		password,
		router,
		saveCustomRoute,
		url,
	]);

	/* The password is optional only where the relay genuinely does not ask for one:
	 * a route that requires it cannot be saved with an empty field, and the disabled
	 * state says which field is missing rather than going grey silently. */
	const canSave = url.trim().length > 0 && verdict?.kind === "ok";

	const testAndSave = (
		<>
			<Button
				label={
					testing
						? t("mobile.computers.own_tunnel.testing")
						: t("mobile.computers.own_tunnel.test")
				}
				onPress={() => void test()}
				loading={testing}
				disabled={testing || url.trim().length === 0}
				testID={CONTROL.ownTunnelTest}
			/>
			{/* Hidden, not cleared, while a refusal is shown (design D1): a green
			 *  "Connected" above a red "Couldn't connect" reads as two answers to one
			 *  action. The verdict itself stays so Save and connect remains enabled —
			 *  the tunnel DID answer the test; clearing it would swap the refusal's
			 *  reason for a misleading "Test the connection first". */}
			{verdict && !connectError ? <VerdictBlock verdict={verdict} /> : null}
			<Button
				label={
					saving
						? t("mobile.computers.own_tunnel.saving")
						: t("mobile.computers.own_tunnel.save_connect")
				}
				onPress={() => void saveAndConnect()}
				disabled={!canSave || saving}
				/* `custom-connect` rather than a new name: this IS the act the
				 *  wave-1 flow `01-first-run-sign-in.yaml` performs on this screen,
				 *  and a second identifier for one action is a second way to do it. */
				testID={CONTROL.customConnect}
			/>
			{connectError ? (
				<Alert
					severity="error"
					title={t("mobile.computers.connect_refused.title")}
					testID={REGION.ownTunnelConnectRefused}
					action={{
						label: t("mobile.computers.retry"),
						onPress: () => void saveAndConnect(),
						loading: saving,
						testID: CONTROL.ownTunnelConnectRetry,
					}}
				>
					{connectError}
				</Alert>
			) : null}
			{unsaved ? (
				<Alert
					severity="warning"
					title={t("mobile.computers.save_refused.title")}
					testID={REGION.ownTunnelUnsaved}
					action={{
						label: t("mobile.computers.save_refused.continue"),
						onPress: () => router.replace("/"),
						testID: CONTROL.ownTunnelUnsavedContinue,
					}}
				>
					{unsaved}
				</Alert>
			) : null}
			{!canSave ? (
				<Text className="text-body-sm text-ink-dim">
					{url.trim().length === 0
						? t("mobile.computers.own_tunnel.need_address")
						: t("mobile.computers.own_tunnel.need_test")}
				</Text>
			) : null}
		</>
	);

	/* A computer the phone already knows, handed over by the switcher: only its
	 *  password is missing, so the screen is that one field, focused, with the same
	 *  Test → Save order the set-up guide keeps (a tunnel that has not answered once
	 *  is not one to save). The guide put the field at y≈1480 under three set-up
	 *  steps the reader had already done, and named nothing, so the tap read as the
	 *  wrong page (UX round 1, U4). */
	if (known) {
		return (
			<Screen
				title={t("mobile.computers.own_tunnel.title")}
				testID={SCREEN.ownTunnel}
				headerLeading={
					<BackButton
						testID={CONTROL.ownTunnelBack}
						onPress={() => leaveScreen(router)}
					/>
				}
			>
				<View className="gap-4 pt-2">
					<Text
						className="text-heading text-ink"
						accessibilityRole={ROLE.header}
					>
						{t("mobile.computers.own_tunnel.password_for", {
							name: known.name,
						})}
					</Text>
					<Text className="text-body-sm text-ink-muted">
						{passwordEntryExplanation(saved?.baseUrl ?? null, url)}
					</Text>
					<Text
						className="text-mono-sm text-ink-dim"
						numberOfLines={1}
						ellipsizeMode="middle"
					>
						{url}
					</Text>
					<Input
						label={t("mobile.computers.own_tunnel.password_label")}
						value={password}
						onChangeText={editPassword}
						placeholder={t("mobile.computers.password_placeholder")}
						placeholderDir={composedDir}
						secureTextEntry
						autoCapitalize="none"
						autoFocus
						testID={CONTROL.customPasswordField}
					/>
					{testAndSave}
				</View>
			</Screen>
		);
	}

	return (
		<Screen
			title={t("mobile.computers.own_tunnel.title")}
			testID={SCREEN.ownTunnel}
			headerLeading={
				<BackButton
					testID={CONTROL.ownTunnelBack}
					onPress={() => leaveScreen(router)}
				/>
			}
		>
			<View className="gap-4 pt-2">
				<Text className="text-body text-ink">
					{t("mobile.computers.own_tunnel.intro")}
				</Text>

				{/* ------------------------------------------------ 1. the computer */}
				<View className="gap-2">
					<StepHeader
						numeral="1."
						label={t("mobile.computers.own_tunnel.step_computer")}
					/>
					<Text className="text-body-sm text-ink-muted">
						{t("mobile.computers.own_tunnel.step_computer_help")}
					</Text>
					{COMPUTER_COMMANDS.map((item) => (
						<CommandBlock
							key={item.command}
							label={item.label}
							note={item.note}
							command={item.command}
						/>
					))}
				</View>

				<Divider />

				{/* -------------------------------------------------- 2. the tunnel */}
				<View className="gap-2">
					<StepHeader
						numeral="2."
						label={t("mobile.computers.own_tunnel.step_publish")}
					/>
					<Text className="text-body-sm text-ink-muted">{TUNNEL_RULE}</Text>
					{TUNNEL_COMMANDS.map((item) => (
						<CommandBlock
							key={item.command}
							label={item.label}
							note={item.note}
							command={item.command}
						/>
					))}
				</View>

				<Divider />

				{/* ------------------------------------------------- 3. the address */}
				<View className="gap-3">
					<StepHeader
						numeral="3."
						label={t("mobile.computers.own_tunnel.step_app")}
					/>
					<Input
						label={t("mobile.computers.own_tunnel.url_label")}
						value={url}
						onChangeText={editUrl}
						placeholder="https://your-tunnel.example.com"
						autoCapitalize="none"
						testID={CONTROL.customUrlField}
					/>
					<Input
						label={t("mobile.computers.own_tunnel.password_label")}
						value={password}
						onChangeText={editPassword}
						placeholder={t("mobile.computers.password_placeholder")}
						placeholderDir={composedDir}
						secureTextEntry
						autoCapitalize="none"
						testID={CONTROL.customPasswordField}
					/>
					<View className="gap-2">
						<Button
							label={
								allowInsecure
									? t("mobile.computers.own_tunnel.insecure_allowed")
									: t("mobile.computers.own_tunnel.insecure_allow")
							}
							onPress={toggleInsecure}
							variant={allowInsecure ? "outline" : "quiet"}
							size="sm"
							testID={CONTROL.customInsecureOptIn}
							accessibilityHint={t("mobile.computers.own_tunnel.insecure_hint")}
						/>
						<Text className="text-body-sm text-ink-dim">
							{allowInsecure
								? t("mobile.computers.own_tunnel.insecure_on_help")
								: t("mobile.computers.own_tunnel.insecure_off_help")}
						</Text>
						<View>
							{!allowInsecure && url.trim().startsWith("http://") ? (
								<Alert
									severity="warning"
									title={t("mobile.computers.own_tunnel.unencrypted_title")}
								>
									{t("mobile.computers.own_tunnel.unencrypted_body")}
								</Alert>
							) : null}
							{allowInsecure && url.trim().startsWith("http://") ? (
								<Text className="pt-1 text-body-sm text-warning">
									{isPrivateHost(hostOf(url))
										? t("mobile.computers.own_tunnel.private_host")
										: t("mobile.computers.own_tunnel.public_host")}
								</Text>
							) : null}
						</View>
					</View>
				</View>

				{/* ---------------------------------------------------- 4. the test */}
				<View className="gap-3">
					<StepHeader
						numeral="4."
						label={t("mobile.computers.own_tunnel.step_test")}
					/>
					<Text className="text-body-sm text-ink-muted">
						{t("mobile.computers.own_tunnel.step_test_help")}
					</Text>
					{testAndSave}
				</View>

				<Divider />

				{/* ------------------------------------------------------- security */}
				<View className="gap-2">
					<SectionHeader
						label={t("mobile.computers.own_tunnel.security_heading")}
					/>
					<Text className="text-body-sm text-ink-dim">
						{t("mobile.computers.own_tunnel.security_body", {
							command: "lop mobile password",
						})}
					</Text>
				</View>
			</View>
		</Screen>
	);
}

/** The host part of a typed address, for the private-host note. Never throws:
 *  the field is being typed into, so a half-written address is normal. */
function hostOf(value: string): string {
	try {
		return new URL(value.includes("://") ? value : `https://${value}`).hostname;
	} catch {
		return "";
	}
}

/** What the test found, in the taxonomy's own sentence. */
const VerdictBlock = ({ verdict }: { verdict: TunnelTestVerdict }) => {
	const remedy = verdict.kind === "offline" ? verdict.remedy : null;
	return (
		<>
			<Alert
				severity={
					verdict.kind === "ok"
						? "success"
						: verdict.kind === "invalid"
							? "warning"
							: "error"
				}
				title={
					verdict.kind === "ok"
						? t("mobile.computers.own_tunnel.verdict_ok")
						: t("mobile.computers.own_tunnel.verdict_not_yet")
				}
			>
				{verdictSentence(verdict, sentencePlatform())}
			</Alert>
			{/* The remedy is a separate line because it is a command to run, not part
			 *  of the diagnosis — the same split `refusal-surface.tsx` makes. */}
			{remedy ? (
				<Text className="text-body-sm text-ink-dim">{remedy}</Text>
			) : null}
		</>
	);
};
