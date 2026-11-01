/** Model the OS boundary deterministically: a producer can have exited with 0
 * before its buffered stdout reaches the host. Killing an already-dead group
 * cannot turn that success status into a cap rejection. */
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({ bytes: 1, code: 0 }));
vi.mock("node:child_process", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:child_process")>();
	return {
		...actual,
		spawn: vi.fn(() => {
			const child = new EventEmitter() as EventEmitter & {
				stdout: EventEmitter;
				stderr: EventEmitter & { resume: () => void };
				stdin: { end: () => void };
			};
			child.stdout = new EventEmitter();
			child.stderr = Object.assign(new EventEmitter(), { resume: () => {} });
			child.stdin = {
				end: () =>
					queueMicrotask(() => {
						// No PID: the modeled producer is already gone; no real process is killed.
						child.stdout.emit("data", Buffer.alloc(boundary.bytes, "x"));
						child.emit("close", boundary.code, null);
					}),
			};
			return child;
		}),
	};
});

import {
	activeProofDiagnostics,
	withProofDiagnostics,
} from "./auth-retirement-diagnostics.ts";
import { command } from "./auth-retirement-ios-proof.ts";

const root = () =>
	mkdtempSync(
		join(process.env.LOCAL_OPERATOR_SCRATCHPAD ?? tmpdir(), "proof-cap-"),
	);
beforeEach(() => {
	boundary.bytes = 1;
	boundary.code = 0;
});
it("rejects late over-cap stdout even with zero close status; cannot complete proof", async () => {
	const dir = root(),
		secret = "SYNTHETIC_CAP_ARGUMENT_NEVER_SERIALIZE";
	boundary.bytes = 1024 * 1024 + 1;
	const status = await withProofDiagnostics(dir, async () => {
		activeProofDiagnostics?.checkpoint("install");
		try {
			await command("xcrun", ["simctl", "install", secret]);
		} catch (error) {
			activeProofDiagnostics?.checkpoint("cleanup");
			boundary.bytes = 1;
			await command("xcrun", ["simctl", "shutdown", secret]);
			throw error;
		}
		writeFileSync(join(dir, "proof.json"), JSON.stringify({ complete: true }));
	}).then(
		() => "resolved",
		() => "rejected",
	);
	expect(status).toBe("rejected");
	expect(
		JSON.parse(readFileSync(join(dir, "proof.json"), "utf8")),
	).toMatchObject({ complete: false, diagnosticOnly: true, phases: [] });
	const text = readFileSync(join(dir, "failure.json"), "utf8");
	expect(JSON.parse(text)).toMatchObject({
		classification: "BLOCKED",
		checkpoint: "install",
		command: { category: "install", outcome: "output-cap", exitCode: 0 },
	});
	expect(text).not.toContain(secret);
	expect(text).not.toContain(dir);
});
it("accepts normal under-cap zero exit without a BLOCKED receipt", async () => {
	const dir = root();
	await withProofDiagnostics(dir, async () => {
		expect(await command("xcrun", ["simctl", "list"])).toBe("x");
		writeFileSync(join(dir, "proof.json"), JSON.stringify({ complete: true }));
	});
	expect(existsSync(join(dir, "failure.json"))).toBe(false);
	expect(JSON.parse(readFileSync(join(dir, "proof.json"), "utf8"))).toEqual({
		complete: true,
	});
});
