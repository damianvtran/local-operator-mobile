import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AGENT_AVATARS } from "../../tools/mock-relay/scenarios.ts";
import {
	CAPTURE_BUDGET_MS,
	captureAlongsideReceipt,
	captureOwned,
	MAX_CAPTURE_BYTES,
	ObservationTimeout,
	observationRun,
	validatePng,
} from "./auth-retirement-capture.ts";
import { ProofDiagnostics } from "./auth-retirement-diagnostics.ts";

const roots: string[] = [];
const fresh = () => {
	const root = mkdtempSync(join(tmpdir(), "proof-capture-"));
	roots.push(root);
	return root;
};
afterEach(() => {
	vi.useRealTimers();
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});
const png = AGENT_AVATARS.researcher!;
describe("owned synthetic simulator capture observation", () => {
	it("uses only owned UDID, fixed phase paths, PNG hash and five-second command", async () => {
		const root = fresh(),
			calls: unknown[] = [];
		const result = await captureOwned(
			root,
			"owned-device",
			"seed",
			"after-openurl",
			async (...args) => {
				calls.push(args);
				writeFileSync(args[1].at(-1)!, png);
			},
		);
		expect(calls).toEqual([
			[
				"xcrun",
				[
					"simctl",
					"io",
					"owned-device",
					"screenshot",
					"--type=png",
					join(root, "captures/seed-after-openurl.png"),
				],
				5000,
			],
		]);
		expect(CAPTURE_BUDGET_MS).toBe(5000);
		expect(result).toMatchObject({
			status: "observed",
			relativePath: "captures/seed-after-openurl.png",
			evidencePersisted: true,
		});
		expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
		expect(
			readFileSync(join(root, "seed-after-openurl-capture.json"), "utf8"),
		).not.toContain(root);
	});
	it.each(["error", "timeout", "invalid-png", "oversize"])(
		"capture %s cannot overwrite the frozen command/cause",
		async (mode) => {
			const root = fresh(),
				diag = new ProofDiagnostics(root);
			diag.checkpoint("phase", "seed");
			diag.observePhaseFailure({ phase: "seed", cause: "receipt-timeout" });
			diag.fail();
			const before = readFileSync(join(root, "failure.json"), "utf8");
			const result = await captureOwned(
				root,
				"owned-device",
				"seed",
				"receipt-timeout",
				async (_exe, args) => {
					if (mode === "timeout") throw new ObservationTimeout("PRIVATE_TOKEN");
					if (mode === "error") throw new Error("PRIVATE_TOKEN");
					writeFileSync(
						args.at(-1)!,
						mode === "oversize"
							? Buffer.alloc(MAX_CAPTURE_BYTES + 1)
							: Buffer.from("PRIVATE_TOKEN"),
					);
				},
			);
			expect(result.status).toBe(mode === "timeout" ? "timeout" : "error");
			expect(readFileSync(join(root, "failure.json"), "utf8")).toBe(before);
			expect(JSON.stringify(result)).not.toContain("PRIVATE_TOKEN");
			expect(
				readFileSync(join(root, "seed-receipt-timeout-capture.json"), "utf8"),
			).not.toContain("PRIVATE_TOKEN");
		},
	);
	it("receipt success settles during capture without waiting for its completion", async () => {
		let finish!: () => void;
		let settled = false;
		const answer = Promise.resolve("receipt"),
			capture = new Promise<void>((yes) => {
				finish = yes;
			});
		const pair = captureAlongsideReceipt(answer, async () => {
			await capture;
			return {
				phase: "seed",
				point: "after-openurl",
				status: "observed",
				elapsedMs: 1,
			};
		});
		void pair.capture.then(() => {
			settled = true;
		});
		expect(await pair.answer).toBe("receipt");
		expect(settled).toBe(false);
		finish();
		await pair.capture;
	});
	it("authoritative 60s timeout settles during capture and two calls are the per-phase maximum", async () => {
		vi.useFakeTimers();
		const root = fresh();
		let release!: () => void;
		const held = new Promise<void>((yes) => {
				release = yes;
			}),
			calls: string[] = [];
		const answer = new Promise<never>((_yes, no) =>
			setTimeout(() => no(new Error("receipt-timeout")), 60000),
		);
		const pair = captureAlongsideReceipt(answer, () =>
			captureOwned(root, "owned-device", "seed", "after-openurl", async () => {
				calls.push("first");
				await held;
				throw new ObservationTimeout();
			}),
		);
		const rejected = expect(pair.answer).rejects.toThrow("receipt-timeout");
		await vi.advanceTimersByTimeAsync(60000);
		await rejected;
		const diag = new ProofDiagnostics(root);
		diag.checkpoint("phase", "seed");
		diag.observePhaseFailure({ phase: "seed", cause: "receipt-timeout" });
		diag.fail();
		await captureOwned(
			root,
			"owned-device",
			"seed",
			"receipt-timeout",
			async () => {
				expect(
					JSON.parse(readFileSync(join(root, "failure.json"), "utf8"))
						.phaseFailure.cause,
				).toBe("receipt-timeout");
				calls.push("second");
				throw new ObservationTimeout();
			},
		);
		release();
		await pair.capture;
		expect(calls).toEqual(["first", "second"]);
	});
	it("non-timeout receipt rejection remains immediate while capture finishes separately", async () => {
		let release!: () => void;
		const held = new Promise<void>((yes) => {
			release = yes;
		});
		const original = new Error("phase-rejected");
		const pair = captureAlongsideReceipt(Promise.reject(original), async () => {
			await held;
			return {
				phase: "seed",
				point: "after-openurl",
				status: "error",
				elapsedMs: 1,
			};
		});
		await expect(pair.answer).rejects.toBe(original);
		release();
		expect((await pair.capture).status).toBe("error");
	});
	it("real separate runner discards private output and reports errors/timeouts without diagnostic callbacks", async () => {
		await observationRun(
			process.execPath,
			["-e", "console.log('PRIVATE_TOKEN')"],
			1000,
		);
		await expect(
			observationRun(process.execPath, ["-e", "process.exit(2)"], 1000),
		).rejects.toThrow("Observation command failed");
		await expect(
			observationRun(process.execPath, ["-e", "setInterval(()=>{},1000)"], 20),
		).rejects.toBeInstanceOf(ObservationTimeout);
	});
	it("PNG CRC and end framing reject corruption explicitly", () => {
		validatePng(png);
		const corrupt = Buffer.from(png);
		corrupt[20] = (corrupt[20] ?? 0) ^ 1;
		expect(() => validatePng(corrupt)).toThrow();
		expect(() => validatePng(png.subarray(0, png.length - 1))).toThrow();
	});
	it("rejects non-closed phase before any command", async () => {
		let calls = 0;
		await expect(
			captureOwned(
				fresh(),
				"owned",
				"PRIVATE_TOKEN",
				"after-openurl",
				async () => {
					calls++;
				},
			),
		).rejects.toThrow();
		expect(calls).toBe(0);
	});
});
