#!/usr/bin/env node
/**
 * Resolve the workspace and scheme of the generated iOS project.
 *
 *     node scripts/ci/ios-project.mjs --root ios
 *     node scripts/ci/ios-project.mjs --root ios --json-file fixture.json
 *
 * Why not a literal `-workspace ios/LocalOperator.xcworkspace -scheme
 * LocalOperator`. `expo prebuild` names both after the app's `name`, sanitised —
 * so renaming the app, or an SDK upgrade changing how the name is sanitised,
 * turns every xcodebuild invocation into "does not exist" with no hint about
 * why. Resolving them from the project the build actually produced makes the
 * workflow independent of that, and printing what it resolved is what makes a
 * surprise visible in the log instead of mysterious.
 *
 * `*.xcworkspace` rather than `*.xcodeproj` on purpose: CocoaPods is what the
 * SDK 57 project uses, and building the project file instead of the workspace
 * silently omits every pod — which fails at link time rather than at configure
 * time. If the workspace is missing, that means `pod install` did not run, and
 * the error says so.
 *
 * `--json-file` lets the parsing be exercised on a machine with no Xcode.
 *
 * No third-party dependency.
 */

import { execFileSync } from "node:child_process";
import { appendFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const arg = (name, fallback) => {
	const i = process.argv.indexOf(`--${name}`);
	return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
};

const root = resolve(arg("root", "ios"));
const jsonFile = arg("json-file", "");

let workspaces;
try {
	workspaces = readdirSync(root).filter((name) => name.endsWith(".xcworkspace"));
} catch (error) {
	console.error(
		`::error::no generated iOS project at ${root} (${error.message}). ` +
			"`expo prebuild --platform ios` should have created it.",
	);
	process.exit(1);
}
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

const workspace = join(root, workspaces[0]);

let payload;
try {
	payload = jsonFile
		? execFileSync("cat", [jsonFile], { encoding: "utf8" })
		: execFileSync("xcodebuild", ["-workspace", workspace, "-list", "-json"], {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			});
} catch (error) {
	console.error(`::error::xcodebuild -list failed: ${error.stderr ?? error.message}`);
	process.exit(1);
}

let listed;
try {
	listed = JSON.parse(payload);
} catch (error) {
	console.error(`::error::could not parse xcodebuild -list output: ${error.message}`);
	process.exit(1);
}

const schemes = listed?.workspace?.schemes ?? listed?.project?.schemes ?? [];
if (schemes.length === 0) {
	console.error(
		"::error::the generated project declares no scheme. That is an Xcode " +
			"project problem, not a workflow problem — `expo prebuild` produces one.",
	);
	process.exit(1);
}
if (schemes.length > 1) {
	// A second scheme is possible once there are app extensions or a test
	// target. Guessing wrong here would build the wrong thing silently, so this
	// fails and names them.
	console.error(
		`::error::the project declares ${schemes.length} schemes (${schemes.join(", ")}); ` +
			"name the app's scheme in the workflow (`IOS_SCHEME`) once there is more than one.",
	);
	process.exit(1);
}

const lines = [`workspace=${workspace}`, `scheme=${schemes[0]}`];
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
for (const line of lines) console.log(line);
