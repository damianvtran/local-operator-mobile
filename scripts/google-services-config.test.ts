import { execFileSync, spawnSync } from "node:child_process";
import {
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

/*
 * Android FCM wiring for Team Bridge push: the app config with and without a
 * google-services.json, the CI step that materialises it from a secret, and
 * check-secrets' optional reporting. The no-file case is the one every current
 * build is in, so it is asserted to keep `android.googleServicesFile` ABSENT.
 */

const ROOT = join(__dirname, "..");
const DOES_NOT_EXIST = /does not exist/;
const NOT_JSON = /does not decode to JSON/;
const WRONG_PACKAGE = /no client for com\.localoperator\.mobile/;
const NOT_GSJ = /no project_info\.project_number/;
const scratch: string[] = [];
const tempDir = () => {
	const dir = mkdtempSync(join(tmpdir(), "lo-gsj-"));
	scratch.push(dir);
	return dir;
};
afterEach(() => {
	for (const dir of scratch.splice(0))
		rmSync(dir, { recursive: true, force: true });
	vi.unstubAllEnvs();
	vi.resetModules();
});

const PACKAGE = "com.localoperator.mobile";
const config = (pkg = PACKAGE) => ({
	project_info: { project_number: "000000000000", project_id: "example-fcm" },
	client: [{ client_info: { android_client_info: { package_name: pkg } } }],
});

describe("app.config.ts resolveGoogleServicesFile", () => {
	it("is undefined with no env and no file (debug APK, CI, web stay push-off)", async () => {
		const { resolveGoogleServicesFile } = await import("../app.config");
		expect(resolveGoogleServicesFile({}, () => false, "/repo")).toBeUndefined();
	});

	it("uses ./google-services.json when present at the root", async () => {
		const { resolveGoogleServicesFile } = await import("../app.config");
		const seen: string[] = [];
		expect(
			resolveGoogleServicesFile(
				{},
				(p) => {
					seen.push(p);
					return true;
				},
				"/repo",
			),
		).toBe("./google-services.json");
		expect(seen).toEqual(["/repo/google-services.json"]);
	});

	it("prefers GOOGLE_SERVICES_JSON_PATH and refuses one that names nothing", async () => {
		const { resolveGoogleServicesFile } = await import("../app.config");
		expect(
			resolveGoogleServicesFile(
				{ GOOGLE_SERVICES_JSON_PATH: "/tmp/x.json" },
				(p) => p === "/tmp/x.json",
				"/repo",
			),
		).toBe("/tmp/x.json");
		expect(() =>
			resolveGoogleServicesFile(
				{ GOOGLE_SERVICES_JSON_PATH: "/tmp/missing.json" },
				() => false,
				"/repo",
			),
		).toThrow(DOES_NOT_EXIST);
		// Blank is unset, not "a path to the empty string".
		expect(
			resolveGoogleServicesFile(
				{ GOOGLE_SERVICES_JSON_PATH: "  " },
				() => false,
				"/repo",
			),
		).toBeUndefined();
	});

	it("the resolved config carries android.googleServicesFile only when a file exists", async () => {
		vi.stubEnv("GOOGLE_SERVICES_JSON_PATH", "");
		const without = (await import("../app.config")).default;
		expect(without.android).not.toHaveProperty("googleServicesFile");

		vi.resetModules();
		const file = join(tempDir(), "google-services.json");
		writeFileSync(file, JSON.stringify(config()));
		vi.stubEnv("GOOGLE_SERVICES_JSON_PATH", file);
		const withFile = (await import("../app.config")).default;
		expect(withFile.android?.googleServicesFile).toBe(file);
		// Nothing else about the Android config moved.
		const { googleServicesFile: _, ...rest } = withFile.android ?? {};
		expect(rest).toEqual(without.android);
	});
});

const run = (
	script: string,
	env: Record<string, string>,
	args: string[] = [],
) =>
	spawnSync(process.execPath, [join(ROOT, script), ...args], {
		// A minimal environment: no inherited secrets can leak into the run.
		env: {
			PATH: process.env.PATH ?? "",
			...env,
		} as unknown as NodeJS.ProcessEnv,
		encoding: "utf8",
	});

describe("scripts/ci/google-services.ts", () => {
	it("absent secret: notice, exit 0, nothing exported", () => {
		const dir = tempDir();
		const githubEnv = join(dir, "env");
		writeFileSync(githubEnv, "");
		const out = run("scripts/ci/google-services.ts", {
			RUNNER_TEMP: dir,
			GITHUB_ENV: githubEnv,
		});
		expect(out.status).toBe(0);
		expect(out.stdout).toContain(
			"::notice::GOOGLE_SERVICES_JSON_BASE64 is not set",
		);
		expect(readFileSync(githubEnv, "utf8")).toBe("");
	});

	it("valid secret: owner-only file under RUNNER_TEMP, path exported, value not printed", () => {
		const dir = tempDir();
		const githubEnv = join(dir, "env");
		writeFileSync(githubEnv, "");
		const b64 = Buffer.from(JSON.stringify(config())).toString("base64");
		const out = run("scripts/ci/google-services.ts", {
			RUNNER_TEMP: dir,
			GITHUB_ENV: githubEnv,
			GOOGLE_SERVICES_JSON_BASE64: b64,
		});
		expect(out.status).toBe(0);
		const path = join(dir, "google-services.json");
		expect(readFileSync(githubEnv, "utf8")).toBe(
			`GOOGLE_SERVICES_JSON_PATH=${path}\n`,
		);
		expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(config());
		expect(statSync(path).mode & 0o777).toBe(0o600);
		expect(out.stdout + out.stderr).not.toContain(b64);
		expect(out.stdout + out.stderr).not.toContain("000000000000");
	});

	it.each([
		["not JSON", Buffer.from("nope").toString("base64"), NOT_JSON],
		[
			"another app's file",
			Buffer.from(JSON.stringify(config("com.example.other"))).toString(
				"base64",
			),
			WRONG_PACKAGE,
		],
		[
			"not a google-services.json",
			Buffer.from(JSON.stringify({ client: [] })).toString("base64"),
			NOT_GSJ,
		],
	])("present but %s: ::error:: and exit 1", (_label, value, why) => {
		const dir = tempDir();
		const out = run("scripts/ci/google-services.ts", {
			RUNNER_TEMP: dir,
			GOOGLE_SERVICES_JSON_BASE64: value,
		});
		expect(out.status).toBe(1);
		expect(out.stderr).toMatch(why);
	});
});

describe("scripts/ci/check-secrets.ts --optional", () => {
	it("release mode: an absent OPTIONAL name is reported and does not fail", () => {
		const dir = tempDir();
		const output = join(dir, "out");
		writeFileSync(output, "");
		const out = run(
			"scripts/ci/check-secrets.ts",
			{ REQUIRED_X: "v", GITHUB_OUTPUT: output },
			[
				"--mode",
				"release",
				"--need",
				"REQUIRED_X",
				"--optional",
				"GOOGLE_SERVICES_JSON_BASE64",
			],
		);
		expect(out.status).toBe(0);
		expect(out.stdout).toContain(
			"optional-absent: GOOGLE_SERVICES_JSON_BASE64",
		);
		expect(out.stdout).toContain("::notice::optional secrets missing");
		expect(readFileSync(output, "utf8")).toContain("all_present=true");
		expect(readFileSync(output, "utf8")).toContain(
			"optional_missing=GOOGLE_SERVICES_JSON_BASE64",
		);
	});

	it("release mode: a missing REQUIRED name still fails, optional present is reported by size only", () => {
		const out = run(
			"scripts/ci/check-secrets.ts",
			{ GOOGLE_SERVICES_JSON_BASE64: "c2VjcmV0" },
			[
				"--mode",
				"release",
				"--need",
				"REQUIRED_X",
				"--optional",
				"GOOGLE_SERVICES_JSON_BASE64",
			],
		);
		expect(out.status).toBe(1);
		expect(out.stdout).toContain(
			"optional-present: GOOGLE_SERVICES_JSON_BASE64 (8 bytes)",
		);
		expect(out.stdout).not.toContain("c2VjcmV0");
	});
});

// Keeps the file out of git whatever the build does (the operator's FCM-only
// decision; see app.config.ts).
it("google-services.json stays gitignored", () => {
	expect(
		execFileSync("git", ["check-ignore", "google-services.json"], {
			cwd: ROOT,
			encoding: "utf8",
		}).trim(),
	).toBe("google-services.json");
});
