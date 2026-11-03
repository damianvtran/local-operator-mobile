/** Closed diagnostic vocabulary, not a new proof/admission protocol. Never
 * retain native errors, callback URLs, output text, credentials or paths. The
 * app duplicates STAGES because the Node host must not import React Native. */

import {
	ProofCommandTimeout,
	sanitizeHostNumbers,
	sanitizeTimeoutHostNumbers,
} from "./auth-retirement-launch.ts";
import { sanitizeProgress } from "./auth-retirement-progress.ts";
import { safeUrlProgress } from "./auth-retirement-readiness.ts";
import type { Run } from "./auth-retirement-simulator.ts";
export const PROBE_OBSERVATIONS = [
	"observed",
	"timeout",
	"malformed",
	"error",
] as const;
export type ProbeObservation = (typeof PROBE_OBSERVATIONS)[number];
const probeObservation = (value: unknown): ProbeObservation =>
	PROBE_OBSERVATIONS.find((code) => code === value) ?? "error";
export const APP_STAGES = [
	"seed-store-not-empty",
	"seed-write-not-persistent",
	"replace-not-persisted",
	"retire-held-mismatch",
	"retire-no-bearer",
	"retire-still-present",
	"restore-write-not-persistent",
	"restore-account-mismatch",
	"restore-persist-control",
	"restore-fresh",
	"restore-retired",
	"exception",
	"other",
] as const;
export const REFUSED_REASONS = [
	"method-or-path",
	"nonce",
	"no-waiter",
	"body-cap",
	"json",
	"unknown-key",
	"phase-mismatch",
	"flavor-mismatch",
	"source-mismatch",
	"coarse-type",
	"stage-unknown",
	"progress-unknown",
] as const;
export const PHASE_CAUSES = [
	"step-ceiling",
	"launch-timeout",
	"scheme-unregistered",
	"receiver-bind-failed",
	"ready-timeout",
	"receipt-timeout",
	"phase-rejected",
	"transport-count",
	"persistence-absent",
	"durable-unconfirmed",
	"verifier-negative",
	"verifier-positive",
	"launch-identity",
	"other",
] as const;
const PHASES = [
	"seed",
	"persist-control",
	"retire",
	"retired-restore",
	"fresh-replace",
	"fresh-restore",
];
export type RefusedReason = (typeof REFUSED_REASONS)[number];
export type PhaseCause = (typeof PHASE_CAUSES)[number];
export const appStage = (value: unknown): (typeof APP_STAGES)[number] =>
	APP_STAGES.find((stage) => stage === value) ?? "other";
export const refusedCounts = () =>
	Object.fromEntries(REFUSED_REASONS.map((reason) => [reason, 0])) as Record<
		RefusedReason,
		number
	>;
export function countRefused(
	counts: Record<RefusedReason, number>,
	reason: RefusedReason,
): void {
	counts[reason] = Math.min(1000000, counts[reason] + 1);
}
export function receiptRefusal(
	r: unknown,
	phase: string,
	flavor: string,
	source: string,
): RefusedReason | null {
	if (!r || typeof r !== "object" || Array.isArray(r)) return "coarse-type";
	const value = r as Record<string, unknown>;
	const allowed = new Set([
		"phase",
		"ok",
		"flavor",
		"sourceSha",
		"rawOauthPresent",
		"durableRetired",
		"restored",
		"refreshes",
		"publishes",
		"deletes",
		"stage",
	]);
	if (Object.keys(value).some((key) => !allowed.has(key))) return "unknown-key";
	if (value.phase !== phase) return "phase-mismatch";
	if (value.flavor !== flavor) return "flavor-mismatch";
	if (value.sourceSha !== source) return "source-mismatch";
	for (const key of ["rawOauthPresent", "durableRetired", "restored"])
		if (key in value && typeof value[key] !== "boolean") return "coarse-type";
	for (const key of ["refreshes", "publishes", "deletes"])
		if (
			key in value &&
			(!Number.isSafeInteger(value[key]) ||
				Number(value[key]) < 0 ||
				Number(value[key]) > 8)
		)
			return "coarse-type";
	if ("stage" in value) {
		if (typeof value.stage !== "string") return "coarse-type";
		if (!APP_STAGES.some((stage) => stage === value.stage))
			return "stage-unknown";
	}
	return null;
}
/** Same existing failure predicates and order; only give them fixed names. */
export function receiptCause(
	phase: string,
	r: Record<string, unknown>,
	outbound: number,
): PhaseCause | null {
	if (r.ok !== true) return "phase-rejected";
	if (
		(["persist-control", "retire"].includes(phase) && outbound !== 1) ||
		(!["persist-control", "retire"].includes(phase) && outbound !== 0)
	)
		return "transport-count";
	if (["seed", "fresh-replace"].includes(phase) && r.rawOauthPresent !== true)
		return "persistence-absent";
	if (
		phase === "retire" &&
		(r.durableRetired !== true || r.rawOauthPresent !== false)
	)
		return "durable-unconfirmed";
	return null;
}
export async function observeOwnedProcess(
	udid: string,
	run: Run,
): Promise<{
	processAliveAtTimeout: boolean | "UNOBSERVED";
	processAliveObservation: ProbeObservation;
}> {
	try {
		const output = await run("xcrun", [
			"simctl",
			"spawn",
			udid,
			"launchctl",
			"list",
		]);
		// launchctl retains stopped jobs with PID "-". A label alone is not
		// liveness, and substring matches would admit another application's job.
		const proofId = "com.localoperator.mobile.retirementproof";
		const uiLabel = `UIKitApplication:${proofId}`;
		let alive = false;
		for (const line of output.split("\n")) {
			const columns = line.split("\t");
			// Locate a possible label even on a malformed non-tab-separated row;
			// such a matching row is UNOBSERVED, never evidence of absence.
			const label = (
				columns.length >= 3 ? columns.at(-1) : line.trim().split(/\s+/).at(-1)
			)?.trim();
			if (
				label !== proofId &&
				label !== uiLabel &&
				!label?.startsWith(`${uiLabel}[`)
			)
				continue;
			if (columns.length !== 3 || !/^-?\d+$/.test(columns[1]?.trim() ?? ""))
				return {
					processAliveAtTimeout: "UNOBSERVED",
					processAliveObservation: "malformed",
				};
			const pid = columns[0]?.trim();
			if (pid === "-") continue;
			if (!/^[1-9]\d*$/.test(pid ?? "") || !Number.isSafeInteger(Number(pid)))
				return {
					processAliveAtTimeout: "UNOBSERVED",
					processAliveObservation: "malformed",
				};
			alive = true;
		}
		return {
			processAliveAtTimeout: alive,
			processAliveObservation: "observed",
		};
	} catch (error) {
		return {
			processAliveAtTimeout: "UNOBSERVED",
			processAliveObservation:
				error instanceof ProofCommandTimeout ? "timeout" : "error",
		};
	}
}
const safeNumber = (value: unknown): number | null =>
	typeof value === "number" && Number.isFinite(value) && value >= 0
		? value
		: null;
export function sanitizePhaseFailure(
	input: Record<string, unknown>,
): Record<string, unknown> {
	if (input.cause === "step-ceiling")
		return {
			cause: "step-ceiling",
			phase: PHASES.find((value) => value === input.phase) ?? null,
			signal:
				input.signal === "SIGINT" || input.signal === "SIGTERM"
					? input.signal
					: "UNOBSERVED",
			...sanitizeProgress(input),
		};
	if (input.cause === "scheme-unregistered")
		return {
			cause: "scheme-unregistered",
			schemeRegistered: input.schemeRegistered === true,
		};
	if (input.cause === "receiver-bind-failed") {
		// Bind failures are setup failures, not listener/phase timeouts. Only the
		// selected numeric port and closed errno survive; never native error text.
		return {
			cause: "receiver-bind-failed",
			port:
				Number.isInteger(input.port) &&
				Number(input.port) >= 20000 &&
				Number(input.port) <= 39999
					? input.port
					: null,
			code:
				input.code === "EADDRINUSE" || input.code === "EACCES"
					? input.code
					: "other",
		};
	}
	const rawCounts =
		input.refused && typeof input.refused === "object"
			? (input.refused as Record<string, unknown>)
			: {};
	const cause = PHASE_CAUSES.find((value) => value === input.cause) ?? "other";
	return {
		phase: PHASES.find((value) => value === input.phase) ?? null,
		...(input.phase === "seed" ? sanitizeHostNumbers(input) : {}),
		...(input.cause === "receipt-timeout"
			? sanitizeTimeoutHostNumbers(input)
			: {}),
		...("processAliveObservation" in input
			? {
					processAliveObservation: probeObservation(
						input.processAliveObservation,
					),
				}
			: {}),
		...("schemeLogObservation" in input
			? { schemeLogObservation: probeObservation(input.schemeLogObservation) }
			: {}),
		cause,
		...(cause === "phase-rejected"
			? { appStage: appStage(input.appStage) }
			: {}),
		refused: Object.fromEntries(
			REFUSED_REASONS.map((reason) => [
				reason,
				Number.isSafeInteger(rawCounts[reason]) &&
				Number(rawCounts[reason]) >= 0
					? Math.min(1000000, Number(rawCounts[reason]))
					: 0,
			]),
		),
		schemeOpenSeenBySystem:
			typeof input.schemeOpenSeenBySystem === "boolean"
				? input.schemeOpenSeenBySystem
				: "UNOBSERVED",
		schemeOpenSeenByApp:
			typeof input.schemeOpenSeenByApp === "boolean"
				? input.schemeOpenSeenByApp
				: "UNOBSERVED",
		readyAfterLaunchMs: safeNumber(input.readyAfterLaunchMs),
		urlProgress: safeUrlProgress(input.urlProgress),
		launchToOpenurlMs: safeNumber(input.launchToOpenurlMs),
		openurlToOutcomeMs: safeNumber(input.openurlToOutcomeMs),
		processAliveAtTimeout:
			typeof input.processAliveAtTimeout === "boolean"
				? input.processAliveAtTimeout
				: "UNOBSERVED",
	};
}
