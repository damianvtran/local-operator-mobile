import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
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
	mdnsCommand,
	PINS,
	PROOF_MODE,
	runProof,
	safeArchiveName,
	selectProof,
} from "./account-routing-proof-contract.ts";
import * as flow from "./account-routing-proof-flows.ts";

const MANUAL = "workflow_" + "dispatch";
const NONCE = "0123456789abcdef0123456789abcdef";
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
