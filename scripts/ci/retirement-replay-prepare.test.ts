/**
 * Replay 41883569070 failed at `runner-prepare`: the local
 * retirement-replay-products.py check was killed at its 10 s cap (10,029 ms)
 * and the evidence said `runnerFailure: null`. These tests pin both fixes
 * against a REAL subprocess through NativeScope (no simulator, no Xcode):
 * the cap now lets a slow but healthy prepare finish, and every prepare
 * failure carries a closed record built from its outcome alone.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Deadline, ReplayRefused } from "./retirement-replay-core.ts";
import { safeSummary } from "./retirement-replay-evidence.ts";
import { managedRunner } from "./retirement-replay-lifecycle.ts";
import { NativeScope } from "./retirement-replay-native.ts";
import {
	classifyPrepareFailure,
	PREPARE_CLASSES,
	safeRunnerFailure,
} from "./retirement-replay-runner-tail.ts";
import { PREPARE_CAP_MS, prepareRunner } from "./retirement-ui-replay.ts";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});
/** A stand-in prepare: a shell script with a known duration and exit. */
function standIn(body: string) {
	const directory = mkdtempSync(
		join(tmpdir(), "prepare-"),
	);
	roots.push(directory);
	const path = join(directory, "prepare.sh");
	writeFileSync(path, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
	return path;
}
async function runPrepare(body: string, cap?: number) {
	const scope = new NativeScope(new Deadline(120000));
	const prepare = prepareRunner(scope, [], standIn(body), cap);
	const outcome = await prepare.run().then(
		() => "ok",
		(error: unknown) => (error instanceof ReplayRefused ? error.code : "?"),
	);
	await scope.stop(new Deadline(5000)).catch(() => undefined);
	return { outcome, record: prepare.failureRecord() };
}

describe("runner prepare cap (replay 41883569070)", () => {
	it("the cap admits the slowest measured prepare (23.8 s) with margin, and fits the work budget", () => {
		expect(PREPARE_CAP_MS).toBeGreaterThanOrEqual(23800 * 1.5);
		// See the PREPARE_CAP_MS comment for the arithmetic: 117 s before
		// prepare + cap + 40 + 20 + 70 must stay inside the 300 s work clock.
		expect(117000 + PREPARE_CAP_MS + 40000 + 20000 + 70000).toBeLessThanOrEqual(
			300000,
		);
	});
	it("a 12 s prepare finishes under the cap (it timed out under the old 10 s one)", async () => {
		expect(await runPrepare("sleep 12; exit 0")).toEqual({
			outcome: "ok",
			record: null,
		});
	}, 30000);
	it("the old 10 s cap is what killed it: same prepare, cap 10000 → command-timeout", async () => {
		const result = await runPrepare("sleep 12; exit 0", 10000);
		expect(result.outcome).toBe("command-timeout");
		expect(result.record?.errorClass).toBe("prepare_timeout");
	}, 30000);
});

describe("a failed prepare carries a closed record (never null)", () => {
	it("timeout → prepare_timeout, exitCode null", async () => {
		const { outcome, record } = await runPrepare("sleep 5", 1000);
		expect(outcome).toBe("command-timeout");
		expect(record).toEqual(
			expect.objectContaining({
				command: "prepare",
				errorClass: "prepare_timeout",
				exitCode: null,
				failingTest: null,
				failureCount: 0,
			}),
		);
		expect(safeRunnerFailure(record)).toEqual(record);
	}, 30000);
	it("a ValueError refusal (Python exit 1) → prepare_refused, and its text never leaves", async () => {
		const secret = "f".repeat(64);
		const { outcome, record } = await runPrepare(
			`echo "ValueError: Session identity ${secret}" >&2; exit 1`,
		);
		expect(outcome).toBe("command-exit");
		expect(record).toEqual(
			expect.objectContaining({
				command: "prepare",
				errorClass: "prepare_refused",
				exitCode: 1,
			}),
		);
		expect(JSON.stringify(record)).not.toContain(secret);
		expect(JSON.stringify(record)).not.toContain("Session identity");
	}, 30000);
	it("any other nonzero exit → prepare_exit", async () => {
		const { record } = await runPrepare("exit 3");
		expect(record).toEqual(
			expect.objectContaining({ errorClass: "prepare_exit", exitCode: 3 }),
		);
	}, 30000);
	it("a passing prepare reports nothing", async () => {
		expect((await runPrepare("exit 0")).record).toBeNull();
	}, 30000);
	it("managedRunner exports prepare's record when launch never ran", async () => {
		const scope = new NativeScope(new Deadline(30000));
		const prepare = prepareRunner(scope, [], standIn("exit 1"));
		let launched = false;
		const runner = managedRunner(
			prepare.run,
			() => {
				launched = true;
				throw new Error("must not launch");
			},
			() => scope.stop(new Deadline(5000)),
			prepare.failureRecord,
		);
		await runner.completion.catch(() => undefined);
		expect(launched).toBe(false);
		expect(runner.failureRecord?.(true)).toEqual(
			expect.objectContaining({
				command: "prepare",
				errorClass: "prepare_refused",
			}),
		);
		await scope.stop(new Deadline(5000)).catch(() => undefined);
	}, 30000);
	it("the export boundary keeps a prepare record and rejects a launch class on it", () => {
		const record = classifyPrepareFailure(null, "command-timeout");
		const summary = safeSummary({
			phase: "seed",
			mode: "seed-replay",
			seedPersisted: false,
			acceptanceComplete: false,
			cause: "command-timeout",
			runnerReportedTap: false,
			urlProgress: "none",
			refused: {},
			observation: null,
			fingerprint: null,
			querySample: null,
			tapSample: null,
			captures: [],
			secondary: [],
			observations: {},
			phases: [{ name: "runner-prepare", elapsedMs: 45001, status: "failed" }],
			failedPhase: "runner-prepare",
			runnerFailure: record,
		} as never) as { runnerFailure: unknown };
		expect(summary.runnerFailure).toEqual(record);
		expect(
			safeRunnerFailure({ ...record, errorClass: "test_failed" }),
		).toBeNull();
		for (const errorClass of PREPARE_CLASSES)
			expect(safeRunnerFailure({ ...record, errorClass })?.errorClass).toBe(
				errorClass,
			);
	});
});
