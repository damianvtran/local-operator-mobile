import { useCallback, useEffect, useState } from "react";
import { AppState, Linking, Platform, Text, View } from "react-native";
import { useStore } from "zustand";

import type { PushDeviceRow } from "@/contracts";
import {
	useConnection,
	useConnectionState,
	useListState,
} from "@/features/auth/connection-provider";
import { SwitchRow } from "@/features/sessions/sidebar-view-controls";
import { t } from "@/i18n";
import {
	openChannelSettings,
	readChannelBlocked,
} from "@/notifications/channel-state";
import {
	deviceListEntries,
	deviceStateDescription,
} from "@/notifications/devices";
import { readInstallRecord } from "@/notifications/install-id";
import { readAvailability, requestPermission } from "@/notifications/native";
import {
	loadNotificationPreferences,
	type NotificationPreferences,
	notificationPreferencesStore,
	type PushCapabilities,
	preferenceView,
	pushCapabilities,
	registrationAffected,
	teamBridgeWanted,
	updateNotificationPreferences,
} from "@/notifications/notification-preferences";
import {
	availabilityFromHook,
	canRequestPermission,
	type PushAvailability,
	pushCopy,
	pushEnableLabel,
} from "@/notifications/permission";
import {
	sessionPushRegistrationStore,
	sessionPushRouteKey,
} from "@/notifications/session-push-registration-state";
import { sessionPushStatusCopy } from "@/notifications/session-push-status";
import { requestSessionPushRegistration } from "@/notifications/use-session-push-registration";
import { isRelayMissing } from "@/relay";
import { TEAM_BRIDGE_CHANNEL_ID } from "@/team-bridge/android-presentation";
import { useTeamBridge } from "@/team-bridge/provider";
import { teamBridgeFixture } from "@/testing/team-bridge-fixture";
import { CONTROL, REGION } from "@/ui/a11y";
import { Button } from "@/ui/components/button";
import { SectionHeader } from "@/ui/components/section-header";

/**
 * Notifications, in Settings, where the toggle is (ADR 0006 §2.4/§5).
 *
 * Three facts, each rendered only when it is known:
 *
 *  1. **The permission state**, in the app's own vocabulary
 *     (`notifications/permission.ts`), with the enable control present ONLY
 *     while the OS has not been asked (and, once denied, the same label
 *     opening the OS settings instead). The prompt fires from the press, never
 *     from a mount — "requested in context, with the §2.4 copy already on
 *     screen" — and a build without the module says so instead of offering a
 *     toggle that cannot work.
 *  2. **This computer's registered devices**, read from `GET /api/push/devices`
 *     (read-only: opening Settings bumps nothing). A relay that predates the
 *     route answers a refusal, and that is rendered as its own sentence rather
 *     than as an empty list — "no devices" and "cannot read the list" are
 *     different facts, and the second must not borrow the first's words.
 *  3. **This phone's registration with THIS computer**
 *     (`session-push-registration.ts`), one sentence from
 *     `session-push-status.ts`, shown only for the routed computer and only
 *     when it adds a fact the permission sentence does not already state. A
 *     successful registration re-reads the device list, so the row it created
 *     appears without leaving the screen.
 *  3b. **What this phone wants** (operator request, 2026-11-14): a master
 *     switch, "Agent finished", "Agent hit an error" and "Team Bridge
 *     messages". The first three ride to the computer's daemon in the register
 *     body, gated on its `push_preferences` capability (an older daemon would
 *     refuse the field and the whole registration); without it they show
 *     disabled with a note that a newer Local Operator is needed, and an "off"
 *     that cannot reach that computer says it keeps sending (PR #264 D1/U1).
 *     Shown only once the OS has granted. Team Bridge is app-only: it
 *     adds or removes the hub registration. `notification-preferences.ts` has
 *     the contract and the rules.
 *  4. **Nothing promised.** Team Bridge registration IS wired: the Team
 *     Bridge provider registers this phone with Radient's hub on launch and
 *     foreground once permission is granted, and the hub fans out over
 *     APNs/FCM (app and cloud since 2026-10-27; `docs/publishing/push-setup.md`
 *     has the operator-owned credential steps). Delivery still depends on
 *     those credentials, which this screen cannot see, so the copy says
 *     "when Radient's push delivery is available" rather than promising an
 *     alert. Computer session pushes are registered by this phone
 *     (`session-push-registration.ts`), so the permission sentence no longer
 *     says they are off (PR #264 D2/U3).
 *
 * On the web target the permission read is the platform's `unsupported`, or —
 * for the harness only — the `lo-notifications` query value, the same
 * convention as `lo-relay`/`lo-conversation`: a URL can steer the page and
 * never the installed app (`permission.ts`'s hook note explains why the design
 * round needs it).
 */

const hookAvailability = (): PushAvailability | null => {
	if (Platform.OS !== "web" || typeof location === "undefined") return null;
	return availabilityFromHook(
		new URLSearchParams(location.search).get("lo-notifications"),
	);
};

type DeviceListState =
	| { kind: "loading" }
	| {
			kind: "ready";
			devices: PushDeviceRow[];
			/** This phone's id on the routed computer, or null when unknown. */
			thisDeviceId: string | null;
	  }
	/** The relay answered a refusal that says the route is not there. */
	| { kind: "unsupported" }
	/** The read failed for another reason — do not claim the route is absent. */
	| { kind: "error" };

export const NotificationsSection = () => {
	const { relay, radientSignedIn } = useConnection();
	const { registerPush, withdrawPush } = useTeamBridge();
	const route = useConnectionState((s) => s.route);
	const routeKey = route ? sessionPushRouteKey(route) : null;
	const registration = useStore(sessionPushRegistrationStore);
	const registrationCopy = sessionPushStatusCopy(registration, routeKey);
	/* Re-read the list when THIS computer accepts a registration: the first one
	 * creates the row the list would otherwise miss until Settings reopens. */
	const registeredHere =
		registration.routeKey === routeKey ? registration.registeredAt : null;
	const [availability, setAvailability] = useState<PushAvailability | null>(
		null,
	);
	const [requesting, setRequesting] = useState(false);
	const [deviceList, setDeviceList] = useState<DeviceListState>({
		kind: "loading",
	});

	useEffect(() => {
		const hooked = hookAvailability();
		if (hooked !== null) {
			setAvailability(hooked);
			return;
		}
		let cancelled = false;
		void readAvailability().then((next) => {
			if (!cancelled) setAvailability(next);
		});
		return () => {
			cancelled = true;
		};
	}, []);

	/* ADR 0010 S4 (§7 row 9): whether the reader switched the Team Bridge
	 * channel off in Android's system settings. Re-read on every return to the
	 * foreground, because the system page is where they change it and they come
	 * back here from it. Always false off Android (`channel-state.ts`). */
	const [bridgeChannelOff, setBridgeChannelOff] = useState(false);
	useEffect(() => {
		if (Platform.OS !== "android") return;
		let cancelled = false;
		const read = () =>
			void readChannelBlocked(TEAM_BRIDGE_CHANNEL_ID).then((off) => {
				if (!cancelled) setBridgeChannelOff(off);
			});
		read();
		const subscription = AppState.addEventListener("change", (state) => {
			if (state === "active") read();
		});
		return () => {
			cancelled = true;
			subscription.remove();
		};
	}, []);

	const loadDevices = useCallback(async () => {
		const client = relay();
		if (client === null) {
			setDeviceList({ kind: "error" });
			return;
		}
		try {
			const payload = await client.pushDevices();
			/* The web record is session-only (`install-id.ts`), so only a native
			 * keystore's record may name a row "this phone". A failed read just
			 * means no row is marked — the list itself still renders. */
			const record = Platform.OS === "web" ? null : await readInstallRecord();
			setDeviceList({
				kind: "ready",
				devices: payload.devices,
				thisDeviceId: record?.device_id ?? null,
			});
		} catch (error) {
			/* The relay's own 404 is a relay older than the route (S4a); anything
			 * else — the edge's unknown-tunnel 404 (a dead tunnel) included — is a
			 * read that failed on a relay that may well have it. The two
			 * sentences differ because the facts do. */
			setDeviceList({
				kind: isRelayMissing(error) ? "unsupported" : "error",
			});
		}
	}, [relay]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: registeredHere is the re-read trigger, not an input
	useEffect(() => {
		void loadDevices();
	}, [loadDevices, registeredHere]);

	const preferencesState = useStore(notificationPreferencesStore);
	const preferences = preferencesState.preferences;
	const preferencesHydrated = preferencesState.hydrated;
	useEffect(() => {
		void loadNotificationPreferences();
	}, []);
	/* What the routed daemon accepts, from a LIVE frame only (PR #264 R1 m1):
	 * no computer, or this route's first frame not applied yet, is UNKNOWN —
	 * nothing disabled and no "update your computer" note, which would be
	 * false with no computer at all. One primitive key so the selector is
	 * stable across re-renders. */
	const routed = useConnectionState((s) => s.route !== null);
	const capabilityKey = useListState((s) => {
		if (s.lastFrameAt === null) return null;
		const caps = pushCapabilities(s.capabilities);
		return `${caps.preferences ? 1 : 0}${caps.previews ? 1 : 0}`;
	});
	const capability: PushCapabilities | null =
		routed && capabilityKey !== null
			? {
					preferences: capabilityKey[0] === "1",
					previews: capabilityKey[1] === "1",
				}
			: null;
	const view = preferenceView({
		availability,
		capability,
		preferences,
		// The existing loopback-only web fixture owns its synthetic hub identity,
		// not an OAuth grant. Let the settings capture show that same identity;
		// normal web and native builds cannot enter this fixture path.
		radientSignedIn: radientSignedIn || teamBridgeFixture()?.token != null,
	});
	/* At most one note under the switches, and never both: "your computer
	 * keeps sending" when an off choice is not reaching an older computer
	 * (design D1 / UX U1 — the honest fallback, `preferenceView` says why a
	 * withdrawal is not possible), else the update note while switches are
	 * disabled. The keeps-sending line is a fact the reader acts on, so it is
	 * one step brighter than the dim footnotes. */
	const capabilityNote = view.computerKeepsSending ? (
		<Text
			className="text-body-sm text-ink-muted"
			testID={REGION.settingsNotificationsCapabilityNote}
		>
			{t("mobile.notifications.preferences.computer_keeps_sending")}
		</Text>
	) : view.updateNote ? (
		<Text
			className="text-body-sm text-ink-dim"
			testID={REGION.settingsNotificationsCapabilityNote}
		>
			{t("mobile.notifications.preferences.update_computer")}
		</Text>
	) : null;
	/* A dimmed switch read aloud says only "dimmed"; the hint names why
	 * (design D6 / UX U9). Screen-reader only: the note is already on screen. */
	const disabledHint = (disabled: boolean): string | undefined =>
		disabled ? t("mobile.notifications.preferences.disabled_hint") : undefined;
	/* One change: stored, then re-registered AT ONCE so the daemon filters
	 * from now on (a forced POST; the body carries `preferences` only to a
	 * daemon that advertises them), and Team Bridge's hub registration added or
	 * removed when its effective state moved — off DELETEs, on PUTs. */
	const onPreference = useCallback(
		async (patch: Partial<NotificationPreferences>) => {
			const before = teamBridgeWanted(
				notificationPreferencesStore.getState().preferences,
			);
			const next = await updateNotificationPreferences(patch).catch(
				() => notificationPreferencesStore.getState().preferences,
			);
			// Only a switch the daemon filters on re-registers (R1 m2): every
			// register re-mints the device key and forwards to the cloud.
			if (registrationAffected(patch)) requestSessionPushRegistration();
			const after = teamBridgeWanted(next);
			if (radientSignedIn && before !== after) {
				await (after ? registerPush() : withdrawPush()).catch(() => undefined);
			}
		},
		[radientSignedIn, registerPush, withdrawPush],
	);

	const onEnable = useCallback(async () => {
		setRequesting(true);
		try {
			const permission = await requestPermission();
			setAvailability(permission);
			// Permission is requested in context, not on mount. Once granted,
			// register now rather than waiting for a subsequent app foreground:
			// with the routed computer (session pushes) and, when signed in to
			// Radient, with Team Bridge's hub. Both reuse the one OS grant.
			if (permission === "granted") requestSessionPushRegistration();
			if (permission === "granted" && radientSignedIn) await registerPush();
		} finally {
			setRequesting(false);
		}
	}, [registerPush, radientSignedIn]);

	return (
		<View className="gap-2" testID={REGION.settingsNotifications}>
			<SectionHeader label={t("mobile.settings.section.notifications")} />
			{/* The state sentence. `null` is the read in flight — one line, no
			 *  spinner: Settings is a static screen and a spinner here would be
			 *  furniture. `unknown` wears a mark, because a check that FAILED is
			 *  not a refusal (`denied`) and must be distinguishable from one at a
			 *  glance — and its sentence names the remedy the other states cannot
			 *  (checking again), since this is the one state that can change on its
			 *  own. */}
			<View className="flex-row items-start gap-1.5">
				{availability === "unknown" ? (
					<Text className="font-mono text-mono-sm text-ink-muted" aria-hidden>
						?
					</Text>
				) : null}
				<Text className="min-w-0 flex-1 text-body-sm text-ink-muted">
					{availability === null
						? "Checking this phone's notification settings."
						: pushCopy(availability)}
				</Text>
			</View>
			{availability !== null && canRequestPermission(availability) ? (
				<Button
					testID={CONTROL.settingsNotificationsEnable}
					label={pushEnableLabel()}
					onPress={() => void onEnable()}
					disabled={requesting}
					variant="outline"
					size="sm"
				/>
			) : null}
			{/* Denied: the one way out is the OS settings page, so it gets the
			 *  same "Turn on notifications" the nudge and the primer wear (UX R1
			 *  U6/U7) — after the nudge's third dismissal this is the only path. */}
			{availability === "denied" ? (
				<Button
					testID={CONTROL.settingsNotificationsOpenSettings}
					label={pushEnableLabel()}
					onPress={() => void Linking.openSettings().catch(() => undefined)}
					variant="outline"
					size="sm"
				/>
			) : null}
			{/* The preference switches (operator request, 2026-11-14), only once
			 *  the OS has granted (`preferenceView.show`): denied has its
			 *  system-settings remedy, undetermined only "Turn on notifications"
			 *  (UX R1 U4). */}
			{view.show && preferencesHydrated ? (
				<View testID={REGION.settingsNotificationsPreferences}>
					<SwitchRow
						label={t("mobile.notifications.preferences.master")}
						value={preferences.enabled}
						onChange={(enabled) => void onPreference({ enabled })}
						testID={CONTROL.settingsNotificationsMaster}
					/>
					{view.types ? (
						<>
							{/* Keep the global gate separate from the agent categories: both
							 * can be off without unregistering Team Bridge on this phone. */}
							<View className="mt-3 gap-1">
								<SectionHeader
									label={t("mobile.notifications.preferences.agent_heading")}
								/>
								<Text className="text-body-sm text-ink-dim">
									{t("mobile.notifications.preferences.agent_note")}
								</Text>
							</View>
							<SwitchRow
								label={t("mobile.notifications.preferences.completions")}
								value={preferences.completions}
								disabled={view.sessionDisabled}
								accessibilityHint={disabledHint(view.sessionDisabled)}
								onChange={(completions) => void onPreference({ completions })}
								testID={CONTROL.settingsNotificationsCompletions}
							/>
							<SwitchRow
								label={t("mobile.notifications.preferences.errors")}
								value={preferences.errors}
								disabled={view.sessionDisabled}
								accessibilityHint={disabledHint(view.sessionDisabled)}
								onChange={(errors) => void onPreference({ errors })}
								testID={CONTROL.settingsNotificationsErrors}
							/>
							<SwitchRow
								label={t("mobile.notifications.preferences.previews")}
								value={preferences.previews}
								disabled={view.previewsDisabled}
								accessibilityHint={disabledHint(view.previewsDisabled)}
								onChange={(previews) => void onPreference({ previews })}
								testID={CONTROL.settingsNotificationsPreviews}
							/>
							{/* Directly under the switches it explains (UX R1 U8), then
							 *  the kit's `mt-2` before the previews line so the two dim
							 *  lines no longer read as one paragraph (design D3). */}
							{capabilityNote}
							{/* One plain line on where the text travels — the
							 *  provider named per platform, no lecture (operator,
							 *  2026-11-14: default on, "as easy as possible"). */}
							<Text
								className={
									capabilityNote !== null
										? "mt-2 text-body-sm text-ink-dim"
										: "text-body-sm text-ink-dim"
								}
							>
								{Platform.OS === "android"
									? t("mobile.notifications.preferences.previews_note_android")
									: t("mobile.notifications.preferences.previews_note_ios")}
							</Text>
						</>
					) : (
						/* Master off: no switches to explain, only — on an older
						 *  computer — the fact that it keeps sending (D1/U1). */
						capabilityNote
					)}
					{view.teamBridge ? (
						<View className="mt-4 gap-1">
							<SectionHeader
								label={t("mobile.notifications.preferences.bridge_heading")}
							/>
							<SwitchRow
								label={t("mobile.notifications.preferences.team_bridge")}
								value={preferences.teamBridge}
								onChange={(teamBridge) => void onPreference({ teamBridge })}
								testID={CONTROL.settingsNotificationsTeamBridge}
							/>
							{preferences.teamBridge && bridgeChannelOff ? (
								/* The app switch says on, the OS discards: say so, and
								 *  link to the one place it can be turned back on. */
								<View className="gap-2">
									<Text className="text-body-sm text-ink-muted">
										{t("mobile.notifications.preferences.bridge_system_off")}
									</Text>
									<Button
										testID={CONTROL.settingsNotificationsBridgeChannelSettings}
										variant="outline"
										size="sm"
										label={t(
											"mobile.notifications.preferences.bridge_system_open",
										)}
										onPress={() =>
											void openChannelSettings(TEAM_BRIDGE_CHANNEL_ID)
										}
									/>
								</View>
							) : null}
							<Text className="text-body-sm text-ink-dim">
								{t("mobile.notifications.preferences.bridge_note", {
									all: t("mobile.team_bridge.thread.notify_all"),
									mentions: t("mobile.team_bridge.thread.notify_mentions"),
									muted: t("mobile.team_bridge.thread.notify_mute"),
								})}
							</Text>
						</View>
					) : null}
				</View>
			) : null}
			{registrationCopy !== null ? (
				<Text
					className="text-body-sm text-ink-muted"
					testID={REGION.settingsNotificationsRegistration}
				>
					{registrationCopy}
				</Text>
			) : null}
			{/* The registered-device lines. The list is read-only here; removing a
			 *  device is a destructive act with its own confirm flow and is not
			 *  wired in this build. */}
			{deviceList.kind === "loading" ? (
				<Text className="text-body-sm text-ink-dim">
					Checking this computer's registered devices.
				</Text>
			) : deviceList.kind === "unsupported" ? (
				<Text className="text-body-sm text-ink-dim">
					This computer's relay does not support notifications yet.
				</Text>
			) : deviceList.kind === "error" ? (
				<Text className="text-body-sm text-ink-dim">
					Could not read this computer's registered devices.
				</Text>
			) : deviceList.devices.length === 0 ? (
				<Text className="text-body-sm text-ink-dim">
					No devices are registered with this computer yet.
				</Text>
			) : (
				/* This phone first and named as such; every other device carries
				 * when it was last active, so two phones of one model never render
				 * as identical rows (operator report, 2026-11-16: 33 "iPhone" rows). */
				/* Own `gap-3` wrapper: a three-line row needs more separation from
				 * the next than the section's `gap-2` gives (design D4). The state
				 * line is the one that matters when something is wrong, so it
				 * outranks "Last active" in ink (design D5). */
				<View className="gap-3">
					{deviceListEntries(deviceList.devices, deviceList.thisDeviceId).map(
						(entry) => (
							<View key={entry.row.device_id} className="gap-1">
								<Text className="text-body-sm text-ink">{entry.title}</Text>
								{entry.detail !== null ? (
									<Text className="text-body-sm text-ink-dim">
										{entry.detail}
									</Text>
								) : null}
								<Text className="text-body-sm text-ink-muted">
									{deviceStateDescription(entry.row.state)}
								</Text>
							</View>
						),
					)}
				</View>
			)}
		</View>
	);
};
