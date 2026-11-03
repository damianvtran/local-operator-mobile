import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = new URL("./", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const main = read("main.swift");
const runner = read("run.sh");
const tests = read("CallbackProofUITests.swift");
const project = read("project.yml");
const probe = read("TCPClosureProbe.swift");
const workflow = read("../../../.github/workflows/oauth-callback-proof.yml");
const AUTOSTART = /\b(?:self\.)?(?:start|prepare)\(\)/;
const URL_TARGET = /URL\(string: "([^"]+)"/g;
const TIMEOUT_OVERRIDE = /transport\.timeoutSeconds\s*=/;
const UI_CONTINUE = /continueAfterFailure\s*=\s*true/;
const LEGACY_FRONTEND = /maestro|setup-java/i;

/** Source-contract tripwires are not native execution. Their mutations reject
 * architecture drift cheaply; the hosted XCUITests remain the acceptance path. */
function launchIsInert(source: string): boolean {
	const launch = source.slice(
		source.indexOf("func application("),
		source.indexOf("func start()"),
	);
	return !AUTOSTART.test(launch) && launch.includes("bindProvider()");
}
function beginIsSoleTrigger(source: string): boolean {
	return (
		source.includes(
			'guard self.stage == "ready", !self.started, !self.completed else {',
		) &&
		source.split("self.start()").length === 2 &&
		!source.includes("#selector(start)")
	);
}
function runnerOnlyBeginsFixture(source: string): boolean {
	const targets = [...source.matchAll(URL_TARGET)].map(
		(match) => match[1] ?? "",
	);
	return (
		targets.length === 1 &&
		targets[0]?.endsWith("/begin") === true &&
		!source.includes("/callback")
	);
}
function noAssertionRetries(driver: string, ui: string): boolean {
	return (
		!driver.includes("-retry-tests-on-failure") &&
		!UI_CONTINUE.test(ui) &&
		ui.includes("continueAfterFailure = false")
	);
}
function retryRequiresBoth(source: string): boolean {
	return (
		source.includes("allowed = test_never_ran and receipt_ready") &&
		source.includes("started_marker") &&
		source.includes("native.get('stage') == 'ready'")
	);
}
const retryPython =
	runner.split("<<'RETRY_PY'\n")[1]?.split("\nRETRY_PY")[0] ?? "";
const admission =
	runner
		.slice(runner.indexOf('if python3 - "$OUT/evidence"'))
		.split("<<'PY'\n")[1]
		?.split("\nPY")[0] ?? "";

function withDirectory(check: (directory: string) => void) {
	const directory = mkdtempSync(join(tmpdir(), "oauth-native-policy-"));
	try {
		check(directory);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

describe("native XCTest OAuth proof architecture", () => {
	it("keeps launch inert and /begin as its sole guarded start, rejecting cold-driver mutations", () => {
		expect(launchIsInert(main)).toBe(true);
		expect(
			launchIsInert(main.replace("    bindProvider()", "    self.prepare()")),
		).toBe(false);
		expect(beginIsSoleTrigger(main)).toBe(true);
		expect(
			beginIsSoleTrigger(
				main.replace(
					'guard self.stage == "ready", !self.started, !self.completed else {',
					"guard !self.completed else {",
				),
			),
		).toBe(false);
		expect(main).toContain("label.accessibilityValue");
		expect(main).not.toContain("UIButton");
	});

	it("allows test-runner HTTP only to the fixture begin port, never the production listener", () => {
		expect(runnerOnlyBeginsFixture(tests)).toBe(true);
		const bypass = tests.replace("\\(port)/begin", "\\(port)/callback");
		expect(bypass).not.toBe(tests);
		expect(runnerOnlyBeginsFixture(bypass)).toBe(false);
		expect(tests).toContain("URLSession.shared.dataTask");
		expect(tests.indexOf("app.launch()")).toBeLessThan(
			tests.indexOf("try beginFromRunner(port: port)"),
		);
	});

	it("never retries an assertion or ignores a UI failure", () => {
		expect(noAssertionRetries(runner, tests)).toBe(true);
		expect(runner).toContain("for attempt in 1 2");
		expect(runner).toContain("::warning::Retrying");
		expect(
			noAssertionRetries(`${runner}\n-retry-tests-on-failure`, tests),
		).toBe(false);
		expect(
			noAssertionRetries(
				runner,
				tests.replace(
					"continueAfterFailure = false",
					"continueAfterFailure = true",
				),
			),
		).toBe(false);
		expect(runner).toContain("for attempt in 1 2; do");
		expect(runner).toContain("::warning::Retrying");
		expect(tests).toContain("PROOF_TEST_STARTED");
	});

	it("requires BOTH not-run evidence and absent/fresh-ready native state before a startup retry", () => {
		expect(retryRequiresBoth(retryPython)).toBe(true);
		const weakened = retryPython.replace(
			"allowed = test_never_ran and receipt_ready",
			"allowed = test_never_ran",
		);
		expect(retryRequiresBoth(weakened)).toBe(false);
		withDirectory((directory) => {
			const report = join(directory, "tests.json");
			const receipt = join(directory, "receipt.json");
			const log = join(directory, "xcode.log");
			writeFileSync(report, JSON.stringify({ testNodes: [] }));
			writeFileSync(log, "");
			const run = (source: string) =>
				spawnSync(
					"python3",
					["-c", source, report, receipt, "positive", "current", log],
					{ encoding: "utf8" },
				).status;
			expect(run(retryPython)).toBe(0); // Absent receipt, authoritative no-test report.
			writeFileSync(
				receipt,
				JSON.stringify({
					mode: "positive",
					run_id: "current",
					stage: "ready",
					started: false,
				}),
			);
			expect(run(retryPython)).toBe(0);
			writeFileSync(
				receipt,
				JSON.stringify({
					mode: "positive",
					run_id: "current",
					stage: "browser-ready",
					started: true,
				}),
			);
			expect(run(retryPython)).toBe(1);
			expect(run(weakened)).toBe(0); // Discriminating unsafe mutation would replay an in-flow test.
			writeFileSync(
				receipt,
				JSON.stringify({
					mode: "positive",
					run_id: "current",
					stage: "ready",
					started: false,
				}),
			);
			writeFileSync(log, "PROOF_TEST_STARTED positive");
			expect(run(retryPython)).toBe(1);
			writeFileSync(log, "");
			writeFileSync(
				report,
				JSON.stringify({
					testNodes: [{ nodeType: "Test Case", result: "Failed" }],
				}),
			);
			expect(run(retryPython)).toBe(1);
			writeFileSync(report, JSON.stringify({ unknownSchema: [] }));
			expect(run(retryPython)).toBe(1);
			writeFileSync(
				report,
				JSON.stringify({
					testNodes: [{ nodeType: "Unknown Execution", result: "Failed" }],
				}),
			);
			expect(run(retryPython)).toBe(1);
		});
	});

	it("preserves fresh-native plus driver-success admission, including stale PASS rejection", () => {
		expect(createHash("sha256").update(admission).digest("hex")).toBe(
			"dad86e109915c56db736274f4e076885731f0dcd2a898fd1e210a2ef63b9bc53",
		);
		withDirectory((directory) => {
			for (const fresh of [true, false]) {
				writeFileSync(
					join(directory, "positive-native.json"),
					JSON.stringify({
						mode: "positive",
						run_id: fresh ? "current" : "old",
						pass: true,
					}),
				);
				const result = spawnSync(
					"python3",
					["-c", admission, directory, "positive", "0", "current"],
					{ encoding: "utf8" },
				);
				expect(result.status).toBe(fresh ? 0 : 1);
			}
		});
	});

	it("keeps real timeout/cancel/port assertions and actual open-listener negative controls", () => {
		expect(main).toContain("elapsed >= 295 && elapsed < 330");
		expect(main).not.toMatch(TIMEOUT_OVERRIDE);
		expect(tests).toContain('mode == "timeout" ? 360 : 90');
		expect(tests).toContain("try tapSheetCancel()");
		expect(tests).toContain('springboard.buttons["Continue"]');
		expect(tests).toContain("consent.waitForExistence");
		expect(tests).toContain("for application in [app, safari, springboard]");
		expect(tests).not.toContain("addUIInterruptionMonitor");
		expect(tests).toContain("attachHierarchies()");
		expect(main).toContain("pass && outcome == .refused");
		expect(main).toContain("control.open == .open, control.closed == .refused");
		expect(probe).toContain("SO_ERROR");
	});

	it("pins XcodeGen, builds once, retains xcresults/attachments and unchanged production source", () => {
		expect(workflow).toContain('XCODEGEN_VERSION: "2.46.0"');
		expect(workflow).toContain(
			"4d9e34b62172d645eed6457cac13fc222569974098ef4ee9c3368bedf0196806",
		);
		expect(workflow).toContain("shasum -a 256 -c -");
		expect(workflow).not.toMatch(LEGACY_FRONTEND);
		expect(runner).not.toMatch(LEGACY_FRONTEND);
		expect(runner).toContain("xcodebuild build-for-testing");
		expect(runner).toContain("xcodebuild test-without-building");
		expect(runner).toContain("xcresulttool get test-results tests");
		expect(runner).toContain("xcresulttool export attachments");
		expect(runner).toContain("CallbackProof.app.zip");
		expect(project).toContain("TEST_TARGET_NAME: CallbackProof");
		expect(project).not.toContain("RadientLoopbackModule.swift");
		const transport = read(
			"../../../modules/radient-loopback/ios/LoopbackAuthSession.swift",
		);
		expect(createHash("sha256").update(transport).digest("hex")).toBe(
			"7f7235601ee08dd091299948f6f0a95acbfa17c5bd622c71863a2a36f07e445d",
		);
	});
});
