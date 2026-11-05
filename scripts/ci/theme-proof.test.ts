import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
	assertDiagnosticSimulator,
	assertDiagnosticTrace,
	assertDriverReady,
	collectThemeFrames,
	copyThemeFrames,
	createThemeDriverWarmer,
	isDriverBootstrapFailure,
	PROOF_THEMES,
	sanitizeBootstrapLog,
	THEME_FRAMES,
	themeProofPlan,
	warmThemeDriver,
} from "./theme-proof-contract.ts";

/** The flow and the runner's inventory are two files; this keeps them one list.
 *  A capture the flow takes but the inventory omits would ship unchecked, and
 *  one the inventory names but the flow never takes would fail every run. */
describe("minimal native saved-route diagnostic allocation", () => {
	it("warms once in the same owned simulator and never borrows another VM's readiness", async () => {
		const commands: string[] = [];
		const warm = createThemeDriverWarmer(async (name, _cmd, args) => {
			commands.push(`${name}:${args.join(" ")}`);
			return name === "warm-maestro-driver" ? "welcome-screen" : "";
		});
		await warm("owned-A", "com.localoperator.mobile");
		await warm("owned-A", "com.localoperator.mobile");
		expect(commands).toHaveLength(2);
		await warm("owned-B", "com.localoperator.mobile");
		expect(commands).toHaveLength(4);
		expect(commands[3]).toContain("owned-B");
	});

	it("does not silently retry a failed bootstrap for the same owned simulator", async () => {
		let attempts = 0;
		const warm = createThemeDriverWarmer(async (name) => {
			if (name === "warm-maestro-driver") {
				attempts++;
				throw new Error("IOSDriverTimeoutException");
			}
			return "";
		});
		await expect(warm("owned-A", "com.localoperator.mobile")).rejects.toThrow(
			"IOSDriverTimeoutException",
		);
		await expect(warm("owned-A", "com.localoperator.mobile")).rejects.toThrow(
			"IOSDriverTimeoutException",
		);
		expect(attempts).toBe(1);
	});
	it("setup never starts relay/app flow and bootstrap failure never retries hierarchy", () => {
		const runner = readFileSync(
			new URL("./theme-ios-proof.ts", import.meta.url),
			"utf8",
		);
		const start = runner.indexOf('if (plan.stage === "setup")');
		const setup = runner.slice(start, runner.indexOf("} else {", start));
		const shared = runner.indexOf(
			"const warmDriver = createThemeDriverWarmer(run);",
		);
		const warmBlock = runner.slice(shared, start);
		expect(warmBlock).toContain('if (plan.stage !== "full")');
		expect(warmBlock).toMatch(/await warmDriver\(\s*udid,/);
		expect(shared).toBeLessThan(
			runner.indexOf('const relay = await startRelay("en")'),
		);
		expect(warmBlock).not.toContain("flowRun(");
		expect(runner.match(/createThemeDriverWarmer\(run\)/g)).toHaveLength(1);
		expect(setup).not.toMatch(/startRelay|flowRun|session-row/);
		expect(runner).toContain(
			"captureFailure(label, isDriverBootstrapFailure(String(error)))",
		);
		const failure = runner.slice(
			runner.indexOf("async function captureFailure("),
			runner.indexOf("async function flowRun("),
		);
		expect(failure.indexOf("if (driverUnavailable)")).toBeLessThan(
			failure.indexOf("`failure-hierarchy-${label}`"),
		);
		expect(failure).toMatch(/if \(driverUnavailable\) \{[\s\S]*return;/);
	});

	it("uses the actual launch/hierarchy sequence and fails once before any app flow", async () => {
		const calls: { name: string; args: string[]; cap: number }[] = [];
		const run = async (
			name: string,
			_command: string,
			args: string[],
			cap: number,
		) => {
			calls.push({ name, args, cap });
			return name === "warm-maestro-driver" ? "welcome-screen" : "";
		};
		await warmThemeDriver(run, "owned-udid", "com.localoperator.mobile");
		expect(calls.map((c) => c.name)).toEqual([
			"warm-launch-app",
			"warm-maestro-driver",
		]);
		expect(calls[1].args).toEqual([
			"--verbose",
			"--device",
			"owned-udid",
			"hierarchy",
		]);
		expect(calls[1].cap).toBe(420);
		let attempts = 0;
		await expect(
			warmThemeDriver(
				async (name) => {
					if (name === "warm-maestro-driver") {
						attempts++;
						throw new Error("IOSDriverTimeoutException");
					}
					return "";
				},
				"owned-udid",
				"com.localoperator.mobile",
			),
		).rejects.toThrow("IOSDriverTimeoutException");
		expect(attempts).toBe(1);
	});
	it("classifies the actual installer exception, not an app assertion, and sanitizes verbose startup output", () => {
		expect(
			isDriverBootstrapFailure(
				"xcuitest.installer.LocalXCTestInstaller$IOSDriverTimeoutException",
			),
		).toBe(true);
		expect(
			isDriverBootstrapFailure("session-row-6714def86197 was not visible"),
		).toBe(false);
		const safe = sanitizeBootstrapLog(
			"IOSDriverTimeoutException http://127.0.0.1:7001/status\nAuthorization: Bearer secret\nCookie: lop_mobile=secret",
		);
		expect(safe).toContain("IOSDriverTimeoutException");
		expect(safe).not.toMatch(/secret|127\.0\.0\.1|lop_mobile/);
	});

	it("has a setup-only cold-driver gate, not an app flow or guessed sleep", () => {
		const plan = themeProofPlan("setup");
		expect(plan.flow).toBeNull();
		expect(plan.budgetSeconds).toBe(900);
		expect(plan.frames).toEqual(["setup-ready"]);
		expect(() => assertDriverReady("SpringBoard maestrodriver")).toThrow(
			"drawn app screen",
		);
		expect(() => assertDriverReady("welcome-screen")).not.toThrow();
		expect(() => assertDriverReady("home-screen")).not.toThrow();
	});

	it("wires the stage through workflow, runtime limit and driver instead of dispatching full proof", () => {
		const runner = readFileSync(
			new URL("./theme-ios-proof.ts", import.meta.url),
			"utf8",
		);
		const workflow = readFileSync(
			new URL("../../.github/workflows/e2e.yml", import.meta.url),
			"utf8",
		);
		expect(runner).toContain('themeProofPlan(env.PROOF_STAGE ?? "full")');
		expect(runner).toContain("const BUDGET_SECONDS = plan.budgetSeconds");
		expect(runner).toContain("assertDiagnosticSimulator(runtime, deviceType)");
		expect(runner).toContain("assertDiagnosticTrace(events)");
		expect(runner).toContain("plan.flow,");
		const job = workflow.slice(
			workflow.indexOf("\n  theme-ios-proof:"),
			workflow.indexOf("\n  u08-geometry-proof:"),
		);
		expect(job).toContain("PROOF_STAGE: ${{ inputs.proof_stage || 'full' }}");
		expect(workflow).toContain('case "$PROOF_STAGE" in full|diagnostic|setup)');
	});

	it("is one bounded short flow and never the twelve-theme matrix", () => {
		const plan = themeProofPlan("diagnostic");
		expect(plan.budgetSeconds).toBe(900);
		expect(plan.flow).toBe("saved-route-diagnostic.yaml");
		const flow = readFileSync(
			new URL(
				"../../e2e/maestro/theme-proof/saved-route-diagnostic.yaml",
				import.meta.url,
			),
			"utf8",
		);
		expect(
			[...flow.matchAll(/^- takeScreenshot: (\S+)$/gm)].map((m) => m[1]),
		).toEqual(plan.frames);
		expect(flow).toContain('id: "session-row-6714def86197"');
		expect(flow).not.toMatch(/theme-card|theme-picker/);
		expect(themeProofPlan().frames).toEqual(THEME_FRAMES);
		expect(themeProofPlan().budgetSeconds).toBe(2700);
		expect(themeProofPlan("setup").budgetSeconds).toBe(900);
		expect(() => themeProofPlan("unknown")).toThrow();
	});
	it("refuses other hardware/runtime and a successful row without safe provider trace", () => {
		expect(() =>
			assertDiagnosticSimulator(
				"com.apple.CoreSimulator.SimRuntime.iOS-26-5",
				"com.apple.CoreSimulator.SimDeviceType.iPhone-17",
			),
		).not.toThrow();
		expect(() =>
			assertDiagnosticSimulator(
				"iOS-18-0",
				"com.apple.CoreSimulator.SimDeviceType.iPhone-17",
			),
		).toThrow();
		expect(() =>
			assertDiagnosticSimulator(
				"iOS-26-5",
				"com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro",
			),
		).toThrow();
		expect(() => assertDiagnosticTrace([])).toThrow("missing safe");
		expect(() =>
			assertDiagnosticTrace([{ event: "stage", stage: "save.begin" }]),
		).toThrow("peer-list200");
		expect(() =>
			assertDiagnosticTrace([
				{ event: "stage", stage: "save.begin" },
				{ event: "response", requestClass: "peer-list", status: 200 },
				{ event: "stage", stage: "cold-list.applied" },
			]),
		).not.toThrow();
	});
});

describe("the theme proof's frame inventory", () => {
	it("preserves screenshots in the flow finally path and sanitizes native logs before writing", () => {
		const runner = readFileSync(
			new URL("./theme-ios-proof.ts", import.meta.url),
			"utf8",
		);
		const flowRun = runner.slice(
			runner.indexOf("async function flowRun("),
			runner.indexOf("try {\n\t// Source and archive"),
		);
		expect(flowRun).toMatch(/finally\s*\{[\s\S]*copyThemeFrames/);
		expect(flowRun).toMatch(/"log",\s*"stream",\s*"--level",\s*"info"/);
		expect(flowRun).toContain(
			"parseSavedRouteDiagnostics(pending.slice(0, end))",
		);
		expect(flowRun).toContain("JSON.stringify(events, null, 2)");
	});

	it("salvages completed screenshots after failure without admitting an incomplete matrix", () => {
		const root = mkdtempSync(join(tmpdir(), "theme-partial-"));
		const source = join(root, "maestro");
		const destination = join(root, "frames");
		const shots = join(source, "failed-flow", "takeScreenshot");
		mkdirSync(shots, { recursive: true });
		writeFileSync(
			join(shots, "picker-mode-system.png"),
			"captured-before-failure",
		);
		expect(copyThemeFrames(source, destination)).toEqual([
			"picker-mode-system.png",
		]);
		expect(existsSync(join(destination, "picker-mode-system.png"))).toBe(true);
		expect(
			readFileSync(join(destination, "picker-mode-system.png"), "utf8"),
		).toBe("captured-before-failure");
		// Presence of useful partial evidence must never turn missing acceptance
		// frames into a successful proof.
		expect(() => collectThemeFrames(source, destination)).toThrow(
			"missing picker-mode-light.png",
		);
	});

	const flow = readFileSync(
		new URL("../../e2e/maestro/theme-proof/theme-matrix.yaml", import.meta.url),
		"utf8",
	);
	const shots = [...flow.matchAll(/^- takeScreenshot: (\S+)$/gm)].map(
		(m) => m[1],
	);

	it("covers the restored four and all three changed light-palette neighbors", () => {
		expect(PROOF_THEMES).toHaveLength(12);
		for (const theme of [
			"catppuccinMocha",
			"tokyoNightStorm",
			"duskfox",
			"outrun",
			"localOperatorLight",
			"rosePineDawn",
			"everforestLight",
		])
			expect(PROOF_THEMES).toContain(theme);
	});

	it("cold-relaunches without clearing storage and reads selection before any card tap", () => {
		const restart = flow.slice(flow.indexOf("- stopApp"));
		expect(restart).toContain("clearState: false");
		expect(restart).not.toContain("clearState: true");
		expect(restart).toContain(
			'id: "theme-card-everforestLight"\n      selected: true',
		);
		expect(restart).toContain(
			'id: "theme-picker-mode-light"\n      selected: true',
		);
		expect(restart).not.toMatch(/- tapOn:\s+id: "theme-(card|picker-mode)-/);
		expect(THEME_FRAMES).toContain("home-persisted-everforestLight");
		expect(THEME_FRAMES).toContain("picker-persisted-everforestLight");
	});

	it("captures exactly the frames the runner requires, in order", () => {
		expect(shots).toEqual(THEME_FRAMES);
	});

	it("applies every proof theme through its own picker card", () => {
		for (const theme of PROOF_THEMES) {
			expect(flow).toContain(`id: "theme-card-${theme}"\n      selected: true`);
		}
	});
});
