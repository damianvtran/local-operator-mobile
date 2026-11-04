import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { probeStageBCoordinator } from "./stage-b-node-probe";

describe("real proof coordinator with Node-only executable shims", () => {
	it("preserves raw identities/workflow/path through launch while persisting redacted logs", () => {
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
				"launch-owned-app",
				"segment-1-warm-app-foreground",
				"failure-hierarchy",
				"cleanup-delete-owned-simulator",
			]),
		);
	}, 45000);
	it("rejects the old redacted-return mutation at the exact pre-simulator source fence", () => {
		expect(probeStageBCoordinator(true)).toMatchObject({
			oldRedactedReturn: true,
			error: "checkout differs from frozen PR source",
			commands: ["source"],
		});
	}, 45000);
	it("rejects a coordinator mutation that disables simulator code signing", () => {
		expect(probeStageBCoordinator(false, true)).toMatchObject({
			unsignedBuild: true,
			rejectedUnsignedBuild: true,
		});
	}, 45000);
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
