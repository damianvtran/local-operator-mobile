import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { StageBDriverBatch } from "./stage-b-driver-batch";
import {
	createLostTapRetry,
	type StageBCallbackProbe,
	stageBLostTapGate,
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
	it("is wired into the initial connect, which must open its own segment", () => {
		const source = readFileSync(
			new URL("./stage-b-draft-proof.ts", import.meta.url),
			"utf8",
		);
		const initial = source.slice(
			source.indexOf('await flow("warm-app-foreground"'),
		);
		const flush = initial.indexOf("await flushFlows();");
		const connect = initial.indexOf('"connect-initial"');
		// The retry is the third argument of that flow, so it sits after the name.
		const armed = initial.indexOf("createLostTapRetry({");
		const next = initial.indexOf('await flow("type-initial"');
		// The gate only re-runs a segment opener: the flush must precede the
		// connect flow, and the retry must belong to that same flow's arguments.
		expect(flush).toBeGreaterThanOrEqual(0);
		expect(flush).toBeLessThan(connect);
		expect(connect).toBeLessThan(armed);
		expect(armed).toBeLessThan(next);
		// Both relicensing paths share the factory rather than rebuilding it.
		expect(
			source.split("createLostTapRetry({").length - 1,
		).toBeGreaterThanOrEqual(2);
	});
});
