/**
 * The runner failure tail is a NEW path out of a runner that holds a private
 * environment (loopback control URL, session id, bearer). These tests pin that
 * it is default-deny, capped, redacted, nonzero-exit-only, and that a redaction
 * miss exports nothing but the exit code and a refusal marker.
 */
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Deadline } from "./retirement-replay-core.ts";
import { safeSummary } from "./retirement-replay-evidence.ts";
import { NativeScope } from "./retirement-replay-native.ts";
import {
	LINE_CAP,
	leaksSecret,
	MAX_LINES,
	RING_BYTES,
	redactLine,
	safeRunnerTail,
	sanitizeRunnerTail,
	TailRing,
	type TailSecrets,
} from "./retirement-replay-runner-tail.ts";
import { launchRunner } from "./retirement-ui-replay.ts";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});
function secrets(): TailSecrets {
	return {
		bearer: randomBytes(32).toString("hex"),
		session: randomBytes(24).toString("hex"),
		control: "http://127.0.0.1:47213/rpc",
	};
}

describe("redaction", () => {
	it("replaces the bearer, session, control URL and port, and collapses absolute paths", () => {
		const s = secrets();
		const line = `xcodebuild: error: bearer=${s.bearer} session=${s.session} url=${s.control} port 47213 at /Users/runner/work/_temp/retirement-seed-replay/runner/Products/private.xctestrun`;
		const out = redactLine(line, s);
		expect(out).not.toContain(s.bearer);
		expect(out).not.toContain(s.session);
		expect(out).not.toContain(s.control);
		expect(out).not.toMatch(/\b47213\b/);
		expect(out).not.toContain("/Users/runner");
		expect(out).toContain("<bearer>");
		expect(out).toContain("<session>");
		expect(out).toContain("<control>");
		expect(out).toContain("<port>");
		expect(out).toContain("…/private.xctestrun");
		expect(leaksSecret(out, s)).toBe(false);
	});
	it("caps each exported line at LINE_CAP characters", () => {
		const s = secrets();
		const out = redactLine(`xcodebuild: error: ${"x".repeat(5000)}`, s);
		expect(out.length).toBe(LINE_CAP);
		expect(out.endsWith("…")).toBe(true);
	});
});

describe("TailRing", () => {
	it("keeps only the most recent RING_BYTES", () => {
		const ring = new TailRing();
		ring.push(Buffer.from("A".repeat(RING_BYTES)));
		ring.push(Buffer.from("B".repeat(1000)));
		ring.push(Buffer.from("C".repeat(10)));
		expect(ring.size).toBe(RING_BYTES);
		const text = ring.text();
		expect(text.length).toBe(RING_BYTES);
		expect(text.endsWith(`${"B".repeat(1000)}${"C".repeat(10)}`)).toBe(true);
		expect(text.startsWith("A")).toBe(true);
	});
	it("never grows past RING_BYTES even from one huge chunk", () => {
		const ring = new TailRing();
		ring.push(Buffer.alloc(RING_BYTES * 8, 0x5a));
		expect(ring.size).toBe(RING_BYTES);
	});
});

describe("sanitizeRunnerTail", () => {
	const raw = [
		"Command line invocation:",
		"    /Applications/Xcode.app/Contents/Developer/usr/bin/xcodebuild test-without-building",
		"LO_REPLAY_BEARER = SECRET_FROM_ENV_DUMP",
		"2026-11-04 09:20:01.123 xcodebuild[1234:5678] Writing result bundle",
		"xcodebuild: error: Failed to prepare device for impending launch.",
		"Testing failed:",
		"\tRetirementSystemAlert-Runner (1234) encountered an error (Early unexpected exit)",
		"    Underlying Error: The test runner exited with code 1.",
		"** TEST EXECUTE FAILED **",
	].join("\n");
	it("exports NOTHING for a zero exit", () => {
		expect(sanitizeRunnerTail(0, raw, secrets())).toBeNull();
	});
	it("is default-deny: only allowlisted failure shapes leave", () => {
		const out = sanitizeRunnerTail(65, raw, secrets());
		expect(out).toEqual({
			exitCode: 65,
			lines: [
				"xcodebuild: error: Failed to prepare device for impending launch.",
				"Testing failed:",
				"    Underlying Error: The test runner exited with code 1.",
				"** TEST EXECUTE FAILED **",
			],
		});
		const text = JSON.stringify(out);
		expect(text).not.toContain("Command line invocation");
		expect(text).not.toContain("SECRET_FROM_ENV_DUMP");
		expect(text).not.toContain("LO_REPLAY");
		expect(text).not.toContain("Writing result bundle");
	});
	it("redacts private values inside allowlisted lines", () => {
		const s = secrets();
		const out = sanitizeRunnerTail(
			1,
			`xcodebuild: error: could not reach ${s.control} with ${s.bearer}`,
			s,
		);
		expect(out).toEqual({
			exitCode: 1,
			lines: ["xcodebuild: error: could not reach <control> with <bearer>"],
		});
	});
	it("exports at most MAX_LINES lines (the most recent)", () => {
		const many = Array.from(
			{ length: MAX_LINES + 10 },
			(_, i) => `error: line ${i}`,
		).join("\n");
		const out = sanitizeRunnerTail(1, many, secrets());
		expect(out && "lines" in out && out.lines.length).toBe(MAX_LINES);
		expect(out && "lines" in out && out.lines.at(-1)).toBe(
			`error: line ${MAX_LINES + 9}`,
		);
	});
	it("treats a signalled runner (null exit code) as a failure", () => {
		const out = sanitizeRunnerTail(null, "Testing failed:", secrets());
		expect(out).toEqual({ exitCode: null, lines: ["Testing failed:"] });
	});
	it("refuses the WHOLE tail when the final assert finds a private value: exit code + marker only, never partial", () => {
		const s = secrets();
		const out = sanitizeRunnerTail(
			70,
			"xcodebuild: error: something\nTesting failed:",
			s,
			() => false,
		);
		expect(out).toEqual({ exitCode: 70, redactionRefused: true });
		expect(JSON.stringify(out)).not.toContain("something");
	});
	it("the production assert catches a value redaction did not remove", () => {
		const s = secrets();
		// A bearer split across a path-like token is collapsed, but a bare bearer
		// in an allowlisted line must still never reach the export.
		expect(leaksSecret(`error: ${s.bearer}`, s)).toBe(true);
		expect(leaksSecret("error: port 47213", s)).toBe(true);
		expect(leaksSecret("error: nothing private", s)).toBe(false);
	});
});

describe("export boundary (safeSummary)", () => {
	it("accepts only what sanitizeRunnerTail can emit", () => {
		expect(safeRunnerTail({ exitCode: 0, lines: ["x"] })).toBeNull();
		expect(safeRunnerTail({ exitCode: 3, redactionRefused: true })).toEqual({
			exitCode: 3,
			redactionRefused: true,
		});
		expect(
			safeRunnerTail({
				exitCode: 3,
				lines: ["ok", "x".repeat(LINE_CAP + 1), 7, "bad\u0007bell"],
				extra: "dropped",
			}),
		).toEqual({ exitCode: 3, lines: ["ok"] });
		expect(safeRunnerTail({ exitCode: "1", lines: [] })).toBeNull();
	});
	it("safeSummary exports the tail field and nothing beside it", () => {
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
			runnerTail: { exitCode: 65, lines: ["Testing failed:"] },
		});
		expect(out.runnerTail).toEqual({
			exitCode: 65,
			lines: ["Testing failed:"],
		});
		expect(out.acceptanceComplete).toBe(false);
	});
});

describe("real subprocess through NativeScope + launchRunner's ring", () => {
	it("a failing child's stderr reaches the tail sanitized, and a passing child exports nothing", async () => {
		const directory = mkdtempSync(
			join(process.env.LOCAL_OPERATOR_SCRATCHPAD ?? tmpdir(), "runner-tail-"),
		);
		roots.push(directory);
		const s = secrets();
		const ring = new TailRing();
		const scope = new NativeScope(new Deadline(10000));
		const failing = scope.start(
			process.execPath,
			[
				"-e",
				`process.stderr.write("noise ${s.bearer}\\nxcodebuild: error: launch failed at ${s.control}\\n");process.stdout.write("Testing failed:\\n");process.exit(65)`,
			],
			5000,
			undefined,
			false,
			ring,
		);
		await expect(failing.completion).rejects.toMatchObject({
			code: "command-exit",
		});
		expect(failing.exitCode()).toBe(65);
		const tail = sanitizeRunnerTail(failing.exitCode(), ring.text(), s);
		expect(tail).toEqual({
			exitCode: 65,
			lines: [
				"xcodebuild: error: launch failed at <control>",
				"Testing failed:",
			],
		});
		expect(JSON.stringify(tail)).not.toContain(s.bearer);
		const passingRing = new TailRing();
		const passing = scope.start(
			process.execPath,
			["-e", 'process.stderr.write("xcodebuild: error: x\\n")'],
			5000,
			undefined,
			false,
			passingRing,
		);
		await passing.completion;
		expect(
			sanitizeRunnerTail(passing.exitCode(), passingRing.text(), s),
		).toBeNull();
		await scope.stop(new Deadline(5000));
	});
	it("launchRunner with NO secrets refuses the tail rather than exporting unchecked text", async () => {
		const scope = new NativeScope(new Deadline(10000));
		// xcodebuild is absent on hosts without Xcode; either way it exits nonzero
		// or fails to start, and an unchecked tail must never be produced.
		const handle = launchRunner("/nonexistent.xctestrun", "x", "/tmp", scope);
		await handle.completion.catch(() => undefined);
		const tail = handle.failureTail?.();
		expect(tail === null || (tail && "redactionRefused" in tail)).toBe(true);
		await scope.stop(new Deadline(5000));
	});
});
