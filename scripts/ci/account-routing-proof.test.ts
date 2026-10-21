import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { policyIdentity } from "../../tools/mock-relay/account-routing-identity.ts";
import baseline from "./account-routing-e2e-baseline.json";
import { DERIVED_OPS, NativeProof } from "./account-routing-ios-proof.ts";
import {
	ANDROID_PROOF_MODE,
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
	COLD_FIRST_WAIT_MS,
	STEADY_WAIT_MS,
} from "./account-routing-proof-flows.ts";
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
			[
				...Object.keys(baseline.jobs),
				PROOF_MODE,
				ANDROID_PROOF_MODE,
				"u08-geometry-proof",
			].sort(),
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
		// The Android proof job, in the SAME truth table: it fires only on a manual
		// dispatch of ITS OWN mode, so adding it cannot fan out into any other event
		// or mode — and an S15 or iOS dispatch must not start it.
		const android = current[ANDROID_PROOF_MODE];
		if (!android) throw new Error("missing android targeted job");
		for (const event of ["pull_request", "push", "schedule", MANUAL])
			for (const mode of [
				"",
				"full",
				"s15-proof",
				PROOF_MODE,
				ANDROID_PROOF_MODE,
			])
				expect(evaluate(android.condition, event, mode)).toBe(
					event === MANUAL && mode === ANDROID_PROOF_MODE,
				);
	});
	it("every dispatchable proof mode has an arm in the Validate-proof-selection shell", async () => {
		// WHY THIS EXISTS: the truth table above reads the JOB `if:` conditions, and
		// the harness job's own `Validate proof selection` step is a SHELL `case` it
		// never read — so adding a mode (inputs + job + contract) could leave that
		// validator without an arm, which is exactly how run 38915672373 failed in 2s
		// with `::error::unknown proof mode` before any emulator or build spend. The
		// control below runs the ACTUAL shipped script text, not a copy, so a mode
		// added without its arm fails here instead of on a dispatch.
		const { spawnSync } = await import("node:child_process");
		const workflow = source(".github/workflows/e2e.yml");
		const step = workflow.split("- name: Validate proof selection")[1];
		if (!step) throw new Error("missing validator step");
		const script = step.split("\n        run: |\n")[1]?.split(/\n {6}- /)[0];
		if (!script) throw new Error("missing validator script");
		const modes: [string, string, boolean][] = [
			// mode, stage, must the validator ACCEPT on a manual dispatch?
			["full", "full", true],
			["s15-proof", "full", true],
			["core-audit-only", "full", true],
			["u08-geometry-proof", "full", true],
			["u08-geometry-proof", "setup", false],
			["u08-geometry-proof", "preflight", false],
			["account-routing-ios-proof", "full", true],
			["account-routing-ios-proof", "preflight", true],
			["account-routing-ios-proof", "setup", true],
			["account-routing-android-proof", "full", true],
			// Stage arguments that must be refused rather than silently accepted.
			["account-routing-android-proof", "setup", false],
			["account-routing-android-proof", "preflight", false],
			["not-a-mode", "full", false],
		];
		for (const [mode, stage, accepted] of modes) {
			const result = spawnSync("bash", ["-c", script], {
				encoding: "utf8",
				env: {
					...process.env,
					PROOF_MODE: mode,
					PROOF_STAGE: stage,
					GITHUB_EVENT_NAME: "workflow_dispatch",
				},
			});
			expect(
				result.status === 0,
				`${mode}/${stage} on a manual dispatch (stderr: ${result.stderr.trim()})`,
			).toBe(accepted);
		}
		// And the class guard itself: every mode the workflow offers must appear as an
		// arm, so the next mode added cannot repeat this. The options list is the
		// operator-facing source of truth.
		const options =
			workflow
				.split("      proof_mode:")[1]
				?.split("      proof_stage:")[0]
				?.split("options:")[1]
				?.split("\n")
				.map((line) => line.trim().replace(/^-\s*/, ""))
				.filter((line) => /^[a-z0-9-]+$/.test(line)) ?? [];
		expect(options.length).toBeGreaterThan(0);
		for (const mode of options)
			expect(script, `arm for ${mode}`).toContain(`${mode})`);
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
	it("derives the path-walking first flow's cap from its own observations (R10)", () => {
		// R10: the flow that walks the connect path measured 104569ms, 104115ms and
		// then 120170ms KILLED, against a hand-set cap of exactly 120s. That cap was
		// the last bound serving MEASURED work without being derived from its own
		// observations; it is now derived like every other measured operation.
		// (STEADY_FLOW_CAP_SECONDS remains hand-set, and correctly so — it is a
		// warm-stage POLICY value with no completed sample behind it, not a
		// measurement, and this control asserts the derived cap exceeds it.)
		const cap = capFor("maestroFirstFlow");
		// Above the observed max, and above the 3x factor for a cold op.
		expect(cap).toBeGreaterThan(observedMaxSeconds("maestroFirstFlow"));
		expect(cap).toBeGreaterThanOrEqual(
			Math.ceil(observedMaxSeconds("maestroFirstFlow") * 3),
		);
		expect(cap).toBe(361);
		// Strictly above the flow that was killed at 120s, with real headroom.
		expect(cap).toBeGreaterThan(120.17);
		// Every value is a real elapsed with its run id, and each is CENSORED: none
		// of the three completed the path (two ended on an assertion, one was killed),
		// so none is a full-cost measurement.
		expect(
			OPERATION_OBSERVATIONS.maestroFirstFlow.map((s) => s.run).sort(),
		).toEqual([38853165349, 38854849272, 38857164876].sort());
		for (const sample of OPERATION_OBSERVATIONS.maestroFirstFlow)
			expect((sample as { censored?: boolean }).censored).toBe(true);
		// The steady in-run contract is untouched, and is NOT what the first flow gets.
		expect(STEADY_FLOW_CAP_SECONDS).toBe(120);
		expect(capFor("maestroFirstFlow")).toBeGreaterThan(STEADY_FLOW_CAP_SECONDS);
		// The selection itself must cover the first flow that WALKS the path, not just
		// the driver touch: assert the proof keeps a flag distinct from `maestroWarm`.
		const source = readFileSync(
			new URL("./account-routing-ios-proof.ts", import.meta.url),
			"utf8",
		);
		expect(source).toContain('capFor("maestroFirstFlow")');
		// R7-1: the cap must follow the flow's own SHAPE, not its position, and no
		// cross-call state may decide it — a sticky "first flow" flag left `full`'s
		// SECOND clearState path-walking flow (candidate-real-form, after the
		// producer) on the steady 120s that killed run 38857164876.
		expect(source).not.toContain("flowsWalkedPath");
		expect(source).toContain("launchesCold");
		expect(source).toContain("clearState === true");
		// Both connectSettings call sites exist in the proof (base and candidate), so
		// the shape rule is what both of them depend on.
		const connectSites = source.match(/flows\.connectSettings\(/g) ?? [];
		expect(connectSites.length).toBe(2);
	});
	it("never bounds a simctl install below that operation's own floor (R7-2)", () => {
		// The candidate install is the SAME simctl install as install-exact-base, on a
		// later and colder build, so a separate 120s budget contradicted the op's own
		// 300s cold floor. Both call sites now use that operation's cap.
		const source = readFileSync(
			new URL("./account-routing-ios-proof.ts", import.meta.url),
			"utf8",
		);
		// Skip comment lines: the call site documents WHY it takes that cap, and a
		// match on the prose would assert against the explanation instead of the arg.
		const installCaps = source
			.split("\n")
			.flatMap((line, index) =>
				/"simctl",\s*"install"/.test(line) ? [index] : [],
			)
			.map(
				(index) =>
					source
						.split("\n")
						.slice(index + 1)
						.find((line) => line.trim() && !line.trim().startsWith("//"))
						?.trim()
						.replace(/,$/, "") ?? "",
			);
		expect(installCaps.length).toBe(2);
		for (const cap of installCaps) expect(cap).toBe('capFor("install")');
		expect(capFor("install")).toBeGreaterThanOrEqual(
			COLD_OPERATION_FLOOR_SECONDS.install ?? 0,
		);
	});
	it("gives a cold cap to EVERY clearState flow in a full-stage sequence (R7-1)", async () => {
		// The fresh-object control is what let R7-1 through, so this exercises the
		// FULL-stage SEQUENCE inside ONE proof object: base-real-form, then the
		// producer, then candidate-real-form. No hosted run: the host is stubbed and
		// each flow's chosen cap is recorded.
		const root = mkdtempSync(join(tmpdir(), "loh12-seq-"));
		try {
			const proof = new NativeProof(root, process.cwd(), "full", {
				...hosted,
			}) as unknown as {
				udid?: string;
				baseline?: unknown;
				candidate?: unknown;
				flow: (name: string, commands: flow.NativeStep[]) => Promise<void>;
				host: { run: (...args: unknown[]) => Promise<string> };
				slots: Map<"a" | "b", unknown>;
			};
			const caps: { name: string; cap: number }[] = [];
			proof.host = {
				run: async (...args: unknown[]) => {
					const name = String(args[0]);
					// run(name, command, args, cap, extra) — cap is the FOURTH arg.
					const cap = args[3];
					if (name.startsWith("maestro-") && typeof cap === "number")
						caps.push({ name, cap });
					return "bounds: [0,0][1,1] frame: {}";
				},
			} as unknown as { run: (...args: unknown[]) => Promise<string> };
			proof.udid = "0".repeat(8) + "-0000-0000-0000-" + "0".repeat(12);
			proof.baseline = { bundleId: "com.example.app", app: "/tmp/a" };
			// `flow()` reads only the slot's origin for its `-e RELAY_URL`; the cap
			// decision is what this control is about, so a minimal slot stands in the
			// same way the host is stubbed.
			for (const profile of ["a", "b"] as const)
				proof.slots.set(profile, {
					origin: `http://127.0.0.1:1`,
					port: 1,
				} as unknown as typeof proof.slots extends Map<infer _K, infer V>
					? V
					: never);
			// The DRIVER bring-up first, as the real stage does.
			await proof.flow("driver-touch", [{ assertVisible: { id: "x" } }]);
			// Then the two clearState path-walking flows of a `full` stage.
			await proof.flow("base-real-form", flow.connectSettings("/h.yaml"));
			await proof.flow("candidate-real-form", flow.connectSettings("/h.yaml"));
			// Labels carry the frame counter (`maestro-2-base-real-form`), so match by
			// suffix: an exact-name lookup misses silently and would prove nothing.
			const capOf = (fragment: string) => {
				const hit = caps.find((c) => c.name.includes(fragment));
				expect(hit, `no Maestro call for ${fragment}`).toBeDefined();
				return hit?.cap;
			};
			expect(caps.length).toBe(3);
			// First Maestro call: the driver bring-up.
			expect(capOf("driver-touch")).toBe(capFor("maestroCold"));
			// BOTH path-walking flows take the derived cold cap — including the second,
			// which a sticky first-flow flag left on the steady 120s (R7-1).
			expect(capOf("base-real-form")).toBe(capFor("maestroFirstFlow"));
			expect(capOf("candidate-real-form")).toBe(capFor("maestroFirstFlow"));
			expect(capOf("candidate-real-form")).toBeGreaterThan(
				STEADY_FLOW_CAP_SECONDS,
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
	it("keeps the proof's iOS connect sequence free of iOS-unsupported steps (R9)", () => {
		// The base helper `e2e/maestro/helpers/connect-relay.yaml` is Android-only
		// (its eight consuming flows run on the Android lane; base iOS e2e is
		// deferred), so its `hideKeyboard` steps were never exercised on iOS, where
		// Maestro 2.11.0 rejects them (run 38854849272). The proof owns an iOS
		// variant instead; this control keeps it a faithful mirror minus that step.
		const base = readFileSync(
			new URL("../../e2e/maestro/helpers/connect-relay.yaml", import.meta.url),
			"utf8",
		);
		const ios = readFileSync(
			new URL(
				"../../e2e/maestro/account-routing-proof/connect-relay-ios.yaml",
				import.meta.url,
			),
			"utf8",
		);
		const ids = (text: string) =>
			[...text.matchAll(/id:\s*"([^"]+)"/g)].map((m) => m[1]).sort();
		// Every base id, nothing dropped and nothing invented.
		expect(ids(ios)).toEqual(ids(base));
		// No iOS-unsupported step. Asserted on STEP lines, not on prose: a comment
		// may legitimately name `hideKeyboard` while explaining why it is absent.
		const stepLines = (text: string) =>
			text
				.split("\n")
				.map((line) => line.trim())
				.filter((line) => line.startsWith("- "))
				.map((line) => line.replace(/^- /, "").split(":")[0]);
		expect(stepLines(base)).toContain("hideKeyboard");
		expect(stepLines(ios)).not.toContain("hideKeyboard");
		// The substitution is a tap on STATIC, non-interactive text, which is what
		// Maestro's own iOS failure message recommends.
		expect(ios).toContain('text: "Your own tunnel"');
		// Both real `Connected` verdict gates survive: the flow still proves the
		// real own-tunnel handshake instead of being weakened to pass.
		expect([...ios.matchAll(/text: "Connected"/g)].length).toBe(2);
		// And the proof's call sites actually use this file, not the base helper.
		const proofSource = readFileSync(
			new URL("./account-routing-ios-proof.ts", import.meta.url),
			"utf8",
		);
		expect(proofSource).toContain(
			"e2e/maestro/account-routing-proof/connect-relay-ios.yaml",
		);
		expect(proofSource).not.toContain(
			'"e2e/maestro/helpers/connect-relay.yaml"',
		);
		// The BASE asset must be left exactly as the Android lane verifies it: its
		// opening wait is still the base 15000ms, because the proof no longer depends
		// on it. Editing it would change an asset only Android can re-check (R9's own
		// constraint), and R8's cold-budget edit to it was superseded by this file.
		const baseWaits = [...base.matchAll(/timeout:\s*(\d+)/g)].map((m) =>
			Number(m[1]),
		);
		expect(baseWaits[0]).toBe(15000);
		expect(baseWaits.every((value) => value === 15000)).toBe(true);
	});
	it("gives the first post-clearState wait a cold budget, later waits steady (R8)", () => {
		// Run 38853165349's first evidence flow FAILED `id: welcome-screen is
		// visible` on a flat 15000ms steady wait, while the rendered frame shows the
		// app HAD drawn the Welcome screen after a clearState launch. The budget, not
		// the app, was the defect. This control holds the helper's opening wait and
		// the proof's derivation together so they cannot drift.
		// The helper the proof ACTUALLY runs: its own iOS variant. R8 originally
		// edited the base helper; R9 replaced that dependency, so the cold wait now
		// lives in the proof-owned file and the base asset is left untouched (a
		// control asserts that too, below).
		const helper = readFileSync(
			new URL(
				"../../e2e/maestro/account-routing-proof/connect-relay-ios.yaml",
				import.meta.url,
			),
			"utf8",
		);
		const waits = [...helper.matchAll(/timeout:\s*(\d+)/g)].map((m) =>
			Number(m[1]),
		);
		// The OPENING wait is the cold one and must clear the measured cold launch.
		expect(waits[0]).toBe(COLD_FIRST_WAIT_MS);
		expect(COLD_FIRST_WAIT_MS).toBe(capFor("coldAppLaunch") * 1000);
		expect(COLD_FIRST_WAIT_MS).toBeGreaterThan(
			observedMaxSeconds("coldAppLaunch") * 1000,
		);
		// Every LATER wait stays steady: a cold cost must not inflate them, or a
		// genuine warm-path slowdown would hide behind a huge budget.
		for (const later of waits.slice(1)) expect(later).toBe(STEADY_WAIT_MS);
		expect(STEADY_WAIT_MS).toBe(15000);
	});
	it("requires a drawn app screen in the warm-up, not just a driver touch (R8)", () => {
		// F4 warmed the driver; the first flow still carried the app's cold launch.
		// The warm-up now proves the app has PAINTED before the first flow starts.
		const source = readFileSync(
			new URL("./account-routing-ios-proof.ts", import.meta.url),
			"utf8",
		);
		expect(source).toContain("warm driver did not show a drawn app screen");
		// The flow still launches with clearState and asserts for itself: the
		// readiness gate must not have replaced the real path.
		expect(source).toContain("flows.connectSettings(");
		const flowsSource = readFileSync(
			new URL("./account-routing-proof-flows.ts", import.meta.url),
			"utf8",
		);
		expect(flowsSource).toContain("launchApp: { clearState: true }");
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
		expect(workflow).toContain("240");
		// And the budget it mirrors, so the two cannot drift.
		expect(STAGE_SECONDS.full).toBe(14400);
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
		// TWO-DIRECTIONAL (review R7-3): a quote must match a flag, AND every flag
		// must quote its artifact record. One-directional checking let a flag be
		// SELF-DECLARED — a hand-written `censored: true` with no artifact behind it
		// would satisfy "quoted sample still flagged" while proving nothing, which is
		// the pattern R6-1 existed to end.
		const flagged: [string, number][] = [];
		for (const [operation, samples] of Object.entries(OPERATION_OBSERVATIONS))
			for (const sample of samples)
				if ((sample as { censored?: boolean }).censored)
					flagged.push([operation, sample.run]);
		const quoted: [string, number][] = ARTIFACT_CENSORED_SAMPLES.map(
			(entry) => [entry.operation, entry.run],
		);
		const key = ([operation, run]: [string, number]) => `${operation}:${run}`;
		expect(flagged.map(key).sort()).toEqual(quoted.map(key).sort());
		// Every quote carries raw artifact text, not a bare assertion.
		for (const entry of ARTIFACT_CENSORED_SAMPLES)
			expect(entry.evidence.length).toBeGreaterThan(10);
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
