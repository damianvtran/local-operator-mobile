#!/usr/bin/env node
/**
 * Decide which platforms a tagged release builds and publishes.
 *
 *     RELEASE_PLATFORMS=ios,android node scripts/ci/release-platforms.ts
 *
 * Why this exists. `release.yml` used to build, sign and publish BOTH platforms
 * and hard-failed on a tag unless all nine credentials existed. The operator can
 * release one platform before the other has store access (Apple first; Google
 * Play parked), and a tag must not fail on credentials of a platform nobody asked
 * to release. The decision is the repository variable `RELEASE_PLATFORMS`, parsed
 * HERE, once, and consumed by every job through the `credentials` job's output —
 * so the credential gate, the build jobs and `publish` cannot disagree about it.
 *
 * What it does NOT do: relax the rule that a missing credential is a failure. A
 * platform that is enabled and lacks credentials still fails the release (the
 * per-platform `check-secrets.ts --mode release` steps); a platform that is not
 * enabled is not checked at all. Selection is explicit, never inferred from which
 * secrets happen to exist — inferring it would turn a deleted secret into a quiet
 * skipped platform, which is the "release that ships less than it says" failure
 * the hard gate exists to prevent.
 *
 * THE UNSET DEFAULT IS `ios`, deliberately, and loud: the summary says the value
 * came from the default. A variable that was never created, or was blanked, must
 * resolve to something the operator can read off the run page rather than to an
 * empty list (which would release nothing) or to both (which would fail on the
 * parked platform's secrets).
 *
 * An unknown platform name is an ERROR, not an ignored token: `windows`, or the
 * typo `andriod`, would otherwise parse to "nothing enabled that I recognise" and
 * the release would proceed with a platform silently dropped.
 *
 * Output (GITHUB_OUTPUT): `platforms=ios,android` in canonical order, lowercase,
 * de-duplicated. Consumers test it with `contains(..., 'ios')` — safe because no
 * platform name is a substring of another.
 *
 * Run directly by Node (type-stripping, no dependency): it runs before
 * `pnpm install`, in the same job as the credential check.
 */

import { appendFileSync } from "node:fs";

/** Canonical order: also the order the summary and the output list them in. */
export const PLATFORMS = ["ios", "android"] as const;

export type Platform = (typeof PLATFORMS)[number];

/** What an unset or blank `RELEASE_PLATFORMS` means. Documented in docs/ci.md. */
export const DEFAULT_PLATFORMS: readonly Platform[] = ["ios"];

export type Parsed =
	| { ok: true; platforms: Platform[]; fromDefault: boolean }
	| { ok: false; error: string };

const isPlatform = (value: string): value is Platform =>
	PLATFORMS.some((platform) => platform === value);

/**
 * Parse the variable. Tolerant of case and surrounding spaces (`" iOS , Android "`)
 * and of a trailing comma, because it is typed by hand into a settings page;
 * strict about everything else.
 */
export const parsePlatforms = (raw: string | undefined): Parsed => {
	if (raw === undefined || raw.trim() === "") {
		return { ok: true, platforms: [...DEFAULT_PLATFORMS], fromDefault: true };
	}
	const tokens = raw
		.split(",")
		.map((token) => token.trim().toLowerCase())
		.filter(Boolean);
	if (tokens.length === 0) {
		return {
			ok: false,
			error: `RELEASE_PLATFORMS is "${raw}", which names no platform. Use a comma-separated list of: ${PLATFORMS.join(", ")} (or leave it unset for the default, ${DEFAULT_PLATFORMS.join(",")}).`,
		};
	}
	const unknown = tokens.filter((token) => !isPlatform(token));
	if (unknown.length > 0) {
		return {
			ok: false,
			error: `RELEASE_PLATFORMS names an unknown platform: ${unknown.map((token) => `"${token}"`).join(", ")}. Known platforms: ${PLATFORMS.join(", ")}. A release will not guess which one was meant.`,
		};
	}
	const wanted = new Set(tokens);
	return {
		ok: true,
		platforms: PLATFORMS.filter((platform) => wanted.has(platform)),
		fromDefault: false,
	};
};

// Same entry-point guard as version.ts: importing this file from the unit suite
// must not run the CLI. `import.meta.main` needs Node >= 24.2, which the
// workflows pin (NODE_VERSION "24"); an older Node is a named failure rather than
// a script that silently does nothing and leaves `platforms` unset.
const isEntryPoint = (import.meta as ImportMeta & { main?: boolean }).main;
if (isEntryPoint === undefined) {
	console.error(
		"::error::this Node does not support `import.meta.main` (needs >= 24.2), " +
			"so this script would silently do nothing and `platforms` would be unset.",
	);
	process.exit(1);
}
if (isEntryPoint) {
	const raw = process.env.RELEASE_PLATFORMS;
	const parsed = parsePlatforms(raw);
	if (!parsed.ok) {
		console.error(`::error::${parsed.error}`);
		process.exit(1);
	}
	const platforms = parsed.platforms.join(",");
	const source = parsed.fromDefault
		? `unset, so the default \`${platforms}\` applies`
		: `\`${(raw ?? "").trim()}\``;
	console.log(
		`release platforms: ${platforms} (RELEASE_PLATFORMS is ${source})`,
	);
	if (process.env.GITHUB_OUTPUT) {
		appendFileSync(process.env.GITHUB_OUTPUT, `platforms=${platforms}\n`);
	}
	if (process.env.GITHUB_STEP_SUMMARY) {
		appendFileSync(
			process.env.GITHUB_STEP_SUMMARY,
			`## Release platforms\n\nThis release builds and publishes: **${platforms}**. \`RELEASE_PLATFORMS\` is ${source}. ` +
				"Only these platforms' credentials are checked; the others are not built, uploaded or required.\n\n",
		);
	}
}
