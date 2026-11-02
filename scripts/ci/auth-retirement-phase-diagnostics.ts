/** Closed diagnostic vocabulary, not a new proof/admission protocol. Never
 * retain native errors, callback URLs, output text, credentials or paths. The
 * app duplicates STAGES because the Node host must not import React Native. */
import type { Run } from "./auth-retirement-simulator.ts";
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
] as const;
export const PHASE_CAUSES = [
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
		value.stage = appStage(value.stage);
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
): Promise<boolean | "UNOBSERVED"> {
	try {
		const output = await run("xcrun", [
			"simctl",
			"spawn",
			udid,
			"launchctl",
			"list",
		]);
		return output
			.split("\n")
			.some((line) =>
				line.includes("com.localoperator.mobile.retirementproof"),
			);
	} catch {
		return "UNOBSERVED";
	}
}
const safeNumber = (value: unknown): number | null =>
	typeof value === "number" && Number.isFinite(value) && value >= 0
		? value
		: null;
export function sanitizePhaseFailure(
	input: Record<string, unknown>,
): Record<string, unknown> {
	const rawCounts =
		input.refused && typeof input.refused === "object"
			? (input.refused as Record<string, unknown>)
			: {};
	const cause = PHASE_CAUSES.find((value) => value === input.cause) ?? "other";
	return {
		phase: PHASES.find((value) => value === input.phase) ?? null,
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
		launchToOpenurlMs: safeNumber(input.launchToOpenurlMs),
		openurlToOutcomeMs: safeNumber(input.openurlToOutcomeMs),
		processAliveAtTimeout:
			typeof input.processAliveAtTimeout === "boolean"
				? input.processAliveAtTimeout
				: "UNOBSERVED",
	};
}
