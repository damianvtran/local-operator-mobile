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
 *     node scripts/ci/native-config.ts android-badging "$RUNNER_TEMP/badging.txt"
 *
 * The third form exists for the launcher label alone (`LAUNCHER_LABEL`): the
 * manifest carries only `@string/app_name`, so the resolved label is visible in
 * the built APK's `aapt2 dump badging` and nowhere else.
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

/**
 * The home-screen label, on BOTH platforms: "Operator", by the operator's
 * decision of 2026-11-11. "Local Operator" is wider than an icon cell, and
 * SpringBoard squeezes the whitespace out of a label before truncating it, so the
 * spaced name rendered as "LocalOpera…" on a phone (build 836, whose IPA carried
 * `CFBundleDisplayName: "Local Operator"`). Only the launcher label is short: the
 * app's `name`, the in-app name and the store names stay "Local Operator", and
 * `expo prebuild` still derives `CFBundleName` / `PRODUCT_NAME` (`LocalOperator`)
 * from `name` — which is why the label is asserted rather than assumed: a config
 * or plugin change that drops it falls back to that spaceless name, or to the
 * truncating full one.
 *
 * Asserted on the BUILT products: `CFBundleDisplayName` in the built Info.plist,
 * and `application-label` in the APK's `aapt2 dump badging` (the manifest only
 * carries `@string/app_name`, so the resolved label exists in the APK alone).
 * It still cannot assert what SpringBoard or a launcher renders. Duplicated from
 * `app.config.ts` (`LAUNCHER_LABEL`) on purpose, for the same reason as
 * `IOS_EXCEPTION_DOMAINS`.
 */
export const LAUNCHER_LABEL = "Operator";

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
/**
 * The built app's `UIBackgroundModes`, exactly (order-free). `remote-notification`
 * is the app's own (app.config.ts, the silent attention push). `fetch` is
 * expo-task-manager's: its auto-applied prebuild plugin (`withTaskManager.js`)
 * appends it unconditionally, measured with `expo config --type introspect`.
 * Nothing schedules a background fetch, so iOS never runs one; it is listed so
 * that the measured set is the pinned set and anything else fails CI.
 */
export const IOS_BACKGROUND_MODES = ["remote-notification", "fetch"] as const;

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

	// Check the built product, not only app.config.ts: a config/plugin omission
	// otherwise leaves each uploaded build waiting for a manual compliance answer.
	if (plist.ITSAppUsesNonExemptEncryption !== false) {
		findings.push({
			field: "ITSAppUsesNonExemptEncryption",
			problem: "expected false after the OS-only cryptography dependency audit",
		});
	}

	if (plist.CFBundleDisplayName !== LAUNCHER_LABEL) {
		findings.push({
			field: "CFBundleDisplayName",
			problem: `expected ${JSON.stringify(LAUNCHER_LABEL)}, found ${JSON.stringify(plist.CFBundleDisplayName)} — the home screen would show the sanitised CFBundleName or a truncated "Local Operator"`,
		});
	}

	const description = plist.NSLocalNetworkUsageDescription;
	if (typeof description !== "string" || description.trim().length === 0) {
		findings.push({
			field: "NSLocalNetworkUsageDescription",
			problem:
				"missing or empty — the local-network alert would have no rationale",
		});
	}

	/* The silent-wake mode (ADR 0006 §1.5): without it iOS drops the cloud's
	 * attention push before any app code runs, and the badge/banner clear on a
	 * desktop ack silently stops working. Checked on the BUILT plist because a
	 * plugin that rewrites the array would otherwise lose it without a sound.
	 * The EXACT set is pinned (review R1-m3), not mere presence: a plugin that
	 * adds a mode (`audio`, `location`) changes what App Review sees the app
	 * claim, so it must arrive as a deliberate edit to IOS_BACKGROUND_MODES. */
	const modes = plist.UIBackgroundModes;
	const expected = [...IOS_BACKGROUND_MODES].sort();
	const found = Array.isArray(modes) ? [...modes].sort() : null;
	if (found === null || JSON.stringify(found) !== JSON.stringify(expected)) {
		findings.push({
			field: "UIBackgroundModes",
			problem: `expected exactly ${JSON.stringify(expected)}, found ${JSON.stringify(modes)} — without "remote-notification" iOS never runs the background task for the silent attention push; any other mode is an undeclared capability`,
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

// ---------------------------------------------------------------------------
// Android APK badging (the launcher label)
// ---------------------------------------------------------------------------

/* `aapt2 dump badging` prints the resolved default label as
 *     application-label:'Operator'
 * and one `application-label-<qualifier>:'…'` line per locale that overrides
 * it. Values are single-quoted with no escaping of an inner quote, so the
 * value is everything up to the line's closing quote. */
const BADGING_LABEL = /^application-label(?:-([^:]+))?:'(.*)'$/gm;

/**
 * Assert the APK's launcher label. The default label must be `LAUNCHER_LABEL`,
 * and every locale override must be too: a translated `app_name` would put a
 * different (possibly truncating) label on that locale's home screen, which is
 * exactly the regression this guards, so it is a finding rather than a pass.
 */
export function checkAndroidBadging(badging: string): Finding[] {
	const findings: Finding[] = [];
	let defaultLabel: string | undefined;
	for (const match of badging.matchAll(BADGING_LABEL)) {
		const [, qualifier, value] = match;
		if (qualifier === undefined) {
			defaultLabel = value;
		} else if (value !== LAUNCHER_LABEL) {
			findings.push({
				field: `application-label-${qualifier}`,
				problem: `expected ${JSON.stringify(LAUNCHER_LABEL)}, found ${JSON.stringify(value)} — a locale override of app_name changes that locale's home-screen label`,
			});
		}
	}
	if (defaultLabel !== LAUNCHER_LABEL) {
		findings.unshift({
			field: "application-label",
			problem:
				defaultLabel === undefined
					? "missing from the badging — pass the full `aapt2 dump badging` output, not its first line"
					: `expected ${JSON.stringify(LAUNCHER_LABEL)}, found ${JSON.stringify(defaultLabel)} — the launcher would show the full app name, which truncates`,
		});
	}
	return findings;
}

/** One line for the CI step summary, naming what was asserted. */
/** The artefact kinds the CLI checks. */
export type Platform = "ios" | "android" | "android-badging";

export const summarize = (platform: Platform): string =>
	platform === "android-badging"
		? `built APK carries application-label=${JSON.stringify(LAUNCHER_LABEL)} with no locale override that differs`
		: platform === "ios"
			? `built Info.plist carries CFBundleDisplayName=${JSON.stringify(LAUNCHER_LABEL)}, ITSAppUsesNonExemptEncryption=false, UIBackgroundModes exactly ${JSON.stringify(IOS_BACKGROUND_MODES)}, NSLocalNetworkUsageDescription and the ATS local-networking configuration (NSAllowsLocalNetworking + ${IOS_EXCEPTION_DOMAINS.length} CIDR exceptions) and none of the ${IOS_FORBIDDEN_KEYS.length} photo/camera permission keys`
			: `release merged manifest carries android:usesCleartextTraffic="true" and ${ANDROID_LOCAL_NETWORK_PERMISSION}, and none of the ${ANDROID_FORBIDDEN_PERMISSIONS.length} camera/media-library permissions`;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const main = (): void => {
	const [platform, path] = process.argv.slice(2);
	if (
		(platform !== "ios" &&
			platform !== "android" &&
			platform !== "android-badging") ||
		typeof path !== "string" ||
		path.length === 0
	) {
		console.error(
			"usage: native-config.ts <ios|android|android-badging> <path>\n" +
				"  ios             path to the built Info.plist converted to JSON (plutil -convert json)\n" +
				"  android         path to the release merged AndroidManifest.xml\n" +
				"  android-badging path to the full `aapt2 dump badging` output of the built APK",
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
	} else if (platform === "android") {
		findings = checkAndroidManifest(raw);
	} else {
		findings = checkAndroidBadging(raw);
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
