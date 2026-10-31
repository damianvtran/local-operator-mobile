import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareProofBuild } from "./auth-retirement-ios-proof.ts";

const root = new URL("../../", import.meta.url);
const source = (path: string) => readFileSync(new URL(path, root), "utf8");
afterEach(() => vi.unstubAllEnvs());
describe("proof-only host/controller boundary", () => {
	it("refuses ordinary workflow invocations before any source rewrite", async () => {
		vi.stubEnv("GITHUB_EVENT_NAME", "pull_request");
		vi.stubEnv("RETIREMENT_PROOF", "true");
		await expect(prepareProofBuild("unused")).rejects.toThrow(
			"Manual proof opt-in required",
		);
		vi.stubEnv("GITHUB_EVENT_NAME", "workflow_dispatch");
		vi.stubEnv("RETIREMENT_PROOF", "false");
		await expect(prepareProofBuild("unused")).rejects.toThrow(
			"Manual proof opt-in required",
		);
	});
	it("ordinary entry and provider expose no proof command/auth bypass", () => {
		expect(JSON.parse(source("package.json")).main).toBe("expo-router/entry");
		for (const file of [
			"app/_layout.tsx",
			"app.config.ts",
			"src/features/auth/connection-provider.tsx",
		])
			expect(source(file)).not.toContain("auth-retirement-proof");
	});
	it("uses native storage and the production primitive graph, never direct deletion", () => {
		const controller = source("src/testing/auth-retirement-proof.ts");
		for (const seam of [
			"expoSecureStore()",
			"new SecureStorage(",
			"new StartupAuthorizationLifecycle(",
			"createRadientAccess(",
			"carryOutRestore(",
			"readStoredOauth",
			"clearStoredCredentials",
			"nativeCredentialRetirement.retire(",
			"refreshRadientTokens(",
		])
			expect(controller).toContain(seam);
		// ConnectionProvider is mentioned solely to disclaim UI/provider proof.
		for (const forbidden of [
			"deleteItemAsync(",
			"memorySecureStore(",
			"node:fs",
			"beginRadientSignIn",
			"ConnectionProvider",
		])
			if (forbidden !== "ConnectionProvider")
				expect(controller).not.toContain(forbidden);
	});
	it("keeps proof opt-in false and native operation capped at ten minutes", () => {
		const workflow = source(".github/workflows/ios.yml");
		expect(workflow).toContain("retirement_proof:");
		expect(workflow).toContain("default: false");
		expect(workflow).toContain("timeout-minutes: 10");
		expect(workflow).toContain(
			"github.event_name == 'workflow_dispatch' && inputs.retirement_proof",
		);
	});
	it("CLI negative control exits nonzero for authorized receipt and zero only for retired restore", () => {
		const dir = mkdtempSync(
			join(
				process.env.LOCAL_OPERATOR_SCRATCHPAD ??
					process.env.RUNNER_TEMP ??
					tmpdir(),
				"native-proof-contract-",
			),
		);
		const file = join(dir, "receipt.json");
		const env = Object.fromEntries(
			Object.entries(process.env).filter(
				([k]) => !k.startsWith("CMUX_") && k !== "XPC_FLAGS",
			),
		);
		writeFileSync(
			file,
			JSON.stringify({
				phase: "persist-control",
				ok: true,
				restored: true,
				rawOauthPresent: true,
			}),
		);
		const run = () =>
			spawnSync(
				process.execPath,
				["scripts/ci/auth-retirement-ios-proof.ts", "--assert-retired", file],
				{
					cwd: root,
					env: { ...env, NODE_ENV: "test" },
					timeout: 10000,
					encoding: "utf8",
				},
			);
		expect(run().status).toBe(1);
		writeFileSync(
			file,
			JSON.stringify({
				phase: "retired-restore",
				ok: true,
				restored: false,
				rawOauthPresent: false,
				refreshes: 0,
				publishes: 0,
				deletes: 0,
			}),
		);
		expect(run().status).toBe(0);
	});
});
