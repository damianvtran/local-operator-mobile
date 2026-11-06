/** Run 42044812065 proved the FIRST fresh-proof connect tap produced no JS
 * callback at all: the proof process's route trace stayed at its boot sequence
 * (signed-out/none, revision 0), no supersession fired and no `/me` arrived,
 * while Maestro had physically tapped the correct, enabled row bounds. That is
 * a missed touch delivery, not a route, epoch or network failure.
 * A single re-tap is therefore defensible ONLY behind positive same-process
 * evidence that the callback never ran. Every missing, late or ambiguous datum
 * fails closed: "the Computers screen is still visible" is ALSO what a network
 * refusal, a superseded admission or a hung boot looks like, so it can never
 * authorise a retry on its own. This module owns that decision and nothing else.
 */
export interface StageBCallbackProbe {
	/** Per-JS-process lease minted at boot; a mismatch means another process. */
	processId: string;
	/** Synchronous row-entry count; independent of the capped trace records. */
	presses: number;
	superseded: number;
	revision: number;
	phase: string;
	route: string;
	selected: boolean;
	failure: boolean;
}
export interface StageBLostTapObservation {
	probe: StageBCallbackProbe | null;
	/** Fresh identity requests observed by the authenticated fixture. */
	identityRequests: number;
}
export interface StageBLostTapLease {
	probe: StageBCallbackProbe;
	identityRequests: number;
}
export interface StageBLostTapDecision {
	allow: boolean;
	reason: string;
}
const SAFE_INT = (value: number) => Number.isSafeInteger(value) && value >= 0;
/** Positive evidence, in order. An allow needs EVERY clean datum; one dirty or
 * missing datum refuses. Returning the reason keeps the receipt honest about
 * why a lost tap was or was not retried. */
export function stageBLostTapGate(input: {
	lease: StageBLostTapLease | null;
	observed: StageBLostTapObservation | null;
	retryAttempted: boolean;
}): StageBLostTapDecision {
	if (input.retryAttempted)
		return { allow: false, reason: "lost-tap retry already attempted" };
	if (!input.lease || !input.observed?.probe)
		return { allow: false, reason: "same-process probe unavailable" };
	const lease = input.lease.probe;
	const probe = input.observed.probe;
	for (const [label, record] of [
		["lease", lease],
		["probe", probe],
	] as const)
		for (const value of [record.presses, record.superseded, record.revision])
			if (!SAFE_INT(value))
				return { allow: false, reason: `ambiguous ${label} counter` };
	if (probe.processId !== lease.processId)
		return { allow: false, reason: "probe came from another process" };
	if (lease.presses !== 0 || lease.superseded !== 0)
		return { allow: false, reason: "process already handled a selection" };
	if (probe.presses !== lease.presses)
		return { allow: false, reason: "row callback observed" };
	if (probe.superseded !== 0)
		return { allow: false, reason: "admission supersession observed" };
	if (
		probe.revision !== 0 ||
		probe.phase !== "signed-out" ||
		probe.route !== "none" ||
		probe.selected ||
		probe.failure
	)
		return { allow: false, reason: "route publication observed" };
	// Cumulative across the run, so only a CHANGE since the lease is evidence.
	if (input.observed.identityRequests !== input.lease.identityRequests)
		return { allow: false, reason: "identity request observed" };
	return {
		allow: true,
		reason: "no row callback: tap never reached JavaScript",
	};
}

/** One conditional re-tap per launch, shared by every connect path. It was
 * previously built only inside `relaunch()`, so the FIRST connect after boot
 * (run 42149735954: row tap COMPLETED, zero row-presses, revision 0,
 * signed-out/none, no /me) had no lease and no probe at all — the guard existed
 * and never ran. Keeping the arming here means a new call site cannot forget it. */
export interface StageBLostTapRetry {
	probe: () => Promise<StageBLostTapDecision>;
	record: (decision: StageBLostTapDecision) => void;
}
export interface StageBLostTapRecord {
	leaseProcess: "same-process";
	identityRequests: number;
	attempted: boolean;
	allowed: boolean;
	reason: string;
}
export function createLostTapRetry(input: {
	lease: StageBLostTapLease | null;
	/** Live cumulative count: a CHANGE since the lease refuses the retry. */
	identityRequests: () => number;
	probeCallback: () => Promise<StageBCallbackProbe | null>;
	record: (entry: StageBLostTapRecord) => void;
}): StageBLostTapRetry | undefined {
	const { lease } = input;
	if (!lease) return undefined;
	let attempted = false;
	return {
		probe: async () => {
			const probe = await input.probeCallback();
			const decision = stageBLostTapGate({
				lease,
				observed: probe
					? { probe, identityRequests: input.identityRequests() }
					: null,
				retryAttempted: attempted,
			});
			attempted = decision.allow;
			return decision;
		},
		record: (decision) =>
			input.record({
				leaseProcess: "same-process",
				identityRequests: lease.identityRequests,
				attempted,
				allowed: decision.allow,
				reason: decision.reason,
			}),
	};
}
