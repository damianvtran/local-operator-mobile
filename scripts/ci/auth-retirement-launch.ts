/** First-launch allowance only; never widen another native command/phase. */
import { freemem, loadavg } from "node:os";
import {
	type createReadyGate,
	launchWithReady,
	READY_BUDGET_MS,
	ReadyTimeout,
} from "./auth-retirement-readiness.ts";
import type { Run } from "./auth-retirement-simulator.ts";
export const DEFAULT_COMMAND_BUDGET_MS = 30000;
// Run41567840095: launch exited0 at30.3s but its30s timer fired first.
export const FIRST_LAUNCH_BUDGET_MS = 60000;
export const SEED_READY_BUDGET_MS =
	READY_BUDGET_MS + (FIRST_LAUNCH_BUDGET_MS - DEFAULT_COMMAND_BUDGET_MS);
// Wait/probe subtotal:300+120+(75+60)+5*(45+60)+30+30=1140s <=1200s.
// NOT a full worst-case bound: four30s identity commands/phase add720s and
// two10s verifiers add20s =>1880s even before setup/cleanup and sync file I/O.
// The unchanged20m workflow ceiling remains a hard stop with always() cleanup.
export class ProofCommandTimeout extends Error {
	constructor() {
		super("Proof subprocess failed or timed out");
	}
}
export class ProofLaunchTimeout extends ProofCommandTimeout {}
export function launchFailureCause(
	error: unknown,
): "launch-timeout" | "ready-timeout" | "launch-identity" {
	return error instanceof ProofLaunchTimeout
		? "launch-timeout"
		: error instanceof ReadyTimeout
			? "ready-timeout"
			: "launch-identity";
}
export type HostNumbers = {
	hostLoadAvg1m: number | "UNOBSERVED";
	hostFreeMemMiB: number | "UNOBSERVED";
};
const numeric = (value: unknown): number | "UNOBSERVED" =>
	typeof value === "number" && Number.isFinite(value) && value >= 0
		? value
		: "UNOBSERVED";
export function sanitizeHostNumbers(
	value: Record<string, unknown>,
): HostNumbers {
	return {
		hostLoadAvg1m: numeric(value.hostLoadAvg1m),
		hostFreeMemMiB: numeric(value.hostFreeMemMiB),
	};
}
export function captureSeedHost(
	readLoad: () => number[] = loadavg,
	readFree: () => number = freemem,
): HostNumbers {
	// macOS freemem counts FREE pages only, excluding inactive/purgeable pages.
	// It understates available memory: compare runs, never treat it as headroom.
	try {
		const load = numeric(readLoad()[0]),
			free = numeric(readFree());
		return sanitizeHostNumbers({
			hostLoadAvg1m:
				typeof load === "number" ? Math.round(load * 100) / 100 : load,
			hostFreeMemMiB:
				typeof free === "number" ? Math.round(free / 1048576) : free,
		});
	} catch {
		return sanitizeHostNumbers({});
	}
}
export type TimeoutHostNumbers = {
	timeoutHostLoadAvg1m: number | "UNOBSERVED";
	timeoutHostFreeMemMiB: number | "UNOBSERVED";
};
export function sanitizeTimeoutHostNumbers(
	value: Record<string, unknown>,
): TimeoutHostNumbers {
	const safe = sanitizeHostNumbers({
		hostLoadAvg1m: value.timeoutHostLoadAvg1m,
		hostFreeMemMiB: value.timeoutHostFreeMemMiB,
	});
	return {
		timeoutHostLoadAvg1m: safe.hostLoadAvg1m,
		timeoutHostFreeMemMiB: safe.hostFreeMemMiB,
	};
}
export function captureTimeoutHost(
	readLoad?: () => number[],
	readFree?: () => number,
): TimeoutHostNumbers {
	// Same free-pages-only caveat as the launch sample; not available headroom.
	const safe = captureSeedHost(readLoad, readFree);
	return {
		timeoutHostLoadAvg1m: safe.hostLoadAvg1m,
		timeoutHostFreeMemMiB: safe.hostFreeMemMiB,
	};
}
export async function launchProofPhase(
	name: string,
	udid: string,
	proofId: string,
	run: Run,
	gate: ReturnType<typeof createReadyGate>,
	beforeSeedLaunch: () => void = () => {},
) {
	return launchWithReady(
		gate,
		async () => {
			if (name === "seed") beforeSeedLaunch();
			try {
				return await run(
					"xcrun",
					["simctl", "launch", "--terminate-running-process", udid, proofId],
					name === "seed" ? FIRST_LAUNCH_BUDGET_MS : DEFAULT_COMMAND_BUDGET_MS,
				);
			} catch (error) {
				if (error instanceof ProofCommandTimeout)
					throw new ProofLaunchTimeout();
				throw error;
			}
		},
		name === "seed" ? SEED_READY_BUDGET_MS : READY_BUDGET_MS,
	);
}
