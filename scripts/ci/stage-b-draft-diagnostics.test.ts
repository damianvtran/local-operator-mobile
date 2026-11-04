import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { capFor } from "./account-routing-proof-contract";
import {
	awaitStageBSeed,
	captureStageBFailure,
	stageBFlowCap,
} from "./stage-b-draft-diagnostics";

const gate = (cause = "pending") =>
	JSON.stringify({
		identifier: "stage-b-proof-gate",
		label: `stage=private-key-read cause=${cause}`,
	});

describe("Stage B diagnosed-failure exit criterion", () => {
	it("gives the warm flow a cold cap and all other flows startup plus nested timeout headroom", () => {
		expect(stageBFlowCap([], true)).toBe(capFor("maestroCold"));
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
			'stageBFlowCap(steps, name === "warm-app-foreground")',
		);
	});
});
