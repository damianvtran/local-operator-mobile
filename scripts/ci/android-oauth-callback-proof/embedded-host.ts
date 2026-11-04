import { readFileSync, writeFileSync } from "node:fs";

/** Proof-only generated host. Expo56 defaults useDevSupport to the React Native
 * AAR's ReactBuildConfig.DEBUG, not the application's BuildConfig.DEBUG. A debug
 * APK can therefore try an absent asset instead of the already-warm Metro.
 * Select the embedded asset explicitly; its JS is built with dev=true ONLY so
 * the existing Debug+E2E override remains testable, never a release override.
 */
export function embeddedHost(source: string): string {
	const anchor =
		/(ExpoReactHostFactory\.getDefaultReactHost\(\s*context\s*=\s*applicationContext\s*,)/g;
	const matches = [...source.matchAll(anchor)];
	if (matches.length !== 1 || source.includes("useDevSupport ="))
		throw new Error(
			"Unexpected generated Expo56 host; stop before native build",
		);
	return source.replace(
		anchor,
		'$1\n      useDevSupport = false,\n      jsBundleAssetPath = "index.android.bundle",',
	);
}

/** Job-generated JS only: record the actual native bundle URL, not an inference
 * from an asset's presence. Fail before OAuth if this proof selects Metro. */
export function embeddedEntry(source: string): string {
	const entry = 'require("expo-router/entry");';
	if (
		source.split(entry).length !== 2 ||
		source.includes("ANDROID_PROOF_ENTRY_LOADED")
	)
		throw new Error("Unexpected proof entry; stop before native build");
	const gate =
		'__DEV__ && process.env.EXPO_PUBLIC_SIGNIN_PROOF_ORIGIN === "http://127.0.0.1:54831"';
	const start = `if (${gate}) console.info("ANDROID_PROOF_ENTRY_LOADED");\n`;
	const probe = `if (${gate}) {\n  const url = require("react-native").TurboModuleRegistry.getEnforcing("SourceCode").getConstants().scriptURL;\n  console.info("ANDROID_PROOF_BUNDLE_URL=" + url);\n  if (!url.startsWith("assets://")) throw new Error("Android proof must load the embedded asset");\n}\n`;
	return start + source.replace(entry, probe + entry);
}

if (process.argv[1]?.endsWith("embedded-host.ts")) {
	if (
		process.env.CI !== "true" ||
		process.env.RUNNER_OS !== "Linux" ||
		process.env.EXPO_PUBLIC_SIGNIN_PROOF_ORIGIN !== "http://127.0.0.1:54831"
	)
		throw new Error("Hosted Android proof only");
	const path = process.argv[2];
	if (!path?.startsWith(`${process.cwd()}/android/`))
		throw new Error("Expected job-generated Android host");
	writeFileSync(path, embeddedHost(readFileSync(path, "utf8")));
	const entry = process.argv[3];
	if (entry !== `${process.cwd()}/signin-proof-entry.js`)
		throw new Error("Expected job-generated proof entry");
	writeFileSync(entry, embeddedEntry(readFileSync(entry, "utf8")));
}
