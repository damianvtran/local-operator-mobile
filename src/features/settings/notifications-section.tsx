import { useCallback, useEffect, useState } from "react";
import { Platform, Text, View } from "react-native";
import { useStore } from "zustand";

import type { PushDeviceRow } from "@/contracts";
import {
	useConnection,
	useConnectionState,
	useListState,
} from "@/features/auth/connection-provider";
import { SwitchRow } from "@/features/sessions/sidebar-view-controls";
import { t } from "@/i18n";
import { deviceStateDescription, deviceTitle } from "@/notifications/devices";
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
	PUSH_ENABLE_LABEL,
	type PushAvailability,
	pushCopy,
} from "@/notifications/permission";
import {
	sessionPushRegistrationStore,
	sessionPushRouteKey,
} from "@/notifications/session-push-registration-state";
import { sessionPushStatusCopy } from "@/notifications/session-push-status";
import { requestSessionPushRegistration } from "@/notifications/use-session-push-registration";
import { isRelayMissing } from "@/relay";
import { useTeamBridge } from "@/team-bridge/provider";
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
 *     while the OS has not been asked. The prompt fires from the press, never
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
 *     disabled with a note to update the computer. Team Bridge is app-only: it
 *     adds or removes the hub registration. `notification-preferences.ts` has
 *     the contract and the rules.
 *  4. **Nothing promised.** Team Bridge registration IS wired: the Team
 *     Bridge provider registers this phone with Radient's hub on launch and
 *     foreground once permission is granted, and the hub fans out over
 *     APNs/FCM (app and cloud since 2026-10-27; `docs/publishing/push-setup.md`
 *     has the operator-owned credential steps). Delivery still depends on
 *     those credentials, which this screen cannot see, so the copy says
 *     "when Radient's push delivery is available" rather than promising an
 *     alert. Computer (relay) background alerts remain unbuilt (ADR 0006 S7),
 *     and every "on" state still says those work only while the app is open.
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
	| { kind: "ready"; devices: PushDeviceRow[] }
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

	const loadDevices = useCallback(async () => {
		const client = relay();
		if (client === null) {
			setDeviceList({ kind: "error" });
			return;
		}
		try {
			const payload = await client.pushDevices();
			setDeviceList({ kind: "ready", devices: payload.devices });
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
		radientSignedIn,
	});
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
			<SectionHeader label="Notifications" />
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
					label={PUSH_ENABLE_LABEL}
					onPress={() => void onEnable()}
					disabled={requesting}
					variant="outline"
					size="sm"
				/>
			) : null}
			{/* The preference switches (operator request, 2026-11-14). Absent when
			 *  the OS denied: the sentence above already names the system-settings
			 *  remedy, and a switch the OS overrides would claim a control the
			 *  reader does not have. */}
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
							<SwitchRow
								label={t("mobile.notifications.preferences.completions")}
								value={preferences.completions}
								disabled={view.sessionDisabled}
								onChange={(completions) => void onPreference({ completions })}
								testID={CONTROL.settingsNotificationsCompletions}
							/>
							<SwitchRow
								label={t("mobile.notifications.preferences.errors")}
								value={preferences.errors}
								disabled={view.sessionDisabled}
								onChange={(errors) => void onPreference({ errors })}
								testID={CONTROL.settingsNotificationsErrors}
							/>
							<SwitchRow
								label={t("mobile.notifications.preferences.previews")}
								value={preferences.previews}
								disabled={view.previewsDisabled}
								onChange={(previews) => void onPreference({ previews })}
								testID={CONTROL.settingsNotificationsPreviews}
							/>
							{/* One plain line on where the text travels — the
							 *  provider named per platform, no lecture (operator,
							 *  2026-11-14: default on, "as easy as possible"). */}
							<Text className="text-body-sm text-ink-dim">
								{Platform.OS === "android"
									? t("mobile.notifications.preferences.previews_note_android")
									: t("mobile.notifications.preferences.previews_note_ios")}
							</Text>
						</>
					) : null}
					{view.teamBridge ? (
						<SwitchRow
							label={t("mobile.notifications.preferences.team_bridge")}
							value={preferences.teamBridge}
							onChange={(teamBridge) => void onPreference({ teamBridge })}
							testID={CONTROL.settingsNotificationsTeamBridge}
						/>
					) : null}
					{view.updateNote ? (
						<Text className="text-body-sm text-ink-dim">
							{t("mobile.notifications.preferences.update_computer")}
						</Text>
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
				deviceList.devices.map((device) => (
					<View key={device.device_id} className="gap-1">
						<Text className="text-body-sm text-ink">{deviceTitle(device)}</Text>
						<Text className="text-body-sm text-ink-dim">
							{deviceStateDescription(device.state)}
						</Text>
					</View>
				))
			)}
		</View>
	);
};
