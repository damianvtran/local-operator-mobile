import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { themeProofPlan } from "./theme-proof-contract.ts";
import {
	assertDirectXCTestResult,
	directXCTestPlan,
	parseDirectEvents,
} from "./transport-xctest-contract.ts";
import {
	assertDirectTargetGraph,
	assertXCTestAttachments,
} from "./transport-xctest-host.ts";

describe("direct runner-only transport XCTest", () => {
	it("selects only the uncompleted negative row with a fresh current baseline, not another A/B matrix", () => {
		const p = directXCTestPlan(
			"/owned/project.xcodeproj",
			"owned-udid",
			"/owned/out",
			true,
		);
		expect(p.test.filter((s) => s.startsWith("-only-testing:"))).toEqual([
			"-only-testing:TransportUITests/TransportUITests/testNegativeControl",
		]);
		expect(
			p.test.filter((s) => /iterations|retry|repetition|relaunch/i.test(s)),
		).toEqual([]);
		expect(p.test[p.test.indexOf("-parallel-testing-enabled") + 1]).toBe("NO");
		expect(themeProofPlan("transport-xctest-negative")).toEqual({
			stage: "transport-xctest-negative",
			flow: null,
			budgetSeconds: 900,
			frames: ["welcome-ready", "loopback-ipv4", "negative-loopback-ipv4"],
		});
		const events = [
			{ event: "method-entered", runnerPID: 12 },
			{ event: "welcome-ready" },
			{
				event: "authority",
				authority: "loopback-ipv4",
				verdict: "password-refused",
				matching401: true,
			},
			{ event: "listener-closed" },
			{
				event: "negative",
				authority: "loopback-ipv4",
				verdict: "unreachable",
				matching401: false,
			},
		];
		expect(() => assertDirectXCTestResult(events, true)).not.toThrow();
		// Default paired mode still requires BOTH authority rows; a narrow run
		// must never become a retroactive full-pair or authentication pass.
		expect(() => assertDirectXCTestResult(events)).toThrow();
		expect(() =>
			assertDirectXCTestResult(
				events.map((e) =>
					e.event === "authority" ? { ...e, matching401: false } : e,
				),
				true,
			),
		).toThrow();
		for (let i = 0; i < events.length; i++) {
			expect(() =>
				assertDirectXCTestResult(
					events.filter((_, n) => n !== i),
					true,
				),
			).toThrow();
		}
		for (const patch of [
			{ matching401: true },
			{ verdict: "password-refused" },
			{ authority: "published-local" },
		]) {
			expect(() =>
				assertDirectXCTestResult(
					[...events.slice(0, -1), { ...events.at(-1)!, ...patch }],
					true,
				),
			).toThrow();
		}
	});
	it("builds only carrier/test targets once and selects exactly one serial method", () => {
		const p = directXCTestPlan(
			"/owned/project.xcodeproj",
			"owned-udid",
			"/owned/out",
		);
		expect(p.build.filter((x) => x === "build-for-testing")).toHaveLength(1);
		expect(p.test).toContain("test-without-building");
		expect(p.test).toContain(
			"-only-testing:TransportUITests/TransportUITests/testPairedTransport",
		);
		// Hosted42020713478 rejected -test-iterations1 before any test method.
		// Default execution is already one selected test; repetition options are
		// not a way to disable retries. Guard the real argument array, not text.
		expect(
			p.test.filter((x) => /iterations|retry|repetition|relaunch/i.test(x)),
		).toEqual([]);
		expect(p.test.filter((x) => x.startsWith("-only-testing:"))).toHaveLength(
			1,
		);
		const serial = p.test.indexOf("-parallel-testing-enabled");
		expect(serial).toBeGreaterThanOrEqual(0);
		expect(p.test[serial + 1]).toBe("NO");
		expect(p.test).not.toContain("build-for-testing");
		expect(p.build.join(" ") + p.test.join(" ")).not.toMatch(
			/workspace|Metro|Expo|LocalOperator\.xcodeproj/,
		);
	});
	it("rejects zero-tests, absent method/readiness and missing supervised negative control", () => {
		expect(() => assertDirectXCTestResult([])).toThrow();
		expect(() =>
			assertDirectXCTestResult([{ event: "method-entered" }]),
		).toThrow();
		const good = [
			{ event: "method-entered", runnerPID: 123 },
			{ event: "welcome-ready" },
			{
				event: "authority",
				authority: "loopback-ipv4",
				verdict: "password-refused",
				matching401: true,
			},
			{
				event: "authority",
				authority: "published-local",
				verdict: "timeout",
				matching401: false,
			},
			{ event: "listener-closed" },
			{
				event: "negative",
				authority: "loopback-ipv4",
				verdict: "unreachable",
				matching401: false,
			},
		];
		expect(() => assertDirectXCTestResult(good)).not.toThrow();
		expect(() => assertDirectXCTestResult(good.slice(0, -1))).toThrow();
	});
	it("carrier graph cannot acquire a product app dependency or networking", () => {
		const generator = readFileSync(
			new URL("./transport-xctest/generate.rb", import.meta.url),
			"utf8",
		);
		expect(generator).toContain("TransportCarrier");
		expect(generator).not.toMatch(
			/ios\/\*|Project\.open|pod install|expo|Metro/,
		);
		const carrier = readFileSync(
			new URL("./transport-xctest/Carrier.swift", import.meta.url),
			"utf8",
		);
		expect(carrier).not.toMatch(/URLSession|URLRequest|Network|LocalOperator/);
	});
});

// These are local harness contracts, never native transport evidence.
it("requires visible-keyboard geometry, empty field and paced exact-prefix acknowledgements before Return", () => {
	const swift = readFileSync(
		new URL("./transport-xctest/TransportUITests.swift", import.meta.url),
		"utf8",
	);
	expect(swift).not.toContain("NSStringFromCGRect");
	expect(swift).toContain("NSCoder.string(for: field.frame)");
	expect(swift).toContain("NSCoder.string(for: keyboard.frame)");
	expect(swift).not.toContain("field.typeText(url)");
	expect(swift).not.toContain("for _ in 0..<6");
	expect(swift).not.toContain("keyboard.frame.minY - app.frame.minY - 24");
	expect(swift).toContain(
		'app.scrollViews.containing(.textField, identifier: "custom-url-field")',
	);
	expect(swift).toContain("for adjustment in 0..<2");
	expect(swift).toContain("remainingClearance");
	expect(swift).toContain("Public URL");
	expect(swift).toContain("previousProgress > 1 && remainingClearance >= 0");
	const positioning = swift.slice(
		swift.indexOf("for adjustment in 0..<2"),
		swift.indexOf('inputCheckpoint("positioned-empty"'),
	);
	expect(positioning).not.toMatch(/field\.tap\(|typeText\(|setValue\(/);
	const afterClose = swift.slice(
		swift.indexOf('control("/close")'),
		swift.indexOf("let afterClose"),
	);
	expect(afterClose).toContain("try freshForm()");
	expect(afterClose).toContain('label: "negative-" + authorities[index]');
	expect(swift).toContain('"gesture-before"');
	expect(swift).toContain('"gesture-after"');
	expect(swift).toContain("start.y < visibleKeyboardTop");
	expect(swift).toContain(
		"No vertical field movement after the ONE app-content drag",
	);
	expect(swift.match(/\.press\(forDuration:/g)).toHaveLength(1);
	expect(swift).toContain("keyboard.frame.minY");
	expect(swift).toContain("field.frame.maxY");
	expect(swift).toContain("for character in url");
	expect(swift).toContain("field.typeText(String(character))");
	expect(swift).toContain("acknowledged exact prefix");
	expect(swift).toContain("Fresh URL field must be empty");
	expect(swift).toContain('"before-return"');
	expect(swift).toContain('"after-return-immediate"');
	expect(swift).toContain('"after-return-settled"');
	expect(swift).not.toMatch(/UIPasteboard|pbcopy|setValue\(/);
});

describe("direct-only stage isolation", () => {
	it("shares the900s budget but never calls Maestro warm/app flows", () => {
		expect(themeProofPlan("transport-xctest").budgetSeconds).toBe(900);
		const source = readFileSync(
			new URL("./theme-ios-proof.ts", import.meta.url),
			"utf8",
		);
		const setup = source.indexOf('} else if (plan.stage === "setup")');
		const start = source.lastIndexOf("if (directXCTest)", setup);
		const body = source.slice(start, setup);
		expect(body).toContain("directTransportTest");
		expect(body).not.toMatch(/warmDriver|flowRun|maestro/);
		const workflow = readFileSync(
			new URL("../../.github/workflows/e2e.yml", import.meta.url),
			"utf8",
		);
		expect(workflow).toContain(
			"if: inputs.proof_stage != 'transport-xctest' && inputs.proof_stage != 'transport-xctest-negative'",
		);
	});
	it("retains only safe event fields, never raw URI/error/credentials", () => {
		const rows = parseDirectEvents(
			"XCT_TRANSPORT " +
				JSON.stringify({
					event: "method-entered",
					runnerPID: 123,
					raw: "http://fixture.local:1234",
					authorization: "secret",
					error: "body",
				}),
		);
		expect(rows).toEqual([{ event: "method-entered", runnerPID: 123 }]);
		expect(
			parseDirectEvents(
				"XCT_TRANSPORT " + JSON.stringify({ event: "other", runnerPID: 123 }),
			),
		).toEqual([]);
	});
});

it("rejects a product dependency or substituted target before the single build", () => {
	expect(() =>
		assertDirectTargetGraph([{ name: "LocalOperator", dependencies: [] }]),
	).toThrow();
	expect(() => assertDirectTargetGraph([])).toThrow();
	expect(() =>
		assertXCTestAttachments("/nonexistent-owned-proof-attachment-root"),
	).toThrow();
});
