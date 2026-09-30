#!/usr/bin/env node
/**
 * Resolve the iOS simulator a build or a Maestro flow should run on.
 *
 *     node scripts/ci/ios-simulator.ts --prefer "iPhone 17"
 *     node scripts/ci/ios-simulator.ts --prefer "iPhone 17" --json-file fixture.json
 *
 * Why a script and not a literal `-destination` string. The ADR pins the runner
 * image and the device *by name* and calls a missing simulator a CI
 * configuration bug — but a hardcoded name turns "the runner image moved to a
 * newer iPhone" into a red build whose message says nothing about the cause, and
 * it is the same class of brittleness that makes people stop reading CI. So the
 * preferred name is still named in the workflow (one place to change) and this
 * script resolves it against what the runner actually has, printing the device,
 * the runtime and the destination it chose. If the preferred device is absent it
 * falls back to the newest available iPhone and SAYS SO in the log, rather than
 * failing or, worse, silently building for something else.
 *
 * `simctl`'s payload is a boundary: it is parsed and narrowed field by field,
 * never asserted, because a shape change in a future Xcode would otherwise
 * surface as a runtime `undefined` inside a build command.
 *
 * Run directly by Node (type-stripping, no build step, no dependency).
 */

import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";

/** `com.apple.CoreSimulator.SimRuntime.iOS-26-5` */
const RUNTIME =
	/^com\.apple\.CoreSimulator\.SimRuntime\.(?<platform>[A-Za-z]+)-(?<version>.+)$/;

type SimDevice = { name: string; udid: string; isAvailable: boolean };
type SimRuntimeEntry = { key: string; version: number[]; devices: SimDevice[] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** Narrow one `simctl list devices --json` runtime map, or `null` if it is not
 * the shape this tool knows how to read. */
const parseRuntimes = (value: unknown): Record<string, SimDevice[]> | null => {
	if (!isRecord(value)) return null;
	const runtimes: Record<string, SimDevice[]> = {};
	for (const [key, list] of Object.entries(value)) {
		if (!Array.isArray(list)) continue;
		const devices: SimDevice[] = [];
		for (const entry of list) {
			if (!isRecord(entry)) continue;
			const { name, udid, isAvailable } = entry;
			if (typeof name !== "string" || typeof udid !== "string") continue;
			devices.push({ name, udid, isAvailable: isAvailable !== false });
		}
		runtimes[key] = devices;
	}
	return runtimes;
};

/** Read `--name value`, falling back to `fallback`. */
const arg = (name: string, fallback: string): string => {
	const i = process.argv.indexOf(`--${name}`);
	return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
};

const message = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

const prefer = arg("prefer", "iPhone 17");
const jsonFile = arg("json-file", "");

let payload: string;
try {
	payload = jsonFile
		? readFileSync(jsonFile, "utf8")
		: execFileSync(
				"xcrun",
				["simctl", "list", "devices", "available", "--json"],
				{ encoding: "utf8" },
			);
} catch (error) {
	console.error(`::error::could not list simulators: ${message(error)}`);
	process.exit(1);
}

let parsed: unknown;
try {
	parsed = JSON.parse(payload);
} catch (error) {
	console.error(
		`::error::could not parse the simulator list: ${message(error)}`,
	);
	process.exit(1);
}

const devicesByRuntime = parseRuntimes(
	isRecord(parsed) ? parsed.devices : undefined,
);
if (!devicesByRuntime) {
	console.error(
		"::error::the simulator list is not a `devices` map of runtime arrays; " +
			"`xcrun simctl list devices available --json` changed shape.",
	);
	process.exit(1);
}

/** Newest iOS runtime first, so the newest SDK is what gets exercised. */
const runtimes: SimRuntimeEntry[] = Object.entries(devicesByRuntime)
	.map(([key, devices]): SimRuntimeEntry | null => {
		const groups = RUNTIME.exec(key)?.groups;
		if (groups?.platform !== "iOS") return null;
		const version = (groups.version ?? "")
			.split("-")
			.map((part) => Number(part));
		const available = devices.filter((device) => device.isAvailable);
		return available.length > 0 ? { key, version, devices: available } : null;
	})
	.filter((runtime): runtime is SimRuntimeEntry => runtime !== null)
	.sort((a, b) => {
		for (let i = 0; i < Math.max(a.version.length, b.version.length); i++) {
			const delta = (b.version[i] ?? 0) - (a.version[i] ?? 0);
			if (delta !== 0) return delta;
		}
		return 0;
	});

if (runtimes.length === 0) {
	console.error(
		"::error::no available iOS simulator on this runner. That is a CI " +
			"configuration problem, not a test failure — check the runner image label " +
			"and install the runtime (ADR 0004, open risks).",
	);
	process.exit(1);
}

const available = runtimes.flatMap((runtime) =>
	runtime.devices.map(
		(device) => `${device.name} (iOS ${runtime.version.join(".")})`,
	),
);

const newest = runtimes[0];
if (!newest) {
	console.error("::error::no iOS runtime survived the sort; this is a bug.");
	process.exit(1);
}
const preferredRuntime = runtimes.find((runtime) =>
	runtime.devices.some((device) => device.name === prefer),
);
const chosenRuntime = preferredRuntime ?? newest;
const chosen =
	chosenRuntime.devices.find((device) => device.name === prefer) ??
	chosenRuntime.devices[0];
if (!chosen) {
	console.error(
		`::error::the runtime ${chosenRuntime.key} lists no usable device.`,
	);
	process.exit(1);
}

const os = chosenRuntime.version.join(".");
const lines = [
	`device=${chosen.name}`,
	`udid=${chosen.udid}`,
	`os=${os}`,
	`destination=platform=iOS Simulator,id=${chosen.udid}`,
];
if (process.env.GITHUB_OUTPUT) {
	// Append rather than replace, so another step can contribute outputs too.
	appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
}

for (const line of lines) console.log(line);
if (!preferredRuntime) {
	console.log(
		`::warning::${prefer} is not installed on this runner; using ` +
			`${chosen.name} on iOS ${os} instead. If the pipeline should run on ` +
			`${prefer}, name it in .github/workflows/ios.yml and the runner image will ` +
			"have to provide it.",
	);
}
console.log(`available: ${available.join(", ")}`);
