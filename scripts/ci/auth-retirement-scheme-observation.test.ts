import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createRequire, stripTypeScriptTypes } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProofDiagnostics } from "./auth-retirement-diagnostics.ts";
import {
	freezeArtifact,
	prepareProofBuild,
} from "./auth-retirement-ios-proof.ts";
import {
	observeSchemeAfterTimeout,
	parseSchemeLogs,
	schemeRegistered,
} from "./auth-retirement-scheme-observation.ts";

const roots: string[] = [];
const fresh = () => {
	const root = mkdtempSync(
		join(
			process.env.LOCAL_OPERATOR_SCRATCHPAD ??
				process.env.RUNNER_TEMP ??
				tmpdir(),
			"scheme-observation-",
		),
	);
	roots.push(root);
	return root;
};
afterEach(() => {
	vi.unstubAllEnvs();
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});
const executable = "SyntheticProof";
const sentinel = "UNSAFE_LOG_SENTINEL";
const event = (process: string) =>
	JSON.stringify({
		processImagePath: process,
		eventMessage: `loretirementproof ${sentinel}`,
	});

describe("built scheme and timeout log observations, no SDK", () => {
	it.each([true, false])(
		"reads only scheme registration boolean %s",
		(registered) => {
			expect(
				schemeRegistered({
					CFBundleURLTypes: [
						{
							CFBundleURLSchemes: [
								registered ? "loretirementproof" : "ordinary",
							],
						},
					],
				}),
			).toBe(registered);
		},
	);
	it.each([true, false])(
		"freezes registered=%s or classifies scheme-unregistered before install",
		async (registered) => {
			const root = fresh(),
				app = join(root, "candidate.app");
			mkdirSync(app);
			writeFileSync(join(app, "Info.plist"), "synthetic");
			const identity = {
				flavor: "auth-retirement-proof",
				bundleId: "com.localoperator.mobile.retirementproof",
				sourceSha: "a".repeat(40),
				nonce: "b".repeat(32),
				receiverPort: 23456,
			};
			writeFileSync(
				join(root, "build-identity.json"),
				JSON.stringify(identity),
			);
			vi.stubEnv("GITHUB_ACTIONS", "true");
			vi.stubEnv("GITHUB_EVENT_NAME", "workflow_dispatch");
			vi.stubEnv("GITHUB_RUN_ID", "123");
			vi.stubEnv("RETIREMENT_PROOF", "true");
			const calls: string[][] = [];
			const run = async (_exe: string, args: string[]) => {
				calls.push(args);
				return JSON.stringify({
					LORetirementProofFlavor: identity.flavor,
					CFBundleIdentifier: identity.bundleId,
					LORetirementProofNonce: identity.nonce,
					LORetirementProofSource: identity.sourceSha,
					LORetirementProofReceiverPort: 23456,
					CFBundleExecutable: executable,
					CFBundleURLTypes: [
						{
							CFBundleURLSchemes: [
								registered ? "loretirementproof" : "ordinary",
							],
						},
					],
					unused: sentinel,
				});
			};
			if (registered) {
				await freezeArtifact(app, root, run);
				const receipt = JSON.parse(
					readFileSync(join(root, "frozen-artifact.json"), "utf8"),
				);
				expect(receipt.schemeRegistered).toBe(true);
				expect(receipt).not.toHaveProperty("executable");
				expect(JSON.stringify(receipt)).not.toContain(sentinel);
			} else {
				await expect(freezeArtifact(app, root, run)).rejects.toThrow(
					"Proof scheme is not registered",
				);
				const text = readFileSync(join(root, "failure.json"), "utf8");
				expect(JSON.parse(text)).toMatchObject({
					classification: "BLOCKED",
					checkpoint: "scheme-unregistered",
					phaseFailure: {
						cause: "scheme-unregistered",
						schemeRegistered: false,
					},
				});
				expect(text).not.toContain(sentinel);
				expect(existsSync(join(root, "frozen-artifact.json"))).toBe(false);
			}
			const freeze = JSON.parse(
				readFileSync(join(root, "freeze.json"), "utf8"),
			);
			expect(freeze).toEqual({ schemeRegistered: registered });
			expect(Object.keys(freeze)).toEqual(["schemeRegistered"]);
			expect(calls).toHaveLength(1);
			expect(calls[0]?.[0]).toBe("-convert");
			expect(calls.flat()).not.toContain("install");
		},
	);
	it.each([
		["system-only", event("/system/SpringBoard"), true, false],
		["app-only", event(`/apps/${executable}`), false, true],
		["both", event("SpringBoard") + "\n" + event(executable), true, true],
		["none", "", false, false],
		["irrelevant", JSON.stringify({ eventMessage: "unrelated" }), false, false],
		["malformed", "not-json", "UNOBSERVED", "UNOBSERVED"],
		[
			"missing-process",
			JSON.stringify({ eventMessage: "loretirementproof" }),
			"UNOBSERVED",
			"UNOBSERVED",
		],
	] as const)(
		"parses %s without retaining records",
		(_name, text, system, app) => {
			expect(parseSchemeLogs(text, executable)).toEqual({
				schemeOpenSeenBySystem: system,
				schemeOpenSeenByApp: app,
			});
		},
	);
	it.each([
		["receipt-timeout", "none", 1],
		["receipt-timeout", "admitted", 0],
		["receipt-timeout", "refused:nonce", 0],
		["ready-timeout", "none", 0],
		["other", "none", 0],
	] as const)("probe gating %s/%s", async (cause, progress, count) => {
		const calls: unknown[][] = [];
		await observeSchemeAfterTimeout(
			cause,
			progress,
			"owned-udid",
			executable,
			async (...args) => {
				calls.push(args);
				return "";
			},
		);
		expect(calls).toHaveLength(count);
		if (count)
			expect(calls[0]).toEqual([
				"xcrun",
				[
					"simctl",
					"spawn",
					"owned-udid",
					"log",
					"show",
					"--last",
					"3m",
					"--style",
					"ndjson",
					"--predicate",
					'eventMessage CONTAINS "loretirementproof"',
				],
			]);
	});
	it("command failure is UNOBSERVED, never absence", async () => {
		expect(
			await observeSchemeAfterTimeout(
				"receipt-timeout",
				"none",
				"owned-udid",
				executable,
				async () => {
					throw new Error(sentinel);
				},
			),
		).toEqual({
			schemeOpenSeenBySystem: "UNOBSERVED",
			schemeOpenSeenByApp: "UNOBSERVED",
		});
	});
	it("persists exactly boolean observations without native log text", () => {
		const root = fresh(),
			diag = new ProofDiagnostics(root);
		diag.checkpoint("phase", "seed");
		diag.observePhaseFailure({
			phase: "seed",
			cause: "receipt-timeout",
			...parseSchemeLogs(event(`/apps/${executable}`), executable),
			log: sentinel,
			url: `loretirementproof://${sentinel}`,
		});
		diag.fail();
		const text = readFileSync(join(root, "failure.json"), "utf8");
		expect(text).not.toContain(sentinel);
		expect(text).not.toContain("loretirementproof:");
		expect(text).not.toContain(executable);
		expect(JSON.parse(text).phaseFailure).toMatchObject({
			schemeOpenSeenBySystem: false,
			schemeOpenSeenByApp: true,
		});
	});
	it("read-only current prepare already supplies the proof scheme through installed Expo setScheme", async () => {
		const root = fresh();
		const source = readFileSync(
			new URL("../../app.config.ts", import.meta.url),
			"utf8",
		);
		writeFileSync(join(root, "app.config.ts"), source);
		writeFileSync(join(root, "package.json"), "{}");
		mkdirSync(join(root, "design/tokens"), { recursive: true });
		writeFileSync(
			join(root, "design/tokens/tokens.json"),
			readFileSync(new URL("../../design/tokens/tokens.json", import.meta.url)),
		);
		const require = createRequire(import.meta.url);
		const expoRequire = createRequire(require.resolve("expo/package.json"));
		const { setScheme } = expoRequire(
			"@expo/config-plugins/build/ios/Scheme.js",
		) as {
			setScheme: (
				config: Record<string, unknown>,
				plist: Record<string, unknown>,
			) => Record<string, unknown>;
		};
		const evaluate = async (text: string, name: string) => {
			const file = join(root, name + ".mjs");
			writeFileSync(
				file,
				`const __dirname=${JSON.stringify(root)};\n` +
					stripTypeScriptTypes(text),
			);
			return (await import(/* @vite-ignore */ pathToFileURL(file).href))
				.default as Record<string, unknown>;
		};
		const production = await evaluate(source, "production");
		expect(schemeRegistered(setScheme(production, {}))).toBe(false);
		vi.stubEnv("GITHUB_EVENT_NAME", "workflow_dispatch");
		vi.stubEnv("RETIREMENT_PROOF", "true");
		vi.stubEnv("GITHUB_ENV", join(root, "github-env"));
		const cwd = process.cwd();
		try {
			process.chdir(root);
			await prepareProofBuild(join(root, "identity"), async (_exe, args) =>
				args[0] === "status" ? "" : "a".repeat(40),
			);
		} finally {
			process.chdir(cwd);
		}
		const prepared = await evaluate(
			readFileSync(join(root, "app.config.ts"), "utf8"),
			"prepared",
		);
		expect(schemeRegistered(setScheme(prepared, {}))).toBe(true);
	});
});
