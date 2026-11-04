import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { immutableBundleDigest } from "./auth-retirement-ios-proof.ts";
import type { Run } from "./auth-retirement-simulator.ts";
import {
	type SampleContext,
	sampleOwnedProof,
} from "./retirement-replay-native.ts";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});
function fixture() {
	const root = mkdtempSync(join(tmpdir(), "retained-live-sample-"));
	roots.push(root);
	const app = join(root, "Fixture.app");
	mkdirSync(app);
	writeFileSync(join(app, "FixtureProof"), "synthetic-not-native");
	const source = {
		flavor: "auth-retirement-proof",
		bundleId: "com.localoperator.mobile.retirementproof",
		nonce: "a".repeat(32),
		sourceSha: "2989876958f6c605f6756f59b15519456516faa7",
		receiverPort: 23456,
		bundleSha256: immutableBundleDigest(app),
	};
	const intent = {
		nonce: source.nonce,
		runId: "fixture-run",
		hostPid: process.pid,
		name: "fixture-owned-proof",
		runtime: "fixture-runtime",
		deviceType: "fixture-device",
		templateUdid: "22222222-2222-2222-2222-222222222222",
		state: "settled" as const,
		clientPid: null,
	};
	const lease = {
		udid: "11111111-1111-1111-1111-111111111111",
		hostPid: process.pid,
		nonce: source.nonce,
	};
	writeFileSync(join(root, "simulator-lease.json"), JSON.stringify(lease));
	writeFileSync(join(root, "creation-intent.json"), JSON.stringify(intent));
	const context: SampleContext = {
		root,
		intent,
		lease,
		proofPID: 123,
		source,
		runnerSource: "c".repeat(40),
		executable: "FixtureProof",
	};
	const info = {
		LORetirementProofFlavor: source.flavor,
		CFBundleIdentifier: source.bundleId,
		LORetirementProofNonce: source.nonce,
		LORetirementProofSource: source.sourceSha,
		LORetirementProofReceiverPort: source.receiverPort,
		CFBundleExecutable: "FixtureProof",
	};
	const inventory = {
		devices: {
			"fixture-runtime": [
				{
					udid: lease.udid,
					name: intent.name,
					deviceTypeIdentifier: intent.deviceType,
				},
			],
		},
	};
	let now = 0,
		spawnReads = 0;
	const budgets: number[] = [];
	let stepMs = 100;
	let secondPID = 123;
	const commands: string[][] = [];
	const run: Run = async (exe, args, budget) => {
		commands.push([exe, ...args]);
		budgets.push(budget ?? 0);
		now += stepMs;
		if (exe === "plutil") return JSON.stringify(info);
		if (args[1] === "list") return JSON.stringify(inventory);
		if (args[1] === "get_app_container") return app;
		if (args[1] === "spawn") {
			spawnReads++;
			return `${spawnReads === 2 ? secondPID : 123}\t0\tUIKitApplication:com.localoperator.mobile.retirementproof[fixture]`;
		}
		throw new Error("Unexpected fixture boundary");
	};
	return {
		root,
		app,
		context,
		info,
		inventory,
		run,
		budgets,
		commands,
		clock: () => now,
		setStep: (value: number) => {
			stepMs = value;
		},
		exitBeforeSecond: () => {
			secondPID = 0;
		},
	};
}
describe("host-owned exact installed/process sampling with injected native boundary", () => {
	it("brackets actual local bundle hashing with two exact live process observations", async () => {
		const f = fixture(),
			measured = await sampleOwnedProof(
				f.context,
				f.run,
				Date.now() + 100000,
				f.clock,
			);
		expect(measured.pid).toBe(123);
		expect(measured.bundle).toBe(f.context.source.bundleSha256);
		expect(
			f.commands.map((row) => (row[0] === "plutil" ? row[1] : row[2])),
		).toEqual(["list", "spawn", "get_app_container", "-convert", "spawn"]);
		expect(f.budgets).toEqual([5000, 4900, 4800, 4700, 4600]);
	});
	it.each(["source", "flavor", "nonce", "port", "bundle-id", "content"])(
		"installed %s mismatch refuses before a second successful sample",
		async (kind) => {
			const f = fixture();
			if (kind === "source") f.info.LORetirementProofSource = "b".repeat(40);
			if (kind === "flavor") f.info.LORetirementProofFlavor = "production";
			if (kind === "nonce") f.info.LORetirementProofNonce = "b".repeat(32);
			if (kind === "port") f.info.LORetirementProofReceiverPort = 23457;
			if (kind === "bundle-id") f.info.CFBundleIdentifier = "other";
			if (kind === "content")
				writeFileSync(join(f.app, "FixtureProof"), "changed");
			await expect(
				sampleOwnedProof(f.context, f.run, Date.now() + 100000, f.clock),
			).rejects.toThrow();
			expect(f.context.pinnedLabel).toBeUndefined();
		},
	);
	it("wrong lease host refuses before any native boundary, while wrong inventory refuses before process access", async () => {
		const f = fixture();
		writeFileSync(
			join(f.root, "simulator-lease.json"),
			JSON.stringify({ ...f.context.lease, hostPid: process.pid + 1 }),
		);
		await expect(
			sampleOwnedProof(f.context, f.run, Date.now() + 100000, f.clock),
		).rejects.toThrow();
		expect(f.commands).toHaveLength(0);
		const g = fixture();
		g.inventory.devices["fixture-runtime"][0]!.udid =
			"33333333-3333-3333-3333-333333333333";
		await expect(
			sampleOwnedProof(g.context, g.run, Date.now() + 100000, g.clock),
		).rejects.toThrow();
		expect(g.commands).toHaveLength(1);
	});
	it("process exit after installed measurement and a sample exceeding shared5s both refuse", async () => {
		const f = fixture();
		f.exitBeforeSecond();
		await expect(
			sampleOwnedProof(f.context, f.run, Date.now() + 100000, f.clock),
		).rejects.toThrow();
		const g = fixture();
		g.setStep(1100);
		await expect(
			sampleOwnedProof(g.context, g.run, Date.now() + 100000, g.clock),
		).rejects.toThrow("refused");
		expect(g.budgets).toEqual([5000, 3900, 2800, 1700, 600]);
	});
});
