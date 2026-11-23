// JavaScript, and `expo/config-plugins` rather than `@expo/config-plugins`, for
// the loader reasons recorded at the top of `with-android-release-signing.js`.
const { withAndroidManifest } = require("expo/config-plugins");

/**
 * Swap Expo's notification receiver for ours (ADR 0010 S2, §4).
 *
 * WHY. Team Bridge pushes need a presentation Expo cannot build (MessagingStyle
 * with the sender's face, a conversation shortcut, a group, a sender-free
 * lock-screen version) and a foreground path Expo drops (data-only pushes never
 * reach the JS handler). Expo's extension point for both is its
 * `NotificationsService` receiver: `getPresentationDelegate` and
 * `getHandlingDelegate` are `protected open`. Our subclass,
 * `dev.localoperator.teambridge.LoNotificationsService`
 * (`modules/lop-team-bridge-push`), only takes effect if it is THE receiver:
 * Expo dispatches every event to the first receiver in the package that
 * handles `expo.modules.notifications.NOTIFICATION_EVENT`
 * (`NotificationsService.findDesignatedBroadcastReceiver`), so leaving Expo's
 * in place would make the choice depend on resolution order.
 *
 * HOW. In the APP manifest (highest merge priority): declare our receiver with
 * Expo's exact attributes and intent filter, and mark Expo's
 * `tools:node="remove"` so the merger drops the one its library manifest
 * contributes. Both in one plugin so they can never be half-applied.
 * `scripts/ci/native-config.ts` asserts the result on the release merged
 * manifest, which is the file an SDK change would silently break.
 */

const EXPO_RECEIVER = "expo.modules.notifications.service.NotificationsService";
const OUR_RECEIVER = "dev.localoperator.teambridge.LoNotificationsService";

/** Expo 57.0.21's own filter (`expo-notifications/android/src/main/AndroidManifest.xml`),
 *  copied whole: boot and package-replaced actions are how Expo re-arms
 *  scheduled notifications, so dropping one would be a regression unrelated
 *  to push. */
const ACTIONS = [
	"expo.modules.notifications.NOTIFICATION_EVENT",
	"android.intent.action.BOOT_COMPLETED",
	"android.intent.action.REBOOT",
	"android.intent.action.QUICKBOOT_POWERON",
	"com.htc.intent.action.QUICKBOOT_POWERON",
	"android.intent.action.MY_PACKAGE_REPLACED",
];

/**
 * Pure transform of the parsed manifest, exported for a unit test.
 * Idempotent: prebuild may run it on an already-modified manifest.
 *
 * @param {import("@expo/config-plugins").AndroidConfig.Manifest.AndroidManifest} manifest
 */
const applyTeamBridgeReceiver = (manifest) => {
	const application = manifest.manifest.application?.[0];
	if (!application) {
		throw new Error(
			"with-android-team-bridge-push: the generated AndroidManifest.xml has no <application> element — the template changed shape, and a silent no-op here would ship Expo's receiver with none of the Team Bridge presentation",
		);
	}
	manifest.manifest.$ = manifest.manifest.$ ?? {};
	manifest.manifest.$["xmlns:tools"] = "http://schemas.android.com/tools";
	const receivers = (application.receiver ?? []).filter(
		(receiver) =>
			receiver.$?.["android:name"] !== EXPO_RECEIVER &&
			receiver.$?.["android:name"] !== OUR_RECEIVER,
	);
	receivers.push(
		{ $: { "android:name": EXPO_RECEIVER, "tools:node": "remove" } },
		{
			$: {
				"android:name": OUR_RECEIVER,
				"android:enabled": "true",
				"android:exported": "false",
			},
			"intent-filter": [
				{
					$: { "android:priority": "-1" },
					action: ACTIONS.map((name) => ({ $: { "android:name": name } })),
				},
			],
		},
	);
	application.receiver = receivers;
	return manifest;
};

/** @type {import("@expo/config-plugins").ConfigPlugin} */
const withAndroidTeamBridgePush = (config) =>
	withAndroidManifest(config, (mod) => {
		mod.modResults = applyTeamBridgeReceiver(mod.modResults);
		return mod;
	});

module.exports = withAndroidTeamBridgePush;
module.exports.applyTeamBridgeReceiver = applyTeamBridgeReceiver;
module.exports.EXPO_RECEIVER = EXPO_RECEIVER;
module.exports.OUR_RECEIVER = OUR_RECEIVER;
module.exports.RECEIVER_ACTIONS = ACTIONS;
