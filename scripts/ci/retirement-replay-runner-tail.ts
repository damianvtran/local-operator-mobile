/**
 * A STRUCTURED, closed failure record for the XCTest runner command.
 *
 * WHY THIS EXISTS. Seed replay 41801686399 failed with `command-exit` 9.6s into
 * runner bootstrap, and nothing recorded why: the runner's output was discarded
 * by design, because it runs with a private environment (the loopback control
 * URL and its port, a session id and a bearer), and the xcresult never leaves
 * the runner. Each replay costs a retained artifact's day, so an unexplained
 * exit wastes a day.
 *
 * WHY NO FREE TEXT. Three review rounds (23-25) each found a new major leak in a
 * redactor over free-text output: ring cuts, split halves, case, base64
 * alignments, separator-split hex. A free-text tail from a runner holding a
 * bearer is hard to prove safe, so (the manager's decision after round 25) this
 * module exports NO text from the runner at all. It exports only:
 *
 * - `exitCode` (a number or null);
 * - `command`: which command failed, `launch` or `prepare` (see
 *   `RunnerCommand`; prepare's class is from its outcome, not its output);
 * - `errorClass`: one value of a CLOSED enum, chosen by matching KNOWN
 *   xcodebuild/XCTest messages (`unknown` when nothing matches);
 * - `failingTest`: only if it is one of ALLOWED_TESTS, compared exactly;
 * - `failureCount`: the number of `Test Case … failed` lines (bounded);
 * - `tailSha256`: sha256 of the captured bytes (the last RING_BYTES). It
 *   CONFIRMS that a captured output someone already holds is the one this run
 *   saw; a fresh run will not reproduce it, since real output carries
 *   timestamps, pids and temp paths (review Q26-2). Publishing it is safe for
 *   a different reason than "the bearer is in it" (usually it is not): the
 *   only low-entropy private value that can appear is the control port, and
 *   confirming a guess needs every other byte reconstructed, while the port
 *   names a loopback listener on a runner that no longer exists, guarded by a
 *   per-session bearer (review S26-1).
 *
 * Every field is from a closed set or a number; nothing the runner wrote can be
 * copied out. `safeRunnerFailure` re-validates that shape at the export
 * boundary. The record is diagnostic only and never decides pass/fail.
 */
import { createHash } from "node:crypto";

/** Bytes of combined runner output kept in memory (the most recent bytes). */
export const RING_BYTES = 16 * 1024;
/** Upper bound reported for `failureCount`. */
export const MAX_FAILURE_COUNT = 99;

/**
 * Closed error classes, checked in this order (most specific first). Each
 * pattern names a known xcodebuild/XCTest message; the TEXT itself never
 * leaves, only the class name. A name may appear twice (`test_failed`): an
 * actual `Test Case … failed` line wins over timeout wording, because a UI
 * query timing out INSIDE the test is a test failure, not a launch failure
 * (review R26-2 / Q26-1), while the bare `** TEST EXECUTE FAILED **` marker
 * follows every failure and is only the last resort.
 */
export const ERROR_CLASSES = [
	[
		"destination_unavailable",
		/Unable to find a destination matching|Unable to find a device matching|Failed to prepare device|device is not available|Unable to boot|Simulator device failed to (?:launch|install)/i,
	],
	[
		"xctestrun_invalid",
		// Verified human-reported file-type diagnostic, not a broad build-error
		// inference: https://github.com/google/xctestrunner/issues/60
		/^xcodebuild: error: Failed to build workspace temporary with scheme Transient Testing\.: File is of an unsupported type; must be either an xctestrun file or xctestproducts bundle\.\r?$/m,
	],
	[
		"xctestrun_invalid",
		// Real wording names the file: `The file “private.xctestrun” couldn’t
		// be opened …` (review R26-1).
		/(?:xctestrun|test run file).*(?:could not be (?:read|parsed|loaded)|is (?:invalid|malformed))|The file .{0,120}\.xctestrun.{0,2} couldn.t be opened|The file couldn.t be opened because it isn.t in the correct format|unable to read the xctestrun/i,
	],
	[
		"test_bundle_load_failed",
		// Runner-level bootstrap failures, the likely causes of the 9.6s exit
		// in replay 41801686399 (review R26-4).
		/(?:The bundle|test bundle).*(?:couldn.t be loaded|could not be loaded)|Failed to load the test bundle|Early unexpected exit|Test runner exited before starting test execution|Test runner never began executing tests|Failed to install or launch the test runner|Failed to (?:create|establish) (?:a )?(?:test )?(?:session|communication)/i,
	],
	["test_failed", /^Test Case '.*' failed /m],
	[
		"launch_timeout",
		// Bootstrap wording only; `Timed out while evaluating UI query` is the
		// test's own failure and is caught above by its Test Case line.
		/Timed out waiting for (?:automation session|the test runner|test runner)|test runner (?:hung|timed out)|Failed to launch .* within|exceeded .*time allowance/i,
	],
	[
		"cli_argument_refused",
		// Only explicit, complete xcodebuild diagnostics. Option content is
		// consumed privately, bounded to one line, and NEVER copied into the
		// record. Public specimens: tuist/tuist#8178, fastlane/fastlane#20540.
		// These forms add future instrumentation, not a diagnosis of the
		// historical exit 64: that run's private output was discarded.
		// Existing specific failures above retain priority; generic Usage and
		// exit-code-only text remain unknown. No optional argument-ID field.
		/^xcodebuild: error: (?:invalid option '[^'\r\n]{1,256}'|Cannot use -xctestrun with -project, -workspace or -scheme options\.)\r?$/m,
	],
	["test_failed", /^\*\* TEST (?:EXECUTE )?FAILED \*\*$/m],
] as const;
export type RunnerErrorClass =
	| (typeof ERROR_CLASSES)[number][0]
	| "unknown"
	| "prepare_timeout"
	| "prepare_refused"
	| "prepare_exit";
const CLASS_NAMES: ReadonlySet<string> = new Set([
	...ERROR_CLASSES.map(([name]) => name),
	"unknown",
	"prepare_timeout",
	"prepare_refused",
	"prepare_exit",
]);

/** The only XCTest test names that may be named in the record, exactly. */
export const ALLOWED_TESTS = [
	"RetirementSystemAlert.RetainedReplayTests.testSingleSeedReplay",
] as const;
const TEST_CASE_LINE = /^Test Case '-\[([\w.]+) (\w+)\]' failed /gm;

/**
 * `launch` is the XCTest runner (xcodebuild). `prepare` is the local
 * retirement-replay-products.py check that runs first; replay 41883569070
 * failed there (command-timeout at 10,029 ms) and exported `runnerFailure:
 * null`, so the receipt said WHERE but not HOW. A prepare failure now gets a
 * record too, built ONLY from the outcome (timeout vs exit vs refusal class),
 * never from prepare's output.
 */
export type RunnerCommand = "launch" | "prepare";
export interface RunnerFailure {
	exitCode: number | null;
	command: RunnerCommand;
	errorClass: RunnerErrorClass;
	failingTest: (typeof ALLOWED_TESTS)[number] | null;
	failureCount: number;
	tailSha256: string;
}

/** Keeps only the most recent RING_BYTES of everything pushed into it. */
export class TailRing {
	#chunks: Buffer[] = [];
	#size = 0;
	push(chunk: Buffer) {
		this.#chunks.push(chunk);
		this.#size += chunk.length;
		while (this.#size > RING_BYTES && this.#chunks.length > 0) {
			const head = this.#chunks[0]!;
			const excess = this.#size - RING_BYTES;
			if (head.length <= excess) {
				this.#chunks.shift();
				this.#size -= head.length;
			} else {
				this.#chunks[0] = head.subarray(excess);
				this.#size -= excess;
			}
		}
	}
	get size() {
		return this.#size;
	}
	bytes() {
		return Buffer.concat(this.#chunks);
	}
}

/**
 * Classify a failed runner command into the closed record. Returns null for a
 * zero exit (nothing is reported for a command that succeeded).
 */
export function classifyRunnerFailure(
	exitCode: number | null,
	command: RunnerCommand,
	tail: Buffer,
): RunnerFailure | null {
	if (exitCode === 0) return null;
	const text = tail.toString("utf8");
	const errorClass =
		ERROR_CLASSES.find(([, pattern]) => pattern.test(text))?.[0] ?? "unknown";
	const failed = [...text.matchAll(TEST_CASE_LINE)].map(
		(match) => `${match[1]}.${match[2]}`,
	);
	const failingTest =
		ALLOWED_TESTS.find((name) => failed.includes(name)) ?? null;
	return {
		exitCode,
		command,
		errorClass,
		failingTest,
		failureCount: Math.min(failed.length, MAX_FAILURE_COUNT),
		tailSha256: createHash("sha256").update(tail).digest("hex"),
	};
}

/**
 * The closed classes a PREPARE failure can carry. They come from the command
 * OUTCOME only (ReplayRefused code, exit status), never from what prepare
 * printed, so this path copies nothing out either:
 * - `prepare_timeout`: killed at its cap (`command-timeout` / `deadline`);
 * - `prepare_refused`: exited 1, Python's status for ANY uncaught exception:
 *   usually one of products.py's ValueError checks, but also e.g. a missing
 *   file (FileNotFoundError). It means "prepare raised", not which check;
 * - `prepare_exit`: any other nonzero exit, a start failure or a signal.
 */
export const PREPARE_CLASSES = [
	"prepare_timeout",
	"prepare_refused",
	"prepare_exit",
] as const;
export type PrepareErrorClass = (typeof PREPARE_CLASSES)[number];

/** Build the record for a failed prepare from its outcome alone. */
export function classifyPrepareFailure(
	exitCode: number | null,
	code: string,
): RunnerFailure {
	const errorClass: PrepareErrorClass =
		code === "command-timeout" || code === "deadline"
			? "prepare_timeout"
			: exitCode === 1
				? "prepare_refused"
				: "prepare_exit";
	return {
		exitCode: exitCode === 0 ? null : exitCode,
		command: "prepare",
		errorClass,
		failingTest: null,
		failureCount: 0,
		// No output is captured for prepare; the digest of nothing says so.
		tailSha256: createHash("sha256").update(Buffer.alloc(0)).digest("hex"),
	};
}

/**
 * Re-validate the closed shape at the export boundary. Anything outside it
 * (an unknown key, a string outside the enums) drops the WHOLE record.
 */
export function safeRunnerFailure(value: unknown): RunnerFailure | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const v = value as Record<string, unknown>;
	const keys = [
		"exitCode",
		"command",
		"errorClass",
		"failingTest",
		"failureCount",
		"tailSha256",
	];
	if (
		Object.keys(v).length !== keys.length ||
		!keys.every((key) => Object.hasOwn(v, key))
	)
		return null;
	const exitOk =
		v.exitCode === null ||
		(typeof v.exitCode === "number" &&
			Number.isSafeInteger(v.exitCode) &&
			v.exitCode !== 0 &&
			Math.abs(v.exitCode) <= 255);
	if (
		!exitOk ||
		(v.command !== "launch" && v.command !== "prepare") ||
		// Each command carries only its own classes (review R28 F2).
		(v.command === "prepare") !==
			(PREPARE_CLASSES as readonly unknown[]).includes(v.errorClass) ||
		typeof v.errorClass !== "string" ||
		!CLASS_NAMES.has(v.errorClass) ||
		!(
			v.failingTest === null ||
			(ALLOWED_TESTS as readonly unknown[]).includes(v.failingTest)
		) ||
		typeof v.failureCount !== "number" ||
		!Number.isInteger(v.failureCount) ||
		v.failureCount < 0 ||
		v.failureCount > MAX_FAILURE_COUNT ||
		typeof v.tailSha256 !== "string" ||
		!/^[0-9a-f]{64}$/.test(v.tailSha256)
	)
		return null;
	return {
		exitCode: v.exitCode as number | null,
		command: v.command,
		errorClass: v.errorClass as RunnerErrorClass,
		failingTest: v.failingTest as RunnerFailure["failingTest"],
		failureCount: v.failureCount,
		tailSha256: v.tailSha256,
	};
}
