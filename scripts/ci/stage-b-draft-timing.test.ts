import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	captureStageBHeldPair,
	captureStageBRestoreBurst,
	STAGE_B_ADD_MEDIA_SECONDS,
	STAGE_B_FRAME_HIERARCHY_SECONDS,
	STAGE_B_HELD_RELEASE_MS,
	STAGE_B_SCREENSHOT_SECONDS,
	STAGE_B_TIMEOUT_HOLD_MS,
	stageBFrameHierarchy,
	verifyStageBPostReleaseWindow,
} from "./stage-b-draft-timing";

afterEach(() => vi.useRealTimers());
describe("measured Stage B frame timing", () => {
	it("refuses a 21s loading frame even when the deliberate timeout-negative hold lasts 22s", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
		const frames = new Map<string, number | undefined>();
		const proof = {
			firstSeenAt: 0,
			deadlineAt: 22000,
			recordFrame: (name: string, completed?: number) =>
				frames.set(name, completed),
		};
		const capture = expect(
			captureStageBHeldPair(
				async () => {
					await new Promise((resolve) => setTimeout(resolve, 10000));
				},
				"dark-loading",
				undefined,
				proof,
			),
		).rejects.toThrow("loading frame not captured before proof release");
		await vi.advanceTimersByTimeAsync(21000);
		await capture;
		expect(frames.get("dark-loading")).toBe(10000);
		expect(frames.get("dark-loading-consecutive")).toBe(21000);
	});
	it("serially completes a 10s and 2s pair by 13s, before the 17s release ceiling", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
		let released: number | undefined;
		let active = 0,
			maxActive = 0;
		const frames = new Map<string, number | undefined>();
		const proof = {
			firstSeenAt: 0,
			deadlineAt: 17000,
			get releasedAt() {
				return released;
			},
			recordFrame: (name: string, completed?: number) =>
				frames.set(name, completed),
		};
		setTimeout(() => {
			released = Date.now();
		}, 17000);
		const shot = async (name: string, seconds: number) => {
			expect(seconds).toBe(12);
			active++;
			maxActive = Math.max(maxActive, active);
			await new Promise<void>((resolve) =>
				setTimeout(resolve, name.endsWith("consecutive") ? 2000 : 10000),
			);
			active--;
		};
		const pending = captureStageBHeldPair(
			shot,
			"loading",
			undefined,
			proof,
		).then(() => {
			released = Date.now();
		});
		await vi.advanceTimersByTimeAsync(13000);
		await pending;
		expect([...frames.values()]).toEqual([10000, 13000]);
		expect(released).toBe(13000);
		expect(maxActive).toBe(1);
	});
	it("names late and missing loading evidence instead of passing after release", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
		let released: number | undefined;
		const frames = new Map<string, number | undefined>();
		const proof = {
			firstSeenAt: 0,
			deadlineAt: 17000,
			get releasedAt() {
				return released;
			},
			recordFrame: (name: string, completed?: number) =>
				frames.set(name, completed),
		};
		setTimeout(() => {
			released = Date.now();
		}, 17000);
		const shot = async (name: string) =>
			new Promise<void>((resolve) =>
				setTimeout(resolve, name.endsWith("consecutive") ? 8000 : 10000),
			);
		const pending = expect(
			captureStageBHeldPair(shot, "loading", undefined, proof),
		).rejects.toThrow("loading frame not captured before proof release");
		await vi.advanceTimersByTimeAsync(19000);
		await pending;
		expect(frames.get("loading-consecutive")).toBe(19000);
		expect(released).toBe(17000);
		const missing = new Map<string, number | undefined>();
		await expect(
			captureStageBHeldPair(
				async () => {
					throw new Error("screenshot timeout");
				},
				"missing",
				undefined,
				{
					firstSeenAt: Date.now(),
					deadlineAt: 36000,
					recordFrame: (name, completed) => missing.set(name, completed),
				},
			),
		).rejects.toThrow("loading frame not captured before proof release");
		expect([...missing.values()]).toEqual([undefined, undefined]);
	});
	it("explicitly reserves twice the measured 118s media-import maximum", () => {
		expect(STAGE_B_ADD_MEDIA_SECONDS).toBe(240);
		expect(STAGE_B_ADD_MEDIA_SECONDS).toBeGreaterThanOrEqual(2 * 118);
		const source = readFileSync(
			new URL("./stage-b-draft-proof.ts", import.meta.url),
			"utf8",
		);
		const at = source.indexOf('"add-owned-photo"');
		expect(at).toBeGreaterThan(0);
		const call = source.slice(
			at,
			source.indexOf("await warmStageBDriver(", at),
		);
		expect(call).toContain("STAGE_B_ADD_MEDIA_SECONDS");
	});
	it("does not hide a failed post-release canary assertion behind clean storage samples", async () => {
		let clock = 0;
		await expect(
			verifyStageBPostReleaseWindow({
				afterRelease: async () => {},
				assertUI: async () => {
					throw new Error("late canary visible");
				},
				observe: async () => ({ recoveryAdmitted: false }),
				now: () => clock,
				sleep: async (ms) => {
					clock += ms;
				},
			}),
		).rejects.toThrow("late canary visible");
	});
	it("starts the negative driver segment strictly after the release barrier and observes the full window", async () => {
		let release!: () => void,
			released = false,
			clock = 0,
			observations = 0;
		const held = new Promise<void>((resolve) => {
			release = () => {
				released = true;
				resolve();
			};
		});
		const events: string[] = [];
		const pending = verifyStageBPostReleaseWindow({
			afterRelease: async () => {
				await held;
				events.push("release");
			},
			assertUI: async () => {
				expect(released).toBe(true);
				events.push("negative-driver-start");
			},
			observe: async () => {
				observations++;
				return { recoveryAdmitted: false };
			},
			now: () => clock,
			sleep: async (ms) => {
				clock += ms;
			},
		});
		await Promise.resolve();
		expect(events).toEqual([]);
		release();
		expect((await pending).recoveryAdmitted).toBe(false);
		expect(events).toEqual(["release", "negative-driver-start"]);
		expect(clock).toBeGreaterThanOrEqual(10000);
		expect(observations).toBeGreaterThan(1);
	});
	it("rejects delayed admission after an initially clean post-release sample", async () => {
		let clock = 0;
		await expect(
			verifyStageBPostReleaseWindow({
				afterRelease: async () => {},
				assertUI: async () => {},
				observe: async () => ({ recoveryAdmitted: clock >= 750 }),
				now: () => clock,
				sleep: async (ms) => {
					clock += ms;
				},
			}),
		).rejects.toThrow("late post-release proof admitted recovery");
		expect(clock).toBe(750);
	});
	it("never overlaps restore screenshot commands on the same simulator", async () => {
		let active = 0,
			maximum = 0;
		await captureStageBRestoreBurst(
			async () => {
				active++;
				maximum = Math.max(maximum, active);
				await new Promise((resolve) => setTimeout(resolve, 1));
				active--;
			},
			"restore",
			async () => {},
		);
		expect(maximum).toBe(1);
		expect(active).toBe(0);
	});
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
		expect(source).not.toContain('frame("light-loading-post-release")');
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
		expect(STAGE_B_HELD_RELEASE_MS).toBe(17000);
		expect(STAGE_B_HELD_RELEASE_MS).toBeLessThan(20000);
		expect(STAGE_B_SCREENSHOT_SECONDS).toBeGreaterThan(10);
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
	it("takes bounded loading pixels, then three serial restore frames with 300ms quiet gaps", async () => {
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
			["light-loading", 12],
			["gap", 1000],
			["light-loading-consecutive", 12],
			["light-populated-after-restore-0", 12],
			["gap", 300],
			["light-populated-after-restore-1", 12],
			["gap", 300],
			["light-populated-after-restore-2", 12],
		]);
	});
});
