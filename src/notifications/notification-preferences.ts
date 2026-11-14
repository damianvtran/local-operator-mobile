/**
 * Notification preferences: which notifications this phone wants, chosen in
 * Settings → Notifications (operator request, 2026-11-14: "I have no way to
 * turn off notifications or turn off certain types of notifications").
 *
 * WHO FILTERS WHAT. The switches are not applied on the phone; each one is
 * honoured by the service that sends the push:
 *  - `enabled` (the master switch), `completions` ("Agent finished") and
 *    `errors` ("Agent hit an error") ride to the ROUTED COMPUTER's daemon in
 *    `POST /api/push/register` as `preferences: { enabled, completions,
 *    errors }`, and the daemon filters its pushes on them. Contract from the
 *    daemon owner (core PR C, cloud lane 58a2fbc134c9, relayed 2026-11-14):
 *    exactly those three booleans, nothing else — the daemon refuses unknown
 *    keys.
 *  - `teamBridge` never reaches the daemon. Team Bridge pushes come from
 *    Radient's hub, so the switch is app-only: off DELETEs this phone's hub
 *    registration, on PUTs it again (`team-bridge/push.ts`, through the
 *    provider's push lifecycle so it cannot race a sign-out).
 *
 * THE CAPABILITY GATE. A daemon that predates PR C refuses an unknown field
 * with `422 unknown field(s)`, which would cost the WHOLE registration — no
 * row, no pushes at all. So `preferences` is sent only when the daemon's
 * `capabilities` advertise `push_preferences` (`wirePreferences`); otherwise
 * the field is omitted, which the daemon reads as "everything on", and
 * Settings shows the session switches disabled with a note to update the
 * computer. No "Needs your input" switch: asks arrive as ordinary completions
 * today, so the daemon could not honour it.
 *
 * The master switch is NOT the OS permission. Permission is whether the phone
 * may show anything at all; this is what the reader wants sent. A denied OS
 * permission hides these switches in favour of the system-settings remedy.
 *
 * Stored device-only in the platform keystore, the same small-record pattern
 * as `team-bridge/notice-dismissals.ts`; a missing or unreadable record is
 * "everything on" — the behaviour before this feature existed.
 */
import { Platform } from "react-native";
import { createStore } from "zustand/vanilla";

import {
	expoSecureStore,
	type SecureStoreAdapter,
	type SecureStoreOptions,
	thisDeviceOnlyAccessibility,
} from "@/connection/storage";
import type { PushAvailability } from "@/notifications/permission";
import type { RegisterPushPreferences } from "@/relay/endpoints";

export type NotificationPreferences = {
	/** The master switch. */
	enabled: boolean;
	/** "Agent finished". */
	completions: boolean;
	/** "Agent hit an error". */
	errors: boolean;
	/** "Team Bridge messages" — app-only, never sent to the daemon. */
	teamBridge: boolean;
};

export const DEFAULT_NOTIFICATION_PREFERENCES: Readonly<NotificationPreferences> =
	Object.freeze({
		enabled: true,
		completions: true,
		errors: true,
		teamBridge: true,
	});

export const PREFERENCES_RECORD_KEY = "lo-mobile-notification-preferences";

const KEYS = ["enabled", "completions", "errors", "teamBridge"] as const;

export const parsePreferences = (
	raw: string | null,
): NotificationPreferences => {
	if (raw === null) return { ...DEFAULT_NOTIFICATION_PREFERENCES };
	try {
		const value = JSON.parse(raw) as Record<string, unknown> | null;
		if (
			value !== null &&
			value.v === 1 &&
			KEYS.every((key) => typeof value[key] === "boolean")
		) {
			return {
				enabled: value.enabled as boolean,
				completions: value.completions as boolean,
				errors: value.errors as boolean,
				teamBridge: value.teamBridge as boolean,
			};
		}
	} catch {
		// Falls through to the defaults.
	}
	return { ...DEFAULT_NOTIFICATION_PREFERENCES };
};

/**
 * Whether the routed daemon accepts `preferences` (core PR C). Read from the
 * list frame's `capabilities` bag, the one the app already gates relay
 * features on. Tolerant of the three shapes that bag uses for a relay
 * capability (`true`, `{ available: true }`, or a `features` flag), because
 * the key's exact spelling was relayed rather than read from a merged core
 * change; anything else, including absence, is "not supported".
 */
export const pushPreferencesSupported = (capabilities: unknown): boolean => {
	if (typeof capabilities !== "object" || capabilities === null) return false;
	const bag = capabilities as Record<string, unknown>;
	const direct = bag.push_preferences;
	if (direct === true) return true;
	if (
		typeof direct === "object" &&
		direct !== null &&
		(direct as { available?: unknown }).available === true
	)
		return true;
	const features = bag.features;
	return (
		typeof features === "object" &&
		features !== null &&
		Boolean((features as Record<string, unknown>).push_preferences)
	);
};

/** The register body's `preferences`, or `undefined` to omit the field. */
export const wirePreferences = (
	preferences: NotificationPreferences,
	supported: boolean,
): RegisterPushPreferences | undefined =>
	supported
		? {
				enabled: preferences.enabled,
				completions: preferences.completions,
				errors: preferences.errors,
			}
		: undefined;

type PreferenceStorage = Pick<
	SecureStoreAdapter,
	"getItemAsync" | "setItemAsync"
>;

export type PreferenceRecords = {
	get: () => Promise<NotificationPreferences>;
	set: (preferences: NotificationPreferences) => Promise<void>;
};

export function createPreferenceRecords(
	storage: () => Promise<PreferenceStorage>,
	options: () => Promise<SecureStoreOptions> = async () => ({}),
): PreferenceRecords {
	return {
		async get() {
			return parsePreferences(
				await (await storage()).getItemAsync(
					PREFERENCES_RECORD_KEY,
					await options(),
				),
			);
		},
		async set(preferences) {
			await (await storage()).setItemAsync(
				PREFERENCES_RECORD_KEY,
				JSON.stringify({ v: 1, ...preferences }),
				await options(),
			);
		},
	};
}

export const devicePreferenceRecords = createPreferenceRecords(
	async () =>
		Platform.OS === "web"
			? {
					async getItemAsync(key) {
						return globalThis.localStorage?.getItem(key) ?? null;
					},
					async setItemAsync(key, value) {
						globalThis.localStorage?.setItem(key, value);
					},
				}
			: expoSecureStore(),
	async () =>
		Platform.OS === "web"
			? {}
			: { keychainAccessible: await thisDeviceOnlyAccessibility() },
);

/** What Settings renders and registration reads. `revision` moves on every
 *  change so a subscriber can tell "changed" from "re-rendered". */
export const notificationPreferencesStore = createStore<{
	preferences: NotificationPreferences;
	hydrated: boolean;
	revision: number;
}>(() => ({
	preferences: { ...DEFAULT_NOTIFICATION_PREFERENCES },
	hydrated: false,
	revision: 0,
}));

let hydration: Promise<NotificationPreferences> | null = null;

/**
 * The stored preferences, read from the keystore once per run. Registration
 * awaits this before building a body, so a cold-start POST never sends the
 * defaults over a choice the reader already made. A failed read keeps the
 * defaults (the pre-feature behaviour) rather than blocking registration.
 */
export const loadNotificationPreferences = (
	records: PreferenceRecords = devicePreferenceRecords,
): Promise<NotificationPreferences> => {
	if (notificationPreferencesStore.getState().hydrated)
		return Promise.resolve(notificationPreferencesStore.getState().preferences);
	hydration ??= records
		.get()
		.catch(() => ({ ...DEFAULT_NOTIFICATION_PREFERENCES }))
		.then((preferences) => {
			const state = notificationPreferencesStore.getState();
			// A change made while the read was in flight wins over the read.
			if (state.hydrated) return state.preferences;
			notificationPreferencesStore.setState({ preferences, hydrated: true });
			return preferences;
		});
	return hydration;
};

/** Apply one change: the store first (Settings repaints at once), then the
 *  keystore. A write failure propagates; the in-memory choice still holds for
 *  this run. */
export const updateNotificationPreferences = async (
	patch: Partial<NotificationPreferences>,
	records: PreferenceRecords = devicePreferenceRecords,
): Promise<NotificationPreferences> => {
	const state = notificationPreferencesStore.getState();
	const preferences = { ...state.preferences, ...patch };
	notificationPreferencesStore.setState({
		preferences,
		hydrated: true,
		revision: state.revision + 1,
	});
	await records.set(preferences);
	return preferences;
};

/** Tests only: a fresh run. */
export const resetNotificationPreferences = (): void => {
	hydration = null;
	notificationPreferencesStore.setState({
		preferences: { ...DEFAULT_NOTIFICATION_PREFERENCES },
		hydrated: false,
		revision: 0,
	});
};

/** Whether this phone should be registered with Team Bridge's hub: the master
 *  switch and Team Bridge's own both on. The provider's register gate and
 *  Settings' toggle handler read this one rule. */
export const teamBridgeWanted = (
	preferences: NotificationPreferences,
): boolean => preferences.enabled && preferences.teamBridge;

/**
 * What Settings → Notifications renders for the preference block.
 *
 *  - `show`: never while the OS has DENIED (the existing system-settings
 *    remedy stands in its place — a switch the OS overrides would be a lie),
 *    never where alerts are not an app capability (`unsupported`: web, a build
 *    without the module), and not before the permission read answers.
 *  - `sessionDisabled` + `updateNote`: the daemon lacks `push_preferences`, so
 *    the master and session switches cannot be honoured and are shown
 *    disabled with the note to update the computer (core PR C contract).
 *  - `types`: the per-type switches, hidden while the master switch is off.
 *  - `teamBridge`: app-only and works on any daemon, but needs a Radient
 *    sign-in to have a hub registration to add or remove.
 */
export const preferenceView = (input: {
	availability: PushAvailability | null;
	supported: boolean;
	preferences: NotificationPreferences;
	radientSignedIn: boolean;
}): {
	show: boolean;
	sessionDisabled: boolean;
	updateNote: boolean;
	types: boolean;
	teamBridge: boolean;
} => {
	const show =
		input.availability !== null &&
		input.availability !== "denied" &&
		input.availability !== "unsupported";
	return {
		show,
		sessionDisabled: !input.supported,
		updateNote: show && !input.supported,
		types: show && input.preferences.enabled,
		teamBridge: show && input.preferences.enabled && input.radientSignedIn,
	};
};
