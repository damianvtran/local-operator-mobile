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
	notificationPreferencesStore,
	PREFERENCES_RECORD_KEY,
	parsePreferences,
	preferenceView,
	pushPreferencesSupported,
	resetNotificationPreferences,
	teamBridgeWanted,
	updateNotificationPreferences,
	wirePreferences,
} from "@/notifications/notification-preferences";

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));

beforeEach(() => {
	resetNotificationPreferences();
});

describe("the capability gate", () => {
	it("omits `preferences` when the daemon does not advertise push_preferences", () => {
		expect(wirePreferences(DEFAULT_NOTIFICATION_PREFERENCES, false)).toBe(
			undefined,
		);
		expect(
			wirePreferences(
				{ ...DEFAULT_NOTIFICATION_PREFERENCES, enabled: false },
				false,
			),
		).toBe(undefined);
	});

	it("sends exactly enabled/completions/errors when it does", () => {
		const wire = wirePreferences(
			{ enabled: true, completions: false, errors: true, teamBridge: false },
			true,
		);
		expect(wire).toEqual({ enabled: true, completions: false, errors: true });
		// Team Bridge is the app-only path: it never reaches the daemon.
		expect(Object.keys(wire ?? {}).sort()).toEqual([
			"completions",
			"enabled",
			"errors",
		]);
	});

	it.each([
		[{ push_preferences: true }, true],
		[{ push_preferences: { available: true } }, true],
		[{ features: { push_preferences: true } }, true],
		[{ push_preferences: { available: false } }, false],
		[{ push_preferences: false }, false],
		[{ features: {} }, false],
		[{}, false],
		[null, false],
		[undefined, false],
	])("reads the capability from %j as %s", (capabilities, expected) => {
		expect(pushPreferencesSupported(capabilities)).toBe(expected);
	});
});

describe("persistence", () => {
	it("defaults to everything on", () => {
		expect(notificationPreferencesStore.getState().preferences).toEqual({
			enabled: true,
			completions: true,
			errors: true,
			teamBridge: true,
		});
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
			supported: true,
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

	it("an older daemon: session switches disabled with the update note; Team Bridge still works", () => {
		const v = view({ supported: false });
		expect(v.sessionDisabled).toBe(true);
		expect(v.updateNote).toBe(true);
		expect(v.teamBridge).toBe(true);
		expect(v.types).toBe(true);
	});

	it("a push_preferences daemon: everything enabled, no note", () => {
		const v = view();
		expect(v.sessionDisabled).toBe(false);
		expect(v.updateNote).toBe(false);
	});

	it("the master switch off hides the per-type switches", () => {
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
