import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
	readFileSync(new URL(path, import.meta.url), "utf8");
describe("real Expo application OAuth proof boundary", () => {
	it("builds the actual Expo app and proves 500, PKCE, discovery and persisted restoration", () => {
		const project = read("./attach-tests.rb");
		const test = read("./SignInAppUITests.swift");
		const workflow = read("../../../.github/workflows/signin-app-proof.yml");
		expect(project).toContain("com.apple.product-type.application");
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
