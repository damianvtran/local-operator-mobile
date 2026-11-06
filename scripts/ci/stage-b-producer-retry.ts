/**
 * The one bounded re-run of the native producer, and only for its own timeout.
 *
 * The producer is 25-45 minutes (25m43s measured on the iOS workflow, 2719.6s at
 * the cap on runs 42004889147 and 42199871420) and both of those failures were
 * build-shape rather than code-shaped: the same head built in 25m43s on the
 * sibling lane. A single retry of a timeout with NO artifact is therefore worth
 * its cost — and nothing else is.
 *
 * Reusing an app from an earlier attempt is NOT safe, which is why this module
 * exists instead of that shortcut: the fixture binds an ephemeral
 * `listen(0)` port into `config.fixtureOrigin` (src/testing/fixture-relay.ts:414),
 * the producer freezes that whole config into the app
 * (stage-b-draft-build.ts:65), so a prebuilt app posts its control requests to a
 * port that no longer exists — and a lane that skipped the producer could never
 * fall back to building. Round 36's B1, recorded on PR #156 rather than fixed by
 * a flag.
 *
 * Rules, all of them refusals: exactly one retry; only when the FIRST attempt
 * ended in its own timeout (`timedOut` true, which the command receipt records
 * separately from `rc`); and only when no app artifact exists, so a partial or
 * real error can never be masked by a second run.
 */
export interface StageBProducerAttempt {
	timedOut: boolean;
	elapsedMs: number;
}
export function stageBShouldRetryProducer(input: {
	attempts: number;
	last: StageBProducerAttempt | null;
	artifactPresent: boolean;
}): { allow: boolean; reason: string } {
	if (input.attempts !== 1)
		return { allow: false, reason: "producer retry is one-time only" };
	if (input.last === null)
		return { allow: false, reason: "no producer command receipt to judge" };
	if (!input.last.timedOut)
		return {
			allow: false,
			reason:
				"producer failed without a timeout: a real build error is never retried",
		};
	if (input.artifactPresent)
		return { allow: false, reason: "an app artifact already exists" };
	return {
		allow: true,
		reason: `producer timed out after ${Math.round(input.last.elapsedMs / 1000)}s with no artifact`,
	};
}
