/**
 * Reviewed fix for seed replay 41768325986: it failed with `command-timeout`
 * BEFORE openurl, and its receipt could not say which command. These tests pin
 * the two parts of that fix and that neither weakens what the replay proves:
 *
 * (a) a per-phase receipt that names where a run stopped (diagnostic only), and
 * (b) simulator boot + readiness on their OWN clock (mirroring the proof
 *     harness's BOOT_READY_BUDGET_MS), with the 300s work clock resuming with
 *     exactly what it had left, never renewed.
 */
import { describe, expect, it } from "vitest";
import { BOOT_READY_BUDGET_MS } from "./auth-retirement-ios-proof.ts";
import { Deadline, ReplayRefused } from "./retirement-replay-core.ts";
import {
	type ExportSummary,
	safeSummary,
} from "./retirement-replay-evidence.ts";
import {
	bootPhase,
	PhaseLog,
	REPLAY_BOOT_BUDGET_MS,
} from "./retirement-replay-lifecycle.ts";
import { REPLAY_POLICY } from "./retirement-replay-policy.ts";

function manualClock(start = 0) {
	let now = start;
	return {
		clock: () => now,
		advance: (ms: number) => {
			now += ms;
		},
	};
}

describe("boot budget", () => {
	it("mirrors the proof harness's BOOT_READY_BUDGET_MS instead of inventing a number", () => {
		expect(REPLAY_BOOT_BUDGET_MS).toBe(BOOT_READY_BUDGET_MS);
		expect(REPLAY_BOOT_BUDGET_MS).toBe(300000);
	});
	it("boot-timeout is an allowlisted cause, so it survives export", () => {
		expect(REPLAY_POLICY.failureCauses).toContain("boot-timeout");
	});
});

describe("Deadline.excluding", () => {
	it("stops the work clock during boot and resumes with exactly what was left", async () => {
		const t = manualClock();
		const deadline = new Deadline(300000, t.clock);
		t.advance(10000);
		expect(deadline.remaining()).toBe(290000);
		await deadline.excluding(async () => {
			t.advance(250000); // a cold boot longer than the old shared budget allowed
		});
		expect(deadline.remaining()).toBe(290000);
		t.advance(290000);
		expect(() => deadline.cap(1)).toThrow(ReplayRefused);
	});
	it("resumes the clock even when boot throws, and never renews it", async () => {
		const t = manualClock();
		const deadline = new Deadline(1000, t.clock);
		t.advance(400);
		await expect(
			deadline.excluding(async () => {
				t.advance(5000);
				throw new ReplayRefused("boot-timeout");
			}),
		).rejects.toMatchObject({ code: "boot-timeout" });
		expect(deadline.remaining()).toBe(600);
	});
	it("refuses a nested pause and a pause on an exhausted clock", async () => {
		const t = manualClock();
		const deadline = new Deadline(100, t.clock);
		await expect(
			deadline.excluding(() => deadline.excluding(async () => undefined)),
		).rejects.toMatchObject({ code: "stage" });
		t.advance(100);
		await expect(
			deadline.excluding(async () => undefined),
		).rejects.toMatchObject({ code: "deadline" });
	});
});

describe("bootPhase classification", () => {
	it("a boot overrun is boot-timeout, not command-timeout", async () => {
		for (const code of ["command-timeout", "deadline"])
			await expect(
				bootPhase(async () => {
					throw new ReplayRefused(code);
				}),
			).rejects.toMatchObject({ code: "boot-timeout" });
	});
	it("any other boot failure keeps its own cause", async () => {
		await expect(
			bootPhase(async () => {
				throw new ReplayRefused("command-exit");
			}),
		).rejects.toMatchObject({ code: "command-exit" });
	});
	it("a work-phase command-timeout after boot is still command-timeout", async () => {
		const phases = new PhaseLog();
		await phases.step("boot", async () => undefined);
		await expect(
			phases.step("install", async () => {
				throw new ReplayRefused("command-timeout");
			}),
		).rejects.toMatchObject({ code: "command-timeout" });
		expect(phases.failed).toBe("install");
	});
});

describe("PhaseLog", () => {
	it("records elapsed time per phase and names the FIRST failing phase", async () => {
		const t = manualClock();
		const phases = new PhaseLog(t.clock);
		await phases.step("create", async () => t.advance(1200));
		await expect(
			phases.step("bootstatus", async () => {
				t.advance(300000);
				throw new ReplayRefused("boot-timeout");
			}),
		).rejects.toThrow();
		await expect(
			phases.step("install", async () => {
				throw new ReplayRefused("command-exit");
			}),
		).rejects.toThrow();
		expect(phases.failed).toBe("bootstatus");
		expect(phases.phases).toEqual([
			{ name: "create", elapsedMs: 1200, status: "ok" },
			{ name: "bootstatus", elapsedMs: 300000, status: "failed" },
			{ name: "install", elapsedMs: 0, status: "failed" },
		]);
	});
});

describe("phase export", () => {
	const base: ExportSummary = {
		phase: "seed",
		mode: "seed-replay",
		seedPersisted: false,
		acceptanceComplete: false,
		cause: "boot-timeout",
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
	};
	it("exports the failing phase next to the cause, and phase timings", () => {
		const out = safeSummary({
			...base,
			failedPhase: "bootstatus",
			phases: [
				{ name: "create", elapsedMs: 900, status: "ok" },
				{ name: "bootstatus", elapsedMs: 300000, status: "failed" },
			],
		});
		expect(out.cause).toBe("boot-timeout");
		expect(out.failedPhase).toBe("bootstatus");
		expect(out.phases).toEqual([
			{ name: "create", elapsedMs: 900, status: "ok" },
			{ name: "bootstatus", elapsedMs: 300000, status: "failed" },
		]);
	});
	it("drops unknown phase names, bad timings and extra fields (no command lines, paths or udids)", () => {
		const out = safeSummary({
			...base,
			failedPhase: "xcrun simctl boot 1234" as never,
			phases: [
				{ name: "boot", elapsedMs: -1, status: "ok" },
				{ name: "/Users/runner/x" as never, elapsedMs: 5, status: "ok" },
				{
					name: "install",
					elapsedMs: 7,
					status: "ok",
					argv: ["secret"],
				} as never,
				{ name: "launch", elapsedMs: 1.5, status: "ok" },
			],
		});
		expect(out.failedPhase).toBeNull();
		expect(out.phases).toEqual([
			{ name: "install", elapsedMs: 7, status: "ok" },
		]);
		expect(JSON.stringify(out)).not.toContain("secret");
	});
	it("the receipt never turns UNOBSERVED into a pass", () => {
		const out = safeSummary({
			...base,
			cause: null,
			failedPhase: null,
			phases: [{ name: "openurl", elapsedMs: 10, status: "ok" }],
		});
		expect(out.acceptanceComplete).toBe(false);
		for (const value of Object.values(out.observations))
			expect(value).toBe("UNOBSERVED");
	});
});
