/** Public message specimens only; none is the discarded historical exit-64 tail. */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	classifyRunnerFailure,
	RING_BYTES,
	safeRunnerFailure,
	TailRing,
} from "./retirement-replay-runner-tail.ts";

// Human-reported stderr, not messages invented from the exit code:
// https://github.com/tuist/tuist/issues/8178
const INVALID =
	"xcodebuild: error: invalid option '-resolvePackageDependenciesWithSystemScm'";
// https://github.com/fastlane/fastlane/issues/20540
const COMBINATION =
	"xcodebuild: error: Cannot use -xctestrun with -project, -workspace or -scheme options.";
// https://github.com/google/xctestrunner/issues/60
const UNSUPPORTED =
	"xcodebuild: error: Failed to build workspace temporary with scheme Transient Testing.: File is of an unsupported type; must be either an xctestrun file or xctestproducts bundle.";
const classify = (text: string, code = 64) =>
	classifyRunnerFailure(code, "launch", Buffer.from(text));

describe("explicit CLI diagnostics, not inferred usage failures", () => {
	it.each([INVALID, COMBINATION])(
		"classifies the complete known argument form",
		(text) => {
			expect(classify(text)?.errorClass).toBe("cli_argument_refused");
		},
	);
	it("adds only the complete unsupported-file wording to the existing configuration class", () => {
		expect(classify(UNSUPPORTED)?.errorClass).toBe("xctestrun_invalid");
	});
	it.each([
		"Usage: xcodebuild [-project <projectname>]",
		"exit 64",
		"xcodebuild: error: something else failed",
		"xcodebuild: error: invalid option",
		"xcodebuild: error: invalid option '-unfinished",
		"prefix " + INVALID,
		INVALID + " suffix",
		COMBINATION.slice(0, -1),
		UNSUPPORTED.slice(0, -1),
		"xcodebuild: error: Failed to build workspace arbitrary with scheme arbitrary.",
	])("keeps unknown, prefixed, suffixed and truncated text unknown", (text) => {
		expect(classify(text)?.errorClass).toBe("unknown");
	});
	it("does not classify success from error-looking text", () => {
		expect(classify(INVALID, 0)).toBeNull();
	});
	it("never exports substituted option content, paths, tokens or extra fields", () => {
		const secret = "a".repeat(64);
		const text = `xcodebuild: error: invalid option '${secret}'`;
		const record = classify(text)!;
		expect(record.errorClass).toBe("cli_argument_refused");
		expect(record.tailSha256).toBe(
			createHash("sha256").update(text).digest("hex"),
		);
		expect(Object.keys(record).sort()).toEqual([
			"command",
			"errorClass",
			"exitCode",
			"failingTest",
			"failureCount",
			"tailSha256",
		]);
		expect(JSON.stringify(record)).not.toContain(secret);
		expect(JSON.stringify(record)).not.toContain("invalid option");
		expect(safeRunnerFailure(record)).toEqual(record);
		expect(safeRunnerFailure({ ...record, argument: secret })).toBeNull();
		expect(safeRunnerFailure({ ...record, command: "prepare" })).toBeNull();
		for (const replacement of [
			"/private/secret/path",
			"http://127.0.0.1:54321/rpc",
		]) {
			const changed = classify(
				`xcodebuild: error: invalid option '${replacement}'`,
			)!;
			expect(JSON.stringify(changed)).not.toContain(replacement);
		}
	});
	it("matches split chunks only after the entire anchored line arrives", () => {
		const ring = new TailRing();
		const midpoint = Math.floor(INVALID.length / 2);
		ring.push(Buffer.from(INVALID.slice(0, midpoint)));
		expect(classifyRunnerFailure(64, "launch", ring.bytes())?.errorClass).toBe(
			"unknown",
		);
		ring.push(Buffer.from(INVALID.slice(midpoint)));
		expect(classifyRunnerFailure(64, "launch", ring.bytes())?.errorClass).toBe(
			"cli_argument_refused",
		);
	});
	it("never interprets a line whose beginning was lost to the ring cap", () => {
		const ring = new TailRing();
		ring.push(Buffer.from(INVALID));
		ring.push(Buffer.alloc(RING_BYTES - INVALID.length + 12, 120));
		expect(classifyRunnerFailure(64, "launch", ring.bytes())?.errorClass).toBe(
			"unknown",
		);
	});
	it.each([
		[
			"Unable to find a destination matching the provided destination specifier",
			"destination_unavailable",
		],
		["The bundle test could not be loaded", "test_bundle_load_failed"],
		["Timed out waiting for automation session", "launch_timeout"],
		[
			"Test Case '-[RetirementSystemAlert.RetainedReplayTests testSingleSeedReplay]' failed (1 seconds).",
			"test_failed",
		],
	])("preserves existing specific failure precedence", (text, expected) => {
		expect(classify(text + "\n" + INVALID)?.errorClass).toBe(expected);
	});
	it("prefers an explicit parser refusal over a generic final test marker", () => {
		expect(classify(INVALID + "\n** TEST EXECUTE FAILED **")?.errorClass).toBe(
			"cli_argument_refused",
		);
	});
});
