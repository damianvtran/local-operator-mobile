import { spawn } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProofDiagnostics } from "./auth-retirement-diagnostics.ts";
import { writeProgressAtomic } from "./auth-retirement-progress.ts";

const roots: string[] = [];
const fresh = () => {
	const root = mkdtempSync(
		join(
			process.env.LOCAL_OPERATOR_SCRATCHPAD ??
				process.env.RUNNER_TEMP ??
				tmpdir(),
			"progress-evidence-",
		),
	);
	roots.push(root);
	return root;
};
afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});
const read = (root: string, name: string) =>
	JSON.parse(readFileSync(join(root, name), "utf8"));

describe("progressive timing and real run-only signal evidence", () => {
	it("atomically grows completed timing rows after setup and each pass/failure", () => {
		const root = fresh(),
			diag = new ProofDiagnostics(root);
		diag.setSetupTiming("bootReadyMs", 1.7);
		diag.setSetupTiming("firstInstallMs", 3.1);
		diag.setSetupTiming("freezeToFirstPhaseMs", 10.2);
		let prior = read(root, "progress.json");
		expect(prior.setupTimings).toEqual({
			bootReadyMs: 2,
			firstInstallMs: 3,
			freezeToFirstPhaseMs: 10,
		});
		expect(prior.phases).toEqual([]);
		for (const [index, phase] of [
			"seed",
			"persist-control",
			"retire",
		].entries()) {
			diag.beginPhase(phase);
			diag.finishPhase(index === 2 ? "failed" : "passed");
			const current = read(root, "progress.json");
			expect(current.phases).toHaveLength(index + 1);
			expect(current.phases.slice(0, index)).toEqual(prior.phases);
			expect(current.cumulativeElapsedMs).toBeGreaterThanOrEqual(
				prior.cumulativeElapsedMs,
			);
			expect(Number.isInteger(current.phases[index].elapsedMs)).toBe(true);
			prior = current;
		}
		expect(prior.phases.map((v: { outcome: string }) => v.outcome)).toEqual([
			"passed",
			"passed",
			"failed",
		]);
		expect(readdirSync(root).some((name) => name.endsWith(".tmp"))).toBe(false);
	});
	it("aggregates only closed categories/numeric counts, never command text", () => {
		const root = fresh(),
			diag = new ProofDiagnostics(root);
		const attempt = diag.begin("launch");
		diag.finish(
			{
				...attempt,
				args: "UNSAFE_COMMAND_TEXT",
				stdout: "UNSAFE_COMMAND_TEXT",
			} as typeof attempt,
			"success",
			0,
		);
		diag.finish(diag.begin("launch"), "success", 0);
		diag.finish(
			{
				...diag.begin("unknown"),
				category: "UNSAFE_COMMAND_TEXT",
			} as unknown as typeof attempt, // Deliberately invalid fixture tests the runtime closed-category boundary.
			"success",
			0,
		);
		diag.flushProgress();
		const text = readFileSync(join(root, "progress.json"), "utf8");
		expect(text).not.toContain("UNSAFE_COMMAND_TEXT");
		const timings = JSON.parse(text).commandTimings;
		expect(timings.launch.count).toBe(2);
		expect(timings.unknown.count).toBe(1);
		expect(Object.keys(timings.launch).sort()).toEqual([
			"count",
			"maxMs",
			"totalMs",
		]);
		expect(Number.isInteger(timings.launch.totalMs)).toBe(true);
		expect(timings.launch.totalMs).toBeGreaterThanOrEqual(timings.launch.maxMs);
	});
	it.each(["SIGINT", "SIGTERM"] as const)(
		"real %s mid-phase3 writes step-ceiling and exits without cleanup/commands",
		async (signal) => {
			const root = fresh();
			const result = await signalChild(root, signal, false);
			expect(result.code).toBe(signal === "SIGINT" ? 130 : 143);
			expect(result.signal).toBeNull();
			expect(result.signalToCloseMs).toBeLessThan(7500);
			const failure = read(root, "failure.json");
			expect(failure).toMatchObject({
				classification: "BLOCKED",
				checkpoint: "step-ceiling",
				phase: "retire",
				phaseFailure: { cause: "step-ceiling", phase: "retire", signal },
			});
			expect(failure.phases.map((v: { phase: string }) => v.phase)).toEqual([
				"seed",
				"persist-control",
			]);
			expect(read(root, "progress.json").phases).toEqual(failure.phases);
			expect(read(root, "proof.json").complete).toBe(false);
			expect(existsSync(join(root, "forbidden-boundary"))).toBe(false);
			expect(readdirSync(root).some((name) => name.endsWith(".tmp"))).toBe(
				false,
			);
		},
	);
	it("a real signal after a caught failure preserves the original first cause", async () => {
		const root = fresh();
		expect((await signalChild(root, "SIGINT", true)).code).toBe(130);
		const failure = read(root, "failure.json");
		expect(failure).toMatchObject({
			checkpoint: "phase",
			phase: "retire",
			phaseFailure: { cause: "launch-identity" },
		});
		expect(failure.phaseFailure.cause).not.toBe("step-ceiling");
		expect(existsSync(join(root, "forbidden-boundary"))).toBe(false);
	});
	it("atomic fsynced replacement never exposes partial JSON to a concurrent reader", async () => {
		const root = fresh();
		writeProgressAtomic(root, {
			setupTimings: {},
			phases: [],
			commandTimings: {},
			cumulativeElapsedMs: 0,
		});
		const file = join(root, "reader.mjs");
		writeFileSync(
			file,
			`import {readFileSync} from 'node:fs';let count=0;const check=()=>{JSON.parse(readFileSync(${JSON.stringify(join(root, "progress.json"))},'utf8'));count++;};check();const timer=setInterval(check,1);process.on('message',()=>{clearInterval(timer);process.send({count});process.exit(0);});process.send({ready:true});`,
		);
		let count = 0;
		const child = spawn(process.execPath, [file], {
			stdio: ["ignore", "ignore", "ignore", "ipc"],
		});
		await new Promise<void>((yes, no) => {
			const timer = setTimeout(() => {
				child.kill("SIGKILL");
				no(new Error("Atomic reader deadline"));
			}, 5000);
			child.on("error", no);
			child.on("message", (message) => {
				const value = message as { ready?: boolean; count?: number };
				if (value.ready) {
					for (let i = 1; i <= 8; i++)
						writeProgressAtomic(root, {
							setupTimings: {},
							phases: [],
							commandTimings: {},
							cumulativeElapsedMs: i,
						});
					child.send({ done: true });
				}
				if (value.count) count = value.count;
			});
			child.on("close", (code) => {
				clearTimeout(timer);
				code === 0 ? yes() : no(new Error("Atomic reader failed"));
			});
		});
		expect(count).toBeGreaterThan(0);
		expect(read(root, "progress.json").cumulativeElapsedMs).toBe(8);
		expect(readdirSync(root).some((name) => name.endsWith(".tmp"))).toBe(false);
	});
});
async function signalChild(
	root: string,
	signal: "SIGINT" | "SIGTERM",
	failFirst: boolean,
): Promise<{
	code: number | null;
	signal: NodeJS.Signals | null;
	signalToCloseMs: number;
}> {
	const diag = new URL("./auth-retirement-diagnostics.ts", import.meta.url)
			.href,
		progress = new URL("./auth-retirement-progress.ts", import.meta.url).href;
	const carrier = join(root, "signal-carrier.mjs");
	writeFileSync(
		carrier,
		`import {writeFileSync} from 'node:fs';import {ProofDiagnostics} from ${JSON.stringify(diag)};import {installRunSignalHandlers} from ${JSON.stringify(progress)};const root=${JSON.stringify(root)};const diagnostics=new ProofDiagnostics(root);installRunSignalHandlers(diagnostics);diagnostics.setSetupTiming('bootReadyMs',1);diagnostics.beginPhase('seed');diagnostics.finishPhase('passed');diagnostics.beginPhase('persist-control');diagnostics.finishPhase('passed');diagnostics.beginPhase('retire');if(${failFirst}){try{throw new Error('fixture');}catch{diagnostics.observePhaseFailure({phase:'retire',cause:'launch-identity'});diagnostics.fail();}}const command=()=>writeFileSync(root+'/forbidden-boundary','command'),cleanup=()=>writeFileSync(root+'/forbidden-boundary','cleanup');setInterval(()=>{},1000);process.send({ready:true});try{await new Promise(()=>{});}finally{command();cleanup();}`,
	);
	const child = spawn(process.execPath, [carrier], {
		stdio: ["ignore", "ignore", "pipe", "ipc"],
	});
	let at = 0,
		stderr = "";
	child.stderr?.on("data", (chunk) => {
		stderr = (stderr + String(chunk)).slice(-8192);
	});
	return new Promise((yes, no) => {
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			no(new Error("Signal child deadline"));
		}, 5000);
		child.once("error", no);
		child.once("message", () => {
			at = performance.now();
			child.kill(signal);
		});
		child.once("close", (code, received) => {
			clearTimeout(timer);
			if (!at) {
				writeFileSync(join(root, "child-setup-error.log"), stderr);
				no(new Error("Signal child setup failed"));
				return;
			}
			yes({ code, signal: received, signalToCloseMs: performance.now() - at });
		});
	});
}
