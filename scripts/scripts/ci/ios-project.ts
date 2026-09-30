#!/usr/bin/env node
/**
 * Resolve the workspace and scheme of the generated iOS project.
 *
 *     node scripts/ci/ios-project.ts --root ios
 *     node scripts/ci/ios-project.ts --root ios --json-file fixture.json
 *
 * Why not a literal `-workspace ios/LocalOperator.xcworkspace -scheme
 * LocalOperator`. `expo prebuild` names both after the app's `name`, sanitised —
 * so renaming the app, or an SDK upgrade changing how the name is sanitised,
 * turns every xcodebuild invocation into "does not exist" with no hint about
 * why. Resolving them from the project the build actually produced makes the
 * workflow independent of that, and printing what it resolved is what makes a
 * surprise visible in the log instead of mysterious.
 *
 * WHY THE SCHEME IS NOT SIMPLY "THE ONLY ONE". A CocoaPods workspace lists a
 * scheme for every pod it integrates — on this app, measured in CI on
 * 2026-09-30, `xcodebuild -list` reported 115 of them (EXConstants, Expo,
 * React-Fabric, Yoga, …) beside the app's own. "More than one scheme" is
 * therefore this project's normal state, not an ambiguity to refuse. The app's
 * scheme is the one named after the app's own `.xcodeproj`, which is what
 * `expo prebuild` generates next to the workspace; a lone candidate is still
 * accepted, and anything else fails naming what it found rather than building a
 * pod's scheme — which fails later, in a way that looks like a code problem.
 *
 * `*.xcworkspace` rather than `*.xcodeproj` for the BUILD is deliberate:
 * CocoaPods builds the workspace, and building the project file instead
 * silently omits every pod. If the workspace is missing, `pod install` did not
 * run, and the error says so.
 *
 * `xcodebuild -list -json` is a boundary, so its payload is narrowed rather
 * than asserted. `--json-file` lets the resolution be exercised on a machine
 * with no Xcode.
 *
 * Run directly by Node (type-stripping, no build step, no dependency).
 */

import { execFileSync } from "node:child_process";
import { appendFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** The scheme names `xcodebuild -list -json` reports, or `null` when the payload
 * is not the shape this tool knows how to read. */
const parseSchemes = (value: unknown): string[] | null => {
	if (!isRecord(value)) return null;
	const container = isRecord(value["workspace"])
		? value["workspace"]
		: isRecord(value["project"])
			? value["project"]
			: null;
	if (!container) return null;
	const schemes = container["schemes"];
	if (!Array.isArray(schemes)) return null;
	return schemes.filter(
		(scheme): scheme is string => typeof scheme === "string",
	);
};

/** Read `--name value`, falling back to `fallback`. */
const arg = (name: string, fallback: string): string => {
	const i = process.argv.indexOf(`--${name}`);
	return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
};

const message = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

const root = resolve(arg("root", "ios"));
const jsonFile = arg("json-file", "");

let entries: string[];
try {
	entries = readdirSync(root);
} catch (error) {
	console.error(
		`::error::no generated iOS project at ${root} (${message(error)}). ` +
			"`expo prebuild --platform ios` should have created it.",
	);
	process.exit(1);
}

const workspaces = entries.filter((name) => name.endsWith(".xcworkspace"));
if (workspaces.length === 0) {
	console.error(
		`::error::no .xcworkspace in ${root}. The .xcodeproj is not enough: ` +
			"CocoaPods builds the workspace, so this means `pod install` never ran.",
	);
	process.exit(1);
}
if (workspaces.length > 1) {
	console.error(
		`::error::${workspaces.length} workspaces in ${root} (${workspaces.join(", ")}); ` +
			"refusing to guess which one is the app.",
	);
	process.exit(1);
}
const workspaceName = workspaces[0];
if (workspaceName === undefined) {
	console.error(
		"::error::no workspace name survived the check; this is a bug.",
	);
	process.exit(1);
}
const workspace = join(root, workspaceName);

// The app's own project file, whose name the app's scheme shares. `Pods.xcodeproj`
// is not at this level (it lives inside `Pods/`), so a second project here is
// something this tool has not seen before and should not guess about.
const projects = entries.filter((name) => name.endsWith(".xcodeproj"));
if (projects.length !== 1) {
	console.error(
		`::error::expected exactly one .xcodeproj in ${root} and found ` +
			`${projects.length} (${projects.join(", ") || "none"}); the app's scheme is ` +
			"resolved from that project's name.",
	);
	process.exit(1);
}
const projectName = projects[0];
if (projectName === undefined) {
	console.error("::error::no project name survived the check; this is a bug.");
	process.exit(1);
}
const appTarget = projectName.replace(/\.xcodeproj$/, "");

let payload: string;
try {
	payload = jsonFile
		? execFileSync("cat", [jsonFile], { encoding: "utf8" })
		: execFileSync("xcodebuild", ["-workspace", workspace, "-list", "-json"], {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			});
} catch (error) {
	console.error(`::error::xcodebuild -list failed: ${message(error)}`);
	process.exit(1);
}

let parsed: unknown;
try {
	parsed = JSON.parse(payload);
} catch (error) {
	console.error(
		`::error::could not parse xcodebuild -list output: ${message(error)}`,
	);
	process.exit(1);
}

const schemes = parseSchemes(parsed);
if (!schemes) {
	console.error(
		"::error::the generated project reports no schemes, or a shape this tool " +
			"does not recognise. `expo prebuild` produces one; run `xcodebuild -list` " +
			"by hand to see what it actually says.",
	);
	process.exit(1);
}

const scheme = schemes.includes(appTarget)
	? appTarget
	: schemes.length === 1
		? (schemes[0] ?? null)
		: null;
if (scheme === null) {
	console.error(
		`::error::the workspace declares ${schemes.length} schemes and none is named ` +
			`${appTarget} (the app project's own name). Candidates: ` +
			`${schemes.slice(0, 20).join(", ")}${schemes.length > 20 ? ", …" : ""}`,
	);
	process.exit(1);
}

const lines = [`workspace=${workspace}`, `scheme=${scheme}`];
if (process.env.GITHUB_OUTPUT) {
	appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
}
for (const line of lines) console.log(line);
