import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	activeProofDiagnostics,
	commandCategory,
	withProofDiagnostics,
} from "./auth-retirement-diagnostics.ts";
import {
	BOOT_READY_BUDGET_MS,
	FIRST_INSTALL_BUDGET_MS,
	prepareOwnedSimulator,
} from "./auth-retirement-ios-proof.ts";
import {
	prepareCreation,
	type Run,
	recoverCreation,
	writeDurable,
} from "./auth-retirement-simulator.ts";

const udid = "11111111-1111-1111-1111-111111111111";
const app = "synthetic-proof.app";
const roots: string[] = [];
afterEach(() => {
	// Retire only private children this file actually created, never the shared
	// harness/runner/temp parent. Failed setup/assertions must also clean up.
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});

describe("dedicated-device cold-start gates, injected SDK boundary", () => {
	it("waits for the exact owned device with only boot-ready's first-boot budget", async () => {
		const calls: unknown[][] = [];
		const run: Run = async (...args) => {
			calls.push(args);
			return "";
		};
		await prepareOwnedSimulator(udid, app, async () => {}, run);
		expect(BOOT_READY_BUDGET_MS).toBe(300000);
		expect(calls[0]).toEqual(["xcrun", ["simctl", "boot", udid]]);
		expect(calls[1]).toEqual([
			"xcrun",
			["simctl", "bootstatus", udid, "-b"],
			BOOT_READY_BUDGET_MS,
		]);
	});

	it("re-verifies immutable content before installing with its distinct first-install cap", async () => {
		const order: string[] = [];
		const calls: unknown[][] = [];
		const run: Run = async (...args) => {
			calls.push(args);
			order.push(args[1][1]!);
			return "";
		};
		await prepareOwnedSimulator(
			udid,
			app,
			async () => {
				order.push("verify");
			},
			run,
		);
		expect(FIRST_INSTALL_BUDGET_MS).toBe(120000);
		expect(order).toEqual(["boot", "bootstatus", "verify", "install"]);
		expect(calls[2]).toEqual([
			"xcrun",
			["simctl", "install", udid, app],
			FIRST_INSTALL_BUDGET_MS,
		]);
	});

	it("does not install when the original immutable-artifact admission fails", async () => {
		const operations: string[] = [];
		const run: Run = async (_exe, args) => {
			operations.push(args[1]!);
			return "";
		};
		await expect(
			prepareOwnedSimulator(
				udid,
				app,
				async () => {
					throw new Error("synthetic mismatch");
				},
				run,
			),
		).rejects.toThrow("synthetic mismatch");
		expect(operations).toEqual(["boot", "bootstatus"]);
	});

	it.each(["bootstatus", "install"] as const)(
		"keeps a simulated %s timeout BLOCKED before phases while attempting owned-intent cleanup",
		async (failedOperation) => {
			// Exercise the real diagnostics and ownership-recovery code, not xcrun.
			// This proves host control flow only; it is not simulator/native evidence.
			const root = mkdtempSync(
				join(
					process.env.LOCAL_OPERATOR_SCRATCHPAD ??
						process.env.RUNNER_TEMP ??
						tmpdir(),
					"cold-start-regression-",
				),
			);
			roots.push(root);
			const fields = {
				nonce: "a".repeat(32),
				runId: "123456",
				hostPid: process.pid,
				runtime: "synthetic-runtime",
				deviceType: "synthetic-type",
				templateUdid: "22222222-2222-2222-2222-222222222222",
			};
			const intent = prepareCreation(root, fields);
			intent.state = "settled";
			writeDurable(join(root, "creation-intent.json"), intent);
			const phases: string[] = [];
			const cleanupCalls: string[][] = [];
			const run: Run = async (exe, args, budget) => {
				if (args[1] === failedOperation) {
					const diag = activeProofDiagnostics!;
					diag.finish(
						diag.begin(commandCategory(exe, args)),
						"timeout",
						null,
						"SIGKILL",
						{
							budgetMs: budget!,
							exitAfterMs: budget!,
							closeAfterMs: budget!,
							timerAfterMs: budget!,
							stdoutEndAfterMs: budget!,
							stderrEndAfterMs: budget!,
							exitCode: null,
							exitSignal: "SIGKILL",
							killResult: "sent",
						},
					);
					throw new Error("simulated owned-command timeout");
				}
				return "";
			};
			const cleanupRun: Run = async (_exe, args) => {
				cleanupCalls.push(args);
				return args[1] === "list"
					? JSON.stringify({
							devices: {
								[intent.runtime]: [
									{
										udid,
										name: intent.name,
										state: "Booted",
										deviceTypeIdentifier: intent.deviceType,
									},
								],
							},
						})
					: "";
			};
			await expect(
				withProofDiagnostics(root, async () => {
					try {
						await prepareOwnedSimulator(udid, app, async () => {}, run);
						phases.push("seed");
					} catch (error) {
						activeProofDiagnostics?.fail();
						throw error;
					} finally {
						activeProofDiagnostics?.checkpoint("cleanup");
						await recoverCreation(root, fields.nonce, fields.runId, cleanupRun);
					}
				}),
			).rejects.toThrow("simulated owned-command timeout");
			expect(phases).toEqual([]);
			expect(cleanupCalls).toContainEqual(["simctl", "shutdown", udid]);
			expect(cleanupCalls).toContainEqual(["simctl", "delete", udid]);
			expect(
				JSON.parse(readFileSync(join(root, "failure.json"), "utf8")),
			).toMatchObject({
				classification: "BLOCKED",
				checkpoint: failedOperation === "bootstatus" ? "boot-ready" : "install",
				phase: null,
				command: { category: failedOperation, outcome: "timeout" },
			});
		},
	);
});
