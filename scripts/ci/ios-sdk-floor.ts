#!/usr/bin/env node
/**
 * Fail the job when the active Xcode's iOS SDKs are older than a floor.
 *
 *     node scripts/ci/ios-sdk-floor.ts --min 27
 *
 * WHY THIS EXISTS. App Store Connect accepted TestFlight build 1264 with
 * ITMS-90725: "This app was built with the iOS 26.5 SDK. Starting April 2027,
 * iOS and iPadOS apps must be built with the iOS 27 SDK or later, included in
 * Xcode 27 or later." The SDK a binary is built against is whatever the runner
 * image's default Xcode carries, and that is invisible in the workflow: a job
 * that silently lands back on an older image (a label edit, an image rollback,
 * a copy-pasted job) would keep producing uploads Apple refuses after the
 * deadline, and the first anyone would hear of it is a rejected build. So every
 * job that builds the app asserts the floor up front and dies with a message
 * naming the cause.
 *
 * WHAT IT CHECKS. Both the device SDK (`iphoneos`, what an IPA is built
 * against) and the simulator SDK (`iphonesimulator`, what the PR gate builds
 * against): one Xcode carries both, but checking both costs nothing and means
 * the simulator gate cannot pass on a toolchain the signed job would fail on.
 * `xcodebuild -version` is printed alongside so the log records which Xcode
 * produced the numbers.
 *
 * `--sdk-version <x.y>` replaces the `xcrun` probe; it exists so the decision
 * can be unit-tested on a machine with no Xcode (this repository's dev Macs
 * deliberately have none, docs/ci.md).
 *
 * Run directly by Node (type-stripping, no build step, no dependency).
 */

import { execFileSync } from "node:child_process";

const DOTTED_VERSION = /^(\d+)(?:\.\d+)*$/;

/** The major version of an `xcrun --show-sdk-version` answer, or `null` when
 * the answer is not a dotted version (a shape change must fail, not pass). */
export const sdkMajor = (version: string): number | null => {
	const match = DOTTED_VERSION.exec(version.trim());
	return match ? Number(match[1]) : null;
};

/** One verdict line per SDK; `ok` is false if any SDK is unreadable or below
 * the floor. */
export const checkFloor = (
	min: number,
	versions: Record<string, string>,
): { ok: boolean; lines: string[] } => {
	const lines: string[] = [];
	let ok = true;
	for (const [sdk, version] of Object.entries(versions)) {
		const major = sdkMajor(version);
		if (major === null) {
			ok = false;
			lines.push(
				`::error::${sdk} SDK version ${JSON.stringify(version)} is not a version this check can read.`,
			);
		} else if (major < min) {
			ok = false;
			lines.push(
				`::error::${sdk} SDK ${version} is below the iOS ${min} SDK floor. App Store ` +
					`Connect requires the iOS ${min} SDK (Xcode ${min}+) from April 2027 ` +
					"(ITMS-90725). Check the job's `runs-on` image label (docs/ci.md).",
			);
		} else {
			lines.push(`${sdk} SDK ${version} meets the iOS ${min} floor.`);
		}
	}
	return { ok, lines };
};

const arg = (name: string): string | undefined => {
	const i = process.argv.indexOf(`--${name}`);
	return i === -1 ? undefined : process.argv[i + 1];
};

const main = (): void => {
	const min = Number(arg("min"));
	if (!Number.isInteger(min) || min <= 0) {
		console.error("::error::--min <major> is required, e.g. --min 27");
		process.exit(2);
	}
	const override = arg("sdk-version");
	const versions: Record<string, string> = {};
	if (override !== undefined) {
		versions.override = override;
	} else {
		console.log(execFileSync("xcodebuild", ["-version"], { encoding: "utf8" }));
		for (const sdk of ["iphoneos", "iphonesimulator"]) {
			versions[sdk] = execFileSync(
				"xcrun",
				["--sdk", sdk, "--show-sdk-version"],
				{ encoding: "utf8" },
			).trim();
		}
	}
	const { ok, lines } = checkFloor(min, versions);
	for (const line of lines) console.log(line);
	if (!ok) process.exit(1);
};

// Same entry-point guard as version.ts and ios-launch-gate.ts: `import.meta.main`
// is undefined before Node 24.2, and a floor check that exits 0 without judging
// anything is the silent regression this file exists to prevent.
const isEntryPoint = (import.meta as ImportMeta & { main?: boolean }).main;
if (isEntryPoint === undefined) {
	console.error(
		"::error::this Node does not support `import.meta.main` (needs >= 24.2), " +
			"so the SDK floor would pass without checking anything. The workflows pin " +
			'`NODE_VERSION: "24"`.',
	);
	process.exit(1);
}
if (isEntryPoint) main();
