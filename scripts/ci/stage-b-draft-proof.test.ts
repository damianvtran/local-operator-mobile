import { execFileSync } from "node:child_process";
import {
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	STAGE_B_BUNDLE,
	type StageBProofConfig,
} from "../../src/testing/stage-b-draft-transport";
import { capFor } from "./account-routing-proof-contract";
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
	warmStageBDriver,
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
	it("wires driver warm-up into the production initial-launch path before evidence", () => {
		const root = fileURLToPath(new URL("../../", import.meta.url));
		const source = readFileSync(
			join(root, "scripts/ci/stage-b-draft-proof.ts"),
			"utf8",
		);
		const start = source.indexOf("export async function runStageBDraftProof(");
		expect(start).toBeGreaterThan(0);
		const body = source.slice(start);
		const warm = body.indexOf("await warmStageBDriver(");
		const evidence = body.indexOf('await flow("connect-initial"');
		expect(warm).toBeGreaterThan(0);
		expect(evidence).toBeGreaterThan(warm);
		// Ignore the earlier relaunch helper: its explicit launch is intentional.
		const initial = body.indexOf('await run("phone-light"');
		expect(initial).toBeGreaterThan(0);
		expect(initial).toBeLessThan(warm);
		expect(body.slice(initial, evidence)).not.toContain("await launch();");
	});
	it("warms the driver before tracked launch, then requires a foregrounded drawn app", async () => {
		const calls: unknown[] = [];
		let hierarchyCalls = 0;
		const drawn = '{"identifier":"home-screen"}';
		const result = await warmStageBDriver(
			async (name, seconds) => {
				calls.push([name, seconds]);
				return ++hierarchyCalls === 1
					? '{"application":"SpringBoard","label":"Stage B Draft Proof"}'
					: drawn;
			},
			async () => {
				calls.push("tracked-simctl-launch");
			},
			async () => {
				calls.push("foreground-without-restart");
			},
		);
		expect(result).toBe(drawn);
		expect(calls).toEqual([
			["warm-maestro-driver-cold", capFor("maestroCold")],
			"tracked-simctl-launch",
			"foreground-without-restart",
			["warm-app-readiness", 90],
		]);
	});
	it("names a readiness failure instead of admitting SpringBoard icons as app UI", async () => {
		await expect(
			warmStageBDriver(
				async () =>
					'{"application":"SpringBoard","icons":["Stage B Draft Proof","maestro-driver-iosUITests-Runner"]}',
				async () => {},
				async () => {},
			),
		).rejects.toThrow(
			"Stage B warm readiness: hierarchy has no drawn app screen id",
		);
	});
	it("does not launch or enter evidence when cold driver startup fails", async () => {
		let launched = false;
		let foregrounded = false;
		await expect(
			warmStageBDriver(
				async () => {
					throw new Error("warm-maestro-driver-cold deadline exceeded");
				},
				async () => {
					launched = true;
				},
				async () => {
					foregrounded = true;
				},
			),
		).rejects.toThrow("warm-maestro-driver-cold deadline exceeded");
		expect(launched).toBe(false);
		expect(foregrounded).toBe(false);
	});
	it("uses ordinary iOS build parallelism with an owned destination and explicit whole-job headroom", () => {
		const root = fileURLToPath(new URL("../../", import.meta.url));
		const source = readFileSync(
			join(root, "scripts/ci/stage-b-draft-proof.ts"),
			"utf8",
		);
		const start = source.indexOf('"unsigned-candidate-producer"');
		expect(start).toBeGreaterThan(0);
		const build = source.slice(start, source.indexOf("const products", start));
		expect(build).not.toContain('"-jobs"');
		for (const flag of [
			"CODE_SIGN_IDENTITY=-",
			"CODE_SIGN_STYLE=Manual",
			"DEVELOPMENT_TEAM=",
			"CODE_SIGNING_ALLOWED=YES",
			"CODE_SIGNING_REQUIRED=NO",
		])
			expect(build).toContain(flag);
		expect(build).not.toContain("CODE_SIGNING_ALLOWED=NO");
		expect(build).toContain(`platform=iOS Simulator,id=\${udid}`);
		expect(build).toContain('join(output, "DerivedData")');
		expect(build).toContain("2700");
		const workflow = readFileSync(
			join(root, ".github/workflows/stage-b-draft-proof.yml"),
			"utf8",
		);
		const native = workflow
			.split("\n  native:\n")[1]
			?.split("\n  backup-artifact:")[0];
		expect(native).toContain("timeout-minutes: 120");
	});
	it.each(["expo-loader", "native-esm-control"])(
		"evaluates generated config with the real Expo CLI (%s), preserving dirname and static context",
		(mode) => {
			const fixture = mkdtempSync(
				join(
					process.env.LOCAL_OPERATOR_SCRATCHPAD ?? tmpdir(),
					"stage-b-config-eval-",
				),
			);
			const root = fileURLToPath(new URL("../../", import.meta.url));
			const link = join(fixture, "node_modules");
			symlinkSync(realpathSync(join(root, "node_modules")), link, "dir");
			try {
				writeFileSync(
					join(fixture, "package.json"),
					JSON.stringify({
						name: "config-evaluation-fixture",
						version: "1.0.0",
					}),
				);
				writeFileSync(
					join(fixture, "app.json"),
					JSON.stringify({
						expo: {
							name: "fixture",
							slug: "fixture",
							extra: { staticContext: "preserved" },
						},
					}),
				);
				writeFileSync(join(fixture, "marker.txt"), "relative-original-data");
				writeFileSync(
					join(fixture, "app.stage-b-original.ts"),
					`import { readFileSync } from 'node:fs';\nimport { join } from 'node:path';\nconst marker = readFileSync(join(__dirname, 'marker.txt'), 'utf8');\nexport default ({ config }) => ({ ...config, ios: { infoPlist: { OriginalMarker: marker, NSAppTransportSecurity: { NSAllowsArbitraryLoads: false, NSExceptionDomains: { '10.0.0.0/8': { NSExceptionAllowsInsecureHTTPLoads: true }, '127.0.0.1': { NSIncludesSubdomains: false } } } } } });\n`,
				);
				const source =
					mode === "expo-loader"
						? stageBGeneratedSource(config).config
						: `import base from ${JSON.stringify("./app.stage-b-original.ts")};\nexport default { ...base };\n`;
				writeFileSync(join(fixture, "app.config.ts"), source);
				const evaluate = () =>
					execFileSync(
						join(link, ".bin/expo"),
						["config", "--type", "public", "--json"],
						{
							cwd: fixture,
							encoding: "utf8",
							timeout: 45000,
							stdio: "pipe",
							env: {
								...process.env,
								CI: "1",
								EXPO_OFFLINE: "1",
								EXPO_NO_TELEMETRY: "1",
							},
						},
					);
				if (mode === "native-esm-control")
					expect(evaluate).toThrow(
						"__dirname is not defined in ES module scope",
					);
				else {
					const actual = JSON.parse(evaluate());
					expect(actual.ios.bundleIdentifier).toBe(STAGE_B_BUNDLE);
					expect(actual.ios.infoPlist).toMatchObject({
						OriginalMarker: "relative-original-data",
						StageBProofSourceSha: config.sourceSha,
						StageBProofNonce: config.nonce,
						StageBProofFlavor: config.flavor,
					});
					expect(actual.extra.staticContext).toBe("preserved");
					expect(actual.extra.stageBProof.fixtureOrigin).toBe(
						config.fixtureOrigin,
					);
					expect(actual.ios.infoPlist.NSAppTransportSecurity).toEqual({
						NSAllowsArbitraryLoads: false,
						NSAllowsLocalNetworking: true,
						NSExceptionDomains: {
							"10.0.0.0/8": { NSExceptionAllowsInsecureHTTPLoads: true },
							"127.0.0.1": {
								NSIncludesSubdomains: false,
								NSExceptionAllowsInsecureHTTPLoads: true,
							},
						},
					});
				}
			} finally {
				unlinkSync(link);
				rmSync(fixture, { recursive: true, force: true });
			}
		},
	);
	it("admits independent native and backup proofs only in the approved read-only lane", () => {
		const root = fileURLToPath(new URL("../../", import.meta.url));
		const workflow = readFileSync(
			join(root, ".github/workflows/stage-b-draft-proof.yml"),
			"utf8",
		);
		expect(workflow).toContain(
			"permissions:\n  contents: read\n  actions: read",
		);
		const native = workflow
			.split("\n  native:\n")[1]
			?.split("\n  backup-artifact:")[0];
		expect(native).toContain("needs: preflight");
		expect(native).not.toContain("needs: [preflight, backup-artifact]");
		expect(workflow).toContain("stage-b-backup/*.txt");
		expect(workflow).toContain("stage-b-backup/xml-index.json");
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
	it("installs transport before registering a gated real Expo router root", () => {
		const source = stageBGeneratedSource(config);
		expect(source.entry).toContain(".installStageBDraftProof(");
		expect(source.entry).toContain("renderRootComponent(StageBProofRoot)");
		expect(source.entry).toContain("expo-router/build/qualified-entry");
		expect(source.entry).not.toContain(
			".then(() => require('expo-router/entry'))",
		);
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
