import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { capFor } from "./account-routing-proof-contract";
import {
	awaitStageBSeed,
	captureStageBFailure,
	captureStageBMediaReadiness,
	captureStageBSetupFailure,
	stageBFlowCap,
	stageBSeedFailureFromHierarchy,
} from "./stage-b-draft-diagnostics";
import {
	attachStageBPhoto,
	selectStageBComputer,
	typeStageBDraft,
} from "./stage-b-draft-flows";

const gate = (cause = "pending") =>
	JSON.stringify({
		identifier: "stage-b-proof-gate",
		label: `stage=private-key-read cause=${cause}`,
	});

describe("Stage B diagnosed-failure exit criterion", () => {
	it("captures cold system-app/migration evidence without Maestro and redacts failed probes", async () => {
		const dir = mkdtempSync(
			join(
				process.env.LOCAL_OPERATOR_SCRATCHPAD ?? tmpdir(),
				"stage-b-setup-diag-",
			),
		);
		const calls: { name: string; args: string[]; cap: number }[] = [];
		const privateToken = ["setup", "diagnostic", "private", "token"].join("-");
		try {
			const result = await captureStageBSetupFailure(
				async (name, _command, args, cap) => {
					calls.push({ name, args, cap });
					if (name.includes("services"))
						throw new Error(`Bearer ${privateToken}`);
					return `SpringBoard Waiting on System App; Bearer ${privateToken}`;
				},
				"owned",
				dir,
			);
			expect(calls.every((call) => call.cap <= 30)).toBe(true);
			expect(calls.some((call) => call.name.includes("hierarchy"))).toBe(false);
			expect(
				calls
					.find((call) => call.name === "setup-failure-boot-log")
					?.args.join(" "),
			).toContain("migration");
			expect(result["setup-failure-boot-log"]).toBe("captured");
			expect(JSON.stringify(result)).not.toContain(privateToken);
			const text = readFileSync(
				join(dir, "setup-failure-boot-log.txt"),
				"utf8",
			);
			expect(text).toContain("Waiting on System App");
			expect(text).not.toContain(privateToken);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
	it("uploads the redacted media evidence files alongside receipt/command logs", () => {
		const workflow = readFileSync(
			new URL(
				"../../.github/workflows/stage-b-draft-proof.yml",
				import.meta.url,
			),
			"utf8",
		);
		expect(workflow).toContain("/stage-b-draft-proof-*/media-*.txt");
	});
	it("captures bounded Photos service evidence without claiming readiness or retaining credentials", async () => {
		const dir = mkdtempSync(
			join(process.env.LOCAL_OPERATOR_SCRATCHPAD ?? tmpdir(), "stage-b-media-"),
		);
		try {
			const commands: { name: string; args: string[]; seconds: number }[] = [];
			const result = await captureStageBMediaReadiness(
				async (name, _command, args, seconds) => {
					commands.push({ name, args, seconds });
					return "123 0 com.apple.assetsd token=forbidden-key";
				},
				"synthetic-simulator",
				dir,
				"before",
			);
			expect(result).toEqual({
				services: "captured",
				"photos-log": "captured",
			});
			expect(commands.map((c) => c.seconds)).toEqual([15, 30]);
			expect(commands[0]?.args.slice(-2)).toEqual(["launchctl", "list"]);
			expect(commands[1]?.args).toContain("6m");
			for (const name of ["media-before-services", "media-before-photos-log"]) {
				const text = readFileSync(join(dir, `${name}.txt`), "utf8");
				expect(text).toContain("com.apple.assetsd");
				expect(text).not.toContain("forbidden-key");
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
	it("records unavailable service probes instead of replacing the import failure", async () => {
		const dir = mkdtempSync(
			join(process.env.LOCAL_OPERATOR_SCRATCHPAD ?? tmpdir(), "stage-b-media-"),
		);
		try {
			const result = await captureStageBMediaReadiness(
				async () => {
					throw new Error("service probe unavailable");
				},
				"synthetic-simulator",
				dir,
				"failed",
			);
			expect(Object.keys(result)).toEqual(["services", "photos-log"]);
			for (const status of Object.values(result))
				expect(status).toContain("service probe unavailable");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
	it("decodes the persisted failure gate stage/cause without another driver call", () => {
		expect(
			stageBSeedFailureFromHierarchy(gate("Error: token=secret-value")),
		).toBe(
			"seed never completed at stage=private-key-read: Error: [redacted-credential]",
		);
		expect(
			stageBSeedFailureFromHierarchy('{"identifier":"home-screen"}'),
		).toBeNull();
	});
	it("gives the warm flow a cold cap and all other flows startup plus nested timeout headroom", () => {
		const merged = [
			...selectStageBComputer(),
			...typeStageBDraft("synthetic"),
			...attachStageBPhoto(),
		];
		expect(stageBFlowCap(merged, true)).toBe(stageBFlowCap(merged));
		expect(stageBFlowCap(merged, true)).toBeGreaterThan(capFor("maestroCold"));
		expect(
			stageBFlowCap([
				{ runFlow: { commands: [{ extendedWaitUntil: { timeout: 300000 } }] } },
			]),
		).toBeGreaterThan(64 + 19 + 78 + 300);
	});
	it("counts the gate as drawn but waits for an actual seeded app screen", async () => {
		const result = await awaitStageBSeed(
			gate(),
			async () => '{"identifier":"home-screen"}',
			{ sleep: async () => {} },
		);
		expect(result).toContain("home-screen");
	});
	it("names the exact failed seed stage and redacts the cause", async () => {
		await expect(
			awaitStageBSeed(gate("Error: token=secret-value"), async () => "unused"),
		).rejects.toThrow(
			"seed never completed at stage=private-key-read: Error: [redacted-credential]",
		);
	});
	it("preserves the last gate stage when the seed never completes", async () => {
		let clock = 0;
		await expect(
			awaitStageBSeed(gate(), async () => gate(), {
				now: () => clock,
				sleep: async () => {
					clock = 180001;
				},
			}),
		).rejects.toThrow(
			"seed never completed at stage=private-key-read: deadline exceeded",
		);
	});
	it("captures hierarchy and OS log even if screenshot capture fails; stores redacted text", async () => {
		const dir = mkdtempSync(
			join(
				process.env.LOCAL_OPERATOR_SCRATCHPAD ?? tmpdir(),
				"stage-b-diagnostics-",
			),
		);
		const calls: string[] = [];
		try {
			const result = await captureStageBFailure(
				async (name, _command, args) => {
					calls.push(name);
					if (name === "failure-screenshot") throw new Error("no framebuffer");
					if (name === "failure-os-log")
						expect(args).toContain('process == "StageBDraftProof"');
					return "stage=private-key-read Bearer forbidden-token";
				},
				"owned-udid",
				dir,
				"maestro",
			);
			expect(calls).toEqual([
				"failure-screenshot",
				"failure-hierarchy",
				"failure-os-log",
			]);
			expect(result["failure-hierarchy"]).toBe("captured");
			expect(
				readFileSync(join(dir, "failure.os-log.txt"), "utf8"),
			).not.toContain("forbidden-token");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
	it("wires failure capture ahead of simulator shutdown and deletion", () => {
		const root = fileURLToPath(new URL("../../", import.meta.url));
		const source = readFileSync(
			join(root, "scripts/ci/stage-b-draft-proof.ts"),
			"utf8",
		);
		const cleanup = source.slice(source.lastIndexOf("} finally {"));
		expect(cleanup.indexOf("captureStageBFailure(")).toBeGreaterThan(0);
		expect(cleanup.indexOf("captureStageBFailure(")).toBeLessThan(
			cleanup.indexOf('"cleanup-shutdown-owned-simulator"'),
		);
		expect(source).toContain(
			'stageBFlowCap(steps, names.includes("warm-app-foreground"))',
		);
	});
});
