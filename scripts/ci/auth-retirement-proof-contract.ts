/** Source-only artifact admission contract. No credential values belong here. */
export interface ProofBuildIdentity {
	flavor: string;
	bundleId: string;
	nonce: string;
	sourceSha: string;
	bundleSha256: string;
}
export interface ProofProcessIdentity extends ProofBuildIdentity {
	udid: string;
	pid: number;
}
export function assertProofBuild(
	actual: ProofBuildIdentity,
	expected: ProofBuildIdentity,
): void {
	/* A launch nonce is not authorization to turn a distributable into a seed
	 * surface. Both artifact metadata and the expected CI identity must name the
	 * dedicated unsigned proof flavor before any phase command is considered. */
	for (const identity of [actual, expected]) {
		if (
			identity.flavor !== "auth-retirement-proof" ||
			identity.bundleId !== "com.localoperator.mobile.retirementproof" ||
			!/^[a-f0-9]{32}$/.test(identity.nonce) ||
			!/^[a-f0-9]{40}$/.test(identity.sourceSha) ||
			!/^[a-f0-9]{64}$/.test(identity.bundleSha256)
		)
			throw new Error("Retirement proof artifact identity refused");
	}
	for (const field of [
		"flavor",
		"bundleId",
		"nonce",
		"sourceSha",
		"bundleSha256",
	] as const)
		if (actual[field] !== expected[field])
			throw new Error(`Retirement proof identity mismatch: ${field}`);
}
export function assertRestartIdentity(
	before: ProofProcessIdentity,
	after: ProofProcessIdentity,
): void {
	assertProofBuild(after, before);
	/* Same keychain scope is the premise: no reinstall/reseed or new simulator
	 * may stand in for a process restart. UDID/PID are coarse identity, not keys. */
	if (
		!before.udid ||
		before.udid !== after.udid ||
		!Number.isSafeInteger(before.pid) ||
		before.pid <= 0 ||
		!Number.isSafeInteger(after.pid) ||
		after.pid <= 0 ||
		before.pid === after.pid
	)
		throw new Error(
			"Retirement proof did not restart on the same owned simulator",
		);
}
/** Coarse native observations only. Missing evidence is failure, never "zero". */
export function assertRetiredRestore(receipt: unknown): void {
	if (typeof receipt !== "object" || receipt === null)
		throw new Error("Missing retired restore receipt");
	const r = receipt as Record<string, unknown>;
	if (
		r.phase !== "retired-restore" ||
		r.ok !== true ||
		r.restored !== false ||
		r.rawOauthPresent !== false ||
		r.refreshes !== 0 ||
		r.publishes !== 0 ||
		r.deletes !== 0
	)
		throw new Error(
			"Native retired restore did not remain unauthorized and transport-silent",
		);
}

/** Independently frozen CI build receipt, not adversarial runner attestation. */
export const assertInstalledArtifact = assertProofBuild;
export interface OwnedSimulatorLease {
	udid: string;
	hostPid: number;
	nonce: string;
}
export function assertOwnedLease(
	actual: OwnedSimulatorLease,
	owned: OwnedSimulatorLease,
): void {
	if (
		!actual.udid ||
		actual.udid !== owned.udid ||
		actual.hostPid !== owned.hostPid ||
		actual.hostPid !== process.pid ||
		actual.nonce !== owned.nonce ||
		!/^[a-f0-9]{32}$/.test(actual.nonce)
	)
		throw new Error("Simulator lease is not owned by this proof host");
}
export type VerifierResult = {
	status: number | null;
	signal: string | null;
	error: boolean;
	stdout: string;
};
export function classifyVerifierResult(
	result: VerifierResult,
): "accepted" | "expected-rejection" | "blocked" {
	if (result.error || result.signal) return "blocked";
	try {
		const verdict = JSON.parse(result.stdout) as Record<string, unknown>;
		if (verdict.kind !== "retired-restore-verdict") return "blocked";
		if (result.status === 0 && verdict.reason === "ACCEPTED") return "accepted";
		if (result.status === 42 && verdict.reason === "AUTHORIZED_RESTORE")
			return "expected-rejection";
	} catch {
		/* malformed/import/startup output is a harness failure */
	}
	return "blocked";
}
