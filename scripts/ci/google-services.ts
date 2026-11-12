#!/usr/bin/env node
/**
 * Materialise the Android FCM client config from the `GOOGLE_SERVICES_JSON_BASE64`
 * secret, before `expo prebuild`, and point `app.config.ts` at it.
 *
 *     node scripts/ci/google-services.ts
 *
 * WHY A SCRIPT AND NOT A `base64 --decode` LINE. The file is OPTIONAL: an absent
 * secret must leave the build green and push-disabled (the state every build is
 * in until the operator creates the Firebase project), while a PRESENT secret
 * that does not decode to a config for THIS app must stop the run — a release
 * built from a truncated paste or another app's file would mint no FCM token and
 * nobody would find out until a device test. The three outcomes need distinct
 * words in the log, and a shell one-liner gives them one.
 *
 * Outcomes:
 *  - secret absent or empty → a `::notice::`, exit 0, nothing written; the
 *    build has no `android.googleServicesFile` and Team Bridge push stays off.
 *  - secret present and valid → the file is written under `$RUNNER_TEMP`
 *    (owner-only, outside the checkout so it can never be committed or
 *    uploaded as an artefact by accident) and `GOOGLE_SERVICES_JSON_PATH` is
 *    appended to `$GITHUB_ENV` for the following steps.
 *  - secret present but not base64 JSON, or no client for the app's package →
 *    `::error::`, exit 1.
 *
 * Firebase is FCM-only here (the operator's 2026-10-29 decision): this script
 * checks only what FCM token minting needs and wires nothing else.
 *
 * The value never reaches stdout; the log names the project NUMBER only by its
 * presence, and the package names it matched.
 *
 * Run directly by Node (type-stripping, no dependency), like check-secrets.ts.
 */

import { appendFileSync, chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Mirrors `BUNDLE_ID` in app.config.ts, which cannot be imported from a script
// that runs before `pnpm install`. A mismatch is exactly the "another app's
// file" case this exists to catch.
const ANDROID_PACKAGE =
	process.env.LO_ANDROID_PACKAGE ?? "com.localoperator.mobile";

const raw = process.env.GOOGLE_SERVICES_JSON_BASE64 ?? "";
if (raw.trim() === "") {
	console.log(
		"::notice::GOOGLE_SERVICES_JSON_BASE64 is not set: building WITHOUT FCM. " +
			"The app builds and runs, but Android cannot mint a push token, so Team " +
			"Bridge push stays off on this build (docs/publishing/push-setup.md).",
	);
	process.exit(0);
}

const fail = (why: string): never => {
	console.error(
		`::error::GOOGLE_SERVICES_JSON_BASE64 is set but ${why}. Re-export ` +
			"google-services.json for the Android app " +
			`${ANDROID_PACKAGE} from the Firebase console and store it with ` +
			"`base64 < google-services.json | tr -d '\\n'` (docs/publishing/push-setup.md).",
	);
	process.exit(1);
};

let parsed: unknown;
try {
	parsed = JSON.parse(Buffer.from(raw.trim(), "base64").toString("utf8"));
} catch {
	fail("does not decode to JSON");
}

type Client = {
	client_info?: { android_client_info?: { package_name?: unknown } };
};
const config = parsed as {
	project_info?: { project_number?: unknown };
	client?: Client[];
};
if (typeof config?.project_info?.project_number !== "string") {
	fail("has no project_info.project_number (not a google-services.json)");
}
const packages = (Array.isArray(config.client) ? config.client : []).map(
	(c) => c?.client_info?.android_client_info?.package_name,
);
if (!packages.includes(ANDROID_PACKAGE)) {
	fail(
		`has no client for ${ANDROID_PACKAGE} (found: ${packages.filter((p) => typeof p === "string").join(", ") || "none"})`,
	);
}

const dir = process.env.RUNNER_TEMP;
if (!dir) fail("RUNNER_TEMP is unset, so there is nowhere safe to write it");
const path = join(dir as string, "google-services.json");
writeFileSync(path, JSON.stringify(parsed), { mode: 0o600 });
chmodSync(path, 0o600);
if (process.env.GITHUB_ENV) {
	appendFileSync(process.env.GITHUB_ENV, `GOOGLE_SERVICES_JSON_PATH=${path}\n`);
}
console.log(
	`google-services.json written for ${ANDROID_PACKAGE} (${packages.length} client(s)); ` +
		"GOOGLE_SERVICES_JSON_PATH exported. FCM is wired for this build.",
);
