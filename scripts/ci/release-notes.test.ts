import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The Release body must describe only the artefacts the release has. It once said
 * "install on Android from the APK attached here" unconditionally, which is false
 * on an iOS-only Release (`RELEASE_PLATFORMS=ios`, the default).
 *
 * The range is empty (`HEAD..HEAD`): only the closing paragraph is asserted, and
 * it does not depend on which commits are listed.
 */

const SCRIPT = fileURLToPath(new URL("./release-notes.ts", import.meta.url));

const notes = (...extra: string[]) => {
	try {
		const stdout = execFileSync(
			process.execPath,
			[SCRIPT, "--from", "HEAD", "--to", "HEAD", ...extra],
			{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
		);
		return { code: 0, stdout, stderr: "" };
	} catch (error) {
		const e = error as { status: number; stdout: string; stderr: string };
		return { code: e.status, stdout: e.stdout, stderr: e.stderr };
	}
};

describe("release notes closing paragraph", () => {
	it("mentions the IPA and TestFlight, and no APK or Play, for ios", () => {
		const { code, stdout } = notes("--platforms", "ios");
		expect(code).toBe(0);
		expect(stdout).toContain("IPA is attached");
		expect(stdout).toContain("TestFlight");
		expect(stdout).not.toMatch(/APK|AAB|Play/);
	});

	it("mentions the APK and Play, and no IPA or TestFlight, for android", () => {
		const { stdout } = notes("--platforms", "android");
		expect(stdout).toContain("APK");
		expect(stdout).toContain("Play internal track");
		expect(stdout).not.toMatch(/IPA|TestFlight/);
	});

	it("mentions both for ios,android and when --platforms is absent", () => {
		for (const extra of [["--platforms", "ios,android"], []]) {
			const { stdout } = notes(...extra);
			expect(stdout).toMatch(/IPA/);
			expect(stdout).toMatch(/APK/);
		}
	});

	it("fails on an unknown or empty platform list", () => {
		expect(notes("--platforms", "windows").code).toBe(1);
		expect(notes("--platforms", "").code).toBe(1);
	});
});
