import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import {
	ANDROID_FORBIDDEN_PERMISSIONS,
	ANDROID_LOCAL_NETWORK_PERMISSION,
	checkAndroidManifest,
	checkIosInfoPlist,
	IOS_EXCEPTION_DOMAINS,
	IOS_FORBIDDEN_KEYS,
	summarize,
} from "./native-config";

/**
 * The native-config gate.
 *
 * The two checkers are what the native workflows run against BUILT artefacts —
 * an `Info.plist` converted to JSON and a release merged `AndroidManifest.xml` —
 * so the tests drive the same field names and the same output text the failures
 * carry in CI. The subprocess cases exist because the CLI wiring is where this
 * kind of script fails silently: a guard that skips, a missing exit code, a
 * usage path that exits 0.
 *
 * `os.tmpdir()` and not a directory in the repository: these are throwaway
 * fixtures that must not show up in a reviewer's `git status`. The root is named
 * with this process's pid so two suites running side by side cannot share it.
 */

const ROOT = mkdtempSync(join(tmpdir(), `native-config-test-${process.pid}-`));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

const SCRIPT = fileURLToPath(new URL("./native-config.ts", import.meta.url));

const writeFixture = (name: string, contents: string): string => {
	const path = join(ROOT, name);
	writeFileSync(path, contents);
	return path;
};

/** The valid plist, as the built product is expected to carry it. */
const validPlist = (): Record<string, unknown> => ({
	CFBundleIdentifier: "com.localoperator.mobile",
	NSLocalNetworkUsageDescription:
		"Connect to the relay running on your own computer when it is on the same Wi-Fi network. The app reaches only the address you enter, and does not scan your network.",
	NSAppTransportSecurity: {
		NSAllowsArbitraryLoads: false,
		NSAllowsLocalNetworking: true,
		NSExceptionDomains: Object.fromEntries(
			IOS_EXCEPTION_DOMAINS.map((domain) => [
				domain,
				{ NSExceptionAllowsInsecureHTTPLoads: true },
			]),
		),
	},
});

const fields = (findings: { field: string }[]): string[] =>
	findings.map((finding) => finding.field);

/** The valid manifest, with the attribute order AGP writes varied below. */
const validManifest = (): string => `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" xmlns:tools="http://schemas.android.com/tools">
  <uses-permission android:name="android.permission.ACCESS_LOCAL_NETWORK"/>
  <uses-permission android:name="android.permission.INTERNET"/>
  <uses-permission android:name="android.permission.RECORD_AUDIO"/>
  <application android:name=".MainApplication" android:label="@string/app_name" android:usesCleartextTraffic="true" android:theme="@style/AppTheme">
    <activity android:name=".MainActivity" android:exported="true"/>
  </application>
</manifest>
`;

describe("checkIosInfoPlist", () => {
	it("passes the configuration the app asks for", () => {
		expect(checkIosInfoPlist(validPlist())).toEqual([]);
	});

	it("names the missing usage description", () => {
		const plist = validPlist();
		delete plist.NSLocalNetworkUsageDescription;
		expect(fields(checkIosInfoPlist(plist))).toContain(
			"NSLocalNetworkUsageDescription",
		);
	});

	it("rejects an empty usage description, which would show an empty alert", () => {
		const plist = validPlist();
		plist.NSLocalNetworkUsageDescription = "   ";
		expect(fields(checkIosInfoPlist(plist))).toContain(
			"NSLocalNetworkUsageDescription",
		);
	});

	it("requires the local-networking boolean to be true, not merely present", () => {
		const plist = validPlist() as {
			NSAppTransportSecurity: { NSAllowsLocalNetworking: unknown };
		};
		plist.NSAppTransportSecurity.NSAllowsLocalNetworking = false;
		expect(fields(checkIosInfoPlist(plist))).toContain(
			"NSAppTransportSecurity.NSAllowsLocalNetworking",
		);
	});

	it("reports a wholly missing ATS dictionary once", () => {
		const plist = validPlist();
		delete plist.NSAppTransportSecurity;
		expect(fields(checkIosInfoPlist(plist))).toEqual([
			"NSAppTransportSecurity",
		]);
	});

	it("requires every literal-private exception domain, because the list is the trade", () => {
		const plist = validPlist() as {
			NSAppTransportSecurity: {
				NSExceptionDomains: Record<string, unknown>;
			};
		};
		delete plist.NSAppTransportSecurity.NSExceptionDomains["192.168.0.0/16"];
		expect(fields(checkIosInfoPlist(plist))).toEqual([
			'NSAppTransportSecurity.NSExceptionDomains["192.168.0.0/16"]',
		]);
	});

	it("requires each exception to allow insecure loads, or the entry does nothing for http", () => {
		const plist = validPlist() as {
			NSAppTransportSecurity: {
				NSExceptionDomains: Record<string, Record<string, unknown>>;
			};
		};
		plist.NSAppTransportSecurity.NSExceptionDomains["10.0.0.0/8"] = {};
		expect(fields(checkIosInfoPlist(plist))).toEqual([
			'NSAppTransportSecurity.NSExceptionDomains["10.0.0.0/8"].NSExceptionAllowsInsecureHTTPLoads',
		]);
	});

	it("rejects a non-dictionary, which is what a wrong file looks like", () => {
		expect(fields(checkIosInfoPlist("nope"))).toEqual(["Info.plist"]);
	});

	it("reports a photo-library usage string as over-declaration, naming it", () => {
		/* The picker-only design needs no library permission (checklist B10); a
		 * string here means a plugin default crept back in. */
		const plist = validPlist();
		plist[IOS_FORBIDDEN_KEYS[0]] =
			"Allow $(PRODUCT_NAME) to access your photos";
		expect(fields(checkIosInfoPlist(plist))).toEqual([IOS_FORBIDDEN_KEYS[0]]);
	});

	it("reports the over-declaration even when a required key is missing too", () => {
		/* The early returns must not hide it: both findings, one run. */
		const plist = validPlist();
		delete plist.NSLocalNetworkUsageDescription;
		plist[IOS_FORBIDDEN_KEYS[1]] = "Allow camera";
		expect(fields(checkIosInfoPlist(plist))).toEqual([
			IOS_FORBIDDEN_KEYS[1],
			"NSLocalNetworkUsageDescription",
		]);
	});
});

describe("checkAndroidManifest", () => {
	it("passes the declarations the app asks for", () => {
		expect(checkAndroidManifest(validManifest())).toEqual([]);
	});

	it("tolerates attribute order and whitespace variations AGP may write", () => {
		const manifest = validManifest().replace(
			'android:usesCleartextTraffic="true"',
			'  android:usesCleartextTraffic = "true" ',
		);
		expect(checkAndroidManifest(manifest)).toEqual([]);
	});

	it("reports a manifest without cleartext permission, naming the attribute", () => {
		const manifest = validManifest().replace(
			' android:usesCleartextTraffic="true"',
			"",
		);
		expect(fields(checkAndroidManifest(manifest))).toEqual([
			"application@android:usesCleartextTraffic",
		]);
	});

	it('rejects cleartextTraffic="false", which reads as permitted but is not', () => {
		const manifest = validManifest().replace(
			'android:usesCleartextTraffic="true"',
			'android:usesCleartextTraffic="false"',
		);
		expect(fields(checkAndroidManifest(manifest))).toEqual([
			"application@android:usesCleartextTraffic",
		]);
	});

	it("reports the local-network permission when it is missing", () => {
		const manifest = validManifest().replace(
			'  <uses-permission android:name="android.permission.ACCESS_LOCAL_NETWORK"/>\n',
			"",
		);
		expect(fields(checkAndroidManifest(manifest))).toEqual([
			`uses-permission[${ANDROID_LOCAL_NETWORK_PERMISSION}]`,
		]);
	});

	it("does not let a commented-out permission satisfy the check", () => {
		const manifest = validManifest().replace(
			'  <uses-permission android:name="android.permission.ACCESS_LOCAL_NETWORK"/>',
			'  <!-- <uses-permission android:name="android.permission.ACCESS_LOCAL_NETWORK"/> -->',
		);
		expect(fields(checkAndroidManifest(manifest))).toEqual([
			`uses-permission[${ANDROID_LOCAL_NETWORK_PERMISSION}]`,
		]);
	});

	it("does not let the platform-gated <uses-permission-sdk-23 …> satisfy the check", () => {
		// The tag-name boundary: a word boundary also matches before the hyphen, so
		// a fixture whose ONLY local-network element is the sdk-23 form used to
		// exit 0 while the release manifest carried no plain declaration at all.
		const manifest = validManifest().replace(
			'  <uses-permission android:name="android.permission.ACCESS_LOCAL_NETWORK"/>',
			'  <uses-permission-sdk-23 android:name="android.permission.ACCESS_LOCAL_NETWORK"/>',
		);
		expect(fields(checkAndroidManifest(manifest))).toEqual([
			`uses-permission[${ANDROID_LOCAL_NETWORK_PERMISSION}]`,
		]);
	});

	it("reports a manifest that is not the shape expected", () => {
		expect(fields(checkAndroidManifest("<manifest/>"))).toEqual([
			"AndroidManifest.xml",
			`uses-permission[${ANDROID_LOCAL_NETWORK_PERMISSION}]`,
		]);
	});

	it("reports a library-manifest media permission the merge brought in", () => {
		/* What expo-image-picker's own manifest would contribute without the
		 * blockedPermissions + plugin options: CAMERA and the storage pair. */
		const manifest = validManifest().replace(
			'  <uses-permission android:name="android.permission.INTERNET"/>',
			'  <uses-permission android:name="android.permission.INTERNET"/>\n  <uses-permission android:name="android.permission.CAMERA"/>\n  <uses-permission android:name="android.permission.READ_MEDIA_IMAGES"/>',
		);
		expect(fields(checkAndroidManifest(manifest))).toEqual([
			"uses-permission[android.permission.CAMERA]",
			"uses-permission[android.permission.READ_MEDIA_IMAGES]",
		]);
	});

	it("reports a platform-gated permission too — it still declares on old platforms", () => {
		const permutation = ANDROID_FORBIDDEN_PERMISSIONS[2] ?? "";
		const manifest = validManifest().replace(
			'  <uses-permission android:name="android.permission.INTERNET"/>',
			`  <uses-permission android:name="android.permission.INTERNET"/>\n  <uses-permission-sdk-23 android:name="${permutation}"/>`,
		);
		expect(fields(checkAndroidManifest(manifest))).toEqual([
			`uses-permission[${permutation}]`,
		]);
	});

	it("does not flag the microphone, which the STT feature declares", () => {
		/* The forbidden list is media-and-camera only; RECORD_AUDIO is in the
		 * valid manifest above precisely so this direction is asserted. */
		expect(checkAndroidManifest(validManifest())).toEqual([]);
	});
});

describe("summarize", () => {
	it("names the concrete things checked, not a generic pass", () => {
		expect(summarize("ios")).toContain("NSAllowsLocalNetworking");
		expect(summarize("android")).toContain(
			'android:usesCleartextTraffic="true"',
		);
	});
});

describe("CLI", () => {
	const run = (
		args: string[],
	): { status: number; stdout: string; stderr: string } => {
		try {
			const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
				encoding: "utf8",
			});
			return { status: 0, stdout, stderr: "" };
		} catch (error) {
			const failed = error as {
				status?: number;
				stdout?: string;
				stderr?: string;
			};
			return {
				status: failed.status ?? -1,
				stdout: failed.stdout ?? "",
				stderr: failed.stderr ?? "",
			};
		}
	};

	it("exits 0 on a built plist and on a merged manifest", () => {
		const plist = writeFixture("Info.json", JSON.stringify(validPlist()));
		expect(run(["ios", plist]).status).toBe(0);
		const manifest = writeFixture("AndroidManifest.xml", validManifest());
		expect(run(["android", manifest]).status).toBe(0);
	});

	it("exits 1 and names the field when an artefact has lost a declaration", () => {
		const plist = validPlist();
		delete plist.NSAppTransportSecurity;
		const path = writeFixture("Info-incomplete.json", JSON.stringify(plist));
		const result = run(["ios", path]);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("NSAppTransportSecurity");
	});

	it("exits 2 on usage, so a miswired step is never a pass", () => {
		expect(run(["nonsense"]).status).toBe(2);
		expect(run([]).status).toBe(2);
	});

	it("exits 1 when the file does not exist", () => {
		expect(run(["ios", join(ROOT, "does-not-exist.json")]).status).toBe(1);
	});
});
