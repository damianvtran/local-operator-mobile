/**
 * The JS half of Team Bridge's Android presentation (ADR 0010 S2 and S4): the
 * channel's localised name, lock-screen default, and the copy the native
 * presentation delegate draws with.
 *
 * WHY THE NATIVE SIDE GETS ITS COPY FROM HERE. The notification is built in
 * Kotlin (`modules/lop-team-bridge-push`, `TeamBridgeDecorator.kt`), often while
 * no JS runs at all (a push to a killed app). But the app's catalogue lives in
 * JS (`src/i18n`) and Android string resources would be a second, untranslated
 * copy. So JS hands the native module the two strings it needs, in the reader's
 * current language, whenever the language frame changes
 * (`use-notification-categories.ts`), and the module keeps them in its own
 * SharedPreferences for the killed-app case. Until the first hand-over the
 * module uses English defaults, which is what today's channel name shows anyway.
 *
 * Re-running is safe: Android keeps an existing channel's importance and the
 * user's lock-screen choice, and only renames it, which is how a language
 * change reaches the system settings list.
 */

import { Platform } from "react-native";
import { RADIENT_API_BASE } from "@/connection/discovery";
import { t } from "@/i18n";
import { loadNotifications } from "@/notifications/native";

/** The Android channel the hub names (`channelId: "team-bridge"`). Created at
 *  start, because FCM falls back to the default channel for an unknown id. */
export const TEAM_BRIDGE_CHANNEL_ID = "team-bridge";

/** What the Kotlin module exposes (`LopTeamBridgePushModule.kt`). */
interface NativeTeamBridgePush {
	setPresentationStrings(selfName: string, hiddenPreview: string): void;
	setHubOrigin(origin: string): void;
	setPresentationAccount(accountId: string): void;
	retirePresentationAccount(accountId: string | null): void;
}

/** The module, or `null` on iOS, web and any binary built without it. A
 *  missing module is a build fact (old dev client, FOSS flavour), never an
 *  error the reader can act on. */
function nativeModule(): NativeTeamBridgePush | null {
	if (Platform.OS !== "android") return null;
	try {
		// Expo's entry point initializes the native runtime on import. Load it
		// only on Android, but keep account admission and retirement synchronous.
		const expo: typeof import("expo") = require("expo");
		return expo.requireOptionalNativeModule<NativeTeamBridgePush>(
			"LopTeamBridgePush",
		);
	} catch {
		return null;
	}
}

/** The copy the native side draws with, resolved now. Pure apart from `t()`. */
export const presentationStrings = () => ({
	/* MessagingStyle needs a non-empty "me" Person even though the reader never
	 * sends from a notification (inline reply is a non-goal). */
	selfName: t("mobile.notifications.team_bridge.self_name"),
	/* The lock-screen public version: the SAME words iOS shows as its hidden
	 * preview placeholder (`categories.ts`), so both platforms say one thing. */
	hiddenPreview: t("mobile.notifications.category.message_placeholder"),
});

/**
 * The registered hub's origin: the ONLY origin the native side may fetch a
 * push avatar photo from (ADR 0010 S5, `PushAvatarFetcher.kt`). A payload whose
 * `sender.photo.url` names any other origin gets no request and so never sees
 * the nonce. The production hub base, as the hub client uses it.
 */
export const hubOrigin = (): string => new URL(RADIENT_API_BASE).origin;

/** The channel input, resolved in the reader's current language. */
export const teamBridgeChannelInput = (
	importanceHigh: number,
	visibilityPrivate: number,
) => ({
	name: t("mobile.notifications.channel.team_bridge"),
	description: t("mobile.notifications.channel.team_bridge_description"),
	importance: importanceHigh,
	/* PRIVATE: on a secure lock screen with "hide sensitive content" the OS
	 * shows each notification's public version (sender-free, see
	 * `TeamBridgeDecorator.kt`). A REQUEST, not a guarantee: AOSP
	 * `PreferencesHelper.createNotificationChannel` treats lockscreen visibility
	 * as a field apps may not set and overwrites it with the package default
	 * (`VISIBILITY_NO_OVERRIDE`, -1000), so `dumpsys` shows -1000 (installed-app
	 * run 44247024803, all APIs). The privacy rule therefore lives on each
	 * notification (`setVisibility(PRIVATE)` + public version), which the OS
	 * honours (ADR 0010 §7 row 14). Passed in from the
	 * module: expo's `AndroidNotificationVisibility.PRIVATE` is its own enum
	 * value (2), not the platform's `VISIBILITY_PRIVATE` (0). */
	lockscreenVisibility: visibilityPrivate,
});

/**
 * Create (or rename) the Team Bridge channel and refresh the native copy.
 * Android only; never throws.
 */
export async function ensureAndroidTeamBridgePresentation(): Promise<void> {
	if (Platform.OS !== "android") return;
	const module = await loadNotifications();
	if (module !== null) {
		try {
			await module.setNotificationChannelAsync(
				TEAM_BRIDGE_CHANNEL_ID,
				teamBridgeChannelInput(
					module.AndroidImportance.HIGH,
					module.AndroidNotificationVisibility.PRIVATE,
				),
			);
		} catch {
			/* Delivery falls back to the default channel; nothing the reader can act on. */
		}
	}
	const native = nativeModule();
	if (native === null) return;
	try {
		const strings = presentationStrings();
		native.setPresentationStrings(strings.selfName, strings.hiddenPreview);
	} catch {
		/* The module keeps its English defaults. */
	}
	try {
		native.setHubOrigin(hubOrigin());
	} catch {
		/* No origin: the native side draws initials only, never a photo. */
	}
}

/** Running synchronously keeps the JS registration lease and native admission
 * in step: neither a pending PUT nor a lost network can delay local retirement. */
export function enableAndroidBridgePresentation(accountId: string): void {
	try {
		nativeModule()?.setPresentationAccount(accountId);
	} catch {
		/* Older binaries have no persisted presentation lease. */
	}
}

export function retireAndroidBridgePresentation(
	accountId: string | null,
): void {
	try {
		nativeModule()?.retirePresentationAccount(accountId);
	} catch {
		/* Older binaries have no persisted presentation lease. */
	}
}
