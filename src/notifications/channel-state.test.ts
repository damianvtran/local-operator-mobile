import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({ OS: "android" as string }));
const sendIntent = vi.hoisted(() => vi.fn(async () => {}));
const openSettings = vi.hoisted(() => vi.fn(async () => {}));
const channel = vi.hoisted(() => ({ value: null as unknown, fail: false }));

vi.mock("react-native", () => ({
	Platform: platform,
	Linking: { sendIntent, openSettings },
}));
vi.mock("@/notifications/native", () => ({
	loadNotifications: async () => ({
		getNotificationChannelAsync: async () => {
			if (channel.fail) throw new Error("binder");
			return channel.value;
		},
	}),
}));

import {
	channelBlocked,
	EXPO_IMPORTANCE_NONE,
	openChannelSettings,
	readChannelBlocked,
} from "@/notifications/channel-state";

afterEach(() => {
	platform.OS = "android";
	channel.value = null;
	channel.fail = false;
	sendIntent.mockReset();
	openSettings.mockReset();
});

describe("channel state (ADR 0010 S4, §7 row 9)", () => {
	it("pins expo's AndroidImportance.NONE, which is NOT the platform's 0", () => {
		const root = join(fileURLToPath(import.meta.url), "..", "..", "..");
		const enumSource = readFileSync(
			join(
				root,
				"node_modules/expo-notifications/build/NotificationChannelManager.types.js",
			),
			"utf8",
		);
		expect(enumSource).toContain(
			`AndroidImportance["NONE"] = ${EXPO_IMPORTANCE_NONE}`,
		);
	});

	it("a channel at NONE is blocked; any other importance or none at all is not", () => {
		expect(channelBlocked({ importance: EXPO_IMPORTANCE_NONE })).toBe(true);
		expect(channelBlocked({ importance: 6 })).toBe(false);
		expect(channelBlocked({ importance: 3 })).toBe(false);
		// Not created yet: the app is about to create it, so not "off".
		expect(channelBlocked(null)).toBe(false);
	});

	it("reads the OS channel on Android", async () => {
		channel.value = { importance: EXPO_IMPORTANCE_NONE };
		expect(await readChannelBlocked("team-bridge")).toBe(true);
		channel.value = { importance: 6 };
		expect(await readChannelBlocked("team-bridge")).toBe(false);
	});

	it("a failed read is not evidence of 'off'", async () => {
		channel.fail = true;
		expect(await readChannelBlocked("team-bridge")).toBe(false);
	});

	it("is always false off Android", async () => {
		platform.OS = "ios";
		channel.value = { importance: EXPO_IMPORTANCE_NONE };
		expect(await readChannelBlocked("team-bridge")).toBe(false);
	});

	it("opens the channel's own system page, falling back to app settings", async () => {
		await openChannelSettings("team-bridge", "com.localoperator.mobile");
		expect(sendIntent).toHaveBeenCalledWith(
			"android.settings.CHANNEL_NOTIFICATION_SETTINGS",
			[
				{
					key: "android.provider.extra.APP_PACKAGE",
					value: "com.localoperator.mobile",
				},
				{ key: "android.provider.extra.CHANNEL_ID", value: "team-bridge" },
			],
		);
		expect(openSettings).not.toHaveBeenCalled();
		sendIntent.mockRejectedValueOnce(new Error("no activity"));
		await openChannelSettings("team-bridge", "com.localoperator.mobile");
		expect(openSettings).toHaveBeenCalledTimes(1);
	});
});
