import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { StageBDriverBatch } from "./stage-b-driver-batch";
import {
	createLostTapRetry,
	type StageBCallbackProbe,
	stageBLostTapDecision,
	stageBLostTapGate,
	stageBProbeAvailability,
} from "./stage-b-lost-tap";

/** The exact failed state of run 42044812065's fresh-proof process. */
const lost: StageBCallbackProbe = {
	processId: "00000000-0000-4000-8000-000000000001",
	presses: 0,
	superseded: 0,
	revision: 0,
	phase: "signed-out",
	route: "none",
	selected: false,
	failure: false,
};
const lease = () => ({ probe: { ...lost }, identityRequests: 0 });
const observed = (patch: Partial<StageBCallbackProbe> = {}) => ({
	probe: { ...lost, ...patch },
	identityRequests: 0,
});
const gate = (
	observation: ReturnType<typeof observed> | null,
	retryAttempted = false,
) =>
	stageBLostTapGate({ lease: lease(), observed: observation, retryAttempted });

describe("lost-tap gate demands positive same-process no-callback evidence", () => {
	it("allows only the observed initial lost-tap state", () => {
		expect(gate(observed())).toEqual({
			allow: true,
			reason: "no row callback: tap never reached JavaScript",
		});
	});
	it.each([
		["row callback observed", { presses: 1 }],
		["admission supersession observed", { superseded: 1 }],
		["route publication observed", { revision: 1 }],
		["route publication observed", { selected: true }],
		["route publication observed", { failure: true }],
		["route publication observed", { phase: "refused" }],
		["route publication observed", { route: "radient" }],
		[
			"probe came from another process",
			{ processId: "00000000-0000-4000-8000-000000000002" },
		],
		["ambiguous probe counter", { presses: Number.NaN }],
		["ambiguous probe counter", { revision: -1 }],
	] as const)("refuses: %s", (reason, patch) => {
		expect(gate(observed(patch as Partial<StageBCallbackProbe>))).toEqual({
			allow: false,
			reason,
		});
	});
	it("refuses a changed identity request (network/reauth path)", () => {
		expect(gate({ probe: { ...lost }, identityRequests: 1 })).toEqual({
			allow: false,
			reason: "identity request observed",
		});
	});
	it("refuses missing, ambiguous or foreign-lease evidence", () => {
		expect(gate(null).reason).toBe("same-process probe unavailable");
		expect(
			stageBLostTapGate({
				lease: null,
				observed: observed(),
				retryAttempted: false,
			}).reason,
		).toBe("same-process probe unavailable");
		expect(
			stageBLostTapGate({
				lease: { probe: { ...lost, presses: Number.NaN }, identityRequests: 0 },
				observed: observed(),
				retryAttempted: false,
			}).reason,
		).toBe("ambiguous lease counter");
		expect(
			stageBLostTapGate({
				lease: { probe: { ...lost, presses: 1 }, identityRequests: 0 },
				observed: observed(),
				retryAttempted: false,
			}).reason,
		).toBe("process already handled a selection");
	});
	it("refuses a second attempt", () => {
		expect(gate(observed(), true)).toEqual({
			allow: false,
			reason: "lost-tap retry already attempted",
		});
	});
});

const step = (id: string) => ({ tapOn: { id } });
const steps = (...ids: string[]) => ids.map(step);
/** Executes, failing the calls named in `failures` (1-based). */
function executor(failures: number[] = []) {
	const runs: { name: string; steps: number }[] = [];
	const execute = async (name: string, group: unknown[]) => {
		runs.push({ name, steps: group.length });
		if (failures.includes(runs.length)) throw new Error("maestro flow failed");
	};
	return { runs, execute };
}
const batch = (execute: (name: string, steps: unknown[]) => Promise<void>) =>
	new StageBDriverBatch(execute as never);

describe("one conditional re-tap inside the driver batch", () => {
	const policy = (allow: boolean) => {
		const seen: { allow: boolean; reason: string }[] = [];
		return {
			seen,
			retry: {
				probe: async () => ({ allow, reason: allow ? "lost" : "callback" }),
				record: (decision: { allow: boolean; reason: string }) =>
					seen.push(decision),
			},
		};
	};
	it("keeps the happy path at one segment", async () => {
		const { runs, execute } = executor();
		const gated = policy(true);
		const subject = batch(execute);
		subject.add("connect", steps("computer-row", "composer"), gated.retry);
		subject.add("draft", steps("assert-draft"));
		await subject.flush();
		expect(runs).toHaveLength(1);
		expect(gated.seen).toEqual([]);
	});
	it("re-runs only the connect entry, then the untouched tail, on lost-tap evidence", async () => {
		const { runs, execute } = executor([1]);
		const gated = policy(true);
		const subject = batch(execute);
		subject.add("connect", steps("computer-row", "composer"), gated.retry);
		subject.add("draft", steps("assert-draft"));
		await subject.flush();
		expect(runs.map((run) => [run.name, run.steps])).toEqual([
			["segment-1-connect", 3],
			["segment-1-connect-lost-tap-retry", 2],
			["segment-1-connect-lost-tap-tail", 1],
		]);
		expect(gated.seen).toEqual([{ allow: true, reason: "lost" }]);
	});
	it.each([
		["row callback observed", 1],
		["network or supersession", 1],
	])("does not retry when the gate refuses (%s)", async () => {
		const { runs, execute } = executor([1]);
		const gated = policy(false);
		const subject = batch(execute);
		subject.add("connect", steps("computer-row"), gated.retry);
		await expect(subject.flush()).rejects.toThrow("maestro flow failed");
		expect(runs).toHaveLength(1);
		expect(gated.seen).toHaveLength(1);
	});
	it("fails after a second lost tap without a third attempt", async () => {
		const { runs, execute } = executor([1, 2]);
		const gated = policy(true);
		const subject = batch(execute);
		subject.add("connect", steps("computer-row", "composer"), gated.retry);
		await expect(subject.flush()).rejects.toThrow("maestro flow failed");
		expect(runs.map((run) => run.name)).toEqual([
			"segment-1-connect",
			"segment-1-connect-lost-tap-retry",
		]);
		expect(gated.seen).toHaveLength(1);
	});
	it("never retries a policy entry that does not open its segment (R26-1)", async () => {
		const { runs, execute } = executor([1]);
		const gated = policy(true);
		const subject = batch(execute);
		subject.add("pre-cert", steps("assert-cert"));
		subject.add("connect", steps("computer-row", "composer"), gated.retry);
		await expect(subject.flush()).rejects.toThrow("maestro flow failed");
		expect(runs.map((run) => run.name)).toEqual(["segment-1-pre-cert"]);
		expect(gated.seen).toEqual([]);
	});
	it("never probes a flow without the policy", async () => {
		const { runs, execute } = executor([1]);
		const subject = batch(execute);
		subject.add("draft", steps("assert-draft"));
		await expect(subject.flush()).rejects.toThrow("maestro flow failed");
		expect(runs).toHaveLength(1);
	});
});

describe("the retry is armed on the first launch, not only on relaunch", () => {
	it("requests the probe and allows one re-tap on the exact lost-tap shape", async () => {
		// Run 42149735954: receipt.lostTapRetry was null and driverSegments empty
		// because the initial connect was batched behind the warm-up flow and the
		// lease was only ever taken inside relaunch(). The gate itself was fine.
		let probes = 0;
		let recorded:
			| Parameters<
					NonNullable<Parameters<typeof createLostTapRetry>[0]["record"]>
			  >[0]
			| null = null;
		const retry = createLostTapRetry({
			lease: lease(),
			identityRequests: () => 0,
			probeCallback: async () => {
				probes++;
				return { ...lease().probe };
			},
			record: (entry) => {
				recorded = entry;
			},
		});
		expect(retry).toBeDefined();
		const decision = await retry?.probe();
		expect(probes).toBe(1);
		expect(decision).toEqual({
			allow: true,
			reason: expect.stringContaining("never reached JavaScript"),
		});
		retry?.record(decision!);
		expect(recorded).toMatchObject({
			leaseProcess: "same-process",
			allowed: true,
			attempted: true,
		});
		// One attempt per launch, no matter what the next probe says.
		expect(await retry?.probe()).toEqual({
			allow: false,
			reason: "lost-tap retry already attempted",
		});
	});
	it("still refuses when the probe is unavailable or a request was observed", async () => {
		const unavailable = createLostTapRetry({
			lease: lease(),
			identityRequests: () => 0,
			probeCallback: async () => null,
			record: () => {},
		});
		expect(await unavailable?.probe()).toEqual({
			allow: false,
			reason: "same-process probe unavailable",
		});
		const observedMe = createLostTapRetry({
			lease: lease(),
			identityRequests: () => 1,
			probeCallback: async () => ({ ...lease().probe }),
			record: () => {},
		});
		expect((await observedMe?.probe())?.allow).toBe(false);
	});
	it("is not created without a same-process lease", () => {
		expect(
			createLostTapRetry({
				lease: null,
				identityRequests: () => 0,
				probeCallback: async () => null,
				record: () => undefined,
			}),
		).toBeUndefined();
	});
	it("classifies every way the probe can fail to answer, and only 'answered' is a lease", () => {
		// Run 42166849295 recorded one sentence for all of these, so the refusal
		// could not be diagnosed. Each failure now has its own name and sentence.
		const reasons = ["timeout", "invalid-payload", "not-requested"] as const;
		const messages = new Set<string>();
		for (const reason of reasons) {
			const outcome = stageBProbeAvailability(reason);
			expect(outcome.available).toBe(false);
			expect(outcome.reason).toBe(reason);
			messages.add(outcome.message);
		}
		expect(messages.size).toBe(reasons.length);
		const answered = stageBProbeAvailability("answered");
		expect(answered.available).toBe(true);
		expect(answered.message).toContain("answered");
	});
	it("builds the retry from fixture evidence in both lanes, not from a probe lease", () => {
		const source = readFileSync(
			new URL("./stage-b-draft-proof.ts", import.meta.url),
			"utf8",
		);
		// The lease that required an answered probe is gone: run 42181646348 timed
		// out on the probe and blocked a legitimate retry.
		expect(source).not.toContain("lostTapLease(");
		expect(source).toContain(
			"const fixtureRecoveryRetry = (): StageBLostTapRetry =>",
		);
		// Both lanes share one factory (definition + two call sites), and the
		// record says what authorised it.
		expect(
			source.split("fixtureRecoveryRetry()").length - 1,
		).toBeGreaterThanOrEqual(2);
		expect(source).toContain("retryAuthorisedBy:");
		// Wire deltas, never cumulative totals: a cumulative /me would refuse
		// every launch after the first.
		expect(source).toContain("launchCounters = {");
		expect(source).toContain("launchCounters.me");
		expect(source).toContain("launchCounters.discovery");
		// A refusal painted on screen is never laundered into a retry.
		expect(source).toContain("STAGE_B_VISIBLE_REFUSALS");
		expect(source).toContain('status: "unavailable"');
		expect(source).toContain("receipt.hierarchyCheck");
	});
	describe("fixture-observed evidence authorises the one re-tap", () => {
		/** Run 42181646348's failed launch: discovery completed, no /me, no
		 * publication, same lease, nothing painted on screen. */
		const clean = {
			identityRequests: 0,
			discoveryReads: 1,
			unauthorized: 0,
			trace: {
				processId: "11111111-1111-4111-8111-111111111111",
				phase: "signed-out",
				selected: false,
			},
			launchProcessId: "11111111-1111-4111-8111-111111111111",
			visibleError: null,
		};
		it("authorises a lost tap on wire evidence alone, with no probe answer", () => {
			const decision = stageBLostTapDecision(clean, null, false);
			expect(decision.allow).toBe(true);
			expect(decision.authorisedBy).toBe("fixture-recovery");
		});
		it("refuses when an identity request was answered", () => {
			const decision = stageBLostTapDecision(
				{ ...clean, identityRequests: 1 },
				null,
				false,
			);
			expect(decision.allow).toBe(false);
			expect(decision.reason).toContain("identity request");
		});
		it("refuses when the route published or the trace is missing", () => {
			expect(
				stageBLostTapDecision(
					{ ...clean, trace: { ...clean.trace, selected: true } },
					null,
					false,
				).allow,
			).toBe(false);
			expect(
				stageBLostTapDecision({ ...clean, trace: null }, null, false).allow,
			).toBe(false);
		});
		it("refuses when a refusal is painted in the hierarchy", () => {
			const decision = stageBLostTapDecision(
				{ ...clean, visibleError: "Could not connect" },
				null,
				false,
			);
			expect(decision.allow).toBe(false);
			expect(decision.reason).toContain("visible refusal");
		});
		it("refuses when the trace came from another process lease", () => {
			const decision = stageBLostTapDecision(
				{
					...clean,
					trace: {
						...clean.trace,
						processId: "22222222-2222-4222-8222-222222222222",
					},
				},
				null,
				false,
			);
			expect(decision.allow).toBe(false);
			expect(decision.reason).toContain("another process");
		});
		it("refuses when a row-press trace shows the tap reached JavaScript", () => {
			const decision = stageBLostTapDecision(
				{ ...clean, pressObserved: true },
				null,
				false,
			);
			expect(decision.allow).toBe(false);
			expect(decision.reason).toContain("row callback observed");
		});
		it("refuses when the trace recorded a failure surface", () => {
			const decision = stageBLostTapDecision(
				{ ...clean, traceFailure: true },
				null,
				false,
			);
			expect(decision.allow).toBe(false);
			expect(decision.reason).toContain("failure surface");
		});
		it("proves the substring-only check would have authorised real refusal copy", () => {
			// The app renders "Try now" on a refused route. Before round 34 the gate
			// matched a short list that did not contain it, so clean wire counters plus
			// that copy would have produced a retry over a genuine failure.
			const before = stageBLostTapDecision(
				{ ...clean, visibleError: null, pressObserved: true },
				null,
				false,
			);
			expect(before.allow).toBe(false);
			// The copy is in the backstop list too, so a hierarchy that paints it
			// refuses even when no trace arrived at all.
			const painted = stageBLostTapDecision(
				{ ...clean, visibleError: "Try now" },
				null,
				false,
			);
			expect(painted.allow).toBe(false);
			const source = readFileSync(
				new URL("./stage-b-draft-proof.ts", import.meta.url),
				"utf8",
			);
			expect(source).toContain('"Try now"');
		});
		it("authorises on structured evidence when the hierarchy read times out", () => {
			// Run 42216832978: the gate's 20 s read timed out while the same run's
			// failure hierarchy took 66.3 s (136 s / 173 s in earlier runs), so an
			// unreadable hierarchy is missing evidence, not a refusal.
			const decision = stageBLostTapDecision(
				{ ...clean, hierarchyUnavailable: true },
				null,
				false,
			);
			expect(decision.allow).toBe(true);
			expect(decision.authorisedBy).toBe("fixture-recovery");
		});
		it("still refuses refusal copy when the read succeeded", () => {
			const decision = stageBLostTapDecision(
				{ ...clean, visibleError: "Try now" },
				null,
				false,
			);
			expect(decision.allow).toBe(false);
			expect(decision.reason).toContain("visible refusal");
		});
		it("still refuses a failure surface when the hierarchy is unavailable", () => {
			const decision = stageBLostTapDecision(
				{ ...clean, hierarchyUnavailable: true, traceFailure: true },
				null,
				false,
			);
			expect(decision.allow).toBe(false);
			expect(decision.reason).toContain("failure surface");
		});
		it("still refuses a row callback when the hierarchy is unavailable", () => {
			const decision = stageBLostTapDecision(
				{ ...clean, hierarchyUnavailable: true, pressObserved: true },
				null,
				false,
			);
			expect(decision.allow).toBe(false);
			expect(decision.reason).toContain("row callback observed");
		});
		it("refuses a second loss in the same launch", () => {
			const decision = stageBLostTapDecision(clean, null, true);
			expect(decision.allow).toBe(false);
			expect(decision.reason).toContain("already attempted");
		});
		it("needs no probe to authorise, but a contradicting probe vetoes", () => {
			// The absence of an answer is not a refusal (the whole point: run
			// 42181646348's probe timed out and blocked a legitimate retry).
			expect(stageBLostTapDecision(clean, null, false).allow).toBe(true);
			const contradicting: StageBCallbackProbe = {
				processId: clean.launchProcessId,
				presses: 1,
				superseded: 0,
				revision: 0,
				phase: "signed-out",
				route: "none",
				selected: false,
				failure: false,
			};
			const vetoed = stageBLostTapDecision(clean, contradicting, false);
			expect(vetoed.allow).toBe(false);
			expect(vetoed.reason).toContain("probe contradicts");
			const agreeing = { ...contradicting, presses: 0 };
			const confirmed = stageBLostTapDecision(clean, agreeing, false);
			expect(confirmed.allow).toBe(true);
			expect(confirmed.authorisedBy).toBe("probe-confirmed");
		});
	});
	it("is wired into the initial connect, which must open its own segment", () => {
		const source = readFileSync(
			new URL("./stage-b-draft-proof.ts", import.meta.url),
			"utf8",
		);
		// Anchor on the flow NAMES, never on how a call is formatted: a reformat
		// across lines already produced silent -1 sentinels (review R31-1/R31-5).
		const warm = source.indexOf('"warm-app-foreground"');
		const connect = source.indexOf('"connect-initial"');
		// The retry is the third argument of that flow, so it sits after the name.
		const armed = source.indexOf("fixtureRecoveryRetry()", connect);
		const next = source.indexOf('"type-initial"', connect);
		const flush = source.lastIndexOf("await flushFlows();", connect);
		// The gate only re-runs a segment opener, and the warm-up entry is empty,
		// so the flush is ordering insurance rather than a paid driver call.
		expect(warm).toBeGreaterThanOrEqual(0);
		expect(connect).toBeGreaterThan(warm);
		expect(flush).toBeGreaterThan(warm);
		expect(flush).toBeLessThan(connect);
		expect(armed).toBeGreaterThan(connect);
		expect(next).toBeGreaterThan(armed);
		// Both relicensing paths share the factory rather than rebuilding it.
		expect(
			source.split("fixtureRecoveryRetry()").length - 1,
		).toBeGreaterThanOrEqual(2);
	});
});
