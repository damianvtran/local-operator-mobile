import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Platform: { OS: "android" } }));

import {
	hubOrigin,
	presentationStrings,
	TEAM_BRIDGE_CHANNEL_ID,
	teamBridgeChannelInput,
} from "@/team-bridge/android-presentation";

/**
 * The JS half of the Team Bridge Android presentation (ADR 0010 S2/S4): the
 * channel is localised (no English literal), HIGH, lock-screen PRIVATE; and the
 * native module's English fallbacks are the `en` catalogue's own words, so a
 * killed-app push before the first hand-over says what the app would.
 */
const RAW_KEY = /^mobile\./;
const root = join(fileURLToPath(import.meta.url), "..", "..", "..", "..");
const kotlinStrings = readFileSync(
	join(
		root,
		"modules/lop-team-bridge-push/android/src/main/java/dev/localoperator/teambridge/PresentationStrings.kt",
	),
	"utf8",
);

describe("Team Bridge Android presentation", () => {
	it("loads presentation helpers without initializing Expo, even on Android", async () => {
		vi.resetModules();
		vi.doMock("expo", () => {
			throw new Error("Unexpected eager Expo initialization");
		});
		try {
			const presentation = await import("@/team-bridge/android-presentation");
			expect(presentation.TEAM_BRIDGE_CHANNEL_ID).toBe("team-bridge");
		} finally {
			vi.doUnmock("expo");
		}
	});

	it("keeps the channel id the cloud names", () => {
		expect(TEAM_BRIDGE_CHANNEL_ID).toBe("team-bridge");
	});

	it("names the channel from the catalogue, at HIGH and lock-screen PRIVATE", () => {
		const input = teamBridgeChannelInput(6, 2);
		expect(input.name).toBe("Team Bridge");
		expect(input.description).toBe(
			"Messages from your teammates and their agents.",
		);
		expect(input.name).not.toMatch(RAW_KEY);
		expect(input.importance).toBe(6);
		expect(input.lockscreenVisibility).toBe(2);
	});

	it("hands the native side resolved copy, matching its English defaults", () => {
		const strings = presentationStrings();
		expect(strings.selfName).not.toMatch(RAW_KEY);
		expect(strings.hiddenPreview).not.toMatch(RAW_KEY);
		expect(kotlinStrings).toContain(
			`DEFAULT_SELF_NAME = "${strings.selfName}"`,
		);
		expect(kotlinStrings).toContain(
			`DEFAULT_HIDDEN_PREVIEW = "${strings.hiddenPreview}"`,
		);
	});

	it("uses the iOS hidden-preview placeholder for the lock screen", () => {
		// One sentence on both platforms (categories.ts registers the same key).
		expect(presentationStrings().hiddenPreview).toBe("Team Bridge message");
	});

	it("hands the native photo fetcher the production hub origin only (ADR 0010 S5)", () => {
		expect(hubOrigin()).toBe("https://api.radienthq.com");
	});
});
