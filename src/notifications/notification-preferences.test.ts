/** Notification preferences: the local switches, how they persist, and the ONE
 * rule that keeps them from breaking registration — `preferences` rides in
 * `POST /api/push/register` only when the daemon advertises
 * `push_preferences` (an older daemon refuses unknown fields with 422, and the
 * whole registration would fail). Contract from the daemon owner (core PR C,
 * relayed 2026-11-14): `{ enabled, completions, errors }`, all three, nothing
 * else. */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { memorySecureStore } from "@/connection/storage";
import {
	createPreferenceRecords,
	DEFAULT_NOTIFICATION_PREFERENCES,
	loadNotificationPreferences,
	notificationPreferencesStore,
	PREFERENCES_RECORD_KEY,
	parsePreferences,
	preferencesForRegistration,
	preferenceView,
	pushCapabilities,
	pushPreferencesSupported,
	registrationAffected,
	resetNotificationPreferences,
	teamBridgeWanted,
	updateNotificationPreferences,
	wirePreferences,
} from "@/notifications/notification-preferences";

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));

beforeEach(() => {
	resetNotificationPreferences();
});

const NONE = { preferences: false, previews: false };
const PREFS_ONLY = { preferences: true, previews: false };
const BOTH = { preferences: true, previews: true };

describe("the capability gate", () => {
	it("omits `preferences` when the daemon does not advertise push_preferences", () => {
		expect(wirePreferences(DEFAULT_NOTIFICATION_PREFERENCES, NONE)).toBe(
			undefined,
		);
		expect(
			wirePreferences(
				{ ...DEFAULT_NOTIFICATION_PREFERENCES, enabled: false, previews: true },
				NONE,
			),
		).toBe(undefined);
		// `push_previews` alone means nothing: the field it extends is gated
		// on `push_preferences`.
		expect(
			wirePreferences(DEFAULT_NOTIFICATION_PREFERENCES, {
				preferences: false,
				previews: true,
			}),
		).toBe(undefined);
	});

	it("push_preferences without push_previews: exactly enabled/completions/errors", () => {
		const wire = wirePreferences(
			{
				enabled: true,
				completions: false,
				errors: true,
				previews: true,
				teamBridge: false,
			},
			PREFS_ONLY,
		);
		expect(wire).toEqual({ enabled: true, completions: false, errors: true });
		// A #3991-only daemon refuses an unknown key with 422, and Team Bridge
		// is the app-only path: neither `previews` nor `teamBridge` rides.
		expect(Object.keys(wire ?? {}).sort()).toEqual([
			"completions",
			"enabled",
			"errors",
		]);
	});

	it("push_preferences and push_previews: `previews` rides too, false as well as true", () => {
		expect(wirePreferences(DEFAULT_NOTIFICATION_PREFERENCES, BOTH)).toEqual({
			enabled: true,
			completions: true,
			errors: true,
			previews: true,
		});
		expect(
			wirePreferences(
				{ ...DEFAULT_NOTIFICATION_PREFERENCES, previews: false },
				BOTH,
			),
		).toEqual({
			enabled: true,
			completions: true,
			errors: true,
			previews: false,
		});
	});

	it("reads the two capabilities independently", () => {
		expect(pushCapabilities({})).toEqual(NONE);
		expect(pushCapabilities({ push_preferences: { available: true } })).toEqual(
			PREFS_ONLY,
		);
		expect(
			pushCapabilities({
				push_preferences: { available: true },
				push_previews: { available: true },
			}),
		).toEqual(BOTH);
		expect(
			pushCapabilities({
				push_preferences: { available: true },
				push_previews: { available: "yes" },
			}),
		).toEqual(PREFS_ONLY);
		expect(pushCapabilities(null)).toEqual(NONE);
	});

	it("reads `capabilities.push_preferences.available === true` as supported", () => {
		expect(
			pushPreferencesSupported({ push_preferences: { available: true } }),
		).toBe(true);
	});

	it("reads an absent capability as unsupported", () => {
		expect(
			pushPreferencesSupported({ session_tags: { available: true } }),
		).toBe(false);
	});
});

describe("persistence", () => {
	it("defaults to everything on, previews included (operator, 2026-11-14: default on)", () => {
		expect(notificationPreferencesStore.getState().preferences).toEqual({
			enabled: true,
			completions: true,
			errors: true,
			previews: true,
			teamBridge: true,
		});
	});

	it("a record written before the previews switch keeps the reader's choices", () => {
		// The pre-previews shape: requiring `previews` would read this as
		// unreadable and reset a stored "off" to all-on.
		expect(
			parsePreferences(
				'{"v":1,"enabled":false,"completions":true,"errors":false,"teamBridge":false}',
			),
		).toEqual({
			enabled: false,
			completions: true,
			errors: false,
			// Absent reads as the default, ON — the daemon's own reading too.
			previews: true,
			teamBridge: false,
		});
		expect(
			parsePreferences(
				'{"v":1,"enabled":true,"completions":true,"errors":true,"previews":false,"teamBridge":true}',
			).previews,
		).toBe(false);
	});

	it("m-read: a failed keystore read is not cached as the defaults, and the next load retries", async () => {
		const adapter = memorySecureStore();
		await adapter.setItemAsync(
			PREFERENCES_RECORD_KEY,
			JSON.stringify({
				v: 1,
				...DEFAULT_NOTIFICATION_PREFERENCES,
				enabled: false,
			}),
		);
		let fail = true;
		const records = createPreferenceRecords(async () => {
			if (fail) throw new Error("keystore locked");
			return adapter;
		});
		await expect(loadNotificationPreferences(records)).rejects.toThrow(
			"keystore locked",
		);
		expect(notificationPreferencesStore.getState().hydrated).toBe(false);
		fail = false;
		expect((await loadNotificationPreferences(records)).enabled).toBe(false);
		expect(notificationPreferencesStore.getState().hydrated).toBe(true);
	});

	it("m-read: a registration whose stored choice cannot be read fails instead of sending defaults", async () => {
		const failing = async () => {
			throw new Error("keystore locked");
		};
		await expect(
			preferencesForRegistration(PREFS_ONLY, failing),
		).rejects.toThrow("keystore locked");
		// An older daemon needs no stored choice at all, so a broken keystore
		// does not cost it the registration.
		expect(await preferencesForRegistration(NONE, failing)).toBe(undefined);
		expect(
			await preferencesForRegistration(BOTH, async () => ({
				...DEFAULT_NOTIFICATION_PREFERENCES,
				enabled: false,
			})),
		).toEqual({
			enabled: false,
			completions: true,
			errors: true,
			previews: true,
		});
	});

	it("m2: only a switch the daemon filters on re-registers with the computer", () => {
		expect(registrationAffected({ teamBridge: false })).toBe(false);
		expect(registrationAffected({ teamBridge: true })).toBe(false);
		expect(registrationAffected({ enabled: false })).toBe(true);
		expect(registrationAffected({ completions: false })).toBe(true);
		expect(registrationAffected({ errors: true })).toBe(true);
		expect(registrationAffected({ previews: true })).toBe(true);
	});

	it("writes a change to the device and reads it back on a cold start", async () => {
		const adapter = memorySecureStore();
		const records = createPreferenceRecords(async () => adapter);
		await updateNotificationPreferences({ completions: false }, records);
		expect(
			notificationPreferencesStore.getState().preferences.completions,
		).toBe(false);
		expect(
			JSON.parse(adapter.items.get(PREFERENCES_RECORD_KEY) ?? "null"),
		).toEqual({
			v: 1,
			enabled: true,
			completions: false,
			errors: true,
			previews: true,
			teamBridge: true,
		});
		expect(
			await createPreferenceRecords(async () => adapter).get(),
		).toMatchObject({ completions: false });
	});

	it("reads a missing or unreadable record as everything on", () => {
		expect(parsePreferences(null)).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
		expect(parsePreferences("not json")).toEqual(
			DEFAULT_NOTIFICATION_PREFERENCES,
		);
		expect(parsePreferences('{"v":1,"enabled":"no"}')).toEqual(
			DEFAULT_NOTIFICATION_PREFERENCES,
		);
	});

	it("bumps the store revision on every change, so registration can follow", async () => {
		const records = createPreferenceRecords(async () => memorySecureStore());
		const before = notificationPreferencesStore.getState().revision;
		await updateNotificationPreferences({ enabled: false }, records);
		await updateNotificationPreferences({ errors: false }, records);
		expect(notificationPreferencesStore.getState().revision).toBe(before + 2);
	});
});

describe("what Settings shows", () => {
	const all = DEFAULT_NOTIFICATION_PREFERENCES;
	const view = (over: Partial<Parameters<typeof preferenceView>[0]> = {}) =>
		preferenceView({
			availability: "granted",
			capability: BOTH,
			preferences: all,
			radientSignedIn: true,
			...over,
		});

	it("shows no switches when the OS denied (the system-settings remedy instead), on web, or before the read", () => {
		expect(view({ availability: "denied" }).show).toBe(false);
		expect(view({ availability: "unsupported" }).show).toBe(false);
		expect(view({ availability: null }).show).toBe(false);
		expect(view({ availability: "undetermined" }).show).toBe(true);
	});

	it("m1: a live frame without push_preferences disables only the session-type switches, with the update note", () => {
		const v = view({ capability: NONE });
		expect(v.sessionDisabled).toBe(true);
		expect(v.previewsDisabled).toBe(true);
		expect(v.updateNote).toBe(true);
		expect(v.types).toBe(true);
		expect(v.teamBridge).toBe(true);
		// The master switch has no `disabled` at all: it also gates Team Bridge.
		expect(v).not.toHaveProperty("masterDisabled");
	});

	it("m1: no computer connected or no frame yet (capability unknown): no note, nothing disabled", () => {
		const v = view({ capability: null });
		expect(v.updateNote).toBe(false);
		expect(v.sessionDisabled).toBe(false);
		expect(v.previewsDisabled).toBe(false);
	});

	it("m1: a stored off can be switched back on against an older daemon (QA Q1)", () => {
		const v = view({
			capability: NONE,
			preferences: { ...all, enabled: false },
		});
		expect(v.show).toBe(true);
		expect(v).not.toHaveProperty("masterDisabled");
	});

	it("push_preferences without push_previews: only the previews switch is disabled, with the note", () => {
		const v = view({ capability: PREFS_ONLY });
		expect(v.sessionDisabled).toBe(false);
		expect(v.previewsDisabled).toBe(true);
		expect(v.updateNote).toBe(true);
	});

	it("both capabilities: everything enabled, no note", () => {
		const v = view();
		expect(v.sessionDisabled).toBe(false);
		expect(v.previewsDisabled).toBe(false);
		expect(v.updateNote).toBe(false);
	});

	it("the master switch off hides the per-type switches, previews included", () => {
		const v = view({ preferences: { ...all, enabled: false } });
		expect(v.types).toBe(false);
		expect(v.teamBridge).toBe(false);
	});

	it("Team Bridge's switch appears only when signed in to Radient", () => {
		expect(view({ radientSignedIn: false }).teamBridge).toBe(false);
	});

	it("Team Bridge is wanted only while the master switch and its own are on", () => {
		expect(teamBridgeWanted(all)).toBe(true);
		expect(teamBridgeWanted({ ...all, teamBridge: false })).toBe(false);
		expect(teamBridgeWanted({ ...all, enabled: false })).toBe(false);
	});
});
