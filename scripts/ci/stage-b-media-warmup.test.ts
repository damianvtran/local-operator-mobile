import { describe, expect, it } from "vitest";
import { stageBWarmMediaLibrary } from "./stage-b-media-warmup";

describe("bounded photo-library warm-up outside the timed import", () => {
	it("records a completed warm-up without touching the timed result", async () => {
		const evidence: Record<string, unknown> = {};
		const order: string[] = [];
		const warmed = await stageBWarmMediaLibrary(async () => {
			order.push("warm");
			return "ok";
		}, evidence);
		order.push("import");
		expect(warmed).toBe(true);
		expect(evidence).toMatchObject({ status: "completed" });
		expect(evidence.elapsedMs).toBeTypeOf("number");
		expect(order).toEqual(["warm", "import"]);
	});
	it("never throws, never claims import success, and redacts its own failure", async () => {
		const evidence: Record<string, unknown> = {};
		const marker = ["synthetic", "warm", "secret"].join("-");
		const warmed = await stageBWarmMediaLibrary(async () => {
			throw new Error(`addmedia timed out; Bearer ${marker}`);
		}, evidence);
		expect(warmed).toBe(false);
		expect(evidence.status).toBe("failed");
		expect(JSON.stringify(evidence)).not.toContain(marker);
		expect(JSON.stringify(evidence)).toContain("Bearer [redacted]");
		const importError = new Error("primary addmedia timeout");
		const observed = await stageBWarmMediaLibrary(async () => {
			throw importError;
		}, evidence).then(
			() => null,
			(error: unknown) => error,
		);
		expect(observed).toBeNull();
		expect(evidence.status).toBe("failed");
	});
});
