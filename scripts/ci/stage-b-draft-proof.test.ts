import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	STAGE_B_BUNDLE,
	type StageBProofConfig,
} from "../../src/testing/stage-b-draft-transport";
import { stageBGeneratedSource } from "./stage-b-draft-build";
import {
	assertStageBDraft,
	selectStageBComputer,
	stageBFlow,
	typeStageBDraft,
} from "./stage-b-draft-flows";
import {
	assertStageBAdmission,
	verifyStageBBundle,
} from "./stage-b-draft-proof";

const SOURCE_EXTENSION = /\.[jt]sx?$/;
const PROOF_IMPORT = /stage-b-draft-bootstrap|stage-b-draft-transport/;
const AUTHORITY_OVERRIDE = /\.admit\(|configureStartupAuthorizationStorage/;

const config: StageBProofConfig = {
	flavor: "stage-b-draft-proof",
	bundleId: STAGE_B_BUNDLE,
	sourceSha: "a".repeat(40),
	nonce: "b".repeat(32),
	fixtureOrigin: "http://127.0.0.1:12345",
};
const env: NodeJS.ProcessEnv = {
	NODE_ENV: "test",
	CI: "true",
	GITHUB_ACTIONS: "true",
	GITHUB_REPOSITORY: "damianvtran/local-operator-mobile",
	GITHUB_EVENT_NAME: "pull_request",
	STAGE_B_NATIVE_APPROVED: "true",
	STAGE_B_SOURCE_SHA: config.sourceSha,
};
describe("dedicated Stage B proof preflight", () => {
	it("admits heavy work only in the separate approved read-only lane after backup proof", () => {
		const root = fileURLToPath(new URL("../../", import.meta.url));
		const workflow = readFileSync(
			join(root, ".github/workflows/stage-b-draft-proof.yml"),
			"utf8",
		);
		expect(workflow).toContain(
			"permissions:\n  contents: read\n  actions: read",
		);
		expect(workflow).toContain("needs: [preflight, backup-artifact]");
		expect(workflow).toContain("github.event.action == 'labeled'");
		expect(workflow).toContain("stage-b-native-approved");
		expect(workflow).toContain("cancel-in-progress: false");
		expect(workflow).toContain(
			"run: pnpm exec tsx scripts/ci/stage-b-draft-proof.ts",
		);
		expect(workflow).not.toContain("\n  workflow_dispatch:");
	});
	it("requires explicit same-repository PR admission and a frozen source", () => {
		expect(() => assertStageBAdmission(env)).not.toThrow();
		for (const changed of [
			{ STAGE_B_NATIVE_APPROVED: "false" },
			{ GITHUB_EVENT_NAME: "push" },
			{ GITHUB_REPOSITORY: "another/repo" },
			{ STAGE_B_SOURCE_SHA: "main" },
		])
			expect(() => assertStageBAdmission({ ...env, ...changed })).toThrow();
	});
	it("rejects source/bundle/nonce/flavor mismatch instead of accepting a stale app", () => {
		expect(() => verifyStageBBundle(config, config)).not.toThrow();
		for (const changed of [
			{ sourceSha: "c".repeat(40) },
			{ nonce: "c".repeat(32) },
			{ bundleId: "com.localoperator.mobile" },
			{ flavor: "ordinary" },
		])
			expect(() =>
				verifyStageBBundle(config, { ...config, ...changed }),
			).toThrow("mismatch");
	});
	it("installs proof transport before importing the real Expo router entry", () => {
		const source = stageBGeneratedSource(config);
		expect(source.entry).toContain(".bootStageBDraftProof(");
		expect(source.entry).toContain(".then(() => require('expo-router/entry'))");
		expect(source.entry).not.toContain("AppRegistry");
		expect(source.entry).not.toContain("View");
		expect(source.config).toContain(STAGE_B_BUNDLE);
		expect(source.config).toContain("StageBProofSourceSha");
	});
	it("keeps ordinary source/entry unreachable from proof bootstrap and commands", () => {
		const root = fileURLToPath(new URL("../../", import.meta.url));
		const manifest = JSON.parse(
			readFileSync(join(root, "package.json"), "utf8"),
		);
		expect(manifest.main).toBe("expo-router/entry");
		const visit = (path: string) => {
			for (const item of readdirSync(path, { withFileTypes: true })) {
				const file = join(path, item.name);
				if (item.isDirectory()) {
					if (item.name !== "testing") visit(file);
				} else if (
					SOURCE_EXTENSION.test(item.name) &&
					!item.name.includes(".test.")
				)
					expect(readFileSync(file, "utf8"), file).not.toMatch(PROOF_IMPORT);
			}
		};
		visit(join(root, "app"));
		visit(join(root, "src"));
		const bootstrap = readFileSync(
			join(root, "src/testing/stage-b-draft-bootstrap.ts"),
			"utf8",
		);
		expect(bootstrap).not.toMatch(AUTHORITY_OVERRIDE);
	});
	it("uses the real editor/computer path, explicit assertions and a single dedicated flow", () => {
		const flow = stageBFlow([
			...selectStageBComputer(),
			...typeStageBDraft("synthetic draft"),
			...assertStageBDraft("synthetic draft", false),
		]);
		expect(flow).toContain(STAGE_B_BUNDLE);
		expect(flow).toContain("computer-row-");
		expect(flow).toContain("composer-input");
		expect(flow).toContain("assertVisible");
		expect(flow).toContain("assertNotVisible");
		expect(flow).not.toContain("e2e/maestro/flows");
		expect(flow).not.toContain("clearState");
	});
});
