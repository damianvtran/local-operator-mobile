// JavaScript, and `expo/config-plugins` rather than `@expo/config-plugins`, for
// the loader reasons recorded at the top of `with-android-release-signing.js`.
const { AndroidConfig, withStringsXml } = require("expo/config-plugins");

/**
 * Set the Android launcher label — the text under the home-screen icon — to a
 * value other than the app's `name`.
 *
 * WHY. The operator's decision (2026-11-11) is a home-screen label of
 * "Operator": "Local Operator" does not fit under a launcher icon (see
 * `LAUNCHER_LABEL` in `app.config.ts`), while the in-app name, the Play listing
 * and `name` stay "Local Operator". Expo has no `android.label` field: its
 * default `withName` plugin writes `name` into the `app_name` string, and the
 * template's `<application android:label="@string/app_name">` reads it. So this
 * plugin rewrites that one string. Pointing the manifest at a new resource
 * instead would leave `app_name` as a second, unused truth.
 *
 * ORDERING. Mods run in reverse registration order, and Expo registers its
 * default plugins (including `withName`) after the project's own, so this
 * plugin's strings mod runs AFTER `withName` and its value is the one written.
 * That is a property of Expo's pipeline rather than of this file, which is why
 * `scripts/ci/native-config.ts` asserts the label on the built APK: an SDK that
 * reordered the mods would fail CI instead of silently shipping "Local Operator".
 *
 * WHAT `app_name` ALSO NAMES. The same string is the app's name in Android's
 * Settings and in the notification shade header — both are the launcher-label
 * surfaces the decision covers. Gradle's `rootProject.name` comes from `name`,
 * not this string, and is unaffected.
 */

/**
 * Pure transform of the parsed `strings.xml`, exported so a unit test can
 * drive it without running prebuild.
 *
 * @param {import("@expo/config-plugins").AndroidConfig.Resources.ResourceXML} strings
 * @param {string} label
 */
const applyLauncherLabel = (strings, label) => {
	if (typeof label !== "string" || label.trim().length === 0) {
		// An empty label would ship an icon with no name; fail the prebuild where
		// the value entered rather than on a phone.
		throw new Error(
			`with-android-launcher-label: expected a non-empty \`label\` option, got ${JSON.stringify(label)}`,
		);
	}
	return AndroidConfig.Strings.setStringItem(
		[
			AndroidConfig.Resources.buildResourceItem({
				name: "app_name",
				value: label,
			}),
		],
		strings,
	);
};

/** @type {import("@expo/config-plugins").ConfigPlugin<{ label: string }>} */
const withAndroidLauncherLabel = (config, { label } = {}) => {
	return withStringsXml(config, (mod) => {
		mod.modResults = applyLauncherLabel(mod.modResults, label);
		return mod;
	});
};

module.exports = withAndroidLauncherLabel;
module.exports.applyLauncherLabel = applyLauncherLabel;
