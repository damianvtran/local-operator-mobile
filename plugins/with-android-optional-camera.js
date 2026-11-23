// JavaScript, not TypeScript, for the reason `with-android-local-network.js`
// records: @expo/config-plugins `require()`s a plugin from its own CommonJS
// context, and `expo/config-plugins` is the specifier that resolves under pnpm.
const { withAndroidManifest } = require("expo/config-plugins");

/**
 * Declare the camera an OPTIONAL device feature in the generated Android
 * manifest.
 *
 * WHY THIS EXISTS. The composer's Take Photo row needs the `CAMERA` runtime
 * permission, and Android treats that permission as IMPLYING two hardware
 * features: `android.hardware.camera` and `android.hardware.camera.autofocus`
 * ("Permissions that imply feature requirements", the `<uses-feature>`
 * reference, Table 2: "a back camera is a required feature unless
 * android.hardware.camera is declared with android:required="false""). Google
 * Play filters on implied features, so without this plugin adding CAMERA
 * would silently hide the app from — and stop updating it on — every device
 * with no back camera (many Chromebooks and tablets). The camera is an extra
 * way to add an image, not the app's purpose: the sheet already says "No
 * camera is available" when there is none (`unavailable`). PR #278 round 1, R1.
 *
 * WHY A PLUGIN. `android/` is generated (continuous native generation, ADR
 * 0004) and no `app.config.ts` field writes `<uses-feature>`.
 *
 * IDEMPOTENT. An existing declaration of either feature (from a library
 * manifest, or a second prebuild pass) is rewritten to `required="false"`
 * rather than duplicated. CI asserts both entries on the RELEASE merged
 * manifest (`scripts/ci/native-config.ts`), so a removed plugin is loud.
 */
const OPTIONAL_CAMERA_FEATURES = [
	"android.hardware.camera",
	"android.hardware.camera.autofocus",
];

/** The pure transform over the parsed manifest, exported for the unit test. */
const applyOptionalCamera = (manifest) => {
	const root = manifest.manifest;
	if (!root) {
		throw new Error(
			"with-android-optional-camera: the parsed AndroidManifest.xml has no <manifest> root — the template changed shape",
		);
	}
	const features = root["uses-feature"] ?? [];
	for (const name of OPTIONAL_CAMERA_FEATURES) {
		const existing = features.find(
			(item) => item?.$?.["android:name"] === name,
		);
		if (existing) existing.$["android:required"] = "false";
		else
			features.push({
				$: { "android:name": name, "android:required": "false" },
			});
	}
	root["uses-feature"] = features;
	return manifest;
};

/** @type {import("@expo/config-plugins").ConfigPlugin} */
const withAndroidOptionalCamera = (config) =>
	withAndroidManifest(config, (mod) => {
		applyOptionalCamera(mod.modResults);
		return mod;
	});

module.exports = withAndroidOptionalCamera;
module.exports.applyOptionalCamera = applyOptionalCamera;
module.exports.OPTIONAL_CAMERA_FEATURES = OPTIONAL_CAMERA_FEATURES;
