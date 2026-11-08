import { beforeEach, describe, expect, it, vi } from "vitest";

const seams = vi.hoisted(() => ({
	os: "ios",
	supported: true,
	missing: false,
	exists: false,
	calls: [] as string[],
	fail: false,
	install: vi.fn(async (_sha: string, _stage: string, _used: number) => {}),
}));
vi.mock("react-native", () => ({
	Platform: {
		get OS() {
			return seams.os;
		},
	},
}));
vi.mock("expo", () => ({
	requireNativeModule: () => {
		if (seams.missing) throw Error("Module not in binary");
		return { available: async () => seams.supported, install: seams.install };
	},
}));
vi.mock("expo-file-system", () => ({
	Paths: { cache: "file:///synthetic-cache" },
	File: class {
		uri = "file:///synthetic-cache/lop-notification-sound-stage.wav";
		get exists() {
			return seams.exists;
		}
		write() {
			seams.calls.push("write");
			seams.exists = true;
			if (seams.fail) throw Error("Disk full");
		}
		delete() {
			seams.calls.push("delete");
			seams.exists = false;
		}
	},
}));

import { openSoundDisk } from "./custom-sound-native";

beforeEach(() => {
	vi.clearAllMocks();
	seams.os = "ios";
	seams.supported = true;
	seams.missing = false;
	seams.exists = false;
	seams.calls = [];
	seams.fail = false;
	seams.install.mockResolvedValue(undefined);
});
describe("native storage adapter contract (mocked binding, not device evidence)", () => {
	it("does not load native storage on web", async () => {
		seams.os = "web";
		expect(await openSoundDisk()).toBeNull();
	});
	it("fails closed if the actual binary lacks the module", async () => {
		seams.missing = true;
		expect(await openSoundDisk()).toBeNull();
	});
	it("fails closed on unsupported Android versions", async () => {
		seams.os = "android";
		seams.supported = false;
		expect(await openSoundDisk()).toBeNull();
	});
	it("stages bytes then awaits native durable commit before resolving", async () => {
		const disk = await openSoundDisk();
		expect(disk).not.toBeNull();
		await disk?.commit("1".repeat(64), new Uint8Array([1, 2]), 1);
		expect(seams.calls).toEqual(["write", "delete"]);
		expect(seams.install).toHaveBeenCalledWith(
			"1".repeat(64),
			"file:///synthetic-cache/lop-notification-sound-stage.wav",
			1,
		);
	});
	it("propagates failed native commits and removes the staging file", async () => {
		seams.install.mockRejectedValueOnce(Error("Native fsync failed"));
		const disk = await openSoundDisk();
		await expect(
			disk?.commit("1".repeat(64), new Uint8Array([1, 2]), 1),
		).rejects.toThrow("fsync");
		expect(seams.calls).toEqual(["write", "delete"]);
	});
	it("cleans a partially written staging file on disk-full", async () => {
		seams.fail = true;
		const disk = await openSoundDisk();
		await expect(
			disk?.commit("1".repeat(64), new Uint8Array([1, 2]), 1),
		).rejects.toThrow("Disk full");
		expect(seams.install).not.toHaveBeenCalled();
		expect(seams.calls).toEqual(["write", "delete"]);
	});
});
