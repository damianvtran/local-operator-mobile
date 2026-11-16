import { beforeEach, describe, expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({
	permission: vi.fn(async () => ({
		granted: true,
		directoryUri: "content://synthetic-selected-directory",
	})),
	create: vi.fn(async () => "content://synthetic-selected-file"),
	write: vi.fn(async () => undefined),
	share: vi.fn(async () => ({ action: "shared" })),
	cacheWrite: vi.fn(),
	cacheDelete: vi.fn(),
}));
vi.mock("expo-file-system/legacy", () => ({
	StorageAccessFramework: {
		requestDirectoryPermissionsAsync: host.permission,
		createFileAsync: host.create,
	},
	writeAsStringAsync: host.write,
	EncodingType: { Base64: "base64" },
}));
vi.mock("expo-file-system", () => ({
	Paths: { cache: "file://synthetic-private-cache" },
	Directory: class {
		create() {}
		delete() {
			host.cacheDelete();
		}
	},
	File: class {
		uri = "file://synthetic-private-cache/retained-file";
		create() {}
		write(bytes: Uint8Array) {
			host.cacheWrite(bytes);
		}
	},
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => "synthetic-unique-id" }));
vi.mock("react-native", () => ({
	Platform: { OS: "web" },
	Share: { share: host.share, sharedAction: "shared" },
}));

import { saveRetainedFile } from "./retained-file";

beforeEach(() => vi.clearAllMocks());
describe("native retained-byte save destinations (platform API contract, not device execution)", () => {
	it("Android writes retained bytes to the user-selected SAF file, never a relay URL", async () => {
		expect(
			await saveRetainedFile(
				new Uint8Array([1, 2, 3]),
				"notes.txt",
				"text/plain",
				"android",
			),
		).toBe(true);
		expect(host.create).toHaveBeenCalledWith(
			"content://synthetic-selected-directory",
			"notes.txt",
			"text/plain",
		);
		expect(host.write).toHaveBeenCalledWith(
			"content://synthetic-selected-file",
			"AQID",
			{ encoding: "base64" },
		);
	});
	it("iOS shares only an app-cache copy of retained bytes", async () => {
		const bytes = new Uint8Array([4, 5]);
		expect(
			await saveRetainedFile(bytes, "notes.txt", "text/plain", "ios"),
		).toBe(true);
		expect(host.cacheWrite).toHaveBeenCalledWith(bytes);
		expect(host.share).toHaveBeenCalledWith({
			url: "file://synthetic-private-cache/retained-file",
			title: "notes.txt",
		});
		/* R1-2: the plaintext cache copy is removed once the sheet resolves. */
		expect(host.cacheDelete).toHaveBeenCalledTimes(1);
	});
	it("iOS removes the cache copy even when the share sheet fails", async () => {
		host.share.mockRejectedValueOnce(new Error("synthetic share failure"));
		await expect(
			saveRetainedFile(new Uint8Array([6]), "notes.txt", "text/plain", "ios"),
		).rejects.toThrow("synthetic share failure");
		expect(host.cacheDelete).toHaveBeenCalledTimes(1);
	});
	it("Android cancellation performs no file creation/write", async () => {
		host.permission.mockResolvedValueOnce({ granted: false, directoryUri: "" });
		expect(
			await saveRetainedFile(
				new Uint8Array([1]),
				"notes.txt",
				"text/plain",
				"android",
			),
		).toBe(false);
		expect(host.create).not.toHaveBeenCalled();
		expect(host.write).not.toHaveBeenCalled();
	});
});
