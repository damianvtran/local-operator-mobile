// This file is JavaScript, not TypeScript, because @expo/config-plugins loads a
// plugin with `require()` from its own CommonJS context — the one exception to
// this repository's "TypeScript everywhere" rule, and the exception is the
// loader, not a preference. Requiring `expo/config-plugins` rather than
// `@expo/config-plugins` is deliberate too: pnpm links only the declared
// dependencies at the root, so the transitive package name does not resolve
// from a plugin file. Measured in CI on 2026-09-30 — `Cannot find module
// '@expo/config-plugins'` failed the Android build at
// `:expo-constants:createExpoConfig`. `expo` is a declared dependency and
// re-exports the same module.
const { withAppBuildGradle } = require("expo/config-plugins");

/**
 * Give the generated Android project a real `release` signing config.
 *
 * WHY THIS PLUGIN EXISTS. `android/` is not committed — continuous native
 * generation is the source of truth (ADR 0004) — so a signing config cannot be
 * a hand-edited `android/app/build.gradle`: the next `expo prebuild --clean`
 * discards it. Expo's template ships one signing config, `debug`, and points the
 * *release* build type at it, which means a `bundleRelease` out of the box
 * produces an AAB no store will accept, signed with a keystore whose password is
 * the string `android`. A config plugin is the sanctioned place for this: the
 * plugin is committed and reviewed, and it runs on every prebuild.
 *
 * WHY IT APPENDS A SECOND `android { }` BLOCK rather than rewriting the
 * template's. A second block is configured after the first, so the later value
 * wins — and unlike a regular-expression rewrite of the generated file it
 * cannot be silently defeated by an SDK upgrade changing the template's
 * whitespace or comment text. The cost is that the whole override is in one
 * readable place, which is the point.
 *
 * WHY THE MATERIAL COMES FROM THE ENVIRONMENT. A keystore path and three
 * passwords passed as Gradle properties (`-PLO_RELEASE_STORE_PASSWORD=…`) would
 * appear in `ps` output and in the CI log; environment variables set from
 * repository secrets are masked by GitHub. The Gradle invocations therefore use
 * `--no-daemon`, because a reused Gradle daemon inherits the environment of
 * whichever client started it.
 *
 * WHAT HAPPENS WITHOUT THE MATERIAL, and why it is not a silent pass. When the
 * variables are absent the `release` signing config is left with no keystore, so
 * `assembleRelease`/`bundleRelease` fail loudly ("Keystore file not set for
 * signing config 'release'") instead of quietly falling back to the debug key.
 * `assembleDebug` — which is what a pull request builds — is unaffected, so a
 * contributor with no signing material can still build and test the app.
 *
 * The release workflow checks for the keystore *before* it invokes Gradle
 * (`scripts/ci/check-secrets.mjs --mode release`), so the failure a maintainer
 * sees names the missing secret rather than a Gradle internals message.
 */

/** Present in the generated file the moment this plugin has run, which is what
 * makes a second prebuild (or a `--clean` one) idempotent rather than additive. */
const MARKER = "/* local-operator: android release signing, added below */";

const BLOCK = `
${MARKER}
android {
    signingConfigs {
        release {
            def localOperatorKeystore = System.getenv("LO_RELEASE_STORE_FILE")
            if (localOperatorKeystore) {
                storeFile file(localOperatorKeystore)
                storePassword System.getenv("LO_RELEASE_STORE_PASSWORD")
                keyAlias System.getenv("LO_RELEASE_KEY_ALIAS")
                keyPassword System.getenv("LO_RELEASE_KEY_PASSWORD")
            }
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
        }
    }
}
`;

/** @type {import("@expo/config-plugins").ConfigPlugin} */
const withAndroidReleaseSigning = (config) => {
	return withAppBuildGradle(config, (mod) => {
		if (!mod.modResults.contents.includes(MARKER)) {
			mod.modResults.contents = `${mod.modResults.contents}${BLOCK}`;
		}
		return mod;
	});
};

module.exports = withAndroidReleaseSigning;
