import { describe, expect, it } from "vitest";
import { createPushGeneration } from "@/notifications/push-generation";

describe("durable push incarnations", () => {
	it("serializes reservations and survives clock rollback and a new runtime", async () => {
		let value: number | undefined;
		const deps = {
			read: async () => value,
			write: async (n: number) => {
				value = n;
			},
			now: () => 100,
		};
		const reserve = createPushGeneration(deps);
		expect(await Promise.all([reserve(), reserve(), reserve()])).toEqual([
			100, 101, 102,
		]);
		const restarted = createPushGeneration({ ...deps, now: () => 20 });
		expect(await restarted()).toBe(103);
	});
	it("never yields a generation whose durable write failed", async () => {
		let fails = true;
		let value: number | undefined;
		const reserve = createPushGeneration({
			read: async () => value,
			now: () => 100,
			write: async (n) => {
				if (fails) throw new Error("keystore");
				value = n;
			},
		});
		await expect(reserve()).rejects.toThrow("keystore");
		expect(value).toBeUndefined();
		fails = false;
		expect(await reserve()).toBe(100);
	});
	it("refuses an exhausted safe integer rather than wrap its fence", async () => {
		const reserve = createPushGeneration({
			read: async () => Number.MAX_SAFE_INTEGER,
			write: async () => {},
		});
		await expect(reserve()).rejects.toThrow("exhausted");
	});
});
