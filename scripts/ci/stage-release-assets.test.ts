import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

/**
 * `stage-release-assets.sh` is the ONE place the platform → published-file-name
 * mapping lives: the staging renames and the `gh release create` asset list
 * (`--list`) both come from it. Tested as a subprocess, because the failure modes
 * that matter are exit codes and the files left behind.
 *
 * `os.tmpdir()` and not the repository, so a reviewer's `git status` stays clean;
 * the root carries this process's pid so side-by-side suites cannot share it.
 */

const SCRIPT = fileURLToPath(
	new URL("./stage-release-assets.sh", import.meta.url),
);
const ROOT = mkdtempSync(join(tmpdir(), `stage-assets-${process.pid}-`));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

let counter = 0;
/** A fresh artefacts directory holding the named (non-empty) files. */
const artifacts = (...files: string[]): string => {
	const dir = join(ROOT, `case-${counter++}`);
	mkdirSync(dir);
	for (const file of files) writeFileSync(join(dir, file), "x".repeat(64));
	return dir;
};

const run = (...args: string[]) => {
	try {
		const stdout = execFileSync("bash", [SCRIPT, ...args], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
		return { code: 0, stdout, stderr: "" };
	} catch (error) {
		const e = error as { status: number; stdout: string; stderr: string };
		return { code: e.status, stdout: e.stdout, stderr: e.stderr };
	}
};

describe("stage-release-assets.sh --list", () => {
	it("lists only the IPA for ios, in the directory it was given", () => {
		const result = run("--list", "artifacts", "1.2.3", "ios");
		expect(result.code).toBe(0);
		expect(result.stdout).toBe("artifacts/local-operator-1.2.3.ipa\n");
	});

	it("lists the APK and AAB for android", () => {
		const result = run("--list", "artifacts", "1.2.3", "android");
		expect(result.stdout).toBe(
			"artifacts/local-operator-1.2.3.apk\nartifacts/local-operator-1.2.3.aab\n",
		);
	});

	it("lists all three for both", () => {
		const result = run("--list", "artifacts", "1.2.3", "ios,android");
		expect(result.stdout.trim().split("\n")).toEqual([
			"artifacts/local-operator-1.2.3.apk",
			"artifacts/local-operator-1.2.3.aab",
			"artifacts/local-operator-1.2.3.ipa",
		]);
	});

	it("fails on an empty or unrecognised platform list instead of widening it", () => {
		expect(run("--list", "artifacts", "1.2.3", "").code).toBe(1);
		expect(run("--list", "artifacts", "1.2.3", "windows").code).toBe(1);
	});
});

describe("stage-release-assets.sh staging", () => {
	it("stages an iOS-only download that holds nothing but the IPA", () => {
		const dir = artifacts("exported.ipa");
		const result = run(dir, "1.2.3", "ios");
		expect(result.code).toBe(0);
		expect(existsSync(join(dir, "local-operator-1.2.3.ipa"))).toBe(true);
	});

	it("leaves a disabled platform's files alone", () => {
		const dir = artifacts("exported.ipa", "app-release.aab", "app-release.apk");
		expect(run(dir, "1.2.3", "ios").code).toBe(0);
		expect(existsSync(join(dir, "app-release.aab"))).toBe(true);
	});

	it("still fails when an ENABLED platform's artefact is missing", () => {
		expect(run(artifacts(), "1.2.3", "ios").code).toBe(1);
		expect(run(artifacts("app-release.apk"), "1.2.3", "android").code).toBe(1);
	});

	it("defaults to both platforms only when the argument is omitted", () => {
		const dir = artifacts("app-release.aab", "app-release.apk", "x.ipa");
		expect(run(dir, "1.2.3").code).toBe(0);
		expect(existsSync(join(dir, "local-operator-1.2.3.aab"))).toBe(true);
		// An empty list is an unresolved platform list, not "everything".
		expect(run(artifacts("x.ipa"), "1.2.3", "").code).toBe(1);
	});
});
