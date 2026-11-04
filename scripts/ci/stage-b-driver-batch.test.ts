import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	attachStageBPhoto,
	type StageBStep,
	stageBFlow,
	stageBStartsInPhotoPicker,
} from "./stage-b-draft-flows";
import { verifyStageBPostReleaseWindow } from "./stage-b-draft-timing";
import { StageBDriverBatch } from "./stage-b-driver-batch";

describe("Stage B adjacent UI driver batching", () => {
	it("starts a fresh driver for EVERY picker, including repeated library use in one batch", async () => {
		const executed: StageBStep[][] = [];
		const batch = new StageBDriverBatch(async (_name, steps) => {
			executed.push(steps);
		});
		batch.add("attach-native-photo", attachStageBPhoto());
		batch.add("original-photo-still-selectable", attachStageBPhoto());
		await batch.flush();
		expect(executed).toHaveLength(3);
		for (let index = 0; index < 2; index++) {
			expect(executed[index]?.at(-1)).toEqual({
				tapOn: { id: "attach-option-library" },
			});
			const picker = executed[index + 1] ?? [];
			expect(stageBStartsInPhotoPicker(picker)).toBe(true);
			const yaml = stageBFlow(picker);
			expect(yaml).not.toContain("launchApp");
			expect(yaml).not.toContain("stage-b-proof-gate");
			expect(picker[0]).toEqual({
				extendedWaitUntil: {
					visible: { id: "PXGGridLayout-Info", text: "Photo, .*" },
					timeout: 30000,
				},
			});
		}
	});
	it("does not acknowledge evidence when a fresh picker segment fails", async () => {
		let acknowledged = false;
		const batch = new StageBDriverBatch(async (_name, steps) => {
			if (stageBStartsInPhotoPicker(steps))
				throw new Error("picker unavailable");
		});
		batch.add("attach", attachStageBPhoto());
		batch.verified(() => {
			acknowledged = true;
		});
		await expect(batch.flush()).rejects.toThrow("picker unavailable");
		expect(acknowledged).toBe(false);
	});
	it("models the production post-segment lease sample honestly, not concurrent sampling", async () => {
		let clock = 0,
			samples = 0;
		const log: string[] = [];
		const batch = new StageBDriverBatch(async () => {
			log.push("driver-start");
			clock += 70000;
			log.push("driver-end");
		});
		const flow = async () =>
			batch.add("negative", [{ assertNotVisible: "synthetic-canary" }]);
		await verifyStageBPostReleaseWindow({
			afterRelease: async () => {
				log.push("release");
			},
			assertUI: async () => {
				await flow();
				await batch.flush();
			},
			observe: async () => {
				await batch.flush();
				samples++;
				log.push("sample");
				return { recoveryAdmitted: false };
			},
			now: () => clock,
			sleep: async (ms) => {
				clock += ms;
			},
		});
		expect(samples).toBe(1);
		expect(clock).toBeGreaterThanOrEqual(10000);
		expect(log).toEqual(["release", "driver-start", "driver-end", "sample"]);
	});
	it("keeps release before the separate negative segment and budgets the reinstall receipt observation", () => {
		const source = readFileSync(
			new URL("./stage-b-draft-proof.ts", import.meta.url),
			"utf8",
		);
		const start = source.indexOf(
			"const timedOut = await verifyStageBPostReleaseWindow(",
		);
		expect(start).toBeGreaterThan(0);
		expect(source.slice(start - 60, start)).toContain("await flushFlows();");
		const block = source.slice(
			start,
			source.indexOf("if (timedOut.recoveryAdmitted", start),
		);
		expect(block).toContain("afterRelease:");
		expect(block).toContain("awaitHeldCapture()");
		expect(block).toContain("assertUI:");
		expect(block).toContain('"timed-out-proof-fails-closed"');
		expect(block).toContain("assertStageBPostReleaseDraft(canary)");
		expect(source).toContain("stageBFlowCap(reinstallSteps) * 1000");
		expect(source).toContain("stageBSeedFailureFromHierarchy(");
		expect(source).toContain("unavailable: failure hierarchy missing");
		expect(source).toContain(
			"not applicable: failure hierarchy has no proof gate",
		);
	});
	it("captures immediately after initial connect and proves navigation before typing in the same flow", () => {
		const source = readFileSync(
			new URL("./stage-b-draft-proof.ts", import.meta.url),
			"utf8",
		);
		const begin = source.indexOf('await flow("connect-initial"');
		const typing = source.indexOf('await flow("type-initial"', begin);
		const connect = source.slice(begin, typing);
		expect(begin).toBeGreaterThan(0);
		expect(typing).toBeGreaterThan(begin);
		expect(connect).toContain('takeScreenshot: "connect-initial-after-tap"');
		expect(connect).toContain("...stageBEditor()");
		expect(connect).toContain('id: "computers-screen"');
		expect(connect.indexOf("takeScreenshot")).toBeLessThan(
			connect.indexOf("...stageBEditor()"),
		);
	});
	it("pays one driver call for ordered adjacent UI steps, never crossing an explicit barrier", async () => {
		const calls: unknown[] = [];
		const batch = new StageBDriverBatch(async (_name, steps, names) => {
			calls.push({ steps, names });
		});
		batch.add("connect", [{ tapOn: { id: "computer" } }]);
		batch.add("type", [{ inputText: "synthetic" }]);
		let verified = false;
		batch.verified(() => {
			verified = true;
		});
		expect(calls).toEqual([]);
		expect(verified).toBe(false);
		await batch.flush();
		expect(verified).toBe(true);
		batch.add("assert-after-restart", [
			{ assertVisible: { id: "composer-input" } },
		]);
		await batch.flush();
		await batch.flush();
		expect(calls).toEqual([
			{
				steps: [{ tapOn: { id: "computer" } }, { inputText: "synthetic" }],
				names: ["connect", "type"],
			},
			{
				steps: [{ assertVisible: { id: "composer-input" } }],
				names: ["assert-after-restart"],
			},
		]);
		expect(batch.segments).toHaveLength(2);
	});
	it("never records a queued case PASS when its real flow fails", async () => {
		const batch = new StageBDriverBatch(async () => {
			throw Error("actual flow failed");
		});
		batch.add("negative-proof", [{ assertNotVisible: { id: "draft" } }]);
		let passed = false;
		batch.verified(() => {
			passed = true;
		});
		await expect(batch.flush()).rejects.toThrow("actual flow failed");
		expect(passed).toBe(false);
		expect(batch.segments).toHaveLength(0);
	});
	it("keeps all process, fixture and storage observation barriers in the real coordinator", () => {
		const source = readFileSync(
			new URL("./stage-b-draft-proof.ts", import.meta.url),
			"utf8",
		);
		for (const boundary of [
			"const terminate = async () => {",
			"const snapshot = async () => {",
			"const command = async (action: string) => {",
			"const expire = async () => {",
		]) {
			const at = source.indexOf(boundary);
			expect(at).toBeGreaterThan(0);
			expect(
				source
					.slice(at + boundary.length)
					.trimStart()
					.startsWith("await flushFlows();"),
			).toBe(true);
		}
		expect(source).toContain("Reused geometry only; see");
		expect(source).toContain("hierarchy.reused-from-");
		expect(source).not.toContain('"warm-app-readiness"');
		expect(source).not.toContain('"warm-seed-state"');
		expect(source).toContain("batch.verified(() =>");
	});
});
