import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The attach paths at the REAL module boundary: `attach.ts` as the composer calls
 * it, with `expo-image-picker` and `expo-file-system` replaced by fakes that
 * answer the way the 57.x native modules do (shapes read from
 * `ImagePickerModule.swift` / `MediaHandler.swift` at 57.0.20). What is asserted
 * is the CALL SEQUENCE the device sees — which permission APIs run, in which
 * order, with which options — because that sequence is what decides whether a
 * system prompt, a picker, a crash or nothing at all appears on the phone.
 */

const native = vi.hoisted(() => ({
	os: "ios" as "ios" | "android" | "web",
	documentUri: "file:///var/mobile/Containers/Data/Application/0000/Documents/",
	cacheUri:
		"file:///var/mobile/Containers/Data/Application/0000/Library/Caches/",
	calls: [] as string[],
	permission: { granted: false, canAskAgain: true },
	requestAnswer: { granted: true, canAskAgain: true },
	launchResult: null as unknown,
	deleted: [] as string[],
}));

vi.mock("react-native", () => ({
	Platform: {
		get OS() {
			return native.os;
		},
	},
}));

vi.mock("expo-image-picker", () => ({
	getCameraPermissionsAsync: async () => {
		native.calls.push("getCameraPermissionsAsync");
		return native.permission;
	},
	requestCameraPermissionsAsync: async () => {
		native.calls.push("requestCameraPermissionsAsync");
		return native.requestAnswer;
	},
	requestMediaLibraryPermissionsAsync: async () => {
		native.calls.push("requestMediaLibraryPermissionsAsync");
		return { granted: false, canAskAgain: false };
	},
	launchCameraAsync: async (options: unknown) => {
		native.calls.push(`launchCameraAsync ${JSON.stringify(options)}`);
		return native.launchResult;
	},
	launchImageLibraryAsync: async (options: unknown) => {
		native.calls.push(`launchImageLibraryAsync ${JSON.stringify(options)}`);
		return native.launchResult;
	},
}));

vi.mock("expo-file-system", () => {
	class File {
		constructor(readonly uri: string) {}
		info() {
			return { exists: !native.deleted.includes(this.uri) };
		}
		delete() {
			native.deleted.push(this.uri);
		}
	}
	return {
		File,
		Paths: {
			get document() {
				return { uri: native.documentUri };
			},
			get cache() {
				return { uri: native.cacheUri };
			},
		},
	};
});

import { prepareCamera, readImageFrom, takePhotoWithCamera } from "./attach";

const CAMERA_LAUNCH = /^launchCameraAsync /;

/** A captured photo as the iOS camera path returns it: a copy under
 *  Caches/ImagePicker and JPEG base64 (the module always re-encodes base64 to
 *  JPEG, whatever `mimeType` reports). */
const capturedAsset = () => ({
	uri: `${native.cacheUri}ImagePicker/1A2B.jpg`,
	base64: "/9j/4AAQSkZJRgABAQ",
	mimeType: "image/heic",
	width: 3024,
	height: 4032,
});

beforeEach(() => {
	native.os = "ios";
	native.documentUri =
		"file:///var/mobile/Containers/Data/Application/0000/Documents/";
	native.calls = [];
	native.permission = { granted: false, canAskAgain: true };
	native.requestAnswer = { granted: true, canAskAgain: true };
	native.launchResult = null;
	native.deleted = [];
});

describe("the camera's permission step (prepareCamera)", () => {
	it("asks the OS only when it has not decided, and is ready on Allow", async () => {
		expect(await prepareCamera()).toBe("ready");
		expect(native.calls).toEqual([
			"getCameraPermissionsAsync",
			"requestCameraPermissionsAsync",
		]);
	});

	it("is ready without a prompt when access was already granted", async () => {
		native.permission = { granted: true, canAskAgain: true };
		expect(await prepareCamera()).toBe("ready");
		expect(native.calls).toEqual(["getCameraPermissionsAsync"]);
	});

	it("answers denied when the reader refuses the prompt", async () => {
		native.requestAnswer = { granted: false, canAskAgain: false };
		expect(await prepareCamera()).toBe("denied");
	});

	it("goes straight to denied, without a prompt the OS would not show, after a final refusal", async () => {
		native.permission = { granted: false, canAskAgain: false };
		expect(await prepareCamera()).toBe("denied");
		expect(native.calls).toEqual(["getCameraPermissionsAsync"]);
	});

	it("answers unavailable on the iOS simulator BEFORE touching the picker, which would crash it", async () => {
		native.documentUri =
			"file:///Users/dev/Library/Developer/CoreSimulator/Devices/5E1F-UDID/data/Containers/Data/Application/0000/Documents/";
		expect(await prepareCamera()).toBe("unavailable");
		expect(native.calls).toEqual([]);
	});

	it("does not apply the simulator rule on Android, whose emulator paths never match it", async () => {
		native.os = "android";
		native.documentUri = "file:///data/user/0/com.localoperator.mobile/files/";
		expect(await prepareCamera()).toBe("ready");
	});

	it("answers unavailable on the web build, which has no camera row", async () => {
		native.os = "web";
		expect(await prepareCamera()).toBe("unavailable");
		expect(native.calls).toEqual([]);
	});
});

describe("taking a photo (takePhotoWithCamera)", () => {
	it("captures through the picker path: base64 in one read, MIME sniffed, cache copy deleted", async () => {
		native.launchResult = { canceled: false, assets: [capturedAsset()] };
		expect(await takePhotoWithCamera()).toEqual({
			data_b64: "/9j/4AAQSkZJRgABAQ",
			mime_type: "image/jpeg",
		});
		expect(native.calls).toEqual([
			'launchCameraAsync {"mediaTypes":["images"],"base64":true,"allowsEditing":false}',
		]);
		expect(native.deleted).toEqual([capturedAsset().uri]);
	});

	it("returns null when the reader backs out of the camera", async () => {
		native.launchResult = { canceled: true, assets: null };
		expect(await takePhotoWithCamera()).toBeNull();
	});

	it("throws, never resolves null, when the capture has no bytes", async () => {
		native.launchResult = {
			canceled: false,
			assets: [{ ...capturedAsset(), base64: null }],
		};
		await expect(takePhotoWithCamera()).rejects.toThrow("could not be read");
	});
});

describe("the attach sheet's sources at the module boundary (readImageFrom)", () => {
	it("routes Camera to the camera, not to a picker", async () => {
		native.launchResult = { canceled: false, assets: [capturedAsset()] };
		await readImageFrom("camera");
		expect(native.calls[0]).toMatch(CAMERA_LAUNCH);
	});

	it("opens the photo library with NO permission request — PHPicker needs none and the plist has no library string", async () => {
		/* The design `app.config.ts` records: `photosPermission: false` keeps
		 * NSPhotoLibraryUsageDescription out of the plist, so a library-permission
		 * request here would be answered without a prompt, or crash the app. The
		 * library path must go straight to the system picker. */
		native.launchResult = { canceled: false, assets: [capturedAsset()] };
		expect(await readImageFrom("library")).toEqual({
			data_b64: "/9j/4AAQSkZJRgABAQ",
			mime_type: "image/jpeg",
		});
		expect(native.calls).toEqual([
			'launchImageLibraryAsync {"mediaTypes":["images"],"base64":true,"allowsMultipleSelection":false}',
		]);
	});
});
