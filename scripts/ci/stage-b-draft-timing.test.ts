import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	captureStageBHeldPair,
	captureStageBRestoreBurst,
	STAGE_B_FRAME_HIERARCHY_SECONDS,
	STAGE_B_HELD_RELEASE_MS,
	STAGE_B_TIMEOUT_HOLD_MS,
	stageBFrameHierarchy,
} from "./stage-b-draft-timing";

describe("measured Stage B frame timing", () => {
	it("wires fixture-triggered loading capture without Maestro and leaves the product 20s deadline unchanged", () => {
		const source = readFileSync(
			new URL("./stage-b-draft-proof.ts", import.meta.url),
			"utf8",
		);
		const capture = source.slice(
			source.indexOf("const armHeldCapture ="),
			source.indexOf("const snapshot ="),
		);
		expect(capture).toContain("observeHeld");
		expect(capture).toContain("captureStageBHeldPair");
		expect(capture).toContain("proof.release()");
		expect(capture).not.toContain("await frame(");
		expect(capture).not.toContain("await flow(");
		expect(source).toContain('frame("light-loading-post-release")');
		expect(source).toContain('"timed-out-proof-fails-closed"');
		expect(source).toContain('"fresh-proof-after-timeout-restores"');
		const production = readFileSync(
			new URL("../../src/connection/recovery-authority.ts", import.meta.url),
			"utf8",
		);
		expect(production).toContain(
			"setTimeout(() => controller.abort(), 20_000)",
		);
	});
	it("budgets slow AX outside proof and releases loading captures before the unchanged 20s deadline", () => {
		expect(STAGE_B_FRAME_HIERARCHY_SECONDS).toBeGreaterThanOrEqual(2 * 83);
		expect(STAGE_B_HELD_RELEASE_MS).toBe(10000);
		expect(STAGE_B_TIMEOUT_HOLD_MS).toBeGreaterThan(20000);
	});
	it("reuses one hierarchy with a 1s settle gap; never invokes the driver again", async () => {
		const calls: unknown[] = [];
		const read = async (seconds: number) => {
			calls.push(seconds);
			return '{"bounds":"synthetic"}';
		};
		const first = await stageBFrameHierarchy(read);
		expect(
			await stageBFrameHierarchy(read, first, async (ms) => {
				calls.push(["gap", ms]);
			}),
		).toBe(first);
		expect(calls).toEqual([180, ["gap", 1000]]);
	});
	it("takes loading pixels with bounded screenshots, then three 300ms restore frames", async () => {
		const calls: unknown[] = [];
		const shot = async (name: string, seconds: number) => {
			calls.push([name, seconds]);
		};
		const sleep = async (ms: number) => {
			calls.push(["gap", ms]);
		};
		await captureStageBHeldPair(shot, "light-loading", sleep);
		await captureStageBRestoreBurst(shot, "light-populated-after", sleep);
		expect(calls).toEqual([
			["light-loading", 3],
			["gap", 1000],
			["light-loading-consecutive", 3],
			["light-populated-after-restore-0", 3],
			["gap", 300],
			["gap", 600],
			["light-populated-after-restore-1", 3],
			["light-populated-after-restore-2", 3],
		]);
	});
});
