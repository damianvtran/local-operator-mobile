/**
 * Android notification-channel state, read back from the OS (ADR 0010 S4,
 * §7 row 9).
 *
 * WHY. On Android the reader can switch off one channel in system settings
 * (long-press a notification → "Turn off", or Settings → Apps → Notifications)
 * while the app's own switch still says "on". The OS then discards every post
 * on that channel without telling the app, so the Settings screen would claim
 * Team Bridge messages arrive when none can. iOS has no per-category switch, so
 * this is Android-only.
 *
 * WHAT IT DOES NOT DO. No two-way sync: Android forbids an app from re-enabling
 * a channel the user turned off (`NotificationManager.createNotificationChannel`
 * only updates name and description once a channel exists), so the only honest
 * action is to SAY the channel is off and link to the system page where the
 * reader can turn it back on.
 *
 * Pure decision (`channelBlocked`) and the platform reads are split so the
 * decision is a Node test.
 */

import { Linking, Platform } from "react-native";
import { loadNotifications } from "@/notifications/native";

/** The subset of expo's `NotificationChannel` the decision needs. */
export type ChannelSnapshot = { importance: number } | null;

/** expo-notifications' `AndroidImportance.NONE` (its own enum, NOT the platform
 *  constant `NotificationManager.IMPORTANCE_NONE` = 0). Pinned here so the pure
 *  function needs no expo import; `channel-state.test.ts` checks the value
 *  against the installed package's enum. */
export const EXPO_IMPORTANCE_NONE = 2;

/**
 * Whether the OS will discard posts on this channel. A channel that does not
 * exist yet (`null`: first start, before the provider created it) is NOT
 * blocked; the app is about to create it at its own importance.
 */
export const channelBlocked = (channel: ChannelSnapshot): boolean =>
	channel !== null && channel.importance === EXPO_IMPORTANCE_NONE;

/**
 * Read one channel's blocked state. `false` off Android and on any failed read:
 * a read we could not make is not evidence the reader turned anything off, and
 * a false "off" warning is worse than the status quo.
 */
export async function readChannelBlocked(channelId: string): Promise<boolean> {
	if (Platform.OS !== "android") return false;
	const module = await loadNotifications();
	if (module === null) return false;
	try {
		return channelBlocked(await module.getNotificationChannelAsync(channelId));
	} catch {
		return false;
	}
}

/**
 * Open the system page for one channel (`Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS`,
 * API 26+, the app's floor is 24 so the app-level page is the fallback).
 * Never throws: a launcher that refuses both intents leaves the reader on the
 * Settings screen, which already says what to do.
 */
export async function openChannelSettings(
	channelId: string,
	packageName?: string,
): Promise<void> {
	if (Platform.OS !== "android") return;
	try {
		/* Lazy: expo-constants pulls the native module runtime, which the Node
		 * tests of every screen importing this module cannot load. */
		const pkg =
			packageName ??
			(await import("expo-constants")).default.expoConfig?.android?.package ??
			"";
		await Linking.sendIntent("android.settings.CHANNEL_NOTIFICATION_SETTINGS", [
			{ key: "android.provider.extra.APP_PACKAGE", value: pkg },
			{ key: "android.provider.extra.CHANNEL_ID", value: channelId },
		]);
	} catch {
		try {
			await Linking.openSettings();
		} catch {
			/* Nothing further the app can do; the copy names the system path. */
		}
	}
}
