/**
 * Whether a PREBUILT native candidate may stand in for this attempt's build.
 *
 * The producer is the expensive half of a native attempt: 25m43s measured on the
 * iOS workflow, 32-45m under hosted variability (runs 42004889147, 42199871420),
 * and a failed E2E attempt pays it again. The Stage B lane already uploads its
 * app as `candidate-app.tgz` in the `stage-b-native-<sha>` artifact, so a repeat
 * attempt on the SAME frozen head can reuse it — but only if identity is proven,
 * never assumed. Everything here is a refusal rule: a candidate is usable only
 * when its embedded source SHA, bundle id and flavor equal this attempt's, and
 * its nonce is the shape the fixture mints.
 *
 * The nonce is the part worth stating plainly: it is embedded in the app's
 * Info.plist AND in `main.jsbundle`, and binds an app to the fixture for one run.
 * A reused app therefore brings its own nonce, which the fixture must adopt for
 * this attempt (each attempt still mints its own fixture and its own evidence;
 * the nonce binds app↔fixture, not app↔attempt). Consumption stays behind an
 * explicit flag so that decision is taken deliberately, not by accident.
 */
export interface StageBCandidateIdentity {
	sourceSha: string;
	nonce: string;
	bundleId: string;
	flavor: string;
}
export interface StageBCandidateExpectation {
	sourceSha: string;
	bundleId: string;
	flavor: string;
}
export type StageBCandidateSource = "prebuilt" | "built";
/** The fixture's own nonce shape: 16 random bytes, hex. */
export const STAGE_B_CANDIDATE_NONCE = /^[a-f0-9]{32}$/;
export function verifyStageBCandidate(
	found: StageBCandidateIdentity | null,
	expected: StageBCandidateExpectation,
): { ok: boolean; reason: string } {
	if (found === null)
		return { ok: false, reason: "no readable candidate identity" };
	if (found.sourceSha !== expected.sourceSha)
		return {
			ok: false,
			reason: `candidate source SHA mismatch: ${found.sourceSha} != ${expected.sourceSha}`,
		};
	if (found.bundleId !== expected.bundleId)
		return {
			ok: false,
			reason: `candidate bundle id mismatch: ${found.bundleId} != ${expected.bundleId}`,
		};
	if (found.flavor !== expected.flavor)
		return {
			ok: false,
			reason: `candidate flavor mismatch: ${found.flavor} != ${expected.flavor}`,
		};
	if (!STAGE_B_CANDIDATE_NONCE.test(found.nonce))
		return { ok: false, reason: "candidate nonce is not the fixture's shape" };
	return { ok: true, reason: "candidate identity matches the frozen head" };
}
/** Which half of the receipt this attempt had to pay for. */
export function stageBCandidateSource(
	consumed: boolean,
): StageBCandidateSource {
	return consumed ? "prebuilt" : "built";
}

/** Whether this attempt may consume a prebuilt candidate at all.
 *
 * Default ON. The only value that turns it off is the literal `"false"`; anything
 * else (including unset) means "try, and fall back to building when the artifact
 * is missing or refused". */
export function stageBShouldConsumeCandidate(value: string | undefined): {
	consume: boolean;
	reason: string;
} {
	if (value === "false")
		return { consume: false, reason: "STAGE_B_CONSUME_CANDIDATE=false" };
	return {
		consume: true,
		reason: "candidate reuse is the native-lane default",
	};
}
