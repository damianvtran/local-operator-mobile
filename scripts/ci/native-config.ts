#!/usr/bin/env node
/**
 * Assert that the local-network configuration the app ASKS FOR (app.config.ts,
 * `plugins/with-android-local-network.js`) is present in the artefacts that
 * SHIP. Both native workflows call this; it is the "generated config must match
 * what we think we asked for" discipline ADR 0004 applies to `expo prebuild`,
 * pointed at the built products instead of the generated tree.
 *
 *     node scripts/ci/native-config.ts ios "$RUNNER_TEMP/Info.json"
 *     node scripts/ci/native-config.ts android "$RUNNER_TEMP/release-merged/AndroidManifest.xml"
 *
 * WHY THE iOS SIDE READS THE PATH THAT IT DOES. `ios.yml` converts the
 * `Info.plist` of the app it just BUILT (not a source plist, not the generated
 * project) to JSON with `plutil` and passes the file here. What that proves is
 * narrow and stated: the built product carries the keys. WHICH mechanism iOS
 * actually honours for a literal private IP — the local-networking boolean or
 * the CIDR exception domains — is genuinely ambiguous in Apple's own current
 * documentation, and is settled only on a device (ADR 0002 §7, S10). This
 * script checks the configuration is present; it cannot check the OS's reading
 * of it, and it must not be read as doing so.
 *
 * WHY THE ANDROID SIDE READS THE RELEASE MERGED MANIFEST, not the debug APK.
 * The Expo template's `debug` and `debugOptimized` overlays set
 * `usesCleartextTraffic="true"` themselves, with `tools:replace`, so a debug
 * APK shows the attribute whether or not the app's own plugin ran — a check on
 * it would be vacuous. The release variant takes its manifest from the main
 * source manifest (plus library manifests), which is where the plugin's
 * declaration must survive merging. So `android.yml` runs
 * `:app:processReleaseMainManifest` and this script reads its output.
 *
 * Run directly by Node (type-stripping, no build step, no dependency).
 */

import { readFileSync } from "node:fs";

/**
 * The literal private ranges the app's own URL validation accepts for plain
 * `http://` (`src/connection/profile.ts`, `isPrivateHost`): RFC 1918, CGNAT
 * (Tailscale) and link-local. The list is duplicated from `app.config.ts` on
 * purpose — this file is the GATE, and a gate that imports its expectation
 * from the thing it is checking asserts nothing.
 */
export const IOS_EXCEPTION_DOMAINS = [
	"10.0.0.0/8",
	"100.64.0.0/10",
	"169.254.0.0/16",
	"172.16.0.0/12",
	"192.168.0.0/16",
] as const;

/** The Android permission the local-network enforcement (targetSdk 37) gates
 *  on; declared ahead of the bump so the manifest already carries it. */
export const ANDROID_LOCAL_NETWORK_PERMISSION =
	"android.permission.ACCESS_LOCAL_NETWORK";

export interface Finding {
	/** What was expected, named the way the config names it. */
	field: string;
	/** What was found instead. */
	problem: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Check the JSON form of a built `Info.plist`. Returns one finding per missing
 * or wrong expectation; an empty array is a pass.
 */
export function checkIosInfoPlist(plist: unknown): Finding[] {
	const findings: Finding[] = [];
	if (!isRecord(plist)) {
		return [
			{ field: "Info.plist", problem: "the file is not a plist dictionary" },
		];
	}

	const description = plist.NSLocalNetworkUsageDescription;
	if (typeof description !== "string" || description.trim().length === 0) {
		findings.push({
			field: "NSLocalNetworkUsageDescription",
			problem:
				"missing or empty — the local-network alert would have no rationale",
		});
	}

	const ats = plist.NSAppTransportSecurity;
	if (!isRecord(ats)) {
		findings.push({
			field: "NSAppTransportSecurity",
			problem: "missing — no ATS configuration reached the built product",
		});
		return findings;
	}
	if (ats.NSAllowsLocalNetworking !== true) {
		findings.push({
			field: "NSAppTransportSecurity.NSAllowsLocalNetworking",
			problem: `expected true, found ${JSON.stringify(ats.NSAllowsLocalNetworking)}`,
		});
	}
	if (ats.NSAllowsArbitraryLoads !== false) {
		findings.push({
			field: "NSAppTransportSecurity.NSAllowsArbitraryLoads",
			problem: `expected false (the app must not be a general arbitrary-loads downgrade), found ${JSON.stringify(ats.NSAllowsArbitraryLoads)}`,
		});
	}

	const domains = ats.NSExceptionDomains;
	if (!isRecord(domains)) {
		findings.push({
			field: "NSAppTransportSecurity.NSExceptionDomains",
			problem:
				"missing — a literal private IP would depend on the boolean being read the lenient way",
		});
		return findings;
	}
	for (const range of IOS_EXCEPTION_DOMAINS) {
		const entry = domains[range];
		if (!isRecord(entry)) {
			findings.push({
				field: `NSAppTransportSecurity.NSExceptionDomains["${range}"]`,
				problem: "missing",
			});
			continue;
		}
		if (entry.NSExceptionAllowsInsecureHTTPLoads !== true) {
			findings.push({
				field: `NSAppTransportSecurity.NSExceptionDomains["${range}"].NSExceptionAllowsInsecureHTTPLoads`,
				problem: `expected true, found ${JSON.stringify(entry.NSExceptionAllowsInsecureHTTPLoads)}`,
			});
		}
	}
	return findings;
}

/** The merged manifest's parsing patterns, at module scope per biome's
 *  `useTopLevelRegex` — this check runs in every native workflow, and per-call
 *  literals are the pattern the rule warns about. They tolerate attribute order
 *  and whitespace; a failure names the declaration it could not find, never a
 *  parse error. */
const XML_COMMENT = /<!--[\s\S]*?-->/g;
const APPLICATION_OPEN_TAG = /<application\b[^>]*>/i;
const CLEARTEXT_TRUE = /\bandroid:usesCleartextTraffic\s*=\s*"true"/i;

/** Remove XML comments so a commented-out element can never satisfy a check. */
const stripComments = (xml: string): string => xml.replace(XML_COMMENT, "");

/**
 * Check the text of a merged Android manifest (the release variant's). Returns
 * one finding per missing declaration; an empty array is a pass.
 *
 * This is deliberately a pattern match over the manifest AGP writes rather than
 * a general XML parse: the input is a generated file with a known shape, and a
 * dependency for this check would cost more than it protects.
 */
export function checkAndroidManifest(xml: string): Finding[] {
	const findings: Finding[] = [];
	const text = stripComments(xml);

	const application = APPLICATION_OPEN_TAG.exec(text);
	if (!application) {
		findings.push({
			field: "AndroidManifest.xml",
			problem:
				"no <application> element — the manifest is not the shape expected",
		});
	} else if (!CLEARTEXT_TRUE.test(application[0])) {
		findings.push({
			field: "application@android:usesCleartextTraffic",
			problem:
				'expected "true" — a release build would refuse http:// to every host, LAN included',
		});
	}

	const permission = new RegExp(
		`<uses-permission\\b[^>]*\\bandroid:name\\s*=\\s*"${ANDROID_LOCAL_NETWORK_PERMISSION.replace(/\./g, "\\.")}"`,
		"i",
	);
	if (!permission.test(text)) {
		findings.push({
			field: `uses-permission[${ANDROID_LOCAL_NETWORK_PERMISSION}]`,
			problem: "missing",
		});
	}

	return findings;
}

/** One line for the CI step summary, naming what was asserted. */
export const summarize = (platform: "ios" | "android"): string =>
	platform === "ios"
		? `built Info.plist carries NSLocalNetworkUsageDescription and the ATS local-networking configuration (NSAllowsLocalNetworking + ${IOS_EXCEPTION_DOMAINS.length} CIDR exceptions)`
		: `release merged manifest carries android:usesCleartextTraffic="true" and ${ANDROID_LOCAL_NETWORK_PERMISSION}`;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const main = (): void => {
	const [platform, path] = process.argv.slice(2);
	if (
		(platform !== "ios" && platform !== "android") ||
		typeof path !== "string" ||
		path.length === 0
	) {
		console.error(
			"usage: native-config.ts <ios|android> <path>\n" +
				"  ios     path to the built Info.plist converted to JSON (plutil -convert json)\n" +
				"  android path to the release merged AndroidManifest.xml",
		);
		process.exit(2);
	}

	let raw: string;
	try {
		raw = readFileSync(path, "utf8");
	} catch (error) {
		console.error(
			`::error::native-config: cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`,
		);
		process.exit(1);
	}

	let findings: Finding[];
	if (platform === "ios") {
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch (error) {
			console.error(
				`::error::native-config: ${path} is not JSON — the step should run plutil -convert json first: ${error instanceof Error ? error.message : String(error)}`,
			);
			process.exit(1);
		}
		findings = checkIosInfoPlist(parsed);
	} else {
		findings = checkAndroidManifest(raw);
	}

	for (const finding of findings) {
		console.error(
			`::error::native-config: ${finding.field}: ${finding.problem}`,
		);
	}
	if (findings.length > 0) {
		console.error(
			`::error::native-config: the built ${platform} artefact does not carry ` +
				`${findings.length} expected declaration(s). Fix app.config.ts or the ` +
				"config plugin and regenerate — never the generated file, which the " +
				"next `expo prebuild --clean` discards.",
		);
		process.exit(1);
	}
	console.log(`native-config: ✓ ${summarize(platform)} (checked ${path})`);
};

/**
 * THE CLI IS THE ENTRY POINT ONLY. Everything above is importable: a unit test
 * checks the two parsers without the module reading a file path it does not
 * have or exiting the test worker. `import.meta.main` needs Node >= 24.2 (the
 * workflows pin `NODE_VERSION: "24"`); where it is undefined the guard FAILS
 * LOUDLY rather than skipping — a CI step that silently checks nothing is the
 * one outcome this script exists to prevent.
 */
const isEntryPoint = (import.meta as ImportMeta & { main?: boolean }).main;
if (isEntryPoint === undefined) {
	console.error(
		"::error::this Node does not support `import.meta.main` (needs >= 24.2), " +
			"so running this script as a CLI would silently check nothing while the " +
			'job reports success. The workflows pin `NODE_VERSION: "24"`.',
	);
	process.exit(1);
}
if (isEntryPoint) {
	main();
}
