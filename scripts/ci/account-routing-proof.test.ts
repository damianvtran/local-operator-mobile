import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { policyIdentity } from "../../tools/mock-relay/account-routing-identity.ts";
import baseline from "./account-routing-e2e-baseline.json";
import { NativeProof } from "./account-routing-ios-proof.ts";
import {
	assertArchiveDigest,
	assertArtifactMetadata,
	assertBundleFacts,
	assertLoopbackAnswers,
	assertMaestroHelp,
	assertNativeOrigin,
	assertProofCI,
	type BoundedOperation,
	COLD_OPERATIONS,
	capDerivation,
	capFor,
	deriveCapSeconds,
	mdnsCommand,
	OPERATION_OBSERVATIONS,
	observedMaxSeconds,
	PINS,
	PROOF_MODE,
	runProof,
	STAGE_SECONDS,
	safeArchiveName,
	selectProof,
} from "./account-routing-proof-contract.ts";
import * as flow from "./account-routing-proof-flows.ts";
import {
	ProofHost,
	timedOutMessage,
	tolerableTeardown,
} from "./account-routing-proof-host.ts";

const MANUAL = "workflow_" + "dispatch";
const NONCE = "0123456789abcdef0123456789abcdef";
const DEADLINE_KILL = /deadline exceeded \(slow-child, \d+ms, cap=\d+s\)/;
const RC_128 = /rc=128/;
const RC_3 = /exit-3 failed rc=3/;
const hosted: NodeJS.ProcessEnv = {
	NODE_ENV: "test",
	GITHUB_ACTIONS: "true",
	RUNNER_ENVIRONMENT: "github-hosted",
	RUNNER_OS: "macOS",
	LOH12_NATIVE_PROOF_ADMITTED: "1",
	GITHUB_REPOSITORY: "damianvtran/local-operator-mobile",
	GITHUB_EVENT_NAME: "workflow_" + "dispatch",
	GITHUB_SHA: "0".repeat(40),
	PROOF_MODE: "account-routing-ios-proof",
};
const root = new URL("../../", import.meta.url);
const source = (path: string) => readFileSync(new URL(path, root), "utf8");
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

function jobs(text: string) {
	const section = text.split("\njobs:\n")[1];
	if (!section) throw new Error("missing jobs");
	const markers = [...section.matchAll(/^ {2}([A-Za-z0-9_-]+):\s*$/gm)];
	return Object.fromEntries(
		markers.map((entry, index) => {
			const id = entry[1];
			if (!id || entry.index === undefined) throw new Error("bad job");
			const body = section.slice(
				entry.index + entry[0].length,
				markers[index + 1]?.index ?? section.length,
			);
			const condition =
				body
					.split("\n")
					.find((line) => line.startsWith("    if: "))
					?.trim()
					.slice(4) ?? "";
			return [id, { body, condition }];
		}),
	);
}
/** Tiny GH boolean grammar, not eval/new Function or a second workflow engine.
 * Only the existing event/mode truth-table operands are accepted. */
function evaluate(expression: string, event: string, mode: string): boolean {
	if (!expression) return true;
	const tokens =
		expression.match(
			/'[^']*'|github\.event_name|inputs\.proof_mode|==|!=|&&|\|\||[()]/g,
		) ?? [];
	if (tokens.join("") !== expression.replaceAll(/\s/g, ""))
		throw new Error("unknown workflow predicate token");
	let index = 0;
	const atom = (): string | boolean => {
		const token = tokens[index++];
		if (token === "(") {
			const value = or();
			if (tokens[index++] !== ")") throw new Error("unclosed predicate");
			return value;
		}
		if (token === "github.event_name") return event;
		if (token === "inputs.proof_mode") return mode;
		if (token?.startsWith("'")) return token.slice(1, -1);
		throw new Error("missing predicate operand");
	};
	const equals = (): string | boolean => {
		let value = atom();
		if (tokens[index] === "==" || tokens[index] === "!=") {
			const op = tokens[index++];
			const right = atom();
			value = op === "==" ? value === right : value !== right;
		}
		return value;
	};
	const and = (): string | boolean => {
		let value = equals();
		while (tokens[index] === "&&") {
			index++;
			const right = equals();
			value = Boolean(value) && Boolean(right);
		}
		return value;
	};
	const or = (): string | boolean => {
		let value = and();
		while (tokens[index] === "||") {
			index++;
			const right = and();
			value = value || right;
		}
		return value;
	};
	const result = or();
	if (index !== tokens.length) throw new Error("unconsumed predicate");
	return Boolean(result);
}

describe("staged proof source contract — mocks only, no mDNS/native/CI execution", () => {
	it("retains the actual BASE/c67 public route validator bytes", () => {
		expect(sha(source("src/connection/profile.ts"))).toBe(
			"283961844829832e854ac98c72bf3f9405f0fc5212ab356a6393559ac8f25993",
		);
	});
	it("rejects unknown modes/stages and targeted non-manual events", () => {
		for (const mode of ["unknown", PROOF_MODE])
			for (const event of ["pull_request", "push", "schedule"])
				expect(() => selectProof(event, mode, "full")).toThrow();
		for (const stage of ["", "nightly", "setup; sdk"])
			expect(() => selectProof(MANUAL, PROOF_MODE, stage)).toThrow();
		for (const stage of ["preflight", "setup", "full"] as const)
			expect(selectProof(MANUAL, PROOF_MODE, stage)).toBe(stage);
		expect(() => selectProof(MANUAL, "full", "setup")).toThrow();
		expect(() => selectProof("schedule", "s15-proof", "full")).toThrow();
	});
	it("the actual workflow preserves every normal full/S15 job membership and body", () => {
		const current = jobs(source(".github/workflows/e2e.yml"));
		expect(Object.keys(current).sort()).toEqual(
			[...Object.keys(baseline.jobs), PROOF_MODE].sort(),
		);
		for (const [name, old] of Object.entries(baseline.jobs)) {
			const job = current[name];
			expect(job).toBeDefined();
			if (!job) throw new Error("missing old job");
			if (name !== "harness")
				expect(
					sha(
						job.body
							.split("\n")
							.filter((line) => !line.startsWith("    if: "))
							.join("\n")
							.trim(),
					),
				).toBe(old.bodyWithoutConditionSha256);
			for (const event of ["pull_request", "push", "schedule", MANUAL])
				for (const mode of ["", "full", "s15-proof"])
					expect(evaluate(job.condition, event, mode)).toBe(
						evaluate(old.condition, event, mode),
					);
			for (const event of ["pull_request", "push", "schedule", MANUAL])
				if (name !== "harness")
					expect(evaluate(job.condition, event, PROOF_MODE)).toBe(false);
		}
		const targeted = current[PROOF_MODE];
		if (!targeted) throw new Error("missing targeted job");
		for (const event of ["pull_request", "push", "schedule", MANUAL])
			for (const mode of ["", "full", "s15-proof", PROOF_MODE])
				expect(evaluate(targeted.condition, event, mode)).toBe(
					event === MANUAL && mode === PROOF_MODE,
				);
	});
	it("the truth table catches the old !=s15 accidental fanout", () => {
		expect(
			evaluate("inputs.proof_mode != 's15-proof'", MANUAL, PROOF_MODE),
		).toBe(true);
		expect(
			evaluate("(inputs.proof_mode || 'full') == 'full'", MANUAL, PROOF_MODE),
		).toBe(false);
	});
	it("uses package entrypoints and narrow read-only targeted artifact permissions", () => {
		const text = source(".github/workflows/e2e.yml");
		const targeted = jobs(text)[PROOF_MODE];
		if (!targeted) throw new Error("missing target");
		expect(targeted.body).toContain("pnpm e2e:account-routing-proof --stage");
		expect(targeted.body).toContain("actions: read");
		expect(targeted.body).not.toContain("secrets.");
		expect(targeted.body).not.toContain("contents: write");
		expect(targeted.body).not.toContain("signing");
		const pkg = JSON.parse(source("package.json"));
		expect(pkg.scripts["e2e:account-routing-proof"]).toBe(
			"node scripts/ci/account-routing-ios-proof.ts",
		);
		expect(pkg.scripts["e2e:account-routing-artifact-tests"]).toBe(
			"python3 scripts/ci/account-routing-artifact-test.py",
		);
		expect(targeted.body).not.toContain(
			"path: " +
				"$" +
				"{{ runner.temp }}/account-routing-proof-" +
				"$" +
				"{{ github.run_id }}\n",
		);
	});
	it("names a deadline kill instead of fabricating rc=128, flushing partial output", async () => {
		// CI 38842647133: killing a cold child closed it, `code ?? 128` won the
		// race, and a 60s deadline read as a tool failure with an empty log.
		const root = mkdtempSync(join(tmpdir(), "loh12-host-"));
		try {
			const host = new ProofHost(root, process.cwd(), 600, ["owned-secret"], {
				...hosted,
			});
			const failed = await host
				.run(
					"slow-child",
					process.execPath,
					[
						"-e",
						// `\\n` is a real newline for the CHILD's stdout, not an escape in
						// this TS string: a bare `\n` here becomes a literal newline inside the
						// child's single-quoted literal, which is a syntax error the child
						// exits 1 on — a passing-looking test that proved nothing.
						"process.stdout.write('partial-owned-output\\n');setTimeout(()=>process.exit(0),30000)",
					],
					1,
				)
				.catch((error: unknown) => error);
			expect(failed).toBeInstanceOf(Error);
			expect(String(failed)).toMatch(DEADLINE_KILL);
			expect(String(failed)).not.toMatch(RC_128);
			expect(host.records.at(-1)).toMatchObject({
				name: "slow-child",
				rc: null,
				deadlineExceeded: true,
			});
			expect(
				readFileSync(join(root, "commands", "1-slow-child.log"), "utf8"),
			).toContain("partial-owned-output");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
	it("still reports a real non-zero exit as rc, and returns real zero-exit output", async () => {
		const root = mkdtempSync(join(tmpdir(), "loh12-host-"));
		try {
			const host = new ProofHost(root, process.cwd(), 600, [], { ...hosted });
			const exitThree = await host
				.run("exit-3", process.execPath, ["-e", "process.exit(3)"], 20)
				.catch((error: unknown) => error);
			expect(String(exitThree)).toMatch(RC_3);
			expect(host.records.at(-1)).toMatchObject({ name: "exit-3", rc: 3 });
			expect(host.records.at(-1)?.deadlineExceeded).toBeUndefined();
			const output = await host.run(
				"writes-then-zero",
				process.execPath,
				["-e", "process.stdout.write('owned-result')"],
				20,
			);
			expect(output).toBe("owned-result");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
	it("redacts owned credential values from a killed child's flushed output", async () => {
		const root = mkdtempSync(join(tmpdir(), "loh12-host-"));
		try {
			// A secret split across two writes can straddle pipe chunks; the flush
			// must redact the accumulated stream, not each chunk.
			const host = new ProofHost(root, process.cwd(), 600, ["owned-secret"], {
				...hosted,
			});
			await host
				.run(
					"splits-secret",
					process.execPath,
					[
						"-e",
						"process.stdout.write('owned-');setTimeout(()=>{process.stdout.write('secret')},50);setTimeout(()=>process.exit(0),30000)",
					],
					1,
				)
				.catch(() => undefined);
			const log = readFileSync(
				join(root, "commands", "1-splits-secret.log"),
				"utf8",
			);
			expect(log).not.toContain("owned-secret");
			expect(log).toContain("<owned-fixture-value-redacted>");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
	it("warms the iOS driver before the first evidence flow, under the derived cold cap", () => {
		// The repository's Android playbook already launches the installed app once
		// "so the first flow does not carry the cold start"; the missing iOS
		// equivalent let the driver bring-up blow the steady budget
		// (CI 38844597781: 123170ms, empty log).
		const setup = NativeProof.prototype as unknown as {
			warmDriver: () => Promise<void>;
		};
		expect(typeof setup.warmDriver).toBe("function");
		const cold = capFor("maestroCold");
		const steady = capFor("maestroSteady");
		// Cold is derived above its own 123.17s observation AND above the steady
		// contract, so a cold cost cannot hide behind the warm budget.
		expect(cold).toBeGreaterThan(observedMaxSeconds("maestroCold"));
		expect(cold).toBeGreaterThan(steady);
		expect(steady).toBeGreaterThanOrEqual(120);
		expect(cold).toBeLessThan(STAGE_SECONDS.setup - 120);
	});
	it("orders the warm-up before the first evidence flow in the source", () => {
		const source = readFileSync(
			new URL("./account-routing-ios-proof.ts", import.meta.url),
			"utf8",
		);
		const warm = source.indexOf("await this.warmDriver()");
		const firstFlow = source.indexOf('"base-real-form"');
		expect(warm).toBeGreaterThan(-1);
		expect(firstFlow).toBeGreaterThan(-1);
		expect(warm).toBeLessThan(firstFlow);
	});
	it("derives every cap ABOVE its largest observation, or above 1.5x for cold ops", () => {
		// F5 shipped a cap sized just above the SMALLEST observation: the selector
		// measured 6107/7267ms, got 15s, then measured 15021ms and was killed
		// (CI 38847064654). A single sample is not the distribution, so the floor
		// here is the MAX observation, and cold ops need 1.5x on top of it.
		for (const operation of Object.keys(
			OPERATION_OBSERVATIONS,
		) as BoundedOperation[]) {
			const cap = capFor(operation);
			const max = observedMaxSeconds(operation);
			expect(cap).toBeGreaterThan(max);
			if (COLD_OPERATIONS[operation] !== undefined)
				expect(cap).toBeGreaterThanOrEqual(Math.ceil(max * 1.5));
		}
		// The exact regression, with its real numbers.
		expect(capFor("selector")).toBeGreaterThan(15.021);
		expect(capFor("bootReady")).toBeGreaterThan(92.562);
		expect(capFor("shutdown")).toBeGreaterThan(23.349);
		expect(capFor("delete")).toBeGreaterThan(22.002);
	});
	it("rises when a LARGER observation is injected, i.e. the cap is data-driven", () => {
		// Not a readback of a constant: the derivation must react to the samples.
		// The injection must clear the op's floor, or the floor masks it: at 40s
		// (1.5x = 60s) the selector cap sits exactly ON its 60s cold floor and
		// does not move, which would look like a constant. 90s exercises the
		// derivation itself.
		const before = deriveCapSeconds("selector");
		const injected = [
			...OPERATION_OBSERVATIONS.selector,
			{ run: 99999999999, ms: 90000 },
		];
		const after = deriveCapSeconds("selector", 1.5, injected);
		expect(after).toBeGreaterThan(before);
		expect(after).toBeGreaterThanOrEqual(90);
		// The same proof against the RECORDED table, not a loose array: a bigger
		// sample for a real operation must raise that operation's cap.
		const bigger = deriveCapSeconds("install", 1.5, [
			...OPERATION_OBSERVATIONS.install,
			{ run: 1, ms: 90000 },
		]);
		expect(bigger).toBeGreaterThan(deriveCapSeconds("install"));
	});
	it("records the derivation, its samples and run ids for the receipt", () => {
		const record = capDerivation("selector");
		expect(record.operation).toBe("selector");
		expect(record.observations.map((s) => s.run)).toContain(38847064654);
		expect(record.maxObservedSeconds).toBeCloseTo(15.021, 3);
		expect(record.capSeconds).toBe(capFor("selector"));
		expect(record.coldFloorSeconds).toBe(60);
	});
	it("gives every stage room for a cold simulator on its own clock", () => {
		// Each stage is its own workflow step (own `timeout-minutes`), so a stage
		// clock must NOT inherit the previous step's wall time: charging setup the
		// preflight runtime left it exactly the cold cap and no room to boot,
		// install, connect and capture (found by arithmetic on the real constants).
		for (const stage of ["preflight", "setup", "full"] as const) {
			const budget = STAGE_SECONDS[stage] - 120;
			expect(budget).toBeGreaterThan(capFor("bootReady"));
			if (stage === "setup")
				expect(budget - capFor("bootReady")).toBeGreaterThan(300);
		}
	});
	it("keeps the derived cold caps real, named bounds inside the stage budget", () => {
		expect(capFor("selector")).toBeGreaterThanOrEqual(
			COLD_OPERATIONS.selector ?? 0,
		);
		expect(capFor("selector")).toBeGreaterThan(observedMaxSeconds("selector"));
		expect(capFor("bootReady")).toBeGreaterThanOrEqual(
			COLD_OPERATIONS.bootReady ?? 0,
		);
		expect(capFor("bootReady")).toBeLessThan(0.5 * STAGE_SECONDS.setup);
		expect(
			String(timedOutMessage("existing-simulator-selector", 60034, 180)),
		).toBe(
			"deadline exceeded (existing-simulator-selector, 60034ms, cap=180s)",
		);
	});
	it("requires a dedicated admitted hosted runner before real constructor side effects", () => {
		expect(() => assertProofCI({ NODE_ENV: "test" })).toThrow();
		expect(
			() =>
				new NativeProof("/not-created", "/not-used", "preflight", {
					NODE_ENV: "test",
				}),
		).toThrow();
	});
	it("executes actual consent-aware native URL validation and strict Bonjour args", () => {
		const identity = policyIdentity(NONCE, "a", "ci-native-mdns");
		expect(
			assertNativeOrigin(
				identity.hostname,
				identity.cookieName,
				41234,
				"ci-native-mdns",
			),
		).toBe(`http://${identity.hostname}:41234`);
		expect(mdnsCommand(identity.hostname, identity.cookieName, 41234)).toEqual([
			"-P",
			`loh12-${NONCE}-a`,
			"_http._tcp",
			"local.",
			"41234",
			identity.hostname,
			"127.0.0.1",
		]);
		expect(() =>
			assertNativeOrigin(
				identity.hostname,
				identity.cookieName,
				41234,
				"localhost",
			),
		).toThrow();
		expect(() =>
			mdnsCommand("localhost", identity.cookieName, 41234),
		).toThrow();
		expect(() => assertLoopbackAnswers([])).toThrow();
		expect(() =>
			assertLoopbackAnswers(["127.0.0.1", "198.51.100.9"]),
		).toThrow();
		expect(() => assertLoopbackAnswers(["127.0.0.1", "::1"])).not.toThrow();
	});
	it("pins actual artifact run/head/digest/size/expiry and rejects plausible stale artifacts", () => {
		const actual = {
			id: PINS.artifactId,
			name: "ios-simulator",
			expired: false,
			size_in_bytes: PINS.artifactBytes,
			digest: `sha256:${PINS.artifactDigest}`,
			workflow_run: { id: PINS.runId, head_sha: PINS.base },
		};
		expect(assertArtifactMetadata(actual).head).toBe(PINS.base);
		for (const patch of [
			{ id: 1 },
			{ expired: true },
			{ size_in_bytes: 0 },
			{ digest: `sha256:${"0".repeat(64)}` },
			{ workflow_run: { id: PINS.runId, head_sha: PINS.product } },
		])
			expect(() => assertArtifactMetadata({ ...actual, ...patch })).toThrow();
		expect(() => assertArchiveDigest(new Uint8Array(8))).toThrow();
	});
	it.each(["../escape", "/absolute", "A/./B", "a\\b", "C:/file"])(
		"refuses unsafe artifact entry %s",
		(name) => {
			expect(() => safeArchiveName(name)).toThrow();
		},
	);
	it("refuses absent native/embedded-JS facts and unverified Maestro support", () => {
		expect(() =>
			assertBundleFacts({
				bundleId: "example.proof",
				executable: "Runner",
				architectures: ["arm64"],
				jsAssets: [],
			}),
		).toThrow();
		expect(() =>
			assertMaestroHelp("2.11.0", "test --device hierarchy"),
		).not.toThrow();
		expect(() =>
			assertMaestroHelp("latest", "test --device hierarchy"),
		).toThrow();
		expect(() => assertMaestroHelp("2.11.0", "test")).toThrow();
	});
	it.each(["preflight", "setup", "full"] as const)(
		"executes exact %s stages with no baseline SDK build",
		async (stage) => {
			const actions: string[] = [];
			const op = (name: string) =>
				vi.fn(async () => {
					actions.push(name);
				});
			await runProof(stage, {
				preflight: op("preflight"),
				setupBase: op("base-form-and-before"),
				produceCandidate: op("ONE-candidate"),
				candidateFlows: op("native-flows"),
				cleanup: op("cleanup"),
			});
			expect(actions).toEqual(
				stage === "preflight"
					? ["preflight", "cleanup"]
					: stage === "setup"
						? ["preflight", "base-form-and-before", "cleanup"]
						: [
								"preflight",
								"base-form-and-before",
								"ONE-candidate",
								"native-flows",
								"cleanup",
							],
			);
		},
	);
	it.each([
		"preflight",
		"setupBase",
		"produceCandidate",
		"candidateFlows",
	] as const)(
		"a failed %s stops later producer/flows and always reaps",
		async (failed) => {
			const order = [
				"preflight",
				"setupBase",
				"produceCandidate",
				"candidateFlows",
			] as const;
			const calls: string[] = [];
			const actions = Object.fromEntries(
				order.map((name) => [
					name,
					async () => {
						calls.push(name);
						if (name === failed) throw new Error(`failed-${name}`);
					},
				]),
			);
			const operations = {
				preflight: actions.preflight ?? (async () => {}),
				setupBase: actions.setupBase ?? (async () => {}),
				produceCandidate: actions.produceCandidate ?? (async () => {}),
				candidateFlows: actions.candidateFlows ?? (async () => {}),
				cleanup: async () => {
					calls.push("cleanup");
				},
			};
			await expect(runProof("full", operations)).rejects.toThrow(
				`failed-${failed}`,
			);
			expect(calls).toEqual([
				...order.slice(0, order.indexOf(failed) + 1),
				"cleanup",
			]);
		},
	);
	it("drives public connection/consent and actual selected metadata IDs, not persisted-profile injection", () => {
		const connect = JSON.stringify(
			flow.connectSettings("/owned/connect-relay.yaml"),
		);
		expect(connect).toContain("runFlow");
		expect(connect).not.toContain("profile.json");
		expect(JSON.stringify(flow.switchComputer())).toContain("custom-url-field");
		expect(JSON.stringify(flow.removeRoute())).toContain("dialog-confirm");
		expect(JSON.stringify(flow.choose("future-backend-choice"))).toContain(
			"settings-account-routing-group:future-backend-choice",
		);
		expect(JSON.stringify(flow.reloadAfterUncertain())).toContain(
			"Reload policy",
		);
	});
});
