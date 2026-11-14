/**
 * The one module that touches `expo-notifications`.
 *
 * Same rule as `src/connection/storage.ts` for the keystore: the platform
 * contact lives in one place, behind async functions whose failure modes are
 * stated, and every other module (the Settings surface, the tap router) reads
 * this one. Two properties are load-bearing:
 *
 * - **The import is lazy and its absence is a value.** A binary built without
 *   the notifications module (the planned `foss` flavour, ADR 0006 §5; the web
 *   target today) must not crash at module load and must not pretend: `load()`
 *   answers `null` and every function below degrades to `unsupported` / no-op.
 *   This is the mechanical half of "never claim a capability the binary lacks".
 * - **A platform guard before every call, not just before the import.** The web
 *   build resolves the package (its JS imports fine) but the native calls
 *   reject; `Platform.OS` is checked first so the web target never reaches them.
 *
 * What this module deliberately does NOT do (all ADR 0006):
 * - **No `setNotificationHandler`.** Suppressing the OS banner while the app
 *   runs is S9's half, and suppressing it before the in-app surface exists
 *   would make a foreground arrival vanish with nothing in its place — the
 *   "notifications stop silently" failure the ADR names. Until S9, the
 *   platform default stands.
 * - **No register call.** The cloud forward is unbuilt (S7); a registration
 *   today would write a row no push can use. The route's client half lives in
 *   `relay/endpoints.ts` and is exercised by the e2e suite; the call site lands
 *   with S7 (manager decision, 2026-10-03: "DON'T register pre-cloud").
 */

import { Platform } from "react-native";
import type { ConversationPush } from "@/features/deep-links/pending";
import { type NoParamKey, t } from "@/i18n";
import { conversationPushFromResponse } from "@/notifications/payload";
import type { PushAvailability } from "@/notifications/permission";
import { availabilityFromStatus } from "@/notifications/permission";
import {
	type BuiltinSoundId,
	LEGACY_ALERT_CHANNEL_ID,
	type SoundChannelLabel,
	soundChannelSpecs,
} from "@/notifications/sound-catalog";

type NotificationsModule = typeof import("expo-notifications");

/** Whether this PLATFORM can receive push at all. The web target cannot — an
 *  alert needs an app installation and APNs/FCM; a browser tab is not one. */
export const notificationsSupported = (): boolean =>
	Platform.OS === "ios" || Platform.OS === "android";

let loaded: Promise<NotificationsModule | null> | null = null;

/** The module, or `null` when this binary does not carry it. Cached: a dynamic
 *  import resolves once, and a failure is a fact about the build, not a
 *  per-call condition. */
export async function loadNotifications(): Promise<NotificationsModule | null> {
	if (!notificationsSupported()) return null;
	if (loaded === null) {
		loaded = import("expo-notifications").catch(() => null);
	}
	return loaded;
}

/** The current permission state, in the app's vocabulary. Never throws: a read
 *  that fails is `unknown`, which renders its own honest sentence. */
export async function readAvailability(): Promise<PushAvailability> {
	const module = await loadNotifications();
	if (module === null) return "unsupported";
	try {
		const status = await module.getPermissionsAsync();
		return availabilityFromStatus(status.status);
	} catch {
		return "unknown";
	}
}

/**
 * Ask the OS for permission — the act behind the first-run primer's "Turn on
 * notifications" and the Settings control, never a mount effect (ADR 0006 §5:
 * the prompt is requested in context).
 *
 * On Android 13+ this is the call that raises `POST_NOTIFICATIONS`; on iOS it
 * is the standard authorization dialog. The answer is mapped through the same
 * table as `readAvailability`, so the surface renders one vocabulary.
 */
export async function requestPermission(): Promise<PushAvailability> {
	const module = await loadNotifications();
	if (module === null) return "unsupported";
	try {
		const status = await module.requestPermissionsAsync();
		return availabilityFromStatus(status.status);
	} catch {
		return "unknown";
	}
}

/** The localised name of one sound channel. Read at call time (not at module
 *  load) so the reader's current language is the one the channel is created
 *  with — see `src/i18n/runtime.ts` on why copy is never frozen at import. */
const soundChannelName = (label: SoundChannelLabel): string => {
	if (label.kind === "system") return t("mobile.notifications.channel.system");
	if (label.kind === "silent") return t("mobile.notifications.channel.silent");
	return t(BUILTIN_CHANNEL_NAME_KEYS[label.id]);
};

/* A table rather than a template-built key, so `tsc` checks every key exists
 * and `check-strings` can see each one. */
const BUILTIN_CHANNEL_NAME_KEYS = {
	"soft-pulse": "mobile.notifications.channel.soft_pulse",
	"two-note-chime": "mobile.notifications.channel.two_note_chime",
	"felt-marimba": "mobile.notifications.channel.felt_marimba",
	"hum-swell": "mobile.notifications.channel.hum_swell",
	"task-complete": "mobile.notifications.channel.task_complete",
	"signal-handshake": "mobile.notifications.channel.signal_handshake",
	"tape-warble": "mobile.notifications.channel.tape_warble",
	"bubble-chord": "mobile.notifications.channel.bubble_chord",
	"airy-whistle": "mobile.notifications.channel.airy_whistle",
	"bubble-pulse": "mobile.notifications.channel.bubble_pulse",
} as const satisfies Record<BuiltinSoundId, NoParamKey>;

/**
 * Creates the twelve Android sound channels at app start: `sound.<id>` for
 * each bundled sound, `sound.default` (the phone's own default sound) and the
 * silent `sound.none` (`sound-catalog.ts` explains the set).
 *
 * FCM requires `channel_id` to name a channel the app has ALREADY created or
 * the message falls back to a default channel (ADR 0006 §5, quoted from
 * Firebase's docs) — so this runs at app start, not at delivery time, and the
 * cloud names one of these per push from `data.sound`.
 *
 * Re-running is safe and cheap: Android keeps an existing channel's sound and
 * importance (the user owns those once the channel exists) and only updates
 * its name and description, which is what lets a language change rename the
 * channels on the next start.
 *
 * Each channel is created independently, so one failure (a sound file missing
 * from a build that did not run the plugin) does not take the other eleven
 * with it. The pre-sound `"default"` channel is deleted: no push ever named it
 * (S7 is unbuilt), and leaving it would put a channel in the system settings
 * that nothing posts to.
 */
export async function ensureAndroidSoundChannels(): Promise<void> {
	if (Platform.OS !== "android") return;
	const module = await loadNotifications();
	if (module === null) return;
	const description = t("mobile.notifications.channel.description");
	for (const spec of soundChannelSpecs()) {
		try {
			await module.setNotificationChannelAsync(spec.id, {
				name: soundChannelName(spec.label),
				description,
				importance: module.AndroidImportance.DEFAULT,
				// An absent `sound` key is the system default sound; `null` is
				// silence; a file name plays that `res/raw` resource. The key is
				// only set when the spec sets it, so `sound.default` stays default.
				...(spec.sound === undefined ? {} : { sound: spec.sound }),
			});
		} catch {
			/* A channel that cannot be created is not a state the reader can act
			 * on; a push naming it falls back to the platform default, which is
			 * the documented FCM behaviour for an unknown channel_id. */
		}
	}
	try {
		await module.deleteNotificationChannelAsync(LEGACY_ALERT_CHANNEL_ID);
	} catch {
		/* Absent already, or the platform refused: either way nothing posts to it. */
	}
}

/** This device's APNs/FCM token, for the register contract. `null` when the
 *  platform, the module or the token read fails — a caller must not register a
 *  device it cannot address anyway. */
export async function devicePushToken(): Promise<{
	token: string;
	platform: "ios" | "android";
} | null> {
	const module = await loadNotifications();
	if (module === null) return null;
	if (Platform.OS !== "ios" && Platform.OS !== "android") return null;
	try {
		const token = await module.getDevicePushTokenAsync();
		const platform = token.type === "ios" ? "ios" : "android";
		return { token: token.data, platform };
	} catch {
		return null;
	}
}

/**
 * Routes a notification tap to the reader's conversation.
 *
 * Both arrival paths, because a tap out of a cold start and a tap into a warm
 * app are different callbacks (`getLastNotificationResponseAsync` versus
 * `addNotificationResponseReceivedListener`) and a routing that handled only
 * one would look correct in the warm case and lose the cold one — the exact
 * case a push exists for. A response whose payload cannot be parsed is dropped
 * silently IN THIS LAYER and faithfully in the next: `noteConversationPush` is
 * only called with a real handle, and the resolver keeps its own rules about
 * what a destination can do. Returns the teardown. */
export async function subscribeNotificationTaps(
	onPush: (push: ConversationPush) => void,
): Promise<() => void> {
	const module = await loadNotifications();
	if (module === null) return () => {};
	const deliver = (response: unknown): void => {
		const push = conversationPushFromResponse(response);
		if (push !== null) onPush(push);
	};
	try {
		const cold = await module.getLastNotificationResponseAsync();
		if (cold !== null && cold !== undefined) deliver(cold);
	} catch {
		/* No last response is a normal cold start. */
	}
	try {
		const subscription = module.addNotificationResponseReceivedListener(
			(response) => deliver(response),
		);
		return () => subscription.remove();
	} catch {
		return () => {};
	}
}
