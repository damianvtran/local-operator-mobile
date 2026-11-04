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
}
