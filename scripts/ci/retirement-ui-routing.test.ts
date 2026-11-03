import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
	new URL("../../.github/workflows/ios.yml", import.meta.url),
	"utf8",
);
function block(name: string) {
	const value = workflow
		.split(`\n  ${name}:\n`)[1]
		?.split(/\n {2}[\w-]+:\n/)[0];
	if (!value) throw new Error("Workflow job fixture missing");
	return value;
}
function condition(name: string) {
	const value = block(name).match(/^ {4}if: (.+)$/m)?.[1];
	if (!value) throw new Error("Job condition missing");
	return value;
}
function evaluate(
	name: string,
	event: string,
	mode: unknown,
	proof: unknown,
	native = "true",
	ref = "refs/heads/main",
) {
	const source = condition(name)
		.replace(/toJSON\(inputs\.retirement_proof\)/g, "proofJSON")
		.replace(/github\.event_name/g, "event")
		.replace(/github\.ref/g, "ref")
		.replace(/inputs\.mode/g, "mode")
		.replace(/needs\.changes\.outputs\.native/g, "native")
		.replace(/needs\.credentials\.outputs\.all_present/g, "credentials");
	return Boolean(
		runInNewContext(
			source,
			{
				event,
				mode,
				proofJSON: JSON.stringify(proof),
				native,
				ref,
				credentials: "true",
			},
			{ timeout: 100 },
		),
	);
}
function route(mode: unknown, proof: unknown) {
	const env = {
		...process.env,
		IOS_PROOF_JSON: JSON.stringify(proof) ?? "null",
	};
	if (typeof mode === "string") Object.assign(env, { IOS_MANUAL_MODE: mode });
	else delete (env as Record<string, string | undefined>).IOS_MANUAL_MODE;
	return spawnSync(
		"/usr/bin/python3",
		[new URL("./retirement-ui-route.py", import.meta.url).pathname],
		{ env, encoding: "utf8", timeout: 5000 },
	);
}
describe("registered iOS workflow exclusive setup routing (source-only, no dispatch)", () => {
	it.each([
		["setup", "retirement-ui-setup", false, true],
		["contradictory proof", "retirement-ui-setup", true, false],
		["unknown", "replay", false, false],
		["missing mode", undefined, false, false],
		["malformed false", "retirement-ui-setup", "false", false],
		["missing proof", "retirement-ui-setup", undefined, false],
	] as const)(
		"manual %s cannot reach ordinary app jobs",
		(_label, mode, proof, eligible) => {
			expect(evaluate("changes", "workflow_dispatch", mode, proof)).toBe(false);
			expect(
				evaluate("retirement-ui-setup", "workflow_dispatch", mode, proof),
			).toBe(eligible);
			expect(evaluate("credentials", "workflow_dispatch", mode, proof)).toBe(
				false,
			);
			expect(evaluate("internal", "workflow_dispatch", mode, proof)).toBe(
				false,
			);
			const result = route(mode, proof);
			expect(result.status === 0).toBe(eligible);
			expect(block("ios")).toContain("needs: changes");
			expect(block("retirement-ui-setup")).toContain("needs: manual-mode");
		},
	);
	it.each([false, true])(
		"ordinary manual default standard keeps prior proof=%s behavior",
		(proof) => {
			expect(route("standard", proof).status).toBe(0);
			expect(evaluate("changes", "workflow_dispatch", "standard", proof)).toBe(
				true,
			);
			expect(
				evaluate("retirement-ui-setup", "workflow_dispatch", "standard", proof),
			).toBe(false);
		},
	);
	it.each(["pull_request", "push"])(
		"%s and mixed production changes retain ordinary native classification",
		(event) => {
			expect(evaluate("changes", event, "retirement-ui-setup", false)).toBe(
				true,
			);
			expect(
				evaluate("retirement-ui-setup", event, "retirement-ui-setup", false),
			).toBe(false);
			expect(evaluate("ios", event, undefined, undefined, "true")).toBe(true);
			expect(evaluate("ios", event, undefined, undefined, "false")).toBe(false);
			expect(block("changes")).toContain("grep -v -E '^(docs/|.*\\.md$)'");
			expect(block("changes")).not.toContain("retirement-ui-guards.ts");
		},
	);
	it("default input and local reusable workflow are exact, with no app/test install entrypoint", () => {
		expect(workflow).toContain("options: [standard, retirement-ui-setup]");
		expect(workflow).toContain("default: standard");
		expect(block("retirement-ui-setup")).toContain(
			"uses: ./.github/workflows/retirement-ui-setup.yml",
		);
		expect(block("retirement-ui-setup")).toContain("mode: setup");
		const reusable = readFileSync(
			new URL(
				"../../.github/workflows/retirement-ui-setup.yml",
				import.meta.url,
			),
			"utf8",
		);
		expect(reusable).toContain("workflow_call:");
		expect(reusable).toContain('run: test "$SETUP_MODE" = setup');
		expect(reusable).not.toContain("test-without-building");
		expect(reusable).not.toContain("simctl");
		expect(reusable).not.toMatch(/uses:.*setup-node/);
	});
});
