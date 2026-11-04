import { readFileSync, writeFileSync } from "node:fs";

/** Proof-only generated host. Select the packaged asset explicitly: no Metro
 * dependency or native dev support. Expo57's async-require message socket rejects
 * embedded DEV bundles, so the JS export is production-mode as well. Proof hooks
 * use an explicit job-only define; normal Release admission remains unchanged.
 */
const PROOF_DEFINE =
	'process.env.EXPO_PUBLIC_ANDROID_EMBEDDED_PROOF === "true"';
export function embeddedHost(source: string): string {
	const anchor =
		/(ExpoReactHostFactory\.getDefaultReactHost\(\s*context\s*=\s*applicationContext\s*,)/g;
	const matches = [...source.matchAll(anchor)];
	if (matches.length !== 1 || source.includes("useDevSupport ="))
		throw new Error("Unexpected generated Expo host; stop before native build");
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
	const originalGate =
		'__DEV__ && process.env.EXPO_PUBLIC_SIGNIN_PROOF_ORIGIN === "http://127.0.0.1:54831"';
	const gate = `${PROOF_DEFINE} && process.env.EXPO_PUBLIC_SIGNIN_PROOF_ORIGIN === "http://127.0.0.1:54831"`;
	// This entry is generated exclusively inside the hosted proof job, never the
	// normal application's entry. Keep fixture fetch admission alive with dev=false.
	source = source.replace(originalGate, gate);
	const start = `if (${gate}) console.info("ANDROID_PROOF_ENTRY_LOADED");\n`;
	const probe = `if (${gate}) {\n  const url = require("react-native").TurboModuleRegistry.getEnforcing("SourceCode").getConstants().scriptURL;\n  console.info("ANDROID_PROOF_BUNDLE_URL=" + url);\n  if (!url.startsWith("assets://")) throw new Error("Android proof must load the embedded asset");\n}\n`;
	return start + source.replace(entry, probe + entry);
}

/** Transform ONLY the job's temporary copy of the existing origin-admission
 * helper. All URL validation stays verbatim. prepare-app.sh restores the original
 * bytes after export (including on failure); no normal Release source is changed.
 */
export function embeddedOverride(source: string): string {
	const guard = 'typeof __DEV__ !== "undefined" && __DEV__';
	if (
		source.split(guard).length !== 2 ||
		source.includes("EXPO_PUBLIC_ANDROID_EMBEDDED_PROOF")
	)
		throw new Error("Unexpected OAuth proof guard; stop before native build");
	return source.replace(guard, PROOF_DEFINE);
}

if (process.argv[1]?.endsWith("embedded-host.ts")) {
	if (
		process.env.CI !== "true" ||
		process.env.RUNNER_OS !== "Linux" ||
		process.env.EXPO_PUBLIC_SIGNIN_PROOF_ORIGIN !== "http://127.0.0.1:54831" ||
		process.env.EXPO_PUBLIC_ANDROID_EMBEDDED_PROOF !== "true"
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
	const override = process.argv[4];
	if (override !== `${process.cwd()}/src/connection/oauth-proof-override.ts`)
		throw new Error("Expected the job's origin-admission helper");
	writeFileSync(override, embeddedOverride(readFileSync(override, "utf8")));
}
