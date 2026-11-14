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
 *  - `previews` ("Show conversation name and preview") rides in the same
 *    object, but only to a daemon that ALSO advertises `push_previews`
 *    (operator decision, 2026-11-14; ADR 0006 §2 amendment): a daemon with
 *    `push_preferences` alone (core #3991) refuses the unknown key with 422.
 *    Default ON, like every switch here — the operator's standing rule is that
 *    a default-off feature is one most readers never find. The daemon reads
 *    an absent `previews` as true, so omitting it never mutes anything.
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
	/** "Show conversation name and preview" — default ON. */
	previews: boolean;
	/** "Team Bridge messages" — app-only, never sent to the daemon. */
	teamBridge: boolean;
};

export const DEFAULT_NOTIFICATION_PREFERENCES: Readonly<NotificationPreferences> =
	Object.freeze({
		enabled: true,
		completions: true,
		errors: true,
		previews: true,
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
				/* Optional, NOT in KEYS: a record written before this switch
				 * existed has no `previews`, and requiring it would read the
				 * whole record as unreadable — resetting a stored "off" master
				 * to all-on. Absent is the default, ON. */
				previews: typeof value.previews === "boolean" ? value.previews : true,
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
 * features on, at ONE path: `capabilities.push_preferences.available`, the
 * same shape as `session_tags` (agreed with the daemon owner, 2026-11-14).
 * Anything else, including absence, is "not supported" — and an unsupported
 * daemon is never sent the field.
 */
const capabilityAvailable = (capabilities: unknown, name: string): boolean => {
	if (typeof capabilities !== "object" || capabilities === null) return false;
	const capability = (capabilities as Record<string, unknown>)[name];
	return (
		typeof capability === "object" &&
		capability !== null &&
		(capability as { available?: unknown }).available === true
	);
};

export const pushPreferencesSupported = (capabilities: unknown): boolean =>
	capabilityAvailable(capabilities, "push_preferences");

/** What the routed daemon accepts in the register body. Two SEPARATE
 *  capabilities: `previews` extends `preferences`, and a daemon with
 *  `push_preferences` alone refuses it as an unknown key. */
export type PushCapabilities = { preferences: boolean; previews: boolean };

export const pushCapabilities = (capabilities: unknown): PushCapabilities => ({
	preferences: capabilityAvailable(capabilities, "push_preferences"),
	previews: capabilityAvailable(capabilities, "push_previews"),
});

/** The register body's `preferences`, or `undefined` to omit the field. */
export const wirePreferences = (
	preferences: NotificationPreferences,
	capabilities: PushCapabilities,
): RegisterPushPreferences | undefined =>
	capabilities.preferences
		? {
				enabled: preferences.enabled,
				completions: preferences.completions,
				errors: preferences.errors,
				...(capabilities.previews ? { previews: preferences.previews } : {}),
			}
		: undefined;

/**
 * The register body's `preferences`, read for one registration.
 *
 * An older daemon needs no stored choice, so it is not read at all and a
 * broken keystore cannot cost that registration. For a daemon that filters,
 * a failed read REJECTS (PR #264 R1 m-read): the attempt then fails and the
 * next trigger retries, because sending the defaults as if they were the
 * reader's choice would reset a stored "off" to all-on on the daemon.
 */
export const preferencesForRegistration = async (
	capabilities: PushCapabilities,
	load: () => Promise<NotificationPreferences> = loadNotificationPreferences,
): Promise<RegisterPushPreferences | undefined> =>
	capabilities.preferences
		? wirePreferences(await load(), capabilities)
		: undefined;

/** Whether a change touches what the daemon filters on, i.e. whether it must
 *  re-register with the computer (PR #264 R1 m2). `teamBridge` never reaches
 *  the daemon, and every register re-mints the device key and forwards to the
 *  cloud, so toggling it alone must not POST. */
export const registrationAffected = (
	patch: Partial<NotificationPreferences>,
): boolean =>
	"enabled" in patch ||
	"completions" in patch ||
	"errors" in patch ||
	"previews" in patch;

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
 * defaults over a choice the reader already made.
 *
 * A failed read REJECTS and is not cached (PR #264 R1 m-read): caching the
 * defaults would make every later read — and Settings' next write, which
 * spreads over the store — treat all-on as the reader's choice, overwriting
 * a stored "off". The store stays unhydrated (Settings keeps its switches
 * hidden) and the next call reads the keystore again.
 */
export const loadNotificationPreferences = (
	records: PreferenceRecords = devicePreferenceRecords,
): Promise<NotificationPreferences> => {
	if (notificationPreferencesStore.getState().hydrated)
		return Promise.resolve(notificationPreferencesStore.getState().preferences);
	hydration ??= records
		.get()
		.catch((error: unknown) => {
			hydration = null;
			throw error;
		})
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
 *  - `capability`: what the routed daemon's LIVE list frame advertises, or
 *    `null` when unknown — no computer connected, or this route's first frame
 *    not applied yet. Unknown is not "absent": nothing is disabled and no
 *    update note shows (PR #264 R1 m1).
 *  - The master switch is NEVER disabled: it also gates Team Bridge, so a
 *    reader who turned it off on an updated computer must be able to turn it
 *    back on from an older one (R1 m1, QA Q1). There is no field for it.
 *  - `sessionDisabled`: "Agent finished" / "Agent hit an error", disabled
 *    only when a live frame says `push_preferences` is absent.
 *    `previewsDisabled`: the same for `push_previews`. `updateNote` names the
 *    remedy whenever either is disabled.
 *  - `types`: the session-type switches (previews included), hidden while
 *    the master switch is off.
 *  - `teamBridge`: app-only and works on any daemon, but needs a Radient
 *    sign-in to have a hub registration to add or remove.
 */
export const preferenceView = (input: {
	availability: PushAvailability | null;
	capability: PushCapabilities | null;
	preferences: NotificationPreferences;
	radientSignedIn: boolean;
}): {
	show: boolean;
	sessionDisabled: boolean;
	previewsDisabled: boolean;
	updateNote: boolean;
	types: boolean;
	teamBridge: boolean;
} => {
	const show =
		input.availability !== null &&
		input.availability !== "denied" &&
		input.availability !== "unsupported";
	const sessionDisabled =
		input.capability !== null && !input.capability.preferences;
	const previewsDisabled =
		input.capability !== null && !input.capability.previews;
	return {
		show,
		sessionDisabled,
		previewsDisabled,
		updateNote: show && (sessionDisabled || previewsDisabled),
		types: show && input.preferences.enabled,
		teamBridge: show && input.preferences.enabled && input.radientSignedIn,
	};
};
