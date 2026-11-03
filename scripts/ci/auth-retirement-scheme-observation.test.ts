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
import { ProofCommandTimeout } from "./auth-retirement-launch.ts";
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
// Grounded keys/types ONLY: macOS27.2 `log show --last20s --style ndjson`,
// captured by parent 2026-11-03. All values below are synthetic placeholders.
// Simulator log versions can differ, so unrelated extra keys must be tolerated.
const eventRecord = (process: string) => ({
	activityIdentifier: 1,
	backtrace: { frames: [] },
	bootUUID: "00000000-0000-0000-0000-000000000001",
	category: "synthetic",
	eventMessage: `loretirementproof ${sentinel}`,
	eventType: "logEvent",
	formatString: "synthetic",
	launchPersonaID: 0,
	launchPersonaName: "synthetic",
	launchPersonaType: 0,
	machTimestamp: 1,
	messageType: "Default",
	parentActivityIdentifier: 0,
	personaID: 0,
	personaName: "synthetic",
	personaType: 0,
	processID: 123,
	processImagePath: process,
	processImageUUID: "00000000-0000-0000-0000-000000000002",
	senderImagePath: "/synthetic/lib",
	senderImageUUID: "00000000-0000-0000-0000-000000000003",
	senderProgramCounter: 1,
	source: null,
	subsystem: "synthetic",
	threadID: 1,
	timestamp: "2026-11-03T00:00:00Z",
	timezoneName: "UTC",
	traceID: 1,
	userID: 0,
});
const event = (process: string) => JSON.stringify(eventRecord(process));
const ndjson = (events: string) =>
	`${events}${events ? "\n" : ""}${JSON.stringify({ count: events.split("\n").filter(Boolean).length, finished: 1 })}`;

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
		["log", false, false, []],
		["launchservicesd", true, false, ["launchservicesd"]],
		["SpringBoard", true, false, ["SpringBoard"]],
		["CoreSimulatorBridge", true, false, ["CoreSimulatorBridge"]],
		["UNSAFE_PROCESS_NAME", true, false, ["other"]],
		[executable, false, true, []],
		["catalog", true, false, ["other"]],
	] as const)(
		"round13 exact basename %s yields only closed system classes",
		(name, system, app, classes) => {
			expect(
				parseSchemeLogs(ndjson(event(`/synthetic/${name}`)), executable),
			).toEqual({
				schemeOpenSeenBySystem: system,
				schemeOpenSeenByApp: app,
				schemeOpenSystemProcessClass: classes,
				schemeLogObservation: "observed",
				nativeIngressSeen: false,
				nativeLogReadySeen: false,
				jsCallbackEntrySeen: false,
				jsLogReadySeen: false,
			});
		},
	);
	it("round13 process classes are a deterministic set and self-trace cannot add other", () => {
		const records = [
			"log",
			"SpringBoard",
			"launchservicesd",
			"SpringBoard",
			"CoreSimulatorBridge",
			"UNSAFE_PROCESS_NAME",
			executable,
		]
			.map((name) => event(`/synthetic/${name}`))
			.join("\n");
		expect(parseSchemeLogs(ndjson(records), executable)).toMatchObject({
			schemeOpenSeenBySystem: true,
			schemeOpenSeenByApp: true,
			schemeOpenSystemProcessClass: [
				"launchservicesd",
				"SpringBoard",
				"CoreSimulatorBridge",
				"other",
			],
		});
	});
	it.each([
		[executable, "loretirementproof-native-ingress", true, false],
		[executable, "loretirementproof-native-log-ready", false, true],
		[executable, "arbitrary loretirementproof mention", false, false],
		[executable, "prefix loretirementproof-native-ingress", false, false],
		["log", "loretirementproof-native-ingress", false, false],
		["log", "loretirementproof-native-log-ready", false, false],
		["DifferentApp", "loretirementproof-native-ingress", false, false],
		["DifferentApp", "loretirementproof-native-log-ready", false, false],
	] as const)(
		"native marker exactness %s/%s",
		(process, message, ingress, ready) => {
			const output = ndjson(
				JSON.stringify({
					...eventRecord(`/synthetic/${process}`),
					eventMessage: message,
				}),
			);
			expect(parseSchemeLogs(output, executable)).toMatchObject({
				nativeIngressSeen: ingress,
				nativeLogReadySeen: ready,
				schemeLogObservation: "observed",
			});
		},
	);
	it("native calibration and ingress are independent observations and malformed output discards partial certainty", () => {
		const marker = (message: string) =>
			JSON.stringify({
				...eventRecord(`/synthetic/${executable}`),
				eventMessage: message,
			});
		const both =
			marker("loretirementproof-native-ingress") +
			"\n" +
			marker("loretirementproof-native-log-ready");
		expect(parseSchemeLogs(ndjson(both), executable)).toMatchObject({
			nativeIngressSeen: true,
			nativeLogReadySeen: true,
		});
		expect(
			parseSchemeLogs(ndjson(both + "\nnot-json"), executable),
		).toMatchObject({
			nativeIngressSeen: "UNOBSERVED",
			nativeLogReadySeen: "UNOBSERVED",
			jsCallbackEntrySeen: "UNOBSERVED",
			jsLogReadySeen: "UNOBSERVED",
		});
		// False/false without calibration is NOT proof of absent native ingress.
		expect(parseSchemeLogs(ndjson(""), executable)).toMatchObject({
			nativeIngressSeen: false,
			nativeLogReadySeen: false,
			jsCallbackEntrySeen: false,
			jsLogReadySeen: false,
		});
		const root = fresh(),
			diag = new ProofDiagnostics(root);
		diag.checkpoint("phase", "seed");
		diag.observePhaseFailure({
			phase: "seed",
			cause: "receipt-timeout",
			...parseSchemeLogs(ndjson(both), executable),
		});
		diag.fail();
		const text = readFileSync(join(root, "failure.json"), "utf8");
		expect(text).not.toContain("loretirementproof-native");
		expect(text).not.toContain(executable);
		expect(JSON.parse(text).phaseFailure).toMatchObject({
			nativeIngressSeen: true,
			nativeLogReadySeen: true,
		});
	});
	it.each([
		[executable, "loretirementproof-js-callback-entry", true, false],
		[executable, "loretirementproof-js-log-ready", false, true],
		[executable, "loretirementproof-native-ingress", false, false],
		[executable, "arbitrary loretirementproof mention", false, false],
		[executable, "prefix loretirementproof-js-callback-entry", false, false],
		["log", "loretirementproof-js-callback-entry", false, false],
		["log", "loretirementproof-js-log-ready", false, false],
		["DifferentApp", "loretirementproof-js-callback-entry", false, false],
	] as const)("JS marker exactness %s/%s", (process, message, entry, ready) => {
		const output = ndjson(
			JSON.stringify({
				...eventRecord(`/synthetic/${process}`),
				eventMessage: message,
			}),
		);
		expect(parseSchemeLogs(output, executable)).toMatchObject({
			jsCallbackEntrySeen: entry,
			jsLogReadySeen: ready,
			schemeLogObservation: "observed",
		});
	});
	it("JS startup calibration does not establish entry and malformed logs discard partial JS observations", () => {
		const marker = (message: string) =>
			JSON.stringify({
				...eventRecord(`/synthetic/${executable}`),
				eventMessage: message,
			});
		const both =
			marker("loretirementproof-js-callback-entry") +
			"\n" +
			marker("loretirementproof-js-log-ready");
		expect(parseSchemeLogs(ndjson(both), executable)).toMatchObject({
			jsCallbackEntrySeen: true,
			jsLogReadySeen: true,
			nativeIngressSeen: false,
		});
		expect(
			parseSchemeLogs(ndjson(both + "\nnot-json"), executable),
		).toMatchObject({
			jsCallbackEntrySeen: "UNOBSERVED",
			jsLogReadySeen: "UNOBSERVED",
		});
		// No JS calibration means missing console output is not missing callback.
		expect(parseSchemeLogs(ndjson(""), executable)).toMatchObject({
			jsCallbackEntrySeen: false,
			jsLogReadySeen: false,
		});
		const root = fresh(),
			diag = new ProofDiagnostics(root);
		diag.checkpoint("phase", "seed");
		diag.observePhaseFailure({
			phase: "seed",
			cause: "receipt-timeout",
			...parseSchemeLogs(ndjson(both), executable),
		});
		diag.fail();
		const text = readFileSync(join(root, "failure.json"), "utf8");
		expect(text).not.toContain("loretirementproof-js");
		expect(text).not.toContain(executable);
		expect(JSON.parse(text).phaseFailure).toMatchObject({
			jsCallbackEntrySeen: true,
			jsLogReadySeen: true,
		});
	});
	it("round13 self-trace log alone is not system ingress", () => {
		expect(
			parseSchemeLogs(ndjson(event("/synthetic/bin/log")), executable)
				.schemeOpenSeenBySystem,
		).toBe(false);
	});
	it.each([
		["system-only", event("/system/SpringBoard"), true, false],
		["app-only", event(`/apps/${executable}`), false, true],
		["both", event("SpringBoard") + "\n" + event(executable), true, true],
		["trailer-only", "", false, false],
		[
			"irrelevant",
			JSON.stringify({
				...eventRecord("/synthetic/system"),
				eventMessage: "unrelated",
			}),
			false,
			false,
		],
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
			expect(parseSchemeLogs(ndjson(text), executable)).toEqual({
				schemeOpenSeenBySystem: system,
				schemeOpenSeenByApp: app,
				schemeOpenSystemProcessClass: system === true ? ["SpringBoard"] : [],
				schemeLogObservation:
					system === "UNOBSERVED" ? "malformed" : "observed",
				nativeIngressSeen: system === "UNOBSERVED" ? "UNOBSERVED" : false,
				nativeLogReadySeen: system === "UNOBSERVED" ? "UNOBSERVED" : false,
				jsCallbackEntrySeen: system === "UNOBSERVED" ? "UNOBSERVED" : false,
				jsLogReadySeen: system === "UNOBSERVED" ? "UNOBSERVED" : false,
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
				return ndjson("");
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
					"--info",
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
			schemeOpenSystemProcessClass: [],
			schemeLogObservation: "error",
			nativeIngressSeen: "UNOBSERVED",
			nativeLogReadySeen: "UNOBSERVED",
			jsCallbackEntrySeen: "UNOBSERVED",
			jsLogReadySeen: "UNOBSERVED",
		});
	});
	it("typed probe timeout is distinct from malformed output and command error", async () => {
		expect(
			await observeSchemeAfterTimeout(
				"receipt-timeout",
				"none",
				"owned-udid",
				executable,
				async () => {
					throw new ProofCommandTimeout();
				},
			),
		).toEqual({
			schemeOpenSeenBySystem: "UNOBSERVED",
			schemeOpenSeenByApp: "UNOBSERVED",
			schemeOpenSystemProcessClass: [],
			schemeLogObservation: "timeout",
			nativeIngressSeen: "UNOBSERVED",
			nativeLogReadySeen: "UNOBSERVED",
			jsCallbackEntrySeen: "UNOBSERVED",
			jsLogReadySeen: "UNOBSERVED",
		});
		expect(
			await observeSchemeAfterTimeout(
				"receipt-timeout",
				"none",
				"owned-udid",
				executable,
				async () => ndjson("garbage"),
			),
		).toEqual({
			schemeOpenSeenBySystem: "UNOBSERVED",
			schemeOpenSeenByApp: "UNOBSERVED",
			schemeOpenSystemProcessClass: [],
			schemeLogObservation: "malformed",
			nativeIngressSeen: "UNOBSERVED",
			nativeLogReadySeen: "UNOBSERVED",
			jsCallbackEntrySeen: "UNOBSERVED",
			jsLogReadySeen: "UNOBSERVED",
		});
	});
	it("tolerates future simulator keys while skipping the real-shaped trailer", () => {
		const record = {
			...eventRecord(`/synthetic/${executable}`),
			futureSimulatorField: "ignored",
		};
		expect(parseSchemeLogs(ndjson(JSON.stringify(record)), executable)).toEqual(
			{
				schemeOpenSeenBySystem: false,
				schemeOpenSeenByApp: true,
				schemeOpenSystemProcessClass: [],
				schemeLogObservation: "observed",
				nativeIngressSeen: false,
				nativeLogReadySeen: false,
				jsCallbackEntrySeen: false,
				jsLogReadySeen: false,
			},
		);
	});
	it("the grounded event fixture has exactly the captured keys/types and a two-key trailer", () => {
		const record = eventRecord(`/synthetic/${executable}`);
		expect(Object.keys(record).sort()).toEqual(
			"activityIdentifier backtrace bootUUID category eventMessage eventType formatString launchPersonaID launchPersonaName launchPersonaType machTimestamp messageType parentActivityIdentifier personaID personaName personaType processID processImagePath processImageUUID senderImagePath senderImageUUID senderProgramCounter source subsystem threadID timestamp timezoneName traceID userID"
				.split(" ")
				.sort(),
		);
		for (const key of [
			"activityIdentifier",
			"launchPersonaID",
			"launchPersonaType",
			"machTimestamp",
			"parentActivityIdentifier",
			"personaID",
			"personaType",
			"processID",
			"senderProgramCounter",
			"threadID",
			"traceID",
			"userID",
		] as const)
			expect(Number.isInteger(record[key])).toBe(true);
		expect(record.source).toBeNull();
		expect(typeof record.backtrace).toBe("object");
		expect(JSON.parse(ndjson("")).count).toBe(0);
		expect(Object.keys(JSON.parse(ndjson(""))).sort()).toEqual([
			"count",
			"finished",
		]);
	});
	it("persists exactly boolean observations without native log text", () => {
		const root = fresh(),
			diag = new ProofDiagnostics(root);
		diag.checkpoint("phase", "seed");
		diag.observePhaseFailure({
			phase: "seed",
			cause: "receipt-timeout",
			...parseSchemeLogs(
				ndjson(event(`/synthetic/apps/${executable}`)),
				executable,
			),
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
			schemeOpenSystemProcessClass: [],
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
		expect(production.plugins).not.toContain(
			"./scripts/ci/auth-retirement-native-markers.cjs",
		);
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
		expect(prepared.plugins).toContain(
			"./scripts/ci/auth-retirement-native-markers.cjs",
		);
	});
});
