#!/usr/bin/env node
/**
 * Resolve the iOS simulator a build or a Maestro flow should run on.
 *
 *     node scripts/ci/ios-simulator.mjs --prefer "iPhone 17"
 *     node scripts/ci/ios-simulator.mjs --prefer "iPhone 17" --json-file fixture.json
 *
 * Why a script and not a literal `-destination` string. The ADR pins the runner
 * image and the device *by name* and calls a missing simulator a CI
 * configuration bug — but a hardcoded name turns "the runner image moved to a
 * newer iPhone" into a red build whose message says nothing about the cause,
 * and it is the same class of brittleness that makes people stop reading CI. So
 * the preferred name is still named in the workflow (one place to change) and
 * this script resolves it against what the runner actually has, printing the
 * device, the runtime and the destination it chose. If the preferred device is
 * absent it falls back to the newest available iPhone and SAYS SO in the log,
 * rather than failing or, worse, silently building for something else.
 *
 * `--json-file` exists so the selection logic can be exercised against a
 * captured `xcrun simctl list` payload on a machine with no Xcode.
 *
 * No third-party dependency, and it also runs on a machine with no Xcode.
 */

import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";

/** `com.apple.CoreSimulator.SimRuntime.iOS-26-5` → `{ platform, version: [26,5] }` */
const RUNTIME = /^com\.apple\.CoreSimulator\.SimRuntime\.(?<platform>[A-Za-z]+)-(?<version>.+)$/;

const arg = (name, fallback) => {
	const i = process.argv.indexOf(`--${name}`);
	return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
};

const prefer = arg("prefer", "iPhone 17");
const jsonFile = arg("json-file", "");

const payload = jsonFile
	? readFileSync(jsonFile, "utf8")
	: execFileSync("xcrun", ["simctl", "list", "devices", "available", "--json"], {
			encoding: "utf8",
		});

let devicesByRuntime;
try {
	devicesByRuntime = JSON.parse(payload).devices;
} catch (error) {
	console.error(`::error::could not parse the simulator list: ${error.message}`);
	process.exit(1);
}

/** Newest iOS runtime first, so the newest SDK is what gets exercised. */
const runtimes = Object.entries(devicesByRuntime)
	.map(([key, devices]) => {
		const match = RUNTIME.exec(key);
		if (!match || match.groups.platform !== "iOS") return null;
		const version = match.groups.version.split("-").map(Number);
		return { key, version, devices: devices.filter((d) => d.isAvailable !== false) };
	})
	.filter((runtime) => runtime !== null && runtime.devices.length > 0)
	.sort((a, b) => {
		for (let i = 0; i < Math.max(a.version.length, b.version.length); i++) {
			const delta = (b.version[i] ?? 0) - (a.version[i] ?? 0);
			if (delta !== 0) return delta;
		}
		return 0;
	});

const available = runtimes.flatMap((r) => r.devices.map((d) => `${d.name} (iOS ${r.version.join(".")})`));

if (runtimes.length === 0) {
	console.error(
		"::error::no available iOS simulator on this runner. That is a CI " +
			"configuration problem, not a test failure — check the runner image label " +
			"and install the runtime (ADR 0004, open risks).",
	);
	process.exit(1);
}

const newest = runtimes[0];
const preferred = runtimes
	.flatMap((runtime) => runtime.devices.map((device) => ({ runtime, device })))
	.find((entry) => entry.device.name === prefer);
const chosen = preferred ?? { runtime: newest, device: newest.devices[0] };

const os = chosen.runtime.version.join(".");
const lines = [
	`device=${chosen.device.name}`,
	`udid=${chosen.device.udid}`,
	`os=${os}`,
	`destination=platform=iOS Simulator,id=${chosen.device.udid}`,
];
if (process.env.GITHUB_OUTPUT) {
	// Append rather than replace, so another step can contribute outputs too.
	appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
}

for (const line of lines) console.log(line);
if (!preferred) {
	console.log(
		`::warning::${prefer} is not installed on this runner; using ` +
			`${chosen.device.name} on iOS ${os} instead. If the pipeline should run on ` +
			`${prefer}, name it in .github/workflows/ios.yml and the runner image will ` +
			"have to provide it.",
	);
}
console.log(`available: ${available.join(", ")}`);
