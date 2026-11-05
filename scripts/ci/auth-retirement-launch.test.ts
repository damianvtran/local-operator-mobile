import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProofDiagnostics } from "./auth-retirement-diagnostics.ts";
import { command } from "./auth-retirement-ios-proof.ts";
import {
	captureSeedHost,
	DEFAULT_COMMAND_BUDGET_MS,
	FIRST_LAUNCH_BUDGET_MS,
	launchFailureCause,
	launchProofPhase,
	ProofCommandTimeout,
	SEED_READY_BUDGET_MS,
	sanitizeHostNumbers,
} from "./auth-retirement-launch.ts";
import {
	createReadyGate,
	READY_BUDGET_MS,
	ReadyTimeout,
} from "./auth-retirement-readiness.ts";

const roots: string[] = [];
afterEach(() => {
	vi.useRealTimers();
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});
describe("seed-only first launch and ready allowance", () => {
	it.each([
		"seed",
		"persist-control",
		"retire",
		"retired-restore",
		"fresh-replace",
		"fresh-restore",
	])("keeps %s launch and ready budgets phase-scoped", async (phase) => {
		const gate = createReadyGate(),
			arm = vi.spyOn(gate, "arm"),
			calls: unknown[][] = [],
			order: string[] = [];
		await launchProofPhase(
			phase,
			"owned-udid",
			"proof-id",
			async (...args) => {
				calls.push(args);
				order.push("launch");
				expect(gate.accept()).toBe(true);
				return "pid";
			},
			gate,
			() => {
				order.push("host-load");
			},
		);
		expect(DEFAULT_COMMAND_BUDGET_MS).toBe(30000);
		expect(FIRST_LAUNCH_BUDGET_MS).toBe(60000);
		expect(SEED_READY_BUDGET_MS).toBe(75000);
		expect(calls).toEqual([
			[
				"xcrun",
				[
					"simctl",
					"launch",
					"--terminate-running-process",
					"owned-udid",
					"proof-id",
				],
				phase === "seed" ? 60000 : 30000,
			],
		]);
		expect(arm).toHaveBeenCalledWith(
			phase === "seed" ? 75000 : READY_BUDGET_MS,
		);
		expect(order).toEqual(
			phase === "seed" ? ["host-load", "launch"] : ["launch"],
		);
	});
	it("does not time out a seed launch returning at50s with ready at52s", async () => {
		vi.useFakeTimers();
		const gate = createReadyGate();
		const state = { value: "pending" };
		const pending = launchProofPhase(
			"seed",
			"owned",
			"proof",
			async () => {
				await new Promise((yes) => setTimeout(yes, 50000));
				return "pid";
			},
			gate,
		);
		const settled = pending.then(
			() => {
				state.value = "ready";
			},
			() => {
				state.value = "failed";
			},
		);
		setTimeout(() => gate.accept(), 52000);
		await vi.advanceTimersByTimeAsync(50000);
		expect(state.value).toBe("pending");
		await vi.advanceTimersByTimeAsync(2000);
		await settled;
		expect(state.value).toBe("ready");
	});
	it("marks only an actual launch command timeout as launch-timeout", async () => {
		const gate = createReadyGate();
		try {
			await launchProofPhase(
				"seed",
				"owned",
				"proof",
				async () => {
					throw new ProofCommandTimeout();
				},
				gate,
			);
			throw new Error("expected timeout");
		} catch (error) {
			expect(launchFailureCause(error)).toBe("launch-timeout");
		}
		expect(launchFailureCause(new ProofCommandTimeout())).toBe(
			"launch-identity",
		); // not wrapped by the launch boundary
	});
	it("keeps a nonzero launch failure launch-identity", async () => {
		const error = await launchProofPhase(
			"seed",
			"owned",
			"proof",
			async () => {
				throw new Error("Proof subprocess failed or timed out");
			},
			createReadyGate(),
		).then(
			() => {
				throw new Error("Launch unexpectedly resolved");
			},
			(error) => error,
		);
		expect(launchFailureCause(error)).toBe("launch-identity");
	});
	it("keeps missing listener readiness ready-timeout", async () => {
		vi.useFakeTimers();
		let observed: unknown;
		const pending = launchProofPhase(
			"seed",
			"owned",
			"proof",
			async () => "pid",
			createReadyGate(),
		).catch((error) => {
			observed = error;
		});
		await vi.advanceTimersByTimeAsync(SEED_READY_BUDGET_MS);
		await pending;
		expect(observed).toBeInstanceOf(ReadyTimeout);
		expect(launchFailureCause(observed)).toBe("ready-timeout");
	});
	it("the real owned subprocess runner rejects a fired timer with the typed error", async () => {
		await expect(
			command(process.execPath, ["-e", "setInterval(()=>{},1000)"], 20),
		).rejects.toBeInstanceOf(ProofCommandTimeout);
	});
	it("rounds relative host signals without asserting memory headroom", () => {
		expect(
			captureSeedHost(
				() => [1.236],
				() => 3.4 * 1048576,
			),
		).toEqual({ hostLoadAvg1m: 1.24, hostFreeMemMiB: 3 });
	});
	it.each([NaN, -1, "UNSAFE_HOST_TEXT", Infinity])(
		"sanitizes non-numeric/non-finite/negative host values %#",
		(value) => {
			expect(
				sanitizeHostNumbers({ hostLoadAvg1m: value, hostFreeMemMiB: value }),
			).toEqual({ hostLoadAvg1m: "UNOBSERVED", hostFreeMemMiB: "UNOBSERVED" });
		},
	);
	it("host sampling exceptions remain observation-only", () => {
		expect(
			captureSeedHost(() => {
				throw new Error("UNSAFE_HOST_TEXT");
			}),
		).toEqual({ hostLoadAvg1m: "UNOBSERVED", hostFreeMemMiB: "UNOBSERVED" });
	});
	it("persists only sanitized host values at seed failure, with success evidence wired too", () => {
		const root = mkdtempSync(
			join(
				process.env.LOCAL_OPERATOR_SCRATCHPAD ??
					process.env.RUNNER_TEMP ??
					tmpdir(),
				"launch-diagnostic-",
			),
		);
		roots.push(root);
		const diag = new ProofDiagnostics(root);
		diag.checkpoint("phase", "seed");
		diag.observePhaseFailure({
			phase: "seed",
			cause: "launch-timeout",
			hostLoadAvg1m: "UNSAFE_HOST_TEXT",
			hostFreeMemMiB: 42,
			extra: "UNSAFE_HOST_TEXT",
		});
		diag.fail();
		const text = readFileSync(join(root, "failure.json"), "utf8");
		expect(text).not.toContain("UNSAFE_HOST_TEXT");
		expect(JSON.parse(text).phaseFailure).toMatchObject({
			cause: "launch-timeout",
			hostLoadAvg1m: "UNOBSERVED",
			hostFreeMemMiB: 42,
		});
		expect(
			readFileSync(
				new URL("./auth-retirement-ios-proof.ts", import.meta.url),
				"utf8",
			),
		).toContain("seedHost,");
	});
});
