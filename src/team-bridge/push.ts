/**
 * Team Bridge push, on the device: hub registration, sign-out deregistration,
 * the foreground rule, and the tap.
 *
 * WHY REGISTRATION GOES TO THE HUB, NOT THE RELAY. Team Bridge messages are
 * created on the Radient hub and the hub's fan-out worker sends them
 * (agent-server push slice), so the hub must hold this phone's token. The relay
 * registry (`POST /api/push/register`, ADR 0006 S3) addresses ONE computer's
 * pushes and only works while that computer is awake. Registering with the hub
 * is what makes a teammate's message reach a phone whose owner's laptop is
 * closed.
 *
 * WHEN IT REGISTERS. Only while signed in to Radient, only once the OS
 * permission is ALREADY granted (the prompt stays the Settings press, ADR 0006
 * §5: never from a mount), and only on a native build that carries the module.
 * The call is idempotent on the install id, so re-registering on every launch is
 * how a rotated APNs/FCM token replaces the old one.
 *
 * SIGN-OUT. `unregisterTeamBridgeDevice` is called BEFORE the Radient grant is
 * forgotten, so the hub stops pushing to a phone nobody is signed in to. A
 * failure there is not fatal (the hub also drops a device unseen for 60 days)
 * and never blocks a sign-out.
 *
 * FOREGROUND. expo-notifications' own default, with NO handler installed, is to
 * not present a notification that arrives while the app is open
 * (`NotificationsHandler.ts`: "The default behavior when the handler is not set
 * or does not respond in time is not to show the notification"). This module is
 * the first to install a handler, so it keeps that exact behaviour for every push
 * that is NOT Team Bridge (the relay's completion pushes and their S9 rule are
 * untouched). A Team Bridge push DOES show in the foreground, because a
 * teammate's message on another thread is news, except while the reader is
 * looking at that very thread, where the message is already on screen.
 */

import Constants from "expo-constants";
import { Platform } from "react-native";
import {
	ensureInstallRecord,
	nextBridgePushGeneration,
} from "@/notifications/install-id";
import {
	loadNotifications,
	notificationsSupported,
} from "@/notifications/native";
import type { HubClient } from "@/team-bridge/client";
import {
	type TeamBridgePush,
	teamBridgePushFromResponse,
} from "@/team-bridge/push-payload";

/** The Android channel the hub names (`channelId: "team-bridge"`). Created at
 *  start, because FCM falls back to the default channel for an unknown id. */
export const TEAM_BRIDGE_CHANNEL_ID = "team-bridge";

export type RegistrationOutcome =
	| "registered"
	| "unsupported"
	| "permission"
	| "no-token"
	| "failed";

/**
 * Register this phone with the hub when everything it needs is already true.
 * Never prompts and never throws: the outcome is for diagnostics only.
 */
export async function registerTeamBridgeDevice(
	hub: HubClient,
	isCurrent: () => boolean = () => true,
): Promise<RegistrationOutcome> {
	if (!notificationsSupported()) return "unsupported";
	const module = await loadNotifications();
	if (module === null) return "unsupported";
	try {
		const permission = await module.getPermissionsAsync();
		if (permission.status !== "granted") return "permission";
		const token = await module.getDevicePushTokenAsync();
		if (typeof token.data !== "string" || token.data.length === 0)
			return "no-token";
		const install = await ensureInstallRecord();
		// Permission/token/keystore reads may outlive sign-out. Do not start a
		// new authenticated PUT once this account's registration lease retired.
		if (!isCurrent()) return "failed";
		const generation = await nextBridgePushGeneration();
		if (!isCurrent()) return "failed";
		await hub.registerDevice({
			installId: install.install_id,
			generation,
			platform: token.type === "ios" ? "ios" : "android",
			token: token.data,
			/* A development build talks to the APNs sandbox; a release build to
			 *  production. `__DEV__` is the build's own word for which it is. */
			...(token.type === "ios"
				? {
						environment: __DEV__
							? ("sandbox" as const)
							: ("production" as const),
					}
				: {}),
			appVersion: Constants.expoConfig?.version ?? undefined,
		});
		return "registered";
	} catch {
		return "failed";
	}
}

/** Remove this phone from the hub's registry. Best effort; never throws. */
export async function unregisterTeamBridgeDevice(
	hub: HubClient,
): Promise<void> {
	if (!notificationsSupported()) return;
	try {
		const install = await ensureInstallRecord();
		const generation = await nextBridgePushGeneration();
		await hub.unregisterDevice(install.install_id, generation);
	} catch {
		/* The hub's 60-day unseen drop is the backstop; a sign-out never waits on it. */
	}
}

/** The thread the reader is looking at, set by the thread screen while focused. */
let watched: { tenantId: string; conversationId: string } | null = null;

export const setWatchedThread = (
	thread: { tenantId: string; conversationId: string } | null,
): void => {
	watched = thread;
};

/** Pure: whether a foreground push should stay silent. */
export function quietWhileWatching(
	push: TeamBridgePush | null,
	current: { tenantId: string; conversationId: string } | null,
): boolean {
	return (
		push !== null &&
		current !== null &&
		push.tenantId === current.tenantId &&
		push.conversationId === current.conversationId
	);
}

let handlerInstalled = false;

/** Pure: the foreground presentation for one arriving notification. */
export function foregroundBehaviour(
	push: TeamBridgePush | null,
	current: { tenantId: string; conversationId: string } | null,
): {
	shouldShowBanner: boolean;
	shouldShowList: boolean;
	shouldPlaySound: boolean;
	shouldSetBadge: boolean;
} {
	/* Not ours: expo's no-handler default (nothing shown), byte for byte. */
	const show = push !== null && !quietWhileWatching(push, current);
	return {
		shouldShowBanner: show,
		shouldShowList: show,
		shouldPlaySound: show,
		/* The icon badge stays app-managed (ADR 0006 §1.5). */
		shouldSetBadge: false,
	};
}

/** Install the foreground handler and the Android channel once per process. */
export async function installTeamBridgeNotifications(): Promise<void> {
	if (handlerInstalled || !notificationsSupported()) return;
	const module = await loadNotifications();
	if (module === null) return;
	handlerInstalled = true;
	try {
		module.setNotificationHandler({
			handleNotification: async (notification) =>
				foregroundBehaviour(
					teamBridgePushFromResponse({ notification }),
					watched,
				),
		});
	} catch {
		handlerInstalled = false;
	}
	if (Platform.OS === "android") {
		try {
			await module.setNotificationChannelAsync(TEAM_BRIDGE_CHANNEL_ID, {
				name: "Team Bridge",
				description: "Messages from your teammates and their agents.",
				importance: module.AndroidImportance.HIGH,
			});
		} catch {
			/* Delivery falls back to the default channel; nothing the reader can act on. */
		}
	}
}

/**
 * Route Team Bridge notification taps, cold and warm. A response that is not a
 * Team Bridge push is left alone: the relay's tap router owns it.
 */
export async function subscribeTeamBridgeTaps(
	onPush: (push: TeamBridgePush) => void,
): Promise<() => void> {
	const module = await loadNotifications();
	if (module === null) return () => {};
	const deliver = (response: unknown): void => {
		const push = teamBridgePushFromResponse(response);
		if (push !== null) onPush(push);
	};
	try {
		const cold = await module.getLastNotificationResponseAsync();
		if (cold !== null && cold !== undefined) deliver(cold);
	} catch {
		/* No last response is a normal cold start. */
	}
	try {
		const subscription =
			module.addNotificationResponseReceivedListener(deliver);
		return () => subscription.remove();
	} catch {
		return () => {};
	}
}
