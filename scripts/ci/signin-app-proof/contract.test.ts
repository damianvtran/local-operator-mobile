import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
	readFileSync(new URL(path, import.meta.url), "utf8");
describe("real Expo application OAuth proof boundary", () => {
	it("captures simctl stderr help and rejects the observed stdout-only regression", () => {
		const source = read("./run.sh");
		const start = source.indexOf("xcrun simctl help keychain");
		const end = source.indexOf("# Match the proven", start);
		expect(start).toBeGreaterThan(0);
		expect(end).toBeGreaterThan(start);
		const block = source.slice(start, end);
		const root = mkdtempSync(join(tmpdir(), "signin-simctl-help-"));
		const run = (script: string) =>
			spawnSync(
				"/bin/bash",
				[
					"-c",
					`set -e\nxcrun() { printf 'reset appearance accessibility-extra-extra-extra-large\\n' >&2; }\n${script}`,
				],
				{
					env: {
						PATH: "/usr/bin:/bin",
						HOME: root,
						OUT: root,
						NODE_ENV: "test",
					},
					encoding: "utf8",
				},
			).status;
		try {
			expect(run(block)).toBe(0);
			expect(run(block.replace(" 2>&1", ""))).not.toBe(0);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
	it("builds the actual Expo app and proves 500, PKCE, discovery and persisted restoration", () => {
		const project = read("./attach-tests.rb");
		const test = read("./SignInAppUITests.swift");
		const workflow = read("../../../.github/workflows/signin-app-proof.yml");
		expect(project).toContain("com.apple.product-type.application");
		const consent = test.slice(
			test.indexOf("private func consent()"),
			test.indexOf("private func visible("),
		);
		expect(consent).toContain(
			"try require(button.waitForExistence(timeout: 60)",
		);
		expect(consent).toContain("button.tap()");
		expect(consent).not.toContain("if button.waitForExistence");
		expect(
			test.match(/try consent\(\)\n {4}try text\("Signing in…"\)/g),
		).toHaveLength(2);
		expect(read("./run.sh")).toContain('prepare-entry.ts "$OUT"');
		expect(project).toContain("'TEST_TARGET_NAME' => app.name");
		expect(project).toContain("'PRODUCT_NAME' => '$(TARGET_NAME)'");
		expect(project).toContain("'PRODUCT_MODULE_NAME' => 'SignInAppUITests'");
		expect(workflow).toContain("expo prebuild --platform ios");
		expect(workflow).toContain("Prove adversarial debug override");
		expect(workflow).toContain(
			"EXPO_PUBLIC_SIGNIN_PROOF_ORIGIN: http://127.0.0.1:54831",
		);
		expect(test).toContain("/control?mode=failure&hold=true&reset=true");
		expect(test).toContain('try text("Signing in…")');
		expect(test).toContain('app.buttons["sign-in-try-again"].tap()');
		expect(test).toContain('XCTAssertEqual(positive["pkce_verified"], 2)');
		expect(test).toContain('XCTAssertEqual(restored["authorize"], 2)');
		expect(test).toContain('XCTAssertGreaterThan(restored["discovery"]');
		expect(test).toContain(
			'XCTAssertTrue(app.buttons[id].label.contains("OAuth proof computer"))',
		);
		expect(test).not.toContain('try text("OAuth proof computer")');
		expect(test).toContain('attach("cancelled-and-retry")');
		expect(test).toContain('attach("token-500-error-and-retry-collapsed")');
		expect(test).toContain('"actual_monotonic_starts": times');
		expect(test).toContain('attach("transition-\\(index)")');
		expect(read("./run.sh")).toContain('TEST_RUNNER_PROOF_THEME="$theme"');
		expect(read("./run.sh")).toContain(
			"content_size accessibility-extra-extra-extra-large",
		);
		expect(read("./run.sh")).toContain("testDarkLargestWelcome");
		// Expo treats offline as another host selector; combining it with
		// localhost exits before Metro can start, even though --help lists both.
		expect(read("./run.sh")).toContain("'--localhost'");
		expect(read("./run.sh")).toContain("http://localhost:8081/status");
		expect(read("./run.sh")).not.toContain("http://127.0.0.1:8081");
		expect(read("./run.sh")).not.toContain("'--offline'");
		expect(read("./run.sh")).toContain("build-for-testing");
		expect(read("./run.sh")).toContain("test-without-building");
		expect(read("./run.sh")).toContain("for theme in light dark");
		expect(read("./run.sh")).toContain('appearance "$theme"');
		expect(read("./run.sh")).toContain('keychain "$UDID" reset');
		expect(read("./run.sh")).toContain("v['pkce_verified'] == 2");
		expect(workflow).not.toContain("secrets:");
	});
});
