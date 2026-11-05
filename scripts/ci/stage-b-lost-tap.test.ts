import { describe, expect, it } from "vitest";
import { StageBDriverBatch } from "./stage-b-driver-batch";
import {
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
	it("never probes a flow without the policy", async () => {
		const { runs, execute } = executor([1]);
		const subject = batch(execute);
		subject.add("draft", steps("assert-draft"));
		await expect(subject.flush()).rejects.toThrow("maestro flow failed");
		expect(runs).toHaveLength(1);
	});
});
