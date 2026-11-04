/**
 * The runner failure tail is a NEW path out of a runner that holds a private
 * environment (loopback control URL, session id, bearer). These tests pin that
 * it is default-deny, capped, redacted, nonzero-exit-only, and that a redaction
 * miss exports nothing but the exit code and a refusal marker.
 */
import { randomBytes } from "node:crypto";
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
import { Deadline } from "./retirement-replay-core.ts";
import { safeSummary } from "./retirement-replay-evidence.ts";
import { NativeScope, TAIL_DRAIN_MS } from "./retirement-replay-native.ts";
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

describe("TailRing eviction", () => {
	it("a ring cut never exports its first (possibly mid-token) line", () => {
		const ring = new TailRing();
		const s = secrets();
		ring.push(
			Buffer.from(
				`${"x".repeat(RING_BYTES)}error: ${s.bearer}\nTesting failed:\n`,
			),
		);
		expect(ring.truncated).toBe(true);
		expect(
			sanitizeRunnerTail(65, ring.text(), s, undefined, ring.truncated),
		).toEqual({ exitCode: 65, lines: ["Testing failed:"] });
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
});

/*
 * Round 23 security/QA reproductions (S23-1..4, Q23-1..3). Each was a real leak
 * through the first cut; each must now be redacted or refused, never exported.
 */
describe("round 23 leak reproductions", () => {
	const s = secrets();
	const exported = (raw: string, truncated = false) =>
		JSON.stringify(
			sanitizeRunnerTail(65, raw, s, undefined, truncated) ?? null,
		).toLowerCase();
	const traces = (text: string) =>
		[s.bearer, s.session].some((v) => {
			for (let i = 0; i + 12 <= v.length; i++)
				if (text.includes(v.slice(i, i + 12))) return true;
			return false;
		}) || /(?<!\d)47213(?!\d)/.test(decodeURIComponent(text));
	it("S23-1: a ring cut mid-bearer cannot leave (first line dropped once truncated)", () => {
		const raw = `${s.bearer.slice(25)} foo: error: -[X y] : boom\nTesting failed:`;
		expect(traces(exported(raw, true))).toBe(false);
	});
	it("S23-1: a bearer split across two allowlisted lines is redacted", () => {
		const raw = `error: ${s.bearer.slice(0, 32)}\nerror: ${s.bearer.slice(32)}`;
		const out = exported(raw);
		expect(traces(out)).toBe(false);
		expect(out).toContain("<hex>");
	});
	it("S23-1: uppercase bearer and session are redacted", () => {
		const out = exported(
			`error: ${s.bearer.toUpperCase()} ${s.session.toUpperCase()}`,
		);
		expect(traces(out)).toBe(false);
	});
	it("S23-1: an uppercase 40-char PREFIX after the line cap is not exported", () => {
		const out = exported(
			`error: ${"z".repeat(LINE_CAP - 50)}${s.bearer.toUpperCase()}`,
		);
		expect(traces(out)).toBe(false);
	});
	it("S23-1: text after a U+2028/U+0085/CR inside an allowlisted line is its own (denied) line", () => {
		for (const brk of ["\u2028", "\u2029", "\u0085", "\r"]) {
			const out = exported(`error: fine${brk}LO_REPLAY_BEARER=${s.bearer}`);
			expect(out).not.toContain("lo_replay");
			expect(traces(out)).toBe(false);
		}
	});
	it("S23-1: short pieces of a split bearer (any length >= 8) are redacted", () => {
		for (const cut of [53, 56, 8, 30])
			expect(
				traces(
					exported(
						`error: ${s.bearer.slice(0, cut)}\nerror: q ${s.bearer.slice(cut)}`,
					),
				),
			).toBe(false);
	});
	it("S23-1: a bearer written with separators refuses the whole tail", () => {
		expect(
			sanitizeRunnerTail(65, `error: ${s.bearer.split("").join(" ")}`, s),
		).toEqual({ exitCode: 65, redactionRefused: true });
	});
	it("S24-1: base64 of a PREFIXED bearer (all byte alignments, url-safe too) refuses the tail", () => {
		for (const prefix of ["x:", "Bearer ", '{"bearer":"', "a", "ab", "abc"])
			for (const alphabet of ["base64", "base64url"] as const) {
				const encoded = Buffer.from(prefix + s.bearer).toString(alphabet);
				expect(sanitizeRunnerTail(65, `error: auth ${encoded}`, s)).toEqual({
					exitCode: 65,
					redactionRefused: true,
				});
			}
		// A 12-byte fragment, base64'd at each alignment, is refused too.
		for (const prefix of ["", "a", "ab"])
			expect(
				sanitizeRunnerTail(
					65,
					`error: t ${Buffer.from(prefix + s.bearer.slice(10, 22)).toString("base64")}`,
					s,
				),
			).toEqual({ exitCode: 65, redactionRefused: true });
	});
	it("R24-1: ordinary long-running failure lines are NOT refused", () => {
		const raw = [
			"Test Case '-[RetirementSystemAlert.RetainedReplayTests testSingleSeedReplay]' failed (241.302 seconds).",
			"xcodebuild: error: Failed to launch on 2026-11-04 09:20:01.123+0000 at 1730712001.",
			"xcodebuild: error: Unable to find a destination matching { platform:iOS Simulator, id:11111111-1111-4111-8111-111111111111 }",
			"Testing failed:",
		].join("\n");
		const out = sanitizeRunnerTail(65, raw, s);
		expect(out && "lines" in out).toBe(true);
		expect(out && "lines" in out ? out.lines.length : 0).toBe(4);
		expect(JSON.stringify(out)).toContain("failed (241.302 seconds)");
	});
	it("Q23-1: a base64 bearer in an allowlisted line refuses the whole tail", () => {
		const b64 = Buffer.from(s.bearer).toString("base64");
		expect(sanitizeRunnerTail(65, `error: token ${b64}`, s)).toEqual({
			exitCode: 65,
			redactionRefused: true,
		});
	});
	it("S23-2: the XCTest assertion shape is anchored to file:line", () => {
		expect(exported(`garbage foo: error: -[X y] : boom`)).toBe(
			JSON.stringify({ exitCode: 65, lines: [] }).toLowerCase(),
		);
		expect(
			exported(
				"RetainedReplayTests.swift:24: error: -[RetirementSystemAlert.RetainedReplayTests testSingleSeedReplay] : failed",
			),
		).toContain("retainedreplaytests.swift:24");
	});
	it("S23-3: a percent-encoded control URL loses its port", () => {
		const out = exported(
			`error: could not reach ${encodeURIComponent(s.control)}`,
		);
		expect(traces(out)).toBe(false);
	});
	it("Q23-3: a ring cut mid-UTF-8 character never reaches the export", () => {
		const ring = new TailRing();
		ring.push(Buffer.from("é".repeat(RING_BYTES)));
		ring.push(Buffer.from("x\nTesting failed:\n"));
		expect(ring.truncated).toBe(true);
		const out = sanitizeRunnerTail(65, ring.text(), s, undefined, true);
		expect(JSON.stringify(out)).not.toContain("\ufffd");
		expect(out).toEqual({ exitCode: 65, lines: ["Testing failed:"] });
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
				lines: [
					"Testing failed:",
					"free text the allowlist never admits",
					`error: ${"a".repeat(8)}`,
					"error: x\u2028hidden",
					`error: ${"x".repeat(LINE_CAP)}`,
					7,
					"error: bad\u0007bell",
				],
				extra: "dropped",
			}),
		).toEqual({ exitCode: 3, lines: ["Testing failed:"] });
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
		// NativeScope pipes ONLY the wrapper's stdout in tail mode, and the
		// wrapper merges the command's stderr into it, in write order.
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
});

/*
 * launchRunner end to end against a FAKE `xcodebuild` first on PATH (NativeScope
 * passes PATH through), so the real ring, the real exit/close handling and the
 * real failureTail are exercised without Xcode.
 */
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
	it("R23-4: with NO secrets the tail is REFUSED (strictly), never unchecked text", async () => {
		fakeXcodebuild('echo "xcodebuild: error: boom" >&2; exit 65');
		const scope = new NativeScope(new Deadline(10000));
		const handle = launchRunner("/x.xctestrun", "x", "/tmp", scope);
		await handle.completion.catch(() => undefined);
		expect(handle.failureTail?.()).toEqual({
			exitCode: 65,
			redactionRefused: true,
		});
		await scope.stop(new Deadline(5000));
	});
	it("R23-1: the LAST lines survive heavy output on both pipes, under parallel load", async () => {
		const s = secrets();
		// 200 KB on stdout (newline-terminated, so the marker starts its own
		// line), then the last lines on BOTH pipes right before a nonzero exit:
		// exactly what `exit`-before-drain used to cut off.
		fakeXcodebuild(
			`head -c 200000 /dev/zero | tr '\\0' n; echo; head -c 200000 /dev/zero | tr '\\0' n >&2; echo >&2; echo "Testing failed:"; echo "** TEST EXECUTE FAILED **" >&2; exit 65`,
		);
		// Kept light: the deterministic guard is the O_NONBLOCK test below; this
		// one only checks the end-to-end tail, without loading sibling suites.
		for (let round = 0; round < 1; round++) {
			const tails = await Promise.all(
				Array.from({ length: 4 }, async () => {
					const scope = new NativeScope(new Deadline(30000));
					const handle = launchRunner("/x.xctestrun", "x", "/tmp", scope, s);
					await handle.completion.catch(() => undefined);
					const tail = handle.failureTail?.();
					await scope.stop(new Deadline(5000));
					return tail;
				}),
			);
			// Merged into one blocking pipe, so the write order is exact.
			for (const tail of tails)
				expect(tail).toEqual({
					exitCode: 65,
					lines: ["Testing failed:", "** TEST EXECUTE FAILED **"],
				});
		}
	}, 60000);
	it("R23-1: the command's stdout AND stderr are BLOCKING (no EAGAIN byte loss)", async () => {
		// Measured before the fix: the inherited stderr was O_NONBLOCK and heavy
		// stderr writes lost bytes (196608 of 200000 arrived) under load.
		fakeXcodebuild(
			`/usr/bin/python3 -c 'import fcntl,os,sys; print("xcodebuild: error: nonblock", [bool(fcntl.fcntl(f, fcntl.F_GETFL) & os.O_NONBLOCK) for f in (1, 2)]); sys.exit(65)'`,
		);
		const scope = new NativeScope(new Deadline(20000));
		const handle = launchRunner("/x.xctestrun", "x", "/tmp", scope, secrets());
		await handle.completion.catch(() => undefined);
		expect(handle.failureTail?.()).toEqual({
			exitCode: 65,
			lines: ["xcodebuild: error: nonblock [False, False]"],
		});
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
		// The helper leaves the process group (setsid via python) and keeps the
		// inherited pipe open for 15s; the command itself exits 65 at once.
		const directory = fakeXcodebuild(
			`echo "xcodebuild: error: helper"; /usr/bin/python3 -c 'import os,sys,time; os.setsid(); open(sys.argv[1],"w").write(str(os.getpid())); time.sleep(15)' "$(dirname "$0")/helper.pid" & exit 65`,
		);
		const scope = new NativeScope(new Deadline(30000));
		try {
			const started = Date.now();
			const handle = launchRunner(
				"/x.xctestrun",
				"x",
				"/tmp",
				scope,
				secrets(),
			);
			await handle.completion.catch(() => undefined);
			expect(Date.now() - started).toBeLessThan(TAIL_DRAIN_MS + 3000);
			expect(handle.failureTail?.()).toEqual({
				exitCode: 65,
				lines: ["xcodebuild: error: helper"],
			});
		} finally {
			await scope.stop(new Deadline(5000)).catch(() => undefined);
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
	it("R23-2: a runner KILLED before exiting (timeout/stop) still exports its tail", async () => {
		const s = secrets();
		fakeXcodebuild(
			'echo "xcodebuild: error: stuck before ready"; exec sleep 30',
		);
		const scope = new NativeScope(new Deadline(30000));
		const handle = launchRunner("/x.xctestrun", "x", "/tmp", scope, s);
		void handle.completion.catch(() => undefined);
		// Poll (bounded) until the hung child's line is in the ring: a fixed
		// sleep flaked under load.
		for (let i = 0; i < 200; i++) {
			const t = handle.failureTail?.(true);
			if (t && "lines" in t && t.lines.length > 0) break;
			await new Promise((yes) => setTimeout(yes, 50));
		}
		// Hung, not yet exited: nothing unless the replay as a whole failed.
		expect(handle.failureTail?.(false)).toBeNull();
		expect(handle.failureTail?.(true)).toEqual({
			exitCode: null,
			lines: ["xcodebuild: error: stuck before ready"],
		});
		// stop() can throw `cleanup` on a pre-existing EPERM race while probing
		// the dying group (review Q24-1, deferred; it also happens on the base).
		// This test is about the TAIL, which must survive either way.
		await handle.stop(new Deadline(10000)).catch(() => undefined);
		expect(handle.failureTail?.()).toEqual({
			exitCode: null,
			lines: ["xcodebuild: error: stuck before ready"],
		});
		await scope.stop(new Deadline(5000));
	}, 30000);
});
