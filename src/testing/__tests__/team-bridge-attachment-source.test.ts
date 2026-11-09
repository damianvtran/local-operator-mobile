import { afterEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
	pick: vi.fn(async () => ({ canceled: true, assets: [] })),
	paste: vi.fn(async () => null),
}));
vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
vi.mock("expo-image-picker", () => ({ launchImageLibraryAsync: native.pick }));
vi.mock("expo-clipboard", () => ({ getImageAsync: native.paste }));

import { Platform } from "react-native";
import {
	pasteTeamBridgeImage,
	pickTeamBridgeImages,
	prepareTeamBridgeImage,
} from "@/features/team-bridge/attachment-source";
import { syntheticAttachmentSource } from "@/testing/team-bridge-attachment-source";

const at = (
	query = "?tb-fixture=attachments&tb-flow=source6&tb-account=b&tb-source=synthetic",
	hostname = "localhost",
) =>
	vi.stubGlobal("location", {
		hostname,
		origin: `http://${hostname}:18808`,
		search: query,
	});
afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	vi.clearAllMocks();
	Platform.OS = "web";
});

describe("synthetic attachment acquisition, never draft injection", () => {
	it("uses the actual picker and paste acquisition boundary without touching operator media", async () => {
		vi.stubEnv("EXPO_PUBLIC_TEAM_BRIDGE_FIXTURES", "1");
		at();
		const source = syntheticAttachmentSource();
		expect(source).toMatchObject({ width: 24, height: 16, isPng: true });
		expect(await pickTeamBridgeImages(4)).toEqual([source]);
		expect(await pickTeamBridgeImages(0)).toEqual([]);
		expect(await pasteTeamBridgeImage()).toEqual(source);
		expect(native.pick).not.toHaveBeenCalled();
		expect(native.paste).not.toHaveBeenCalled();
	});
	it("retains normal image manipulation and bounding after synthetic acquisition", async () => {
		vi.stubEnv("EXPO_PUBLIC_TEAM_BRIDGE_FIXTURES", "1");
		at();
		const source = syntheticAttachmentSource();
		if (!source) throw new Error("source not admitted");
		const save = vi.fn(async () => ({
			uri: "data:synthetic",
			base64: source.uri.split(",")[1],
		}));
		const release = vi.fn();
		const resize = vi.fn(() => ({
			renderAsync: async () => ({ saveAsync: save, release }),
		}));
		const manipulate = vi.fn(() => ({ resize, release }));
		vi.doMock("expo-image-manipulator", () => ({
			ImageManipulator: { manipulate },
			SaveFormat: { PNG: "png", JPEG: "jpeg" },
		}));
		const result = await prepareTeamBridgeImage(source);
		expect(manipulate).toHaveBeenCalledWith(source.uri);
		expect(resize).toHaveBeenCalledWith({ width: 24, height: 16 });
		expect(save).toHaveBeenCalledWith(
			expect.objectContaining({ format: "png", base64: true }),
		);
		expect(result).toMatchObject({ width: 24, height: 16, mime: "image/png" });
		expect([...result.bytes.slice(0, 8)]).toEqual([
			137, 80, 78, 71, 13, 10, 26, 10,
		]);
		expect(release).toHaveBeenCalledTimes(2);
	});
	it("rejects production flag-off, non-web, remote, unrelated and non-opted-in URLs", async () => {
		at();
		expect(syntheticAttachmentSource()).toBeNull();
		expect(await pickTeamBridgeImages(1)).toEqual([]);
		expect(native.pick).toHaveBeenCalledOnce();
		expect(await pasteTeamBridgeImage()).toBeNull();
		expect(native.paste).toHaveBeenCalledOnce();
		vi.stubEnv("EXPO_PUBLIC_TEAM_BRIDGE_FIXTURES", "1");
		at("?tb-fixture=attachments");
		expect(syntheticAttachmentSource()).toBeNull();
		at("?tb-fixture=notice_default&tb-source=synthetic");
		expect(syntheticAttachmentSource()).toBeNull();
		at("?tb-fixture=attachments&tb-source=synthetic", "example.com");
		expect(syntheticAttachmentSource()).toBeNull();
		at();
		Platform.OS = "ios";
		expect(syntheticAttachmentSource()).toBeNull();
	});
});
