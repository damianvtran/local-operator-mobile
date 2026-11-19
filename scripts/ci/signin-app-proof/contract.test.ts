import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
	readFileSync(new URL(path, import.meta.url), "utf8");
// Source-only guard, not native execution. The ordered milestones keep the
// Nov 19 / 84621b99e single-computer flow honest: Home must be authenticated,
// then a NEW process must reconnect before the separate refusal/retry route.
const autoOpenMilestones = [
	"try releaseAndCaptureTransition()",
	'try visible("home-screen")',
	'try visible("notification-primer-not-now")',
	'app.buttons["notification-primer-not-now"].tap()',
	"try connectedHome()",
	'let positive = try control("/receipt")',
	'XCTAssertEqual(positive["session_pkce_verified"], 1)',
	"app.terminate()",
	"app.launch()",
	"try connectedHome()",
	'let restored = try control("/receipt")',
	'XCTAssertEqual(restored["authorize"], 2)',
	'XCTAssertGreaterThan(restored["discovery"] ?? 0, positive["discovery"] ?? 0)',
	'XCTAssertEqual(restored["session_code"], 2)',
	'XCTAssertEqual(restored["session_token"], 2)',
	'XCTAssertEqual(restored["session_pkce_verified"], 2)',
	'XCTAssertGreaterThan(restored["relay_requests"] ?? 0, positive["relay_requests"] ?? 0)',
	"app.terminate()",
	'control("/control?session=inactive")',
	"app.launch()",
	'try visible("connection-error-console-link")',
	'XCTAssertEqual(inactive["session_code"], 3)',
	'XCTAssertEqual(inactive["session_token"], 2)',
	"app.terminate()",
	'control("/control?session=malformed")',
	"app.launch()",
	'try visible("connection-details-toggle")',
	'XCTAssertEqual(malformed["session_code"], 4)',
	'XCTAssertEqual(malformed["session_token"], 2)',
	'control("/control?session=success")',
	'app.buttons["refusal-sign-in"].tap()',
	'try visible("session-row-b3535011f562")',
	'XCTAssertEqual(connected["authorize"], 2)',
	'XCTAssertEqual(connected["session_code"], 5)',
	'XCTAssertEqual(connected["session_token"], 3)',
	'XCTAssertEqual(connected["session_pkce_verified"], 3)',
] as const;
const hasAutoOpenFlow = (source: string) => {
	let cursor = 0;
	for (const milestone of autoOpenMilestones) {
		const index = source.indexOf(milestone, cursor);
		if (index < 0) return false;
		cursor = index + milestone.length;
	}
	const home = source.slice(
		source.indexOf("private func connectedHome()"),
		source.indexOf("private func releaseAndCaptureTransition()"),
	);
	return [
		'try visible("home-screen")',
		'try visible("computers-button")',
		'XCTAssertTrue(app.buttons["computers-button"].label.contains("OAuth proof computer"))',
		'try visible("session-row-b3535011f562")',
		'app.buttons["sidebar-close"].tap()',
	].every((assertion) => home.includes(assertion));
};

describe("real Expo application OAuth proof boundary", () => {
	it("accepts authenticated Home auto-open and rejects each missing flow milestone", () => {
		const source = read("./SignInAppUITests.swift");
		expect(hasAutoOpenFlow(source)).toBe(true);
		for (const milestone of autoOpenMilestones) {
			// Remove ALL occurrences so repeated Home/retry/launch calls cannot
			// accidentally supply a missing milestone from a later stage.
			expect(hasAutoOpenFlow(source.replaceAll(milestone, "")), milestone).toBe(
				false,
			);
		}
		expect(
			hasAutoOpenFlow(
				source.replaceAll(
					"try connectedHome()",
					'try visible("computers-screen")',
				),
			),
		).toBe(false);
		expect(
			hasAutoOpenFlow(
				source.replace(
					'    try visible("session-row-b3535011f562")\n    app.buttons["sidebar-close"].tap()',
					'    app.buttons["sidebar-close"].tap()',
				),
			),
		).toBe(false);
		const runner = read("./run.sh");
		expect(runner).toContain(
			"v['session_code'] == 5 and v['session_token'] == 3 and v['session_pkce_verified'] == 3",
		);
	});
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
		// Both held exchanges release on the provider receipt, never on an
		// accessibility wait: a post-browser AX snapshot stalled 31-70 s, past the
		// app's 20 s exchange deadline (PR #341, runs 44505768707/44524064527).
		expect(
			test.match(
				/try consent\(\)\n {4}try heldExchange\("(negative|positive)-exchanging", pkceVerified: [12]\)\n/g,
			),
		).toHaveLength(2);
		expect(test).not.toMatch(/try consent\(\)\n {4}try (text|visible)\(/);
		expect(test).toContain('control("/receipt")["pkce_verified"]');
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
		expect(test).toContain('app.buttons["sign-in-try-again"].tap()');
		expect(test).toContain('XCTAssertEqual(positive["pkce_verified"], 2)');
		expect(test).toContain('XCTAssertEqual(restored["authorize"], 2)');
		expect(test).toContain('XCTAssertGreaterThan(restored["discovery"]');
		expect(test).toContain(
			'XCTAssertTrue(app.buttons["computers-button"].label.contains("OAuth proof computer"))',
		);
		expect(test).not.toContain('try text("OAuth proof computer")');
		expect(test).toContain('attach("cancelled-and-retry")');
		expect(test).toContain('attach("tunnel-contract-error-and-retry")');
		expect(test).toContain('attach("tunnel-inactive-status-guidance")');
		expect(test).toContain('XCTAssertEqual(connected["session_code"], 5)');
		expect(test).toContain('attach("connected-session-list")');
		expect(test).toContain('try visible("conversations-list")');
		expect(test).toContain(
			'XCTAssertEqual(connected["session_pkce_verified"], 3)',
		);
		expect(read("./run.sh")).toContain("v['relay_requests'] > 0");
		expect(test).toContain('attach("token-500-error-and-retry-collapsed")');
		// A failed proof names its stage and error class (PR #341, run
		// 44505768707 ended on a bare "We could not finish signing in.").
		expect(test).toMatch(
			/attach\("failed-app-frame"\)\n {6}attachSignInDiagnostics\(\)/,
		);
		expect(test).toContain('matching(identifier: "sign-in-diagnostics")');
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
