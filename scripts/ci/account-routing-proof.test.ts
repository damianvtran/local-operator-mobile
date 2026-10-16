import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { policyIdentity } from "../../tools/mock-relay/account-routing-identity.ts";
import baseline from "./account-routing-e2e-baseline.json";
import { DERIVED_OPS, NativeProof } from "./account-routing-ios-proof.ts";
import {
	ARTIFACT_CENSORED_SAMPLES,
	assertArchiveDigest,
	assertArtifactMetadata,
	assertBundleFacts,
	assertLoopbackAnswers,
	assertMaestroHelp,
	assertNativeOrigin,
	assertProofCI,
	type BoundedOperation,
	COLD_OPERATION_FLOOR_SECONDS,
	capDerivation,
	capFor,
	capRestsOnCensoredSample,
	coldStepSumSeconds,
	deriveCapSeconds,
	mdnsCommand,
	OPERATION_OBSERVATIONS,
	observedMaxSeconds,
	PINS,
	PRODUCER_BUDGET_SECONDS,
	PROOF_MODE,
	runProof,
	STAGE_PAYLOAD_SECONDS,
	STAGE_SECONDS,
	STEADY_FLOW_CAP_SECONDS,
	safeArchiveName,
	selectProof,
	UNOBSERVED_BUDGET_SECONDS,
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
		// The steady value is a labelled CONTRACT (no artifact sample exists for a
		// warm flow), so assert the constant, not a derivation readback.
		const steady = STEADY_FLOW_CAP_SECONDS;
		// Cold is derived above its own 123.17s observation AND above the steady
		// contract, so a cold cost cannot hide behind the warm budget.
		expect(cold).toBeGreaterThan(observedMaxSeconds("maestroCold"));
		expect(cold).toBeGreaterThan(steady);
		expect(steady).toBe(120);
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
			if (COLD_OPERATION_FLOOR_SECONDS[operation] !== undefined)
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
		// The injection must clear the op's FLOOR, or the floor masks it: the
		// selector's cold floor is 300s, so a 90s sample derives 270s and does not
		// move the cap, which would look like a constant. 200s derives 600s.
		const injected = [
			...OPERATION_OBSERVATIONS.selector,
			{ run: 99999999999, ms: 200000 },
		];
		const after = deriveCapSeconds("selector", undefined, injected);
		expect(after).toBeGreaterThan(before);
		expect(after).toBeGreaterThanOrEqual(600);
		// The same proof against the RECORDED table, not a loose array: a bigger
		// sample for a real operation must raise that operation's cap.
		// Same rule for a cold op with a floor: install's floor is 300s, so the
		// injection must derive above it (400s x 3 = 1200).
		const bigger = deriveCapSeconds("install", undefined, [
			...OPERATION_OBSERVATIONS.install,
			{ run: 1, ms: 400000 },
		]);
		expect(bigger).toBeGreaterThan(deriveCapSeconds("install"));
	});
	it("records the derivation, its samples and run ids for the receipt", () => {
		const record = capDerivation("selector");
		expect(record.operation).toBe("selector");
		expect(record.observations.map((s) => s.run)).toContain(38847064654);
		// The MAX is the censored 60s kill, not the 15s one: a killed child is a
		// lower bound, and the derivation must clear the bound that censored it.
		expect(record.maxObservedSeconds).toBeCloseTo(60.034, 3);
		expect(record.restsOnCensoredSample).toBe(true);
		expect(record.capSeconds).toBe(capFor("selector"));
		expect(record.coldFloorSeconds).toBe(300);
		// The measured spread is recorded, so a reader can see why a factor alone
		// cannot bound the next run.
		expect(record.spread?.ratio).toBeGreaterThan(5);
	});
	it("keeps every stage budget above the cold caps it can spend", () => {
		// The stage clock and the op caps are one contract, not two: a budget below
		// the sum of the caps a stage spends is how a legitimate cold step gets
		// clamped and read as a policy failure. Run 38850837889 was colder on every
		// cold op than every prior run, which is why the caps moved; the budgets
		// must move with them.
		for (const stage of ["setup", "full"] as const) {
			const cold = coldStepSumSeconds(stage);
			const payload = STAGE_PAYLOAD_SECONDS[stage] ?? 0;
			expect(cold).toBeGreaterThan(0);
			expect(payload).toBeGreaterThan(cold);
			// The budget covers the stage's whole payload AND keeps headroom, so a
			// slow-but-legitimate run is never clamped by its own clock.
			expect(STAGE_SECONDS[stage]).toBeGreaterThan(payload);
			expect(STAGE_SECONDS[stage] - payload).toBeGreaterThan(0.1 * payload);
		}
		// The `full` stage's payload is much larger than setup's: it adds the ONE
		// candidate producer (xcodebuild dominates) and ~30 warm flows.
		expect(STAGE_PAYLOAD_SECONDS.full ?? 0).toBeGreaterThan(
			(STAGE_PAYLOAD_SECONDS.setup ?? 0) + 3000,
		);
		// The workflow's own timeout must mirror the derived budget, or the runner
		// cancels the job before the proof's own clock ever reports anything.
		const workflow = readFileSync(
			new URL("../../.github/workflows/e2e.yml", import.meta.url),
			"utf8",
		);
		expect(workflow).toContain("inputs.proof_stage == 'setup' && 70");
		expect(workflow).toContain("210");
		// A cold cap must clear its floor AND be a spread multiple of its max, not
		// a fixed 1.5x over it.
		for (const operation of Object.keys(
			COLD_OPERATION_FLOOR_SECONDS,
		) as BoundedOperation[]) {
			expect(capFor(operation)).toBeGreaterThanOrEqual(
				COLD_OPERATION_FLOOR_SECONDS[operation] ?? 0,
			);
		}
		// The four ops run 38850837889 killed or nearly killed, with its numbers.
		expect(capFor("install")).toBeGreaterThan(47.798);
		expect(capFor("shutdown")).toBeGreaterThan(63.481);
		expect(capFor("selector")).toBeGreaterThan(60.034);
		expect(capFor("bootReady")).toBeGreaterThan(122.263);
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
			COLD_OPERATION_FLOOR_SECONDS.selector ?? 0,
		);
		expect(capFor("selector")).toBeGreaterThan(observedMaxSeconds("selector"));
		expect(capFor("bootReady")).toBeGreaterThanOrEqual(
			COLD_OPERATION_FLOOR_SECONDS.bootReady ?? 0,
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
	it("flags every sample an artifact shows was killed, not measured (R6-1)", () => {
		// The flag is written by hand and four samples have been wrong in this
		// loop, each time in the direction that hides a bound. So the evidence is
		// QUOTED from the runs' commands.json rather than remembered, and this
		// control holds the table to it: a sample the artifact shows as
		// `deadlineExceeded`/`rc:null` must carry `censored: true`.
		for (const known of ARTIFACT_CENSORED_SAMPLES) {
			const sample = OPERATION_OBSERVATIONS[known.operation].find(
				(candidate) => candidate.run === known.run,
			);
			expect(
				sample,
				`run ${known.run} has no ${known.operation} sample`,
			).toBeDefined();
			expect(
				(sample as { censored?: boolean }).censored,
				`${known.operation} run ${known.run} was killed by its cap (${known.evidence}) but is not flagged censored`,
			).toBe(true);
		}
		// The R6-1 regression, stated with its real numbers: bootReady's 91.7s is
		// the censored kill, while the deciding bound is the genuine 92.6s sample
		// and the cold floor — so the FLAG must not move the cap.
		const boot = OPERATION_OBSERVATIONS.bootReady.find(
			(candidate) => candidate.run === 38845929163,
		);
		expect((boot as { censored?: boolean }).censored).toBe(true);
		// The max is now run 38850837889's COMPLETED 122.3s boot — colder than every
		// prior run, and the reason the factor is spread-based rather than 1.5x.
		expect(observedMaxSeconds("bootReady")).toBeCloseTo(122.263, 3);
		expect(capFor("bootReady")).toBeGreaterThanOrEqual(360);
		// bootReady's deciding sample is the COMPLETED 92.6s one, so this stays
		// false: the censored 91.7s is not the max and does not decide the bound.
		expect(capRestsOnCensoredSample("bootReady")).toBe(false);
		// Whereas the selector's deciding sample IS the censored kill.
		expect(capRestsOnCensoredSample("selector")).toBe(true);
	});
	it("keeps exactly one source of truth per bound (R6-2)", () => {
		// A table entry nothing reads is the inverse of a bare literal: the same
		// bound with two sources that can disagree. Every OPERATION_OBSERVATIONS
		// key must be reachable, and the two budget maps must stay disjoint from
		// it AND from each other.
		const source = readFileSync(
			new URL("./account-routing-ios-proof.ts", import.meta.url),
			"utf8",
		);
		const unread = (Object.keys(OPERATION_OBSERVATIONS) as string[]).filter(
			(operation) =>
				!source.includes(`capFor("${operation}")`) &&
				!DERIVED_OPS.includes(operation as (typeof DERIVED_OPS)[number]),
		);
		expect(unread).toEqual([]);
		const observations = new Set(Object.keys(OPERATION_OBSERVATIONS));
		for (const budgets of [
			PRODUCER_BUDGET_SECONDS,
			UNOBSERVED_BUDGET_SECONDS,
		]) {
			for (const key of Object.keys(budgets)) {
				expect(observations.has(key)).toBe(false);
			}
		}
	});
	it("isolates every git config source the child could inherit (R5-3)", () => {
		// The proof host isolates the ambient git config so a runner's global
		// config cannot change behaviour; assert the exact env contract rather
		// than trusting it. The gitignored-artifact control (R5-1) lives in
		// account-routing-bootstrap-test.py, where the fixture can carry the
		// pinned checkout's real .gitignore bytes.
		const probeRoot = mkdtempSync(join(tmpdir(), "host-env-"));
		try {
			const probe = new ProofHost(probeRoot, process.cwd(), 600, [], {
				...hosted,
			});
			expect(probe.env.GIT_CONFIG_SYSTEM).toBe("/dev/null");
			// R5-3: GIT_CONFIG_GLOBAL was missing, so a global `commit.gpgsign=true`
			// or credential helper still reached the child (the F2 ambient class).
			expect(probe.env.GIT_CONFIG_GLOBAL).toBe("/dev/null");
			expect(probe.env.GIT_TERMINAL_PROMPT).toBe("0");
			expect(probe.env.GIT_ASKPASS).toBe("/bin/false");
		} finally {
			rmSync(probeRoot, { recursive: true, force: true });
		}
	});
	it("tolerates only the device-missing teardown shape, never a deadline (R5-4)", () => {
		// The helper is on the real teardown path, so this control keeps it honest:
		// simctl's own "already gone" wording is tolerated, a deadline is NOT, and
		// an unrelated failure is not swept up in the tolerance.
		expect(
			tolerableTeardown(
				new Error(
					"shutdown-owned-simulator failed rc=149: Unable to find device",
				),
			),
		).toBe(true);
		expect(
			tolerableTeardown(
				new Error("delete-owned-simulator failed rc=149: Invalid device state"),
			),
		).toBe(true);
		expect(
			tolerableTeardown(
				new Error(
					"deadline exceeded (shutdown-owned-simulator, 60000ms, cap=60s)",
				),
			),
		).toBe(false);
		expect(tolerableTeardown(new Error("some unrelated rc=1 failure"))).toBe(
			false,
		);
		expect(tolerableTeardown("not an error")).toBe(false);
	});
	it("reports the STAGE failure primary when cleanup also fails (R5-5)", async () => {
		// The two-failure compose path: a prerequisite deadline AND a teardown
		// failure. A reader must see the stage cause; cleanup is secondary. The
		// reviewer's probe was this path's first execution, so it needs a control.
		const operations = {
			preflight: async () => {},
			setupBase: async () => {
				throw new Error(
					"deadline exceeded (owned-boot-ready, 91663ms, cap=90s)",
				);
			},
			produceCandidate: async () => {},
			candidateFlows: async () => {},
			cleanup: async () => {
				throw new Error("cleanup failures: simulator-shutdown");
			},
		};
		const failure = await runProof("setup", operations).catch(
			(error: unknown) => error,
		);
		expect(failure).toBeInstanceOf(Error);
		const message = (failure as Error).message;
		expect(message).toContain("owned-boot-ready");
		expect(message).toContain("(secondary)");
		expect(message).toContain("simulator-shutdown");
		// The stage cause must come FIRST: a reader skimming the message must not
		// conclude the run failed on cleanup.
		expect(message.indexOf("owned-boot-ready")).toBeLessThan(
			message.indexOf("simulator-shutdown"),
		);
	});
	it("binds every proof call site to a cap source, not a bare number (R5-2)", () => {
		// The table-only control could not catch a NEW call site writing 55: the
		// defect was in the call sites, not in the table. This reads the proof
		// modules and asserts every `host.run(...)` cap argument is a named
		// source — `capFor(...)`, a labelled budget, or a local `cap` variable.
		const source = readFileSync(
			new URL("./account-routing-ios-proof.ts", import.meta.url),
			"utf8",
		);
		const literals: string[] = [];
		const callPattern = /this\.host\.run\(/g;
		for (const match of source.matchAll(callPattern)) {
			const start = source.indexOf("(", match.index);
			let depth = 0;
			let end = start;
			for (; end < source.length; end += 1) {
				if (source[end] === "(") depth += 1;
				else if (source[end] === ")") {
					depth -= 1;
					if (depth === 0) break;
				}
			}
			const body = source.slice(start + 1, end);
			// Top-level comma split, so a nested call's args do not confuse the index.
			const parts: string[] = [];
			let level = 0;
			let current = "";
			let quote: string | null = null;
			for (const ch of body) {
				if (quote) {
					current += ch;
					if (ch === quote) quote = null;
					continue;
				}
				if (ch === '"' || ch === "'" || ch === "`") {
					quote = ch;
					current += ch;
					continue;
				}
				if (ch === "(" || ch === "[" || ch === "{") level += 1;
				else if (ch === ")" || ch === "]" || ch === "}") level -= 1;
				if (ch === "," && level === 0) {
					parts.push(current);
					current = "";
				} else current += ch;
			}
			parts.push(current);
			const cap = (parts[3] ?? "").trim();
			if (/^\d+$/.test(cap)) literals.push(cap);
			// No 4th argument means the host's implicit default (60s) is the bound,
			// which is exactly the invisible cap this guard exists to forbid.
			if (cap === "") literals.push("<host default>");
		}
		expect(literals).toEqual([]);
	});
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
