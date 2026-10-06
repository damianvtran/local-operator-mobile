// This file is JavaScript, not TypeScript, for the same reason as its sibling
// `with-android-release-signing.js`: @expo/config-plugins loads a plugin with
// `require()` from its own CommonJS context, and the `expo/config-plugins`
// specifier (not `@expo/config-plugins`) is the one that resolves from a plugin
// file under pnpm — measured in CI on 2026-09-30 for the sibling plugin.
const { withAndroidManifest } = require("expo/config-plugins");

/**
 * Give the generated Android project the cleartext-network permission for the
 * LAN connection path (`ADR 0002` §5).
 *
 * WHY THIS EXISTS AT ALL. `android/` is generated — continuous native
 * generation is the source of truth (ADR 0004) — and no field in
 * `app.config.ts` writes `android:usesCleartextTraffic`. Every build since API
 * 28 refuses cleartext by default, and the app offers `http://` to a
 * private-network address as a deliberate, off-by-default option (the
 * same-Wi-Fi case where no tunnel exists). A switch the app offers is only
 * honest if the build carries the native change the platform needs.
 *
 * WHY IT SETS THE ATTRIBUTE ON THE **MAIN** MANIFEST. The Expo template's
 * `debug` and `debugOptimized` overlays already set `usesCleartextTraffic` (for
 * the Metro dev server) and they `tools:replace` the attribute — so a debug
 * APK shows `true` whether or not this plugin exists. A RELEASE build takes
 * its attributes from the main manifest, so that is the manifest that must
 * carry the declaration, and CI asserts it out of the released merged manifest
 * rather than the debug APK for exactly that reason (`.github/workflows/android.yml`).
 *
 * WHY APP-WIDE, NOT NARROWED. The narrow mechanism on Android is a
 * `networkSecurityConfig` with a `<domain-config>` per host — but the host is
 * a private address the reader types at runtime, and the `<domain>` element
 * cannot express an address range or a CIDR. (developer.android.com "Network
 * security configuration", read 2026-10-06: its only IP-address handling is
 * the implicit localhost configuration added in Android 17; there is no range
 * syntax.) So the honest choice is the app-wide flag plus the in-app switch,
 * and the in-app copy says exactly what the exposure is. The per-connection
 * consent the product cares about is the switch, not the manifest bit.
 *
 * WHAT HAPPENS WITHOUT THIS PLUGIN. A release build refuses `http://` to every
 * host — the LAN path fails as if the computer were offline, with no copy
 * anywhere that could explain why. CI's assertion on the release merged
 * manifest is what makes a missing plugin loud instead of silent.
 */

/** @type {import("@expo/config-plugins").ConfigPlugin} */
const withAndroidLocalNetwork = (config) => {
	return withAndroidManifest(config, (mod) => {
		// `application` is an array in the parsed manifest (config-plugins models
		// XML elements as arrays, because the schema permits several). The template
		// writes exactly one, and a second one would be a template change that CI's
		// assertions must not paper over — so take the first and fail loudly when
		// there is none.
		const application = mod.modResults.manifest.application?.[0];
		if (!application) {
			throw new Error(
				"with-android-local-network: the generated AndroidManifest.xml has no <application> element — the template changed shape, and a silent no-op here would ship a release build the app's own http:// switch cannot work on",
			);
		}
		application.$ = application.$ ?? {};
		application.$["android:usesCleartextTraffic"] = "true";
		return mod;
	});
};

module.exports = withAndroidLocalNetwork;
