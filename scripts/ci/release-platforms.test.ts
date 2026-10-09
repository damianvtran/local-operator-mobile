import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { parsePlatforms } from "./release-platforms";

/**
 * `RELEASE_PLATFORMS` decides what a tagged release builds and which credentials
 * it demands, so the parse is pinned from both sides: the pure function for the
 * accepted spellings, and the CLI as a subprocess for the exit code and the
 * `GITHUB_OUTPUT` line that `release.yml` actually consumes.
 */

const SCRIPT = fileURLToPath(
	new URL("./release-platforms.ts", import.meta.url),
);

const platformsOf = (raw: string | undefined): string[] | string => {
	const parsed = parsePlatforms(raw);
	return parsed.ok ? parsed.platforms : parsed.error;
};

describe("parsePlatforms", () => {
	it("defaults an unset or blank variable to ios, and says it was the default", () => {
		for (const raw of [undefined, "", "   "]) {
			expect(parsePlatforms(raw)).toEqual({
				ok: true,
				platforms: ["ios"],
				fromDefault: true,
			});
		}
	});

	it("accepts each platform and both, in canonical order", () => {
		expect(platformsOf("ios")).toEqual(["ios"]);
		expect(platformsOf("android")).toEqual(["android"]);
		expect(platformsOf("android,ios")).toEqual(["ios", "android"]);
		expect(platformsOf("ios,android")).toEqual(["ios", "android"]);
	});

	it("is robust to case, spaces, duplicates and a trailing comma", () => {
		expect(platformsOf(" iOS , Android ,")).toEqual(["ios", "android"]);
		expect(platformsOf("ios,IOS")).toEqual(["ios"]);
	});

	it("fails on an unknown platform instead of dropping it", () => {
		expect(platformsOf("windows")).toContain('unknown platform: "windows"');
		expect(platformsOf("ios,andriod")).toContain('"andriod"');
	});

	it("fails on a value that names no platform at all", () => {
		expect(platformsOf(",")).toContain("names no platform");
	});
});

describe("release-platforms CLI", () => {
	const run = (raw: string | undefined) => {
		try {
			// Built without the GitHub variables, so the CLI neither writes into a real
			// step summary when this runs inside Actions nor inherits a value.
			const {
				RELEASE_PLATFORMS: _p,
				GITHUB_OUTPUT: _o,
				GITHUB_STEP_SUMMARY: _s,
				...env
			} = process.env;
			if (raw !== undefined) env.RELEASE_PLATFORMS = raw;
			const stdout = execFileSync(process.execPath, [SCRIPT], {
				env,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			});
			return { code: 0, stdout, stderr: "" };
		} catch (error) {
			const e = error as { status: number; stdout: string; stderr: string };
			return { code: e.status, stdout: e.stdout, stderr: e.stderr };
		}
	};

	it("exits 0 and names the default when unset", () => {
		const result = run(undefined);
		expect(result.code).toBe(0);
		expect(result.stdout).toContain("release platforms: ios");
		expect(result.stdout).toContain("unset, so the default");
	});

	it("exits 1 with a workflow error annotation on a junk value", () => {
		const result = run("windows");
		expect(result.code).toBe(1);
		expect(result.stderr).toContain("::error::");
		expect(result.stderr).toContain('"windows"');
	});
});
