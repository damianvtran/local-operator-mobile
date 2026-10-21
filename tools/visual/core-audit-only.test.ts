import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
	resolve(import.meta.dirname, "../../.github/workflows/e2e.yml"),
	"utf8",
);
const blocks = workflow
	.slice(workflow.indexOf("\njobs:\n"))
	.split(/^ {2}([\w-]+):\n/m);
const guards = new Map<string, string>();
const GUARD = /^ {4}if: (.+)$/m;
for (let i = 1; i < blocks.length; i += 2) {
	const name = blocks[i],
		block = blocks[i + 1];
	if (name && block) guards.set(name, GUARD.exec(block)?.[1] ?? "true");
}
// Same expression-evaluation convention as s15-proof.test.ts. Evaluate actual
// YAML job predicates, never a second implementation of the new selector.
function selects(guard: string, event: string, mode: string) {
	return Boolean(
		runInNewContext(
			guard,
			{ github: { event_name: event }, inputs: { proof_mode: mode } },
			{ timeout: 100 },
		),
	);
}
const selected = (event: string, mode: string) =>
	[...guards]
		.filter(([, guard]) => selects(guard, event, mode))
		.map(([name]) => name);
const legacy = {
	harness: "true",
	"mock-relay-contract": "(inputs.proof_mode || 'full') == 'full'",
	"docs-commands":
		"(github.event_name == 'schedule' || github.event_name == 'workflow_dispatch') && (inputs.proof_mode || 'full') == 'full'",
	"web-audit": "(inputs.proof_mode || 'full') == 'full'",
	"s15-proof":
		"github.event_name == 'workflow_dispatch' && inputs.proof_mode == 's15-proof'",
	"web-audit-core":
		"(github.event_name == 'schedule' || github.event_name == 'workflow_dispatch') && (inputs.proof_mode || 'full') == 'full'",
	"maestro-android":
		"(github.event_name == 'schedule' || github.event_name == 'workflow_dispatch') && (inputs.proof_mode || 'full') == 'full'",
	"account-routing-android-proof":
		"github.event_name == 'workflow_dispatch' && inputs.proof_mode == 'account-routing-android-proof'",
	"account-routing-ios-proof":
		"github.event_name == 'workflow_dispatch' && inputs.proof_mode == 'account-routing-ios-proof'",
};
const validatorSection =
	workflow
		.split("- name: Validate proof selection")[1]
		?.split("- name: Detect the harness")[0] ?? "";
const validator = validatorSection
	.split("        run: |\n")[1]
	?.split("\n")
	.map((line) => line.slice(10))
	.join("\n");
function admits(event: string, mode: string, stage = "full") {
	if (!validator) throw new Error("Missing fail-closed workflow bootstrap");
	return (
		spawnSync("bash", ["-c", validator], {
			env: {
				PATH: process.env.PATH,
				GITHUB_EVENT_NAME: event,
				PROOF_MODE: mode || "full",
				PROOF_STAGE: stage || "full",
			},
			encoding: "utf8",
			timeout: 1000,
		}).status === 0
	);
}

describe("core-audit-only dispatch isolation", () => {
	it("admits only explicit full-stage dispatch and selects only existing core plus bootstrap", () => {
		expect(workflow).toContain("          - core-audit-only\n");
		expect(admits("workflow_dispatch", "core-audit-only")).toBe(true);
		expect(selected("workflow_dispatch", "core-audit-only")).toEqual([
			"harness",
			"web-audit-core",
		]);
		for (const event of ["push", "pull_request", "schedule"])
			expect(admits(event, "core-audit-only")).toBe(false);
		for (const stage of ["preflight", "setup", "unknown"])
			expect(admits("workflow_dispatch", "core-audit-only", stage)).toBe(false);
		expect(admits("workflow_dispatch", "unknown")).toBe(false);
	});
	it("preserves every old job predicate's result for every existing mode and event", () => {
		expect(
			[...guards.keys()].filter((name) => name !== "u08-geometry-proof"),
		).toEqual(Object.keys(legacy));
		expect(guards.get("u08-geometry-proof")).toBeTruthy();
		for (const event of [
			"push",
			"pull_request",
			"schedule",
			"workflow_dispatch",
		])
			for (const mode of [
				"",
				"full",
				"s15-proof",
				"account-routing-ios-proof",
				"account-routing-android-proof",
			]) {
				expect(
					selects(guards.get("u08-geometry-proof") ?? "true", event, mode),
				).toBe(false);
				for (const [name, old] of Object.entries(legacy))
					expect(
						selects(guards.get(name) ?? "false", event, mode),
						`${event}/${mode}/${name}`,
					).toBe(selects(old, event, mode));
			}
	});
	it("retains the existing proof stage admission rules and full/push defaults", () => {
		for (const event of [
			"push",
			"pull_request",
			"schedule",
			"workflow_dispatch",
		])
			expect(admits(event, "full")).toBe(true);
		for (const mode of [
			"s15-proof",
			"account-routing-ios-proof",
			"account-routing-android-proof",
		]) {
			expect(admits("workflow_dispatch", mode)).toBe(true);
			expect(admits("push", mode)).toBe(false);
		}
		for (const stage of ["preflight", "setup"]) {
			expect(
				admits("workflow_dispatch", "account-routing-ios-proof", stage),
			).toBe(true);
			for (const mode of ["full", "s15-proof", "account-routing-android-proof"])
				expect(admits("workflow_dispatch", mode, stage)).toBe(false);
		}
	});
	it("has a discriminating pre-change isolation negative control", () => {
		const oldSelected = Object.entries(legacy)
			.filter(([, guard]) =>
				selects(guard, "workflow_dispatch", "core-audit-only"),
			)
			.map(([name]) => name);
		expect(oldSelected).toEqual(["harness"]);
		expect(selected("workflow_dispatch", "full")).toEqual([
			"harness",
			"mock-relay-contract",
			"docs-commands",
			"web-audit",
			"web-audit-core",
			"maestro-android",
		]);
	});
});
