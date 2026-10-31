import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupLease } from "./auth-retirement-ios-proof.ts";

const nonce = "a".repeat(32),
	runId = "123456",
	udid = "11111111-1111-1111-1111-111111111111";
const intent = {
	nonce,
	runId,
	hostPid: process.pid,
	name: `lop-retirement-${nonce}-${process.pid}-${runId}`,
	runtime: "runtime-proof",
	deviceType: "type-proof",
	templateUdid: "22222222-2222-2222-2222-222222222222",
	state: "settled",
	clientPid: null,
};
afterEach(() => {
	vi.unstubAllEnvs();
	vi.useRealTimers();
});
function fixture() {
	const root = mkdtempSync(
		join(
			process.env.LOCAL_OPERATOR_SCRATCHPAD ??
				process.env.RUNNER_TEMP ??
				tmpdir(),
			"creation-proof-",
		),
	);
	writeFileSync(join(root, "build-identity.json"), JSON.stringify({ nonce }));
	writeFileSync(join(root, "creation-intent.json"), JSON.stringify(intent));
	vi.stubEnv("GITHUB_ACTIONS", "true");
	vi.stubEnv("GITHUB_EVENT_NAME", "workflow_dispatch");
	vi.stubEnv("GITHUB_RUN_ID", runId);
	vi.stubEnv("RETIREMENT_PROOF", "true");
	return root;
}
describe("creation intent recovery", () => {
	it("recovers create-success/lost-output before a completed lease exists", async () => {
		const root = fixture(),
			calls: string[][] = [];
		const run = async (_exe: string, args: string[]) => {
			calls.push(args);
			return args[1] === "list"
				? JSON.stringify({
						devices: {
							[intent.runtime]: [
								{
									udid,
									name: intent.name,
									state: "Shutdown",
									deviceTypeIdentifier: intent.deviceType,
								},
							],
						},
					})
				: "";
		};
		await (
			cleanupLease as unknown as (root: string, deps: unknown) => Promise<void>
		)(root, { run, isAlive: () => false });
		expect(calls).toContainEqual(["simctl", "delete", udid]);
		expect(
			JSON.parse(readFileSync(join(root, "cleanup.json"), "utf8"))
				.cleanupFailed,
		).toBe(false);
	});
});

import { existsSync, mkdirSync } from "node:fs";
import {
	createFromIntent,
	prepareCreation,
	type Run,
	recoverCreation,
} from "./auth-retirement-simulator.ts";

function freshRoot() {
	return mkdtempSync(
		join(
			process.env.LOCAL_OPERATOR_SCRATCHPAD ??
				process.env.RUNNER_TEMP ??
				tmpdir(),
			"creation-transaction-",
		),
	);
}
const fields = {
	nonce,
	runId,
	hostPid: process.pid,
	runtime: intent.runtime,
	deviceType: intent.deviceType,
	templateUdid: intent.templateUdid,
};
const device = {
	udid,
	name: intent.name,
	state: "Shutdown",
	deviceTypeIdentifier: intent.deviceType,
};
function inventory(devices: unknown[]) {
	return JSON.stringify({ devices: { [intent.runtime]: devices } });
}
describe("durable creation transaction failure cases", () => {
	it("journals intent before create; lost stdout still permits exact recovery", async () => {
		const root = freshRoot();
		const prepared = prepareCreation(root, fields),
			calls: string[][] = [];
		const run: Run = async (_exe, args, _timeout, before) => {
			calls.push(args);
			if (args[1] === "create") {
				expect(existsSync(join(root, "creation-intent.json"))).toBe(true);
				before?.(99999999);
				throw new Error("simulated success at service; stdout lost");
			}
			return args[1] === "list" ? inventory([device]) : "";
		};
		await expect(createFromIntent(root, prepared, run)).rejects.toThrow(
			"stdout lost",
		);
		expect(existsSync(join(root, "simulator-lease.json"))).toBe(false);
		await recoverCreation(root, nonce, runId, run, () => false);
		expect(calls).toContainEqual(["simctl", "delete", udid]);
	});
	it("recovers a cancelled/reentered host from intent with no lease", async () => {
		const root = freshRoot();
		const prepared = prepareCreation(root, fields);
		writeFileSync(
			join(root, "creation-intent.json"),
			JSON.stringify({ ...prepared, state: "in-flight", clientPid: 99999999 }),
		);
		const calls: string[][] = [];
		const run: Run = async (_exe, args) => {
			calls.push(args);
			return args[1] === "list" ? inventory([device]) : "";
		};
		await recoverCreation(root, nonce, runId, run, () => false);
		expect(calls).toContainEqual(["simctl", "delete", udid]);
	});
	it("refuses recovery while the recorded client still runs", async () => {
		const root = freshRoot();
		const prepared = prepareCreation(root, fields);
		writeFileSync(
			join(root, "creation-intent.json"),
			JSON.stringify({ ...prepared, state: "in-flight", clientPid: 99999999 }),
		);
		const run = vi.fn<Run>();
		vi.useFakeTimers();
		const rejected = expect(
			recoverCreation(root, nonce, runId, run, () => true),
		).rejects.toThrow("active");
		await vi.runAllTimersAsync();
		await rejected;
		expect(run).not.toHaveBeenCalled();
	});
	it("refuses foreign metadata, supplied template and ambiguous exact-name matches", async () => {
		for (const entries of [
			[{ ...device, deviceTypeIdentifier: "foreign" }],
			[{ ...device, udid: intent.templateUdid }],
			[device, { ...device, udid: "33333333-3333-3333-3333-333333333333" }],
		]) {
			const root = freshRoot();
			prepareCreation(root, fields);
			const calls: string[][] = [];
			const run: Run = async (_exe, args) => {
				calls.push(args);
				return inventory(entries);
			};
			await expect(
				recoverCreation(root, nonce, runId, run, () => false),
			).rejects.toThrow();
			expect(calls.some((a) => a[1] === "delete" || a[1] === "shutdown")).toBe(
				false,
			);
		}
	});
	it("is idempotent when a settled/already-cleaned device is absent", async () => {
		const root = freshRoot();
		const prepared = prepareCreation(root, fields);
		writeFileSync(
			join(root, "creation-intent.json"),
			JSON.stringify({ ...prepared, state: "settled" }),
		);
		const calls: string[][] = [];
		const run: Run = async (_exe, args) => {
			calls.push(args);
			return inventory([]);
		};
		await recoverCreation(root, nonce, runId, run, () => false);
		await recoverCreation(root, nonce, runId, run, () => false);
		expect(calls.some((a) => a[1] === "delete")).toBe(false);
	});
	it("intent persistence failure issues zero create requests", () => {
		const root = freshRoot();
		mkdirSync(join(root, "creation-intent.json"));
		const run = vi.fn<Run>();
		expect(() => prepareCreation(root, fields)).toThrow();
		expect(run).not.toHaveBeenCalled();
	});
	it("blocks uncertain empty reconciliation instead of claiming cleanup success", async () => {
		const root = freshRoot();
		const prepared = prepareCreation(root, fields);
		writeFileSync(
			join(root, "creation-intent.json"),
			JSON.stringify({ ...prepared, state: "uncertain", clientPid: 99999999 }),
		);
		await expect(
			recoverCreation(
				root,
				nonce,
				runId,
				async () => inventory([]),
				() => false,
			),
		).rejects.toThrow(/blocked/i);
	});
});

import { command } from "./auth-retirement-ios-proof.ts";

describe("gated owned create-client lifecycle (local subprocess only)", () => {
	it("journal failure prevents the underlying executable from starting", async () => {
		const root = freshRoot(),
			sentinel = join(root, "must-not-exist");
		await expect(
			command(
				process.execPath,
				[
					"-e",
					`require('node:fs').writeFileSync(${JSON.stringify(sentinel)},'started')`,
				],
				10000,
				() => {
					throw new Error("journal unavailable");
				},
			),
		).rejects.toThrow("journal failed");
		expect(existsSync(sentinel)).toBe(false);
	});
	it("records the owned client before releasing execution", async () => {
		const root = freshRoot(),
			journal = join(root, "journal"),
			sentinel = join(root, "started");
		await command(
			process.execPath,
			[
				"-e",
				`const fs=require('node:fs');if(!fs.existsSync(${JSON.stringify(journal)}))process.exit(9);fs.writeFileSync(${JSON.stringify(sentinel)},'started');`,
			],
			10000,
			(pid) => {
				expect(pid).toBeGreaterThan(0);
				writeFileSync(journal, "durable-test-journal", { flush: true });
			},
		);
		expect(existsSync(sentinel)).toBe(true);
	});
});
