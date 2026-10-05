/**
 * The recorder boundary's testable half: the container/MIME mapping and the
 * honest degradation on a build without the native module.
 *
 * `react-native` is aliased to `react-native-web` in this Node host (see
 * `vitest.config.ts`), so `Platform.OS` is `web` — which is exactly the "binary
 * that does not carry the module" case the design requires to degrade to a hidden
 * mic rather than a crash. The real capture path needs a device (named as a QA
 * gap in the PR).
 */

import { describe, expect, it } from "vitest";

import {
	canRecord,
	discardRecording,
	extensionOf,
	fileNameOf,
	loadRecorder,
	mimeForExtension,
	readMicPermission,
	recorderFromHook,
	recorderSupported,
	startRecording,
} from "@/stt/recorder";

describe("mime mapping", () => {
	it("maps the recorder's containers onto the server allowlist", () => {
		expect(mimeForExtension(".m4a")).toBe("audio/mp4");
		expect(mimeForExtension("m4a")).toBe("audio/mp4");
		expect(mimeForExtension(".webm")).toBe("audio/webm");
		expect(mimeForExtension(".ogg")).toBe("audio/ogg");
		expect(mimeForExtension(".mp3")).toBe("audio/mpeg");
		expect(mimeForExtension(".wav")).toBe("audio/wav");
		/* An unknown container is refused by the relay's allowlist; the mapping does
		 * not invent a mime, it answers the recorder's default. */
		expect(mimeForExtension(".caf")).toBe("audio/mp4");
	});

	it("reads the extension and filename off a file URI", () => {
		expect(extensionOf("file:///var/tmp/recording.m4a")).toBe(".m4a");
		expect(extensionOf("file:///a/b.m4a?cache=1")).toBe(".m4a");
		expect(extensionOf("file:///no-extension")).toBe("");
		expect(fileNameOf("file:///var/tmp/recording.m4a")).toBe("recording.m4a");
		expect(fileNameOf("file:///")).toBe("recording.m4a");
	});
});

describe("degradation without the native module", () => {
	it("reports the platform as unable to record", () => {
		expect(recorderSupported()).toBe(false);
	});

	it("keeps the capture hook from changing an installed build's answer", () => {
		/* No `lo-recorder` on this host, so the hook falls through to the platform
		 * fact — the property that keeps a URL from steering the shipped app. */
		expect(recorderFromHook(null)).toBeNull();
		expect(recorderFromHook(undefined)).toBeNull();
		expect(canRecord()).toBe(false);
	});

	it("reads the capture hook's vocabulary", () => {
		/* The one value that stands in for a recorder; anything else is a refusal,
		 * so a typo in a cell's URL hides the mic rather than faking a frame. */
		expect(recorderFromHook("supported")).toBe(true);
		expect(recorderFromHook("unsupported")).toBe(false);
		expect(recorderFromHook("yes")).toBe(false);
		expect(recorderFromHook("true")).toBe(false);
	});

	it("loads no module and asks for no permission", async () => {
		expect(await loadRecorder()).toBeNull();
		expect(await readMicPermission()).toBe("unsupported");
		expect(await startRecording()).toBeNull();
	});

	it("swallows a discard that cannot reach the filesystem", async () => {
		await expect(
			discardRecording({
				uri: "file:///nowhere.m4a",
				mimeType: "audio/mp4",
				name: "nowhere.m4a",
				durationMs: 0,
			}),
		).resolves.toBeUndefined();
	});
});
