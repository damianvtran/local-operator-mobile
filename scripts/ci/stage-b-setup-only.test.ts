import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	assertStageBAdmission,
	assertStageBFullEvidence,
	assertStageBSetupAdmission,
} from "./stage-b-draft-proof";
import {
	probeStageBCoordinator,
	STAGE_B_NODE_PROBE_MS,
} from "./stage-b-node-probe";

const FORBIDDEN_SETUP_COMMAND =
	/prebuild|pods|producer|launch-owned-app|segment-|driver-preflight/;
const approved = {
	NODE_ENV: "test" as const,
	CI: "true",
	GITHUB_ACTIONS: "true",
	GITHUB_REPOSITORY: "damianvtran/local-operator-mobile",
	GITHUB_ACTOR: "damianvtran",
	GITHUB_EVENT_NAME: "pull_request",
	STAGE_B_SOURCE_SHA: "a".repeat(40),
	STAGE_B_PROOF_MODE: "setup-only",
	STAGE_B_SETUP_APPROVED: "true",
	STAGE_B_SETUP_LABEL_CONFIRMED: "true",
};
describe("explicit setup prerequisite, never an E2E replacement", () => {
	it("requires distinct trusted approval and rejects setup input in the full lane", () => {
		expect(() => assertStageBSetupAdmission(approved)).not.toThrow();
		expect(() =>
			assertStageBSetupAdmission({
				...approved,
				GITHUB_EVENT_NAME: "workflow_dispatch",
				STAGE_B_SETUP_LABEL_CONFIRMED: "false",
				STAGE_B_SETUP_ONLY_INPUT: "true",
			}),
		).not.toThrow();
		for (const delta of [
			{ STAGE_B_SETUP_APPROVED: "false" },
			{ GITHUB_ACTOR: "other" },
			{ CI: "false" },
			{ GITHUB_EVENT_NAME: "push" },
			{ STAGE_B_PROOF_MODE: "full" },
			{ STAGE_B_SOURCE_SHA: "bad" },
			{
				GITHUB_EVENT_NAME: "workflow_dispatch",
				STAGE_B_SETUP_ONLY_INPUT: "false",
			},
		])
			expect(() =>
				assertStageBSetupAdmission({ ...approved, ...delta }),
			).toThrow("explicit trusted prerequisite approval");
		expect(() =>
			assertStageBAdmission({ ...approved, STAGE_B_NATIVE_APPROVED: "true" }),
		).toThrow("explicitly approved trusted PR lane");
	});
	it("cannot satisfy the full receipt gate even if a setup status is relabelled PASS", () => {
		const receipt = {
			flavor: "stage-b-setup-only",
			proofMode: "setup-only",
			status: "PASS",
			nativeMatrixPass: true,
			cases: [{ result: "PASS" }],
		};
		expect(() => assertStageBFullEvidence(receipt)).toThrow(
			"cannot satisfy native E2E evidence",
		);
		expect(() =>
			assertStageBFullEvidence({
				...receipt,
				flavor: "stage-b-draft-proof",
				proofMode: "full",
			}),
		).not.toThrow();
		expect(() =>
			assertStageBFullEvidence({
				...receipt,
				flavor: "stage-b-draft-proof",
				proofMode: "full",
				nodeOnly: true,
			}),
		).toThrow("cannot satisfy native E2E evidence");
	});
	it("keeps opt-in, artifacts and the native approval job separate", () => {
		const workflow = readFileSync(
			new URL(
				"../../.github/workflows/stage-b-draft-proof.yml",
				import.meta.url,
			),
			"utf8",
		);
		expect(workflow).toContain("workflow_dispatch:");
		expect(workflow).toContain("setup_only:");
		const setup =
			workflow.split("  setup-only:\n")[1]?.split("  native:\n")[0] ?? "";
		expect(setup).toContain("timeout-minutes: 20");
		expect(setup).toContain("stage-b-setup-approved");
		expect(setup).toContain("STAGE_B_PROOF_MODE: setup-only");
		expect(setup).toContain("/stage-b-setup-only-*/");
		expect(setup).not.toContain("STAGE_B_NATIVE_APPROVED");
		expect(setup).not.toContain("get.maestro");
		const controls = setup.indexOf(
			"run: pnpm exec vitest run scripts/ci/stage-b-setup-only.test.ts",
		);
		expect(controls).toBeGreaterThan(0);
		expect(controls).toBeLessThan(
			setup.indexOf("run: pnpm exec tsx scripts/ci/stage-b-draft-proof.ts"),
		);
		expect(setup).toContain("--bail 1");
		const native =
			workflow.split("  native:\n")[1]?.split("  backup-artifact:\n")[0] ?? "";
		expect(native).toContain("STAGE_B_PROOF_MODE: full");
		expect(native).toContain(
			"github.event.label.name == 'stage-b-native-approved'",
		);
	});
	it.each([
		["success", false, {}, "SETUP_ONLY_PASS", ""],
		[
			"boot failure",
			false,
			{ bootFails: true },
			"SETUP_ONLY_FAIL",
			"boot-status failed: rc=19",
		],
		[
			"import failure",
			true,
			{},
			"SETUP_ONLY_FAIL",
			"add-owned-photo failed: rc=18",
		],
		[
			"cleanup failure",
			false,
			{ deleteFails: true },
			"SETUP_ONLY_FAIL",
			"cleanup-delete-owned-simulator failed: rc=20",
		],
	] as const)(
		"runs the production coordinator with fake tools: %s",
		(_name, mediaFails, options, status, error) => {
			const result = probeStageBCoordinator(false, false, mediaFails, options);
			expect(result).toMatchObject({
				nodeOnly: true,
				flavor: "stage-b-setup-only",
				proofMode: "setup-only",
				status,
				nativeMatrixPass: false,
				cases: [],
				fullEvidenceRejected: true,
			});
			expect(result.error).toContain(error);
			const commands = result.commands as string[];
			const records = result.commandReceipts as {
				name: string;
				capSeconds: number;
			}[];
			expect(records.find((c) => c.name === "boot-status")?.capSeconds).toBe(
				240,
			);
			if (commands.includes("add-owned-photo"))
				expect(
					records.find((c) => c.name === "add-owned-photo")?.capSeconds,
				).toBe(240);
			expect(commands).toContain("boot-status");
			expect(commands).toContain("cleanup-delete-owned-simulator");
			expect(commands.some((name) => FORBIDDEN_SETUP_COMMAND.test(name))).toBe(
				false,
			);
			expect(
				commands.filter((name) => name === "add-owned-photo"),
			).toHaveLength("bootFails" in options && options.bootFails ? 0 : 1);
			if (error && !("deleteFails" in options && options.deleteFails)) {
				expect(commands).toContain("setup-failure-boot-log");
				expect(commands).toContain("setup-failure-screenshot");
				expect(commands).not.toContain("failure-hierarchy");
				expect(commands.indexOf("setup-failure-boot-log")).toBeLessThan(
					commands.indexOf("cleanup-shutdown-owned-simulator"),
				);
			}
		},
		STAGE_B_NODE_PROBE_MS + 5000,
	);
});
