import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

/**
 * The optional-camera plugin (`with-android-optional-camera.js`, PR #278 round
 * 1, R1). The transform is driven directly on the parsed-manifest shape
 * config-plugins hands it; that the release merged manifest really carries
 * both entries is asserted on every built APK by `scripts/ci/native-config.ts`.
 */
const require = createRequire(import.meta.url);
type Feature = { $: Record<string, string> };
type Manifest = { manifest?: { "uses-feature"?: Feature[] } };
const plugin = require("./with-android-optional-camera.js") as {
	applyOptionalCamera: (manifest: Manifest) => Manifest;
	OPTIONAL_CAMERA_FEATURES: string[];
};

const required = (manifest: Manifest): Record<string, string | undefined> =>
	Object.fromEntries(
		(manifest.manifest?.["uses-feature"] ?? []).map((feature) => [
			feature.$["android:name"],
			feature.$["android:required"],
		]),
	);

describe("applyOptionalCamera", () => {
	it("declares the camera and its autofocus optional, so Play does not filter out camera-less devices", () => {
		const result = plugin.applyOptionalCamera({ manifest: {} });
		expect(required(result)).toEqual({
			"android.hardware.camera": "false",
			"android.hardware.camera.autofocus": "false",
		});
	});

	it("rewrites an existing required declaration instead of duplicating it", () => {
		const result = plugin.applyOptionalCamera({
			manifest: {
				"uses-feature": [
					{
						$: {
							"android:name": "android.hardware.camera",
							"android:required": "true",
						},
					},
					{
						$: {
							"android:name": "android.hardware.touchscreen",
							"android:required": "false",
						},
					},
				],
			},
		});
		expect(result.manifest?.["uses-feature"]).toHaveLength(3);
		expect(required(result)).toEqual({
			"android.hardware.camera": "false",
			"android.hardware.touchscreen": "false",
			"android.hardware.camera.autofocus": "false",
		});
	});

	it("is idempotent across a second prebuild pass", () => {
		const once = plugin.applyOptionalCamera({ manifest: {} });
		const twice = plugin.applyOptionalCamera(once);
		expect(twice.manifest?.["uses-feature"]).toHaveLength(2);
	});

	it("fails loudly on a manifest with no root rather than shipping a silent no-op", () => {
		expect(() => plugin.applyOptionalCamera({})).toThrow(/no <manifest> root/);
	});
});
