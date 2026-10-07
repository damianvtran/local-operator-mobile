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

/**
 * The plist keys that may NEVER appear in the built app, however a dependency's
 * default configuration would like it: attachments are picked through the system
 * photo pickers (iOS 14+ `PHPickerViewController`, Android Photo Picker), which
 * grant per-item access WITHOUT a library permission — so a photo-library or
 * camera usage string here is over-declaration, the exact failure checklist B10
 * (and the app.config.ts plugin options that keep these out) exists to prevent.
 *
 * `NSPhotoLibraryAddUsageDescription` is in the list although the picker path
 * never writes to the photo library: an app that declares ADD access it never
 * uses is over-declaring in exactly the same way, and the transitive-plugin
 * vector (a library manifest/Info key merging in) does not distinguish read from
 * add. Agent review round 1, R2 — the names are drift-protection: none are live
 * in the built artefacts today (QA round 1 verified the debug APK and the
 * simulator bundle), and that is the property this list keeps true.
 *
 * Asserted against the BUILT artefact because a plugin's changed defaults fail
 * silently in the other direction — nothing prompts, nothing crashes, the app
 * just declares more than it uses.
 */
export const IOS_FORBIDDEN_KEYS = [
	"NSPhotoLibraryUsageDescription",
	"NSCameraUsageDescription",
	"NSPhotoLibraryAddUsageDescription",
] as const;

/** The Android permissions that may NEVER appear in the release merged
 *  manifest. `expo-image-picker`'s library manifest declares CAMERA and both
 *  storage permissions for camera-roll flows this app does not use; the
 *  media-library pair is the Google Play "approved core use case" permission
 *  the picker-only design does not need (checklist B10). Blocked in
 *  `app.config.ts` (`blockedPermissions` + the plugin's `cameraPermission:
 *  false`); asserted absent here, where the merge result is what is read.
 *
 *  The four entries added by agent review round 1 (R2) are the adjacent
 *  spellings a transitively-merged library manifest could contribute without
 *  tripping the five above: the Android 14 partial-access companion, the exif
 *  location companion, all-files access, and audio media (the picker paths this
 *  app uses produce images only). Drift-protection, stated as such: none are
 *  live in the built artefacts today (QA round 1 read the debug APK's binary
 *  manifest and found none of them); this list exists so the next plugin bump
 *  that adds one is a CI failure rather than a silent over-declaration. */
export const ANDROID_FORBIDDEN_PERMISSIONS = [
	"android.permission.CAMERA",
	"android.permission.READ_EXTERNAL_STORAGE",
	"android.permission.WRITE_EXTERNAL_STORAGE",
	"android.permission.READ_MEDIA_IMAGES",
	"android.permission.READ_MEDIA_VIDEO",
	"android.permission.READ_MEDIA_VISUAL_USER_SELECTED",
	"android.permission.ACCESS_MEDIA_LOCATION",
	"android.permission.MANAGE_EXTERNAL_STORAGE",
	"android.permission.READ_MEDIA_AUDIO",
] as const;

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

	/* The forbidden keys FIRST, before the early returns below: a plist can be
	 * missing a required key AND carry an over-declaration, and the
	 * over-declaration is the finding a review round turns on — it must never be
	 * hidden by a check that happens to return earlier. */
	for (const key of IOS_FORBIDDEN_KEYS) {
		if (key in plist) {
			findings.push({
				field: key,
				problem:
					"present — attachments go through the system photo picker, which needs no permission, so this usage string is over-declaration (checklist B10)",
			});
		}
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
 * Whether the manifest declares `name` on a `<uses-permission …>` element.
 *
 * `<uses-permission(?![\w-])` and not `\b` after the tag name: a word boundary
 * also matches before the hyphen in `<uses-permission-sdk-23 …>`, which is a
 * different element (a platform-gated form), so `\b` let a fixture carrying
 * only that element pass the required check. The lookahead ends the tag name
 * exactly where the element name ends.
 *
 * `sdkGated` widens the match to that prefixed form, which is what the
 * FORBIDDEN direction wants: a platform-gated grant is still a grant on the
 * platforms it names, and a dependency that spells CAMERA that way must not
 * walk around an absence check. The required direction keeps the strict form —
 * a gated declaration is not the unconditional one `app.config.ts` asks for,
 * and a test asserts exactly that.
 */
const declaresPermission = (
	text: string,
	name: string,
	{ sdkGated = false }: { sdkGated?: boolean } = {},
): boolean => {
	const tag = sdkGated
		? "<uses-permission(?:-[a-z0-9-]+)?"
		: "<uses-permission(?![\\w-])";
	/* BOTH quote styles are accepted (agent review round 1, R2): AGP writes
	 * double quotes, so this is non-material today — but single-quoted attribute
	 * values are XML-legal, and a banned name must not be able to slip an
	 * absence check by quote style. Cheap widening, no false-positive path: the
	 * name between the quotes still has to match exactly. */
	return new RegExp(
		`${tag}[^>]*\\bandroid:name\\s*=\\s*["']${name.replace(/\./g, "\\.")}["']`,
		"i",
	).test(text);
};

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

	/* The tag-boundary rule and the forbidden direction's widening of it are
	 *  documented on `declaresPermission`; this call keeps the STRICT form. */
	if (!declaresPermission(text, ANDROID_LOCAL_NETWORK_PERMISSION)) {
		findings.push({
			field: `uses-permission[${ANDROID_LOCAL_NETWORK_PERMISSION}]`,
			problem: "missing",
		});
	}

	/* The forbidden permissions, in BOTH spellings — see `declaresPermission`. */
	for (const permission of ANDROID_FORBIDDEN_PERMISSIONS) {
		if (declaresPermission(text, permission, { sdkGated: true })) {
			findings.push({
				field: `uses-permission[${permission}]`,
				problem:
					"present — picker-only attachments need no media-or-camera permission (checklist B10); block it in app.config.ts's blockedPermissions and regenerate",
			});
		}
	}

	return findings;
}

/** One line for the CI step summary, naming what was asserted. */
export const summarize = (platform: "ios" | "android"): string =>
	platform === "ios"
		? `built Info.plist carries NSLocalNetworkUsageDescription and the ATS local-networking configuration (NSAllowsLocalNetworking + ${IOS_EXCEPTION_DOMAINS.length} CIDR exceptions) and none of the ${IOS_FORBIDDEN_KEYS.length} photo/camera permission keys`
		: `release merged manifest carries android:usesCleartextTraffic="true" and ${ANDROID_LOCAL_NETWORK_PERMISSION}, and none of the ${ANDROID_FORBIDDEN_PERMISSIONS.length} camera/media-library permissions`;

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
