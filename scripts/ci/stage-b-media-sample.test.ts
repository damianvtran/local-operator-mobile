import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	assertStageBMediaParents,
	type MediaSampleRun,
	STAGE_B_MEDIA_SAMPLE_AT_MS,
	STAGE_B_MEDIA_SAMPLE_MAX_OUTPUT,
	stageBImportWithSampling,
	stageBOwnedMediaPids,
} from "./stage-b-media-sample";

const owned = "00000000-0000-4000-8000-000000000001";
const services =
	"PID Status Label\n102 0 com.apple.CoreSimulator.bridge\n103 0 com.apple.assetsd\n999 0 irrelevant-service\n";
const identities =
	"101 1 /runtime/launchd_sim\n102 101 /runtime/CoreSimulatorBridge\n103 101 /runtime/assetsd\n";
const dirs: string[] = [];
const directory = () => {
	const p = mkdtempSync(
		join(process.env.LOCAL_OPERATOR_SCRATCHPAD ?? tmpdir(), "stage-b-sample-"),
	);
	dirs.push(p);
	return p;
};
afterEach(() => {
	vi.useRealTimers();
	for (const p of dirs.splice(0)) rmSync(p, { recursive: true, force: true });
});
function runner(overrides?: {
	services?: string;
	identities?: string;
	stack?: string;
}) {
	const calls: {
		command: string;
		args: string[];
		cap: number;
		signal: AbortSignal;
	}[] = [];
	const run: MediaSampleRun = async (name, command, args, cap, signal) => {
		calls.push({ command, args, cap, signal });
		if (name.endsWith("services")) return overrides?.services ?? services;
		if (name.endsWith("manager")) return "101\n";
		if (name.endsWith("identity")) return overrides?.identities ?? identities;
		if (command === "/usr/bin/sample")
			return overrides?.stack ?? "mach_msg_trap\n";
		throw new Error("unexpected diagnostic");
	};
	return { run, calls };
}
function importGate() {
	let finish: (value: string) => void = () => {};
	let fail: (error: Error) => void = () => {};
	const promise = new Promise<string>((resolve, reject) => {
		finish = resolve;
		fail = reject;
	});
	return { finish, fail, promise };
}
describe("one pending Photos import discriminator", () => {
	it("never probes an import settled before 120s", async () => {
		vi.useFakeTimers();
		const x = runner(),
			evidence: Record<string, unknown> = {};
		expect(
			await stageBImportWithSampling(
				async () => "ok",
				x.run,
				owned,
				directory(),
				evidence,
			),
		).toBe("ok");
		await vi.advanceTimersByTimeAsync(240000);
		expect(x.calls).toEqual([]);
		expect(evidence.pendingSampling).toMatchObject({ status: "not-needed" });
	});
	it("samples each exact owned PID once, bounds each probe, and persists only redacted bounded stdout", async () => {
		vi.useFakeTimers();
		const marker = ["synthetic", "sample", "marker"].join("-");
		const x = runner({
			stack: `mach_msg_trap\nBearer ${marker}\n${"x".repeat(STAGE_B_MEDIA_SAMPLE_MAX_OUTPUT * 2)}`,
		});
		const gate = importGate(),
			evidence: Record<string, unknown> = {},
			out = directory();
		const result = stageBImportWithSampling(
			() => gate.promise,
			x.run,
			owned,
			out,
			evidence,
		);
		await vi.advanceTimersByTimeAsync(STAGE_B_MEDIA_SAMPLE_AT_MS - 1);
		expect(x.calls).toHaveLength(0);
		await vi.advanceTimersByTimeAsync(1);
		const samples = x.calls.filter((c) => c.command === "/usr/bin/sample");
		expect(samples.map((c) => c.args[0]).sort()).toEqual(["102", "103"]);
		for (const c of samples) {
			expect(c.args.slice(1)).toEqual(["3", "1", "-file", "/dev/stdout"]);
			expect(c.cap).toBe(20);
		}
		expect(x.calls.every((c) => c.cap <= 20)).toBe(true);
		for (const name of ["CoreSimulatorBridge", "assetsd"]) {
			const text = readFileSync(
				join(out, `media-pending-${name}-stack.txt`),
				"utf8",
			);
			expect(text).toContain("mach_msg_trap");
			expect(text).not.toContain(marker);
			expect(text.length).toBeLessThanOrEqual(STAGE_B_MEDIA_SAMPLE_MAX_OUTPUT);
		}
		await vi.advanceTimersByTimeAsync(30000);
		expect(x.calls.filter((c) => c.command === "/usr/bin/sample")).toHaveLength(
			2,
		);
		gate.finish("ok");
		expect(await result).toBe("ok");
		expect(evidence.pendingSampling).toMatchObject({
			status: "finished",
			pids: { CoreSimulatorBridge: 102, assetsd: 103 },
		});
	});
	it("fails closed for duplicate, inactive, root, identical and unsafe service PIDs", () => {
		for (const bad of [
			`${services}104 0 com.apple.assetsd\n`,
			services.replace("103 0", "- 0"),
			services.replace("103 0", "1 0"),
			services.replace("103 0", "102 0"),
			services.replace("103 0", "999999999999999999 0"),
		])
			expect(() => stageBOwnedMediaPids(bad)).toThrow();
	});
	it("refuses other simulators, reused executables and incomplete host process identities", () => {
		const pids = stageBOwnedMediaPids(services);
		for (const bad of [
			identities.replace("103 101", "103 201"),
			identities.replace("/runtime/assetsd", "/runtime/node"),
			identities.replace("/runtime/launchd_sim", "/runtime/launchd"),
			`${identities}103 101 /runtime/assetsd\n`,
			identities.split("\n").slice(0, 2).join("\n"),
		])
			expect(() => assertStageBMediaParents(bad, 101, pids)).toThrow();
	});
	it("does not sample on failed ownership validation and retains the import's original error", async () => {
		vi.useFakeTimers();
		const x = runner({ identities: identities.replace("103 101", "103 201") }),
			gate = importGate(),
			evidence: Record<string, unknown> = {};
		const primary = new Error("primary addmedia timeout");
		const result = stageBImportWithSampling(
			() => gate.promise,
			x.run,
			owned,
			directory(),
			evidence,
		).catch((e) => e);
		await vi.advanceTimersByTimeAsync(STAGE_B_MEDIA_SAMPLE_AT_MS);
		expect(x.calls.some((c) => c.command === "/usr/bin/sample")).toBe(false);
		expect(evidence.pendingSampling).toMatchObject({ status: "unavailable" });
		gate.fail(primary);
		expect(await result).toBe(primary);
	});
	it("refuses an invalid simulator and redacts a failed live probe without replacing import failure", async () => {
		vi.useFakeTimers();
		const evidence: Record<string, unknown> = {};
		const x = runner(),
			gate = importGate();
		const result = stageBImportWithSampling(
			() => gate.promise,
			x.run,
			"not-owned",
			directory(),
			evidence,
		);
		await vi.advanceTimersByTimeAsync(STAGE_B_MEDIA_SAMPLE_AT_MS);
		expect(x.calls).toHaveLength(0);
		gate.finish("ok");
		await result;
		const next = importGate(),
			second: Record<string, unknown> = {},
			marker = ["synthetic", "diagnostic", "marker"].join("-");
		const failed = stageBImportWithSampling(
			() => next.promise,
			async () => {
				throw new Error(`Bearer ${marker}`);
			},
			owned,
			directory(),
			second,
		).catch((e) => e);
		await vi.advanceTimersByTimeAsync(STAGE_B_MEDIA_SAMPLE_AT_MS);
		expect(second.pendingSampling).toMatchObject({ status: "unavailable" });
		expect(JSON.stringify(second)).not.toContain(marker);
		const primary = new Error("original import failure");
		next.fail(primary);
		expect(await failed).toBe(primary);
	});
	it("cancels outstanding probes without waiting for them or masking a primary failure", async () => {
		vi.useFakeTimers();
		const gate = importGate(),
			signals: AbortSignal[] = [],
			evidence: Record<string, unknown> = {};
		const blocked: MediaSampleRun = async (_n, _c, _a, _s, signal) => {
			signals.push(signal);
			return new Promise<string>(() => {});
		};
		const primary = new Error("primary timeout");
		const result = stageBImportWithSampling(
			() => gate.promise,
			blocked,
			owned,
			directory(),
			evidence,
		).catch((e) => e);
		await vi.advanceTimersByTimeAsync(STAGE_B_MEDIA_SAMPLE_AT_MS);
		gate.fail(primary);
		expect(await result).toBe(primary);
		expect(signals).toHaveLength(1);
		expect(signals[0]?.aborted).toBe(true);
		expect(evidence.pendingSampling).toMatchObject({ status: "cancelled" });
	});
	it("cancels active samples on successful import and redacts diagnostic exceptions", async () => {
		vi.useFakeTimers();
		const gate = importGate(),
			x = runner(),
			signals: AbortSignal[] = [],
			evidence: Record<string, unknown> = {};
		const run: MediaSampleRun = (name, command, args, cap, signal) => {
			if (command !== "/usr/bin/sample")
				return x.run(name, command, args, cap, signal);
			signals.push(signal);
			return new Promise((_r, reject) =>
				signal.addEventListener(
					"abort",
					() => reject(new Error("Bearer synthetic-secret")),
					{ once: true },
				),
			);
		};
		const result = stageBImportWithSampling(
			() => gate.promise,
			run,
			owned,
			directory(),
			evidence,
		);
		await vi.advanceTimersByTimeAsync(STAGE_B_MEDIA_SAMPLE_AT_MS);
		expect(signals).toHaveLength(2);
		gate.finish("ok");
		expect(await result).toBe("ok");
		expect(signals.every((s) => s.aborted)).toBe(true);
		await Promise.resolve();
		expect(JSON.stringify(evidence)).not.toContain("synthetic-secret");
	});
});
