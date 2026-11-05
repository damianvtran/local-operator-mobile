/**
 * The runner failure record is a path out of a runner that holds a private
 * environment (loopback control URL and port, session id, bearer). After three
 * redactor rounds each found a new leak (23-25), it carries NO runner text: a
 * closed error-class enum, an allowlisted test name, counts and a sha256. These
 * tests pin that closure, the classification, and the capture guarantees the
 * record depends on (blocking merged pipe, bounded drain, killed runners).
 */
import { createHash, randomBytes } from "node:crypto";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Deadline, ReplayRefused } from "./retirement-replay-core.ts";
import { safeSummary } from "./retirement-replay-evidence.ts";
import { NativeScope, TAIL_DRAIN_MS } from "./retirement-replay-native.ts";
import {
	ALLOWED_TESTS,
	classifyRunnerFailure,
	ERROR_CLASSES,
	MAX_FAILURE_COUNT,
	RING_BYTES,
	type RunnerFailure,
	safeRunnerFailure,
	TailRing,
} from "./retirement-replay-runner-tail.ts";
import { launchRunner } from "./retirement-ui-replay.ts";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});
function privateValues() {
	return {
		bearer: randomBytes(32).toString("hex"),
		session: randomBytes(24).toString("hex"),
		control: `http://127.0.0.1:${40000 + (randomBytes(2).readUInt16BE() % 20000)}/rpc`,
	};
}
const sha = (text: string) =>
	createHash("sha256").update(Buffer.from(text)).digest("hex");
const TEST = ALLOWED_TESTS[0];
const TEST_LINE = `Test Case '-[RetirementSystemAlert.RetainedReplayTests testSingleSeedReplay]' failed (241.302 seconds).`;

describe("classifyRunnerFailure: closed classes from known messages", () => {
	const cases: [string, string][] = [
		[
			"destination_unavailable",
			"xcodebuild: error: Unable to find a destination matching the provided destination specifier:\n\t\t{ platform:iOS Simulator, id:1111 }",
		],
		[
			"destination_unavailable",
			"xcodebuild: error: Failed to prepare device for impending launch.",
		],
		[
			"xctestrun_invalid",
			"xcodebuild: error: The file couldn’t be opened because it isn’t in the correct format.",
		],
		[
			"test_bundle_load_failed",
			"Testing failed:\n\tRetirementSystemAlert-Runner (1234) encountered an error (Early unexpected exit, operation never finished bootstrapping - no restart will be attempted.",
		],
		[
			"test_bundle_load_failed",
			"The bundle “RetirementSystemAlert” couldn’t be loaded because it is damaged or missing necessary resources.",
		],
		[
			"launch_timeout",
			"Testing failed:\n\tTimed out waiting for automation session",
		],
		["test_failed", `${TEST_LINE}\n** TEST EXECUTE FAILED **`],
		["unknown", "something nobody has seen before\nexit"],
	];
	it.each(cases)("%s", (errorClass, text) => {
		expect(
			classifyRunnerFailure(65, "launch", Buffer.from(text))?.errorClass,
		).toBe(errorClass);
	});
	it.each([
		[
			"R26-1: the real xctestrun wording names the file",
			"xcodebuild: error: The file “private.xctestrun” couldn’t be opened because there is no such file.",
			"xctestrun_invalid",
		],
		[
			"R26-4: runner never began executing tests",
			"Testing failed:\n\tTest runner never began executing tests after launching.",
			"test_bundle_load_failed",
		],
		[
			"R26-4: failed to install or launch the test runner",
			"xcodebuild: error: Failed to install or launch the test runner. (Underlying Error: …)",
			"test_bundle_load_failed",
		],
		[
			"R26-2/Q26-1: a UI-query timeout INSIDE the test is a test failure",
			`${TEST_LINE}\n\tFailed to get matching snapshot: Timed out while evaluating UI query.\n** TEST EXECUTE FAILED **`,
			"test_failed",
		],
		[
			"R26-2/Q26-1: a bootstrap timeout with no failed test case is launch_timeout",
			"Testing failed:\n\tTimed out waiting for automation session\n** TEST EXECUTE FAILED **",
			"launch_timeout",
		],
	])("%s", (_name, text, errorClass) => {
		expect(
			classifyRunnerFailure(65, "launch", Buffer.from(text))?.errorClass,
		).toBe(errorClass);
	});
	it("R26-3: `prepare` is not a value the record accepts (it was never produced)", () => {
		const record = classifyRunnerFailure(65, "launch", Buffer.from("x"))!;
		expect(safeRunnerFailure({ ...record, command: "prepare" })).toBeNull();
	});
	it("S26-2: an INHERITED key does not count as present", () => {
		const record = classifyRunnerFailure(65, "launch", Buffer.from("x"))!;
		const { tailSha256, ...own } = record;
		const proto = Object.create({ tailSha256 });
		Object.assign(proto, own, { extra: 1 });
		expect(safeRunnerFailure(proto)).toBeNull();
	});
	it("a specific cause wins over the generic test_failed marker", () => {
		expect(
			classifyRunnerFailure(
				65,
				"launch",
				Buffer.from(
					"xcodebuild: error: Failed to prepare device for impending launch.\n** TEST EXECUTE FAILED **",
				),
			)?.errorClass,
		).toBe("destination_unavailable");
	});
	it("names only an ALLOWLISTED failing test, exactly, and counts failures", () => {
		const record = classifyRunnerFailure(
			65,
			"launch",
			Buffer.from(
				`${TEST_LINE}\nTest Case '-[Other.Suite testLeakyName]' failed (1.0 seconds).`,
			),
		);
		expect(record).toMatchObject({ failingTest: TEST, failureCount: 2 });
		const other = classifyRunnerFailure(
			65,
			"launch",
			Buffer.from(
				"Test Case '-[Other.Suite testLeakyName]' failed (1.0 seconds).",
			),
		);
		expect(other).toMatchObject({ failingTest: null, failureCount: 1 });
		const many = Array(500).fill(TEST_LINE).join("\n");
		expect(
			classifyRunnerFailure(65, "launch", Buffer.from(many))?.failureCount,
		).toBe(MAX_FAILURE_COUNT);
	});
	it("reports nothing for a zero exit, and a killed runner (null) is a failure", () => {
		expect(classifyRunnerFailure(0, "launch", Buffer.from("x"))).toBeNull();
		expect(classifyRunnerFailure(null, "launch", Buffer.from("x"))).toEqual({
			exitCode: null,
			command: "launch",
			errorClass: "unknown",
			failingTest: null,
			failureCount: 0,
			tailSha256: sha("x"),
		});
	});
	it("tailSha256 is the digest of the exact captured bytes (to match a later local run)", () => {
		const text = "xcodebuild: error: Failed to prepare device\n";
		expect(
			classifyRunnerFailure(65, "launch", Buffer.from(text))?.tailSha256,
		).toBe(sha(text));
	});
});

/*
 * The property every review round chased: NOTHING the runner wrote can leave.
 * Feed the private values in every form rounds 23-25 found (raw, split, cut,
 * case, base64 at every alignment, separators, percent-encoding, U+2028) and
 * assert the serialized record contains none of the runner's text at all.
 */
describe("no runner text leaves (rounds 23-25 leak forms)", () => {
	it("the serialized record carries only closed values, whatever the runner printed", () => {
		for (let n = 0; n < 200; n++) {
			const p = privateValues();
			const port = new URL(p.control).port;
			const forms = [
				p.bearer,
				p.session,
				p.control,
				p.bearer.toUpperCase(),
				p.bearer.split("").join(" "),
				`${p.bearer.slice(0, 30)}\nxcodebuild: error: ${p.bearer.slice(30)}`,
				`${p.bearer.slice(0, 20)}\u2028${p.bearer.slice(20)}`,
				encodeURIComponent(p.control),
				Buffer.from(`x:${p.bearer}`).toString("base64"),
				Buffer.from(`Bearer ${p.bearer}`).toString("base64url"),
				`e7e9 8533 ${p.session.slice(0, 11)}`,
				`port ${port}`,
			];
			const raw = forms
				.map((form) => `xcodebuild: error: Failed to prepare device ${form}`)
				.join("\n");
			const ring = new TailRing();
			ring.push(Buffer.from("z".repeat(n * 97)));
			ring.push(Buffer.from(raw));
			const record = classifyRunnerFailure(65, "launch", ring.bytes());
			const text = JSON.stringify(safeRunnerFailure(record));
			expect(Object.keys(JSON.parse(text)).sort()).toEqual(
				[
					"command",
					"errorClass",
					"exitCode",
					"failingTest",
					"failureCount",
					"tailSha256",
				].sort(),
			);
			// Everything but the digest is from a closed set; the digest is hex
			// of a sha256, so compare the record WITHOUT it against the inputs.
			const { tailSha256, ...closed } = JSON.parse(text) as RunnerFailure;
			expect(tailSha256).toMatch(/^[0-9a-f]{64}$/);
			const closedText = JSON.stringify(closed).toLowerCase();
			for (const value of [p.bearer, p.session])
				for (let i = 0; i + 8 <= value.length; i += 4)
					expect(closedText).not.toContain(value.slice(i, i + 8));
			expect(closedText).not.toContain(port);
			expect(closedText).not.toContain("127.0.0.1");
		}
	});
});

describe("export boundary (safeRunnerFailure / safeSummary)", () => {
	const good: RunnerFailure = {
		exitCode: 65,
		command: "launch",
		errorClass: "test_failed",
		failingTest: TEST,
		failureCount: 1,
		tailSha256: "a".repeat(64),
	};
	it("accepts exactly the closed shape", () => {
		expect(safeRunnerFailure(good)).toEqual(good);
		expect(safeRunnerFailure({ ...good, exitCode: null })).toEqual({
			...good,
			exitCode: null,
		});
	});
	it.each([
		["an extra key", { ...good, message: "free text" }],
		["a missing key", (({ tailSha256: _, ...rest }) => rest)(good)],
		["an unknown class", { ...good, errorClass: "Failed to launch abc" }],
		["an unlisted test", { ...good, failingTest: "Other.Suite.testX" }],
		["a free-text command", { ...good, command: "xcodebuild -x" }],
		["a non-hex digest", { ...good, tailSha256: "z".repeat(64) }],
		["a short digest", { ...good, tailSha256: "a".repeat(63) }],
		["an out-of-range count", { ...good, failureCount: MAX_FAILURE_COUNT + 1 }],
		["a zero exit", { ...good, exitCode: 0 }],
		["a string exit", { ...good, exitCode: "65" }],
		["an array", [good]],
	])("drops the WHOLE record for %s", (_, value) => {
		expect(safeRunnerFailure(value)).toBeNull();
	});
	it("every class the classifier can emit passes the boundary", () => {
		for (const [name] of [...ERROR_CLASSES, ["unknown"] as const])
			expect(safeRunnerFailure({ ...good, errorClass: name })).not.toBeNull();
	});
	it("safeSummary exports the record field and nothing else from the runner", () => {
		const out = safeSummary({
			phase: "seed",
			mode: "seed-replay",
			seedPersisted: false,
			acceptanceComplete: false,
			cause: "command-exit",
			runnerReportedTap: false,
			urlProgress: "none",
			refused: {},
			observation: null,
			fingerprint: null,
			querySample: null,
			tapSample: null,
			captures: [],
			observations: {},
			secondary: [],
			runnerFailure: { ...good, extra: "x" } as RunnerFailure,
		});
		expect(out.runnerFailure).toBeNull();
		expect(out.acceptanceComplete).toBe(false);
	});
});

describe("TailRing", () => {
	it("keeps only the most recent RING_BYTES", () => {
		const ring = new TailRing();
		ring.push(Buffer.from("A".repeat(RING_BYTES)));
		ring.push(Buffer.from("B".repeat(1000)));
		ring.push(Buffer.from("C".repeat(10)));
		expect(ring.size).toBe(RING_BYTES);
		const text = ring.bytes().toString();
		expect(text.endsWith(`${"B".repeat(1000)}${"C".repeat(10)}`)).toBe(true);
	});
	it("never grows past RING_BYTES even from one huge chunk", () => {
		const ring = new TailRing();
		ring.push(Buffer.alloc(RING_BYTES * 8, 0x5a));
		expect(ring.size).toBe(RING_BYTES);
	});
});

describe("launchRunner against a fake xcodebuild", () => {
	const originalPath = process.env.PATH;
	afterEach(() => {
		process.env.PATH = originalPath;
	});
	function fakeXcodebuild(script: string) {
		const directory = mkdtempSync(
			join(process.env.LOCAL_OPERATOR_SCRATCHPAD ?? tmpdir(), "fake-xcb-"),
		);
		roots.push(directory);
		const path = join(directory, "xcodebuild");
		writeFileSync(path, `#!/bin/sh\n${script}\n`, { mode: 0o755 });
		process.env.PATH = `${directory}:${originalPath}`;
		return directory;
	}
	/** Q24-1 (deferred, pre-existing): stop() may refuse `cleanup` on an EPERM
	 * race while probing the dying group. Tolerate ONLY that refusal. */
	const tolerateCleanup = (error: unknown) => {
		if (!(error instanceof ReplayRefused && error.code === "cleanup"))
			throw error;
	};
	it("a realistic long-running failure is classified, with the allowlisted test", async () => {
		const p = privateValues();
		fakeXcodebuild(
			`echo "LO_REPLAY_BEARER=${p.bearer} LO_REPLAY_CONTROL=${p.control}"; echo "${TEST_LINE}"; echo "2026-11-04 09:20:01.123 xcodebuild[1:2] note"; echo "** TEST EXECUTE FAILED **" >&2; exit 65`,
		);
		const scope = new NativeScope(new Deadline(20000));
		const handle = launchRunner("/x.xctestrun", "x", "/tmp", scope);
		await handle.completion.catch(() => undefined);
		const record = handle.failureRecord?.();
		expect(record).toMatchObject({
			exitCode: 65,
			command: "launch",
			errorClass: "test_failed",
			failingTest: TEST,
			failureCount: 1,
		});
		expect(JSON.stringify(record)).not.toContain(p.bearer.slice(0, 8));
		await scope.stop(new Deadline(5000));
	});
	it("R23-1: the LAST lines survive heavy output on both pipes (classification sees them)", async () => {
		fakeXcodebuild(
			`head -c 200000 /dev/zero | tr '\\0' n; echo; head -c 200000 /dev/zero | tr '\\0' n >&2; echo >&2; echo "xcodebuild: error: Failed to prepare device for impending launch." >&2; exit 65`,
		);
		const records = await Promise.all(
			Array.from({ length: 4 }, async () => {
				const scope = new NativeScope(new Deadline(30000));
				const handle = launchRunner("/x.xctestrun", "x", "/tmp", scope);
				await handle.completion.catch(() => undefined);
				const record = handle.failureRecord?.();
				await scope.stop(new Deadline(5000));
				return record?.errorClass;
			}),
		);
		expect(records).toEqual(Array(4).fill("destination_unavailable"));
	}, 60000);
	it("R23-1: the command's stdout AND stderr are BLOCKING (no EAGAIN byte loss)", async () => {
		// Measured before the merge: the inherited stderr was O_NONBLOCK and
		// heavy stderr writes lost bytes (196608 of 200000 arrived) under load.
		fakeXcodebuild(
			`/usr/bin/python3 -c 'import fcntl,os,sys; f=[bool(fcntl.fcntl(x, fcntl.F_GETFL) & os.O_NONBLOCK) for x in (1, 2)]; print("xcodebuild: error: Failed to prepare device" if f == [False, False] else "nonblocking"); sys.exit(65)'`,
		);
		const scope = new NativeScope(new Deadline(20000));
		const handle = launchRunner("/x.xctestrun", "x", "/tmp", scope);
		await handle.completion.catch(() => undefined);
		expect(handle.failureRecord?.()?.errorClass).toBe(
			"destination_unavailable",
		);
		await scope.stop(new Deadline(5000));
	});
	it("R23-1: no byte of 200 KB on EACH pipe is lost", async () => {
		fakeXcodebuild(
			`head -c 200000 /dev/zero | tr '\\0' o; head -c 200000 /dev/zero | tr '\\0' e >&2; exit 65`,
		);
		const sizes = await Promise.all(
			Array.from({ length: 4 }, async () => {
				const scope = new NativeScope(new Deadline(30000));
				let total = 0;
				const counting = new TailRing();
				const push = counting.push.bind(counting);
				counting.push = (chunk: Buffer) => {
					total += chunk.length;
					push(chunk);
				};
				const command = scope.start(
					"xcodebuild",
					[],
					20000,
					undefined,
					false,
					counting,
				);
				await command.completion.catch(() => undefined);
				await scope.stop(new Deadline(5000));
				return total;
			}),
		);
		expect(sizes).toEqual(Array(4).fill(400000));
	}, 60000);
	it("Q24-2: a helper holding the pipe open cannot delay a failed command past TAIL_DRAIN_MS", async () => {
		// The helper leaves the process group (setsid) and keeps the inherited
		// pipe open for 15s; the command itself exits 65 at once.
		const directory = fakeXcodebuild(
			`echo "xcodebuild: error: Failed to prepare device"; /usr/bin/python3 -c 'import os,sys,time; os.setsid(); open(sys.argv[1],"w").write(str(os.getpid())); time.sleep(15)' "$(dirname "$0")/helper.pid" & exit 65`,
		);
		const scope = new NativeScope(new Deadline(30000));
		try {
			const started = Date.now();
			const handle = launchRunner("/x.xctestrun", "x", "/tmp", scope);
			await handle.completion.catch(() => undefined);
			expect(Date.now() - started).toBeLessThan(TAIL_DRAIN_MS + 3000);
			expect(handle.failureRecord?.()?.errorClass).toBe(
				"destination_unavailable",
			);
		} finally {
			await scope.stop(new Deadline(5000)).catch(tolerateCleanup);
			// The helper left our process group on purpose; reap it by exact pid.
			for (let i = 0; i < 40; i++) {
				const file = join(directory, "helper.pid");
				if (existsSync(file)) {
					try {
						process.kill(Number(readFileSync(file, "utf8")), "SIGKILL");
					} catch {}
					break;
				}
				await new Promise((yes) => setTimeout(yes, 50));
			}
		}
	}, 30000);
	it("R23-2: a runner KILLED before exiting (timeout/stop) is still classified", async () => {
		fakeXcodebuild(
			'echo "Testing failed:"; echo "	Timed out waiting for automation session"; exec sleep 30',
		);
		const scope = new NativeScope(new Deadline(30000));
		const handle = launchRunner("/x.xctestrun", "x", "/tmp", scope);
		void handle.completion.catch(() => undefined);
		// Poll (bounded) until the hung child's output is in the ring.
		for (let i = 0; i < 200; i++) {
			if (handle.failureRecord?.(true)?.errorClass === "launch_timeout") break;
			await new Promise((yes) => setTimeout(yes, 50));
		}
		// Hung, not yet exited: nothing unless the replay as a whole failed.
		expect(handle.failureRecord?.(false)).toBeNull();
		expect(handle.failureRecord?.(true)).toMatchObject({
			exitCode: null,
			errorClass: "launch_timeout",
		});
		await handle.stop(new Deadline(10000)).catch(tolerateCleanup);
		expect(handle.failureRecord?.()).toMatchObject({
			exitCode: null,
			errorClass: "launch_timeout",
		});
		await scope.stop(new Deadline(5000)).catch(tolerateCleanup);
	}, 30000);
	it("a clean exit 0 reports nothing", async () => {
		fakeXcodebuild(
			'echo "xcodebuild: error: Failed to prepare device"; exit 0',
		);
		const scope = new NativeScope(new Deadline(20000));
		const handle = launchRunner("/x.xctestrun", "x", "/tmp", scope);
		await handle.completion;
		expect(handle.failureRecord?.()).toBeNull();
		await scope.stop(new Deadline(5000));
	});
});
