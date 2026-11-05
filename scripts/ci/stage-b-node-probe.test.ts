import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	probeStageBCoordinator,
	STAGE_B_NODE_PROBE_MS,
} from "./stage-b-node-probe";

describe("real proof coordinator with Node-only executable shims", () => {
	it(
		"collects before/failed Photos service evidence without retrying import or masking its error",
		() => {
			const result = probeStageBCoordinator(false, false, true);
			expect(result.error).toContain("add-owned-photo failed: rc=18");
			expect(result.mediaReadiness).toMatchObject({
				import: "failed",
				before: { services: "captured", "photos-log": "captured" },
				failed: { services: "captured", "photos-log": "captured" },
			});
			const commands = result.commands as string[];
			expect(commands.filter((n) => n === "add-owned-photo")).toHaveLength(1);
			expect(commands.indexOf("media-before-services")).toBeLessThan(
				commands.indexOf("add-owned-photo"),
			);
			expect(commands.indexOf("media-failed-photos-log")).toBeGreaterThan(
				commands.indexOf("add-owned-photo"),
			);
			expect(commands.indexOf("media-failed-photos-log")).toBeLessThan(
				commands.indexOf("cleanup-shutdown-owned-simulator"),
			);
			expect(commands).not.toContain("launch-owned-app");
		},
		STAGE_B_NODE_PROBE_MS + 5000,
	);
	it(
		"preserves raw identities/workflow/path through launch while persisting redacted logs",
		() => {
			const result = probeStageBCoordinator();
			expect(result).toMatchObject({
				nodeOnly: true,
				sourceRaw: true,
				workflowRaw: true,
				nonceRaw: true,
				containerRaw: true,
				signature: "adhoc",
				entitlementsLogged: true,
				pids: [12345],
				stoppedAtFakeFlow: true,
				logsRedacted: { sha: true, nonce: true, path: true },
				argsRedacted: true,
				safeDigests: true,
			});
			expect(result.commands).toEqual(
				expect.arrayContaining([
					"source",
					"evaluated-workflow",
					"disk-preflight",
					"runtime-preflight",
					"plist-StageBProofSourceSha",
					"plist-StageBProofNonce",
					"installed-container",
					"media-before-services",
					"media-before-photos-log",
					"launch-owned-app",
					"segment-1-warm-app-foreground",
					"failure-hierarchy",
					"cleanup-delete-owned-simulator",
				]),
			);
		},
		STAGE_B_NODE_PROBE_MS + 5000,
	);
	it(
		"rejects the old redacted-return mutation at the exact pre-simulator source fence",
		() => {
			expect(probeStageBCoordinator(true)).toMatchObject({
				oldRedactedReturn: true,
				error: "checkout differs from frozen PR source",
				commands: ["source"],
			});
		},
		STAGE_B_NODE_PROBE_MS + 5000,
	);
	it(
		"rejects a coordinator mutation that disables simulator code signing",
		() => {
			expect(probeStageBCoordinator(false, true)).toMatchObject({
				unsignedBuild: true,
				rejectedUnsignedBuild: true,
			});
		},
		STAGE_B_NODE_PROBE_MS + 5000,
	);
	it("redacts frame hierarchies and exposes no environment-selected test host in production", () => {
		const source = readFileSync(
			fileURLToPath(new URL("./stage-b-draft-proof.ts", import.meta.url)),
			"utf8",
		);
		const frame = source.slice(
			source.indexOf("const frame ="),
			source.indexOf("const frame =") + 1000,
		);
		expect(frame).toContain("stageBDiagnosticText(hierarchy)");
		const production = source.slice(
			source.indexOf("export async function runStageBDraftProof("),
			source.indexOf("const NODE_SHIM_MARKER"),
		);
		expect(production).toContain("runStageBCoordinator(env)");
		expect(production).not.toContain("nodeOnly");
	});
});
