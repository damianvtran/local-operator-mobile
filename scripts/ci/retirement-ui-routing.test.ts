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
	manualResult = "success",
) {
	const source = condition(name)
		.replace(/always\(\)/g, "true")
		.replace(/cancelled\(\)/g, "false")
		.replace(/needs\['manual-mode'\]\.result/g, "manualResult")
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
				manualResult,
			},
			{ timeout: 100 },
		),
	);
}
function route(
	mode: unknown,
	proof: unknown,
	extra: Record<string, string> = {},
) {
	const env = {
		...process.env,
		IOS_PROOF_JSON: JSON.stringify(proof) ?? "null",
		REPLAY_COMPILE_RUN: "",
		REPLAY_RUNNER_ARTIFACT: "",
		REPLAY_RUNNER_SOURCE: "",
		REPLAY_OBSERVE_ONLY_JSON: "false",
		...extra,
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
		expect(workflow).toContain(
			"options: [standard, retirement-ui-setup, retirement-seed-replay]",
		);
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

const replayInputs = {
	REPLAY_COMPILE_RUN: "12345",
	REPLAY_RUNNER_ARTIFACT: "67890",
	REPLAY_RUNNER_SOURCE: "c".repeat(40),
	GITHUB_SHA: "c".repeat(40),
};
describe("exclusive retained replay route cross-product", () => {
	for (const mode of [
		"standard",
		"retirement-ui-setup",
		"retirement-seed-replay",
	])
		for (const proof of [false, true])
			for (const observeOnly of [false, true])
				for (const supplied of [false, true]) {
					it(`${mode} proof=${proof} observer=${observeOnly} supplied=${supplied}`, () => {
						const actual =
							route(mode, proof, {
								...(supplied ? replayInputs : {}),
								REPLAY_OBSERVE_ONLY_JSON: JSON.stringify(observeOnly),
							}).status === 0;
						const expected =
							mode === "retirement-seed-replay"
								? !proof && supplied
								: !supplied && !observeOnly && (mode === "standard" || !proof);
						expect(actual).toBe(expected);
						const replayEligible =
							actual &&
							evaluate(
								"retirement-seed-replay",
								"workflow_dispatch",
								mode,
								proof,
							);
						expect(replayEligible).toBe(
							expected && mode === "retirement-seed-replay",
						);
						if (mode === "retirement-seed-replay")
							for (const app of ["changes", "credentials"])
								expect(evaluate(app, "workflow_dispatch", mode, proof)).toBe(
									false,
								);
					});
				}
	it.each([
		...[
			"REPLAY_COMPILE_RUN",
			"REPLAY_RUNNER_ARTIFACT",
			"REPLAY_RUNNER_SOURCE",
		].map((key) => [key, ""]),
		["REPLAY_COMPILE_RUN", "0"],
		["REPLAY_COMPILE_RUN", "-1"],
		["REPLAY_COMPILE_RUN", "9007199254740992"],
		["REPLAY_RUNNER_ARTIFACT", "01"],
		["REPLAY_RUNNER_SOURCE", "d".repeat(40)],
		["REPLAY_OBSERVE_ONLY_JSON", '"false"'],
		["REPLAY_OBSERVE_ONLY_JSON", "null"],
	])("refuses malformed/missing %s=%s", (key, value) => {
		expect(
			route("retirement-seed-replay", false, {
				...replayInputs,
				[key!]: value!,
			}).status,
		).not.toBe(0);
	});
	it.each(["pull_request", "push"])(
		"%s never enters the replay lane",
		(event) => {
			expect(
				evaluate(
					"retirement-seed-replay",
					event,
					"retirement-seed-replay",
					false,
				),
			).toBe(false);
			expect(evaluate("changes", event, "retirement-seed-replay", false)).toBe(
				true,
			);
		},
	);
	it("reusable invokes only the outer watchdog, fixed root, same-budget fallback and evidence-only short retention", () => {
		expect(block("retirement-seed-replay")).toContain("needs: manual-mode");
		expect(block("retirement-seed-replay")).toContain("actions: read");
		const child = readFileSync(
			new URL(
				"../../.github/workflows/retirement-ui-seed-replay.yml",
				import.meta.url,
			),
			"utf8",
		);
		expect(child).toContain("workflow_call:");
		expect(child).not.toContain("workflow_dispatch:");
		expect(child).toContain("-retirement-seed-replay-");
		expect(child).toContain("cancel-in-progress: false");
		expect(child).toContain("timeout-minutes: 12");
		expect(
			child.match(/retirement-replay-watchdog.py --mode run --root/g),
		).toHaveLength(1);
		expect(
			child.match(/retirement-replay-watchdog.py --mode cleanup --root/g),
		).toHaveLength(1);
		expect(
			child.match(/--root "\$RUNNER_TEMP\/retirement-seed-replay"/g),
		).toHaveLength(2);
		expect(child).toContain(
			"if: always() && steps.replay.outcome != 'skipped'",
		);
		expect(child).toContain("/retirement-seed-replay/evidence/**");
		expect(child).toContain("retention-days: 1");
		expect(child).not.toMatch(
			/continue-on-error|setup-node|pnpm|npm |pod install|expo|build-for-testing|test-without-building|simctl/,
		);
		expect(child).not.toContain("node scripts/ci/retirement-ui-replay.ts");
	});
});

it("failed manual validation blocks even standard app jobs with malformed replay fields", () => {
	expect(route("standard", false, replayInputs).status).not.toBe(0);
	expect(
		evaluate(
			"changes",
			"workflow_dispatch",
			"standard",
			false,
			"true",
			"refs/heads/main",
			"failure",
		),
	).toBe(false);
	expect(block("changes")).toContain("needs: manual-mode");
	for (const event of ["pull_request", "push"])
		expect(
			evaluate(
				"changes",
				event,
				undefined,
				undefined,
				"true",
				"refs/heads/main",
				"skipped",
			),
		).toBe(true);
});
