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

/**
 * Why a same-process lease could not be established.
 *
 * `null` from the raw probe means "no usable answer", which is the right
 * fail-closed input for the gate but a useless record: run 42166849295 recorded
 * `reason: "same-process probe unavailable"` for the relaunch lane and nothing
 * else, so the run could not say whether the app was still booting, the probe
 * timed out, or the payload was dirty. The lease builder asks the app only once
 * it has posted a startup receipt, and this classifies what came back so the
 * receipt carries the answer instead of a shrug.
 */
export type StageBProbeFailure =
	| "timeout"
	| "invalid-payload"
	| "not-requested";
export interface StageBProbeAvailability {
	available: boolean;
	reason: StageBProbeFailure | "answered";
	/** The recorded sentence: stable enough to assert, plain enough to read. */
	message: string;
}
const PROBE_MESSAGES: Readonly<
	Record<StageBProbeFailure | "answered", string>
> = {
	answered: "same-process probe answered",
	timeout: "same-process probe timed out",
	"invalid-payload": "same-process probe answered with an unreadable payload",
	"not-requested": "same-process probe not requested",
};
export function stageBProbeAvailability(
	outcome: StageBProbeFailure | "answered",
): StageBProbeAvailability {
	return {
		available: outcome === "answered",
		reason: outcome,
		message: PROBE_MESSAGES[outcome],
	};
}

/**
 * The re-tap gate, decided on evidence the FIXTURE observes.
 *
 * Run 42181646348 made the in-app probe the single unreliable link: it answered
 * on one launch and timed out on another (`reason: timeout`), so a legitimate
 * lost tap was refused for want of a corroborating signal that the app cannot
 * promise to deliver after a cold relaunch. The probe is now OPTIONAL: when it
 * answers it must agree, and when it does not the wire evidence decides.
 *
 * Every datum here is something the harness can observe without the app's
 * cooperation: the authenticated fixture's own counters (a `/me`, a discovery
 * read), the route-trace receipts the app posts as a side effect of rendering,
 * the process lease carried on those receipts, and one bounded hierarchy read
 * for a visible refusal. Anything ambiguous still refuses: a genuine 401, an
 * offline screen or a superseded admission is never laundered into a retry.
 */
export interface StageBLostTapEvidence {
	/** `/me` requests this launch made, from the fixture's wire counter. */
	identityRequests: number;
	/** Discovery (computers list) responses this launch completed. */
	discoveryReads: number;
	/** `unauthorized` responses the fixture served this launch. */
	unauthorized: number;
	/** The latest route trace this launch posted, or null when none arrived. */
	trace: {
		processId: string;
		phase: string;
		selected: boolean;
		sequence: number;
	} | null;
	/** Process lease of the FIRST receipt this launch posted, if any was seen. */
	launchProcessId: string | null;
	/** A refusal marker visible in the captured hierarchy, or null. */
	visibleError: string | null;
}
export type RetryProvenance = "fixture-recovery" | "probe-confirmed";
export const LOST_TAP_TRACE_QUIET_PHASES = ["signed-in", "signed-out"] as const;

export function stageBFixtureRecovery(
	evidence: {
		identityRequests: number;
		discoveryReads: number;
		unauthorized?: number;
		trace: { processId: string; phase: string; selected: boolean } | null;
		launchProcessId: string | null;
		visibleError: string | null;
	},
	retryAttempted: boolean,
): { allow: boolean; reason: string; authorisedBy?: RetryProvenance } {
	if (retryAttempted)
		return { allow: false, reason: "lost-tap retry already attempted" };
	if (evidence.visibleError !== null)
		return {
			allow: false,
			reason: `visible refusal in hierarchy: ${evidence.visibleError}`,
		};
	if ((evidence.unauthorized ?? 0) > 0)
		return { allow: false, reason: "unauthorized response observed" };
	if (evidence.identityRequests > 0)
		return {
			allow: false,
			reason: "identity request observed: the tap reached JavaScript",
		};
	if (evidence.discoveryReads < 1)
		return {
			allow: false,
			reason: "no discovery read: the computers list never rendered",
		};
	if (evidence.trace === null)
		return { allow: false, reason: "no route trace for this launch" };
	if (
		evidence.launchProcessId !== null &&
		evidence.trace.processId !== evidence.launchProcessId
	)
		return { allow: false, reason: "route trace came from another process" };
	if (evidence.trace.selected)
		return { allow: false, reason: "route publication observed" };
	return {
		allow: true,
		reason: "no row callback, no publication: tap never reached JavaScript",
		authorisedBy: "fixture-recovery",
	};
}
/** Where the probe DID answer, it must corroborate the wire account rather than
 * replace it: the same wire rules still have to hold. */
export function stageBProbeCorroborates(
	probe: StageBCallbackProbe,
	launchProcessId: string | null,
): { ok: boolean; reason?: string } {
	if (launchProcessId !== null && probe.processId !== launchProcessId)
		return { ok: false, reason: "probe came from another process" };
	if (probe.presses > 0) return { ok: false, reason: "row callback observed" };
	if (probe.superseded > 0)
		return { ok: false, reason: "admission supersession observed" };
	if (probe.selected)
		return { ok: false, reason: "route publication observed" };
	if (probe.failure) return { ok: false, reason: "probe reported a refusal" };
	return { ok: true };
}
export function stageBLostTapDecision(
	input: {
		identityRequests: number;
		discoveryReads: number;
		unauthorized?: number;
		trace: { processId: string; phase: string; selected: boolean } | null;
		launchProcessId: string | null;
		visibleError: string | null;
	},
	probe: StageBCallbackProbe | null,
	retryAttempted: boolean,
): { allow: boolean; reason: string; authorisedBy?: RetryProvenance } {
	const wire = stageBFixtureRecovery(input, retryAttempted);
	if (!wire.allow || probe === null) return wire;
	const corroboration = stageBProbeCorroborates(probe, input.launchProcessId);
	if (!corroboration.ok)
		return {
			allow: false,
			reason: `probe contradicts fixture evidence: ${corroboration.reason}`,
		};
	return { ...wire, authorisedBy: "probe-confirmed" };
}
