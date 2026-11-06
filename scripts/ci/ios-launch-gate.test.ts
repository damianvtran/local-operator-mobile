import { execFileSync, spawn } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import {
	appJobs,
	crashReportsSince,
	describeStatus,
	FATAL_SIGNATURES,
	fatalLines,
	frameDelta,
	isAppJobLabel,
	judgeLiveness,
	parseIps,
	summarizeCrashReport,
} from "./ios-launch-gate.ts";

/**
 * The iOS launch gate's judgements, driven with the shapes the simulator and
 * the host's crash reporter produce, so a parser that drifts fails here rather
 * than as a gate that passes a crashed app (builds 419/446/449) or fails a
 * working one.
 *
 * EVERY FIXTURE IS SYNTHETIC, with synthetic identifiers. The `launchctl list`
 * rows follow launchctl(1) (PID, last exit status, label); the `.ips` report
 * follows Apple's "Interpreting the JSON format of a crash report" (metadata on
 * the first line, the report after it). None is a captured artefact, and the
 * values in them are not measurements.
 *
 * `os.tmpdir()`, not the repository, for the files: throwaway fixtures must not
 * show up in a reviewer's `git status`.
 */

const BUNDLE = "com.example.launchgate";
const EXECUTABLE = "LaunchGate";
const SCRIPT = fileURLToPath(new URL("./ios-launch-gate.ts", import.meta.url));
const root = mkdtempSync(join(tmpdir(), `ios-launch-gate-${process.pid}-`));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const listing = (...rows: string[]) =>
	["PID\tStatus\tLabel", "-\t0\tcom.apple.example.daemon", ...rows].join("\n");
const RUNNING = listing(
	`812\t0\tUIKitApplication:com.apple.springboard.other[1f2e][rb-legacy]`,
	`41022\t0\tUIKitApplication:${BUNDLE}[3c1a][rb-legacy]`,
);
const EXITED = listing(`-\t-6\tUIKitApplication:${BUNDLE}[3c1a][rb-legacy]`);
const GONE = listing(
	`812\t0\tUIKitApplication:com.apple.Preferences[1f2e][rb-legacy]`,
);

describe("which launchd job is the app's", () => {
	it.each([
		`UIKitApplication:${BUNDLE}[3c1a][rb-legacy]`,
		`com.apple.UIKitApplication:${BUNDLE}[3c1a][rb-legacy]`,
		`UIKitApplication:${BUNDLE}`,
	])("matches %s", (label) => {
		expect(isAppJobLabel(label, BUNDLE)).toBe(true);
	});

	it.each([
		// Another bundle that merely STARTS with the app's id.
		`UIKitApplication:${BUNDLE}.widget[3c1a][rb-legacy]`,
		`UIKitApplication:${BUNDLE}extra[3c1a][rb-legacy]`,
		// The dots in the id are literal, not "any character".
		"UIKitApplication:comXexampleXlaunchgate[3c1a][rb-legacy]",
		`NotUIKitApplication:${BUNDLE}[3c1a]`,
		BUNDLE,
	])("does not match %s", (label) => {
		expect(isAppJobLabel(label, BUNDLE)).toBe(false);
	});

	it("reads the pid only when the column holds one", () => {
		expect(appJobs(RUNNING, BUNDLE)).toEqual([
			{
				pid: 41022,
				status: "0",
				label: `UIKitApplication:${BUNDLE}[3c1a][rb-legacy]`,
			},
		]);
		expect(appJobs(EXITED, BUNDLE)).toEqual([
			{
				pid: null,
				status: "-6",
				label: `UIKitApplication:${BUNDLE}[3c1a][rb-legacy]`,
			},
		]);
		expect(appJobs(GONE, BUNDLE)).toEqual([]);
	});
});

describe("the exit status column", () => {
	it.each([
		["-6", "stopped by signal 6 (SIGABRT)"],
		["-11", "stopped by signal 11 (SIGSEGV)"],
		["-9", "stopped by signal 9 (SIGKILL)"],
		["-99", "stopped by signal 99"],
		["0", "last exit status 0"],
		["1", "last exit status 1"],
		["-", "no exit status recorded"],
	])("%s reads as %s", (status, words) => {
		expect(describeStatus(status)).toBe(words);
	});
});

describe("is the app running", () => {
	it("is alive only with a job that has a pid, and says which", () => {
		const verdict = judgeLiveness(
			RUNNING,
			BUNDLE,
			"t+5s",
			" (5 s after launch)",
		);
		expect(verdict.alive).toBe(true);
		expect(verdict.lines).toEqual([
			`alive at t+5s (5 s after launch): ${BUNDLE} is running as pid 41022 (launchd job UIKitApplication:${BUNDLE}[3c1a][rb-legacy])`,
		]);
	});

	it("fails an exited job, naming the bundle and the signal that stopped it", () => {
		const verdict = judgeLiveness(EXITED, BUNDLE, "t+7s");
		expect(verdict.alive).toBe(false);
		expect(verdict.lines[0]).toMatch(
			new RegExp(
				`^::error::${BUNDLE.replaceAll(".", "\\.")} is not running at t\\+7s: `,
			),
		);
		expect(verdict.lines[1]).toContain(
			"no process, stopped by signal 6 (SIGABRT)",
		);
	});

	it("fails a missing job and prints the app jobs it saw instead", () => {
		const verdict = judgeLiveness(GONE, BUNDLE, "t+30s");
		expect(verdict.alive).toBe(false);
		expect(verdict.lines.join("\n")).toContain(
			`the UIKitApplication: jobs it does list (none is ${BUNDLE}):\n    812\t0\tUIKitApplication:com.apple.Preferences[1f2e][rb-legacy]`,
		);
	});

	it("is not fooled by a running job of a bundle that shares the prefix", () => {
		const widget = listing(
			`5150\t0\tUIKitApplication:${BUNDLE}.widget[3c1a][rb-legacy]`,
		);
		expect(judgeLiveness(widget, BUNDLE, "t+5s").alive).toBe(false);
	});

	it("says so when the listing has no app job at all", () => {
		const verdict = judgeLiveness("PID\tStatus\tLabel\n", BUNDLE, "t+5s");
		expect(verdict.alive).toBe(false);
		expect(verdict.lines).toContain(
			"  it lists no UIKitApplication: job at all",
		);
	});
});

const header = (overrides: Record<string, unknown> = {}) =>
	JSON.stringify({
		app_name: EXECUTABLE,
		timestamp: "2026-11-06 04:55:01.00 +0000",
		app_version: "1.0.0",
		build_version: "449",
		bundleID: BUNDLE,
		bug_type: "309",
		platform: 7,
		name: EXECUTABLE,
		incident_id: "00000000-0000-4000-8000-000000000000",
		...overrides,
	});

const CRASH_BODY = {
	procName: EXECUTABLE,
	pid: 41022,
	exception: {
		codes: "0x0000000000000000, 0x0000000000000000",
		type: "EXC_CRASH",
		signal: "SIGABRT",
	},
	termination: {
		flags: 0,
		code: 6,
		namespace: "SIGNAL",
		indicator: "Abort trap: 6",
		byProc: EXECUTABLE,
		byPid: 41022,
	},
	asi: {
		"libsystem_c.dylib": ["abort() called"],
		"libc++abi.dylib": [
			"terminating due to uncaught exception of type facebook::jsi::JSError: [Worklets] Tried to synchronously call a Remote Function.",
		],
	},
	faultingThread: 1,
	threads: [
		{
			id: 1,
			queue: "com.apple.main-thread",
			frames: [{ imageIndex: 0, imageOffset: 4096 }],
		},
		{
			id: 2,
			triggered: true,
			name: "com.example.ui-runtime",
			frames: [
				{
					imageIndex: 0,
					imageOffset: 37480,
					symbol: "__pthread_kill",
					symbolLocation: 8,
				},
				{
					imageIndex: 1,
					imageOffset: 25000,
					symbol: "pthread_kill",
					symbolLocation: 264,
				},
				{
					imageIndex: 2,
					imageOffset: 50000,
					symbol: "abort",
					symbolLocation: 120,
				},
				{
					imageIndex: 3,
					imageOffset: 60000,
					symbol: "std::__terminate(void (*)())",
					symbolLocation: 12,
				},
				{ imageIndex: 4, imageOffset: 1193046 },
			],
		},
	],
	usedImages: [
		{ name: "libsystem_kernel.dylib" },
		{ name: "libsystem_pthread.dylib" },
		{ name: "libsystem_c.dylib" },
		{ name: "libc++abi.dylib" },
		{ name: EXECUTABLE },
	],
};
const CRASH = `${header()}\n${JSON.stringify(CRASH_BODY, null, 2)}`;
const FRAME_ZERO = / {4}0 {3}libsystem_kernel\.dylib +__pthread_kill \+ 8/;
const FRAME_THREE =
	/ {4}3 {3}libc\+\+abi\.dylib +std::__terminate\(void \(\*\)\(\)\) \+ 12/;
const LAST_EXCEPTION =
	/ {2}last exception backtrace, top 12 frames:\n {4}0 {3}libsystem_c\.dylib +objc_exception_throw \+ 60/;

describe("what a crash report says", () => {
	it("splits the metadata line from the report", () => {
		const { header: meta, body } = parseIps(CRASH);
		expect(meta?.bug_type).toBe("309");
		expect(body?.procName).toBe(EXECUTABLE);
	});

	it("prints the exception, termination, abort message and crashed thread", () => {
		const summary = summarizeCrashReport(CRASH, 4).join("\n");
		expect(summary).toContain("  report type: bug_type 309 (crash)");
		expect(summary).toContain(
			`  process: ${EXECUTABLE} [41022], ${BUNDLE} 1.0.0 (449)`,
		);
		expect(summary).toContain("  exception: EXC_CRASH (SIGABRT)");
		expect(summary).toContain(
			`  termination: SIGNAL 6 Abort trap: 6 (by ${EXECUTABLE}[41022])`,
		);
		expect(summary).toContain(
			"    libc++abi.dylib: terminating due to uncaught exception of type facebook::jsi::JSError: [Worklets] Tried to synchronously call a Remote Function.",
		);
		expect(summary).toContain(
			"  crashed thread 1 (name com.example.ui-runtime), top 4 frames:",
		);
		expect(summary).toMatch(FRAME_ZERO);
		expect(summary).toMatch(FRAME_THREE);
		// The frame limit holds: the fifth frame is not printed.
		expect(summary).not.toContain("0x123456");
	});

	it("prints an unsymbolicated frame by its offset in the image", () => {
		expect(summarizeCrashReport(CRASH).join("\n")).toMatch(
			new RegExp(` {4}4 {3}${EXECUTABLE} +\\+ 0x123456`),
		);
	});

	it("finds the crashed thread by its flag when the index is absent", () => {
		const { faultingThread: _dropped, ...rest } = CRASH_BODY;
		const report = `${header()}\n${JSON.stringify(rest)}`;
		expect(summarizeCrashReport(report).join("\n")).toContain(
			"  crashed thread 1 (name",
		);
	});

	it("prints the last exception backtrace when the runtime recorded one", () => {
		const report = `${header()}\n${JSON.stringify({
			...CRASH_BODY,
			lastExceptionBacktrace: [
				{
					imageIndex: 2,
					imageOffset: 1,
					symbol: "objc_exception_throw",
					symbolLocation: 60,
				},
			],
		})}`;
		expect(summarizeCrashReport(report).join("\n")).toMatch(LAST_EXCEPTION);
	});

	it("prints the raw head of a report it cannot read rather than dropping it", () => {
		expect(
			summarizeCrashReport("Incident Identifier: X\nCrashed Thread: 0")[1],
		).toBe("    Incident Identifier: X");
		expect(summarizeCrashReport(`${header()}\nnot json`).join("\n")).toContain(
			"the report body is not JSON",
		);
	});
});

describe("which crash reports are the app's, written after launch", () => {
	const dir = join(root, "DiagnosticReports");
	mkdirSync(dir, { recursive: true });
	const sinceMs = Date.now() - 60_000;
	const write = (name: string, contents: string, mtimeMs = Date.now()) => {
		writeFileSync(join(dir, name), contents);
		utimesSync(join(dir, name), mtimeMs / 1000, mtimeMs / 1000);
	};
	write(`${EXECUTABLE}-2026-11-06-045501.ips`, CRASH);
	write(`${EXECUTABLE}-2026-11-06-040000.ips`, CRASH, sinceMs - 120_000);
	write(
		`${EXECUTABLE}-Helper-2026-11-06-045501.ips`,
		`${header({ name: `${EXECUTABLE}-Helper`, app_name: `${EXECUTABLE}-Helper`, bundleID: `${BUNDLE}.helper` })}\n{}`,
	);
	write(
		"SpringBoard-2026-11-06-045501.ips",
		`${header({ name: "SpringBoard" })}\n{}`,
	);
	write(`${EXECUTABLE}-2026-11-06-045502.ips`, "garbled metadata\n{}");
	write(`${EXECUTABLE}-2026-11-06-045503.crash`, CRASH);

	it("keeps this app's reports since launch, and an unreadable one", () => {
		expect(crashReportsSince(dir, EXECUTABLE, sinceMs, BUNDLE)).toEqual([
			join(dir, `${EXECUTABLE}-2026-11-06-045501.ips`),
			join(dir, `${EXECUTABLE}-2026-11-06-045502.ips`),
		]);
	});

	it("treats a missing directory as no reports", () => {
		expect(
			crashReportsSince(join(root, "absent"), EXECUTABLE, sinceMs),
		).toEqual([]);
	});
});

describe("fatal signatures in the app's own output", () => {
	it.each([
		"2026-11-06 04:55:01.123 E  LaunchGate[41022:1a2b] libc++abi: terminating due to uncaught exception of type facebook::jsi::JSError: [Worklets] Tried to synchronously call a Remote Function.",
		"*** Terminating app due to uncaught exception 'NSInvalidArgumentException', reason: 'x'",
		"[com.facebook.react.log:javascript] Unhandled JS Exception: TypeError: undefined is not a function",
		"RCTFatal",
		"Exception Type: EXC_CRASH (SIGABRT)",
	])("catches %s", (line) => {
		expect(fatalLines(`ordinary line\n${line}\nanother`)).toEqual([line]);
	});

	it.each([
		// The worklets logger prefixes informational lines too.
		"[Worklets] Bundle mode initialization: Downloaded the bundle for Worklet Runtimes.",
		"[Worklets] Mismatch between JavaScript part and native part of Worklets (0.10.4 vs 0.10.3).",
		"Running application main",
		"NOSIGABRTX",
	])("leaves %s alone", (line) => {
		expect(fatalLines(line)).toEqual([]);
	});

	it("names what each signature means", () => {
		for (const { what } of FATAL_SIGNATURES) expect(what).not.toBe("");
	});
});

describe("the frame delta", () => {
	it("counts differing bytes over the larger frame, length difference included", () => {
		expect(
			frameDelta(Uint8Array.of(1, 2, 3, 4), Uint8Array.of(1, 2, 3, 4)),
		).toEqual({
			differing: 0,
			total: 4,
			percent: 0,
		});
		expect(
			frameDelta(Uint8Array.of(1, 2, 3, 4), Uint8Array.of(1, 9, 3, 4)).percent,
		).toBe(25);
		expect(frameDelta(Uint8Array.of(1, 2), Uint8Array.of(1, 2, 3, 4))).toEqual({
			differing: 2,
			total: 4,
			percent: 50,
		});
		expect(frameDelta(new Uint8Array(0), new Uint8Array(0)).percent).toBe(0);
	});
});

/** The CLI wiring is where a gate fails silently — a usage path that exits 0,
 * a verdict printed but not returned — so it is exercised as a subprocess. */
describe("CLI", () => {
	const run = (
		args: string[],
	): { status: number; stdout: string; stderr: string } => {
		try {
			const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			});
			return { status: 0, stdout, stderr: "" };
		} catch (error) {
			const failed = error as {
				status?: number;
				stdout?: string;
				stderr?: string;
			};
			return {
				status: failed.status ?? -1,
				stdout: failed.stdout ?? "",
				stderr: failed.stderr ?? "",
			};
		}
	};
	const file = (name: string, contents: string | Uint8Array) => {
		const path = join(root, name);
		writeFileSync(path, contents);
		return path;
	};

	it("alive: exit 0 and the pid when running, exit 1 naming the bundle when not", () => {
		const up = run([
			"alive",
			"--launchctl-file",
			file("up.txt", RUNNING),
			"--bundle",
			BUNDLE,
			"--at",
			"t+30s",
		]);
		expect(up.status).toBe(0);
		expect(up.stdout).toContain(
			`alive at t+30s: ${BUNDLE} is running as pid 41022`,
		);

		const down = run([
			"alive",
			"--launchctl-file",
			file("down.txt", EXITED),
			"--bundle",
			BUNDLE,
			"--at",
			"t+5s",
		]);
		expect(down.status).toBe(1);
		expect(down.stderr).toContain(`::error::${BUNDLE} is not running at t+5s`);
	});

	it("alive: refuses to judge with no listing to read", () => {
		const result = run(["alive", "--bundle", BUNDLE, "--at", "t+5s"]);
		expect(result.status).toBe(2);
		expect(result.stderr).toContain("alive needs --udid or --launchctl-file");
	});

	it("crash-report: exit 1 with the stack when the app crashed, exit 0 when not", () => {
		const dir = join(root, "cli-reports");
		mkdirSync(dir, { recursive: true });
		const since = String(Math.floor(Date.now() / 1000) - 5);
		const clean = run([
			"crash-report",
			"--dir",
			dir,
			"--executable",
			EXECUTABLE,
			"--since",
			since,
		]);
		expect(clean.status).toBe(0);
		expect(clean.stdout).toContain(
			`no crash report for ${EXECUTABLE} written since launch`,
		);

		writeFileSync(join(dir, `${EXECUTABLE}-2026-11-06-045501.ips`), CRASH);
		const crashed = run([
			"crash-report",
			"--dir",
			dir,
			"--executable",
			EXECUTABLE,
			"--bundle",
			BUNDLE,
			"--since",
			since,
		]);
		expect(crashed.status).toBe(1);
		expect(crashed.stderr).toContain(
			`::error::${EXECUTABLE} (${BUNDLE}) crashed after launch: EXC_CRASH (SIGABRT) — crash report ${dir}/`,
		);
		expect(crashed.stderr).toContain(
			"  crashed thread 1 (name com.example.ui-runtime), top 12 frames:",
		);
	});

	it("crash-report: --wait polls until a report the crash reporter writes late lands", async () => {
		const dir = join(root, "late-reports");
		mkdirSync(dir, { recursive: true });
		const since = String(Math.floor(Date.now() / 1000) - 5);
		const child = spawn(process.execPath, [
			SCRIPT,
			"crash-report",
			"--dir",
			dir,
			"--executable",
			EXECUTABLE,
			"--since",
			since,
			"--wait",
			"20",
		]);
		let stderr = "";
		child.stderr.on("data", (chunk) => {
			stderr += String(chunk);
		});
		const exited = new Promise<number | null>((resolve) =>
			child.on("close", resolve),
		);
		await new Promise((resolve) => setTimeout(resolve, 1500));
		writeFileSync(join(dir, `${EXECUTABLE}-2026-11-06-045509.ips`), CRASH);
		expect(await exited).toBe(1);
		expect(stderr).toContain("crashed after launch: EXC_CRASH (SIGABRT)");
	}, 30_000);

	it("crash-report: refuses a --since that is not epoch seconds", () => {
		const result = run([
			"crash-report",
			"--dir",
			root,
			"--executable",
			EXECUTABLE,
			"--since",
			"today",
		]);
		expect(result.status).toBe(2);
	});

	it("fatal-lines: exit 1 on a fatal or an unreadable source, exit 0 on clean output", () => {
		const clean = file("clean.log", "Running application main\n");
		const fatal = file(
			"fatal.log",
			"libc++abi: terminating due to uncaught exception of type facebook::jsi::JSError: [Worklets] x\n",
		);
		expect(run(["fatal-lines", clean]).status).toBe(0);
		const caught = run(["fatal-lines", clean, fatal]);
		expect(caught.status).toBe(1);
		expect(caught.stderr).toContain(
			"::error::the app's own output carries a fatal",
		);
		expect(caught.stderr).toContain(
			"  libc++abi: terminating due to uncaught exception",
		);
		const missing = run(["fatal-lines", join(root, "never-written.log")]);
		expect(missing.status).toBe(1);
		expect(missing.stderr).toContain("does not exist, so it cannot be scanned");
	});

	it("frame-delta: one machine-readable line", () => {
		const a = file("a.bmp", Uint8Array.of(1, 2, 3, 4));
		const b = file("b.bmp", Uint8Array.of(1, 9, 3, 4));
		expect(run(["frame-delta", a, b])).toEqual({
			status: 0,
			stdout: "1 4 25.00\n",
			stderr: "",
		});
	});

	it("refuses an unknown command", () => {
		expect(run(["judge-everything"]).status).toBe(2);
	});
});
