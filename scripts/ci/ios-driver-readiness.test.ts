import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
const workflow = readFileSync(`${root}.github/workflows/e2e.yml`, "utf8");
const helper = readFileSync(
	`${root}scripts/ci/ios-driver-readiness.py`,
	"utf8",
);
const PRODUCT_STEPS =
	/download-artifact|native-artifact|xcodebuild|expo|pnpm|Operator\.app|chrome-ios-proof\.ts/;
const JOB_CONDITION = /^ {4}if: (.+)$/m;
const CLEANUP_ALWAYS = /Unconditional exact-owner teardown\n {8}if: always\(\)/;
const UPLOAD_ALWAYS = /uses: actions\/upload-artifact@v6\n {8}if: always\(\)/;
const PROHIBITED_OPERATIONS =
	/simctl", "(?:install|launch)"|MAESTRO_DRIVER_STARTUP_TIMEOUT|--retry|pkill/;
const jobs = new Map(
	[
		...workflow
			.split("\njobs:\n")[1]
			.matchAll(/^ {2}([\w-]+):\n([\s\S]*?)(?=^ {2}[\w-]+:\n|(?![\s\S]))/gm),
	].map(([_, name, body]) => [name, body]),
);

// These are deliberately workflow/source contracts, not evidence that XCTest
// boots. The Python matrix drives the real HTTP transport against mock endpoints.
describe("app-free iOS driver operation", () => {
	it("passes HTTP/ownership/teardown negative controls without native tools", () => {
		const result = spawnSync(
			"python3",
			["scripts/ci/ios-driver-readiness-test.py"],
			{
				cwd: root,
				encoding: "utf8",
				timeout: 60_000,
			},
		);
		expect(result.stderr, result.stdout).toContain("OK");
		expect(result.status, result.stderr).toBe(0);
	}, 65_000);

	it("is dispatch-only and separate from every application job", () => {
		const job = jobs.get("ios-driver-readiness");
		expect(job).toBeDefined();
		expect(job).toContain("needs: harness");
		expect(job).toContain(
			"if: github.event_name == 'workflow_dispatch' && inputs.proof_mode == 'ios-driver-readiness'",
		);
		expect(job).toContain("runs-on: macos-26");
		expect(job).toContain("uses: ./.github/actions/install-maestro");
		expect(job).not.toMatch(PRODUCT_STEPS);
		const selected = (event: string, mode: string) =>
			[...jobs]
				.filter(([, body]) => {
					const condition = body.match(JOB_CONDITION)?.[1] ?? "true";
					// These job conditions use only JS-compatible equality/boolean operators,
					// string literals and always(). Unknown Actions syntax fails the test.
					return runInNewContext(
						condition,
						{
							github: { event_name: event },
							inputs: { proof_mode: mode },
							always: () => true,
						},
						{ timeout: 1000 },
					);
				})
				.map(([name]) => name);
		expect(selected("workflow_dispatch", "ios-driver-readiness")).toEqual([
			"harness",
			"ios-driver-readiness",
		]);
		for (const event of ["push", "pull_request", "schedule"]) {
			expect(selected(event, "")).not.toContain("ios-driver-readiness");
		}
		expect(workflow).toContain(
			'ios-driver-readiness) test "$GITHUB_EVENT_NAME" = workflow_dispatch; test "$PROOF_STAGE" = full ;;',
		);
	});

	it("keeps the deadlines, single launch, logs and unconditional cleanup", () => {
		const job = jobs.get("ios-driver-readiness") ?? "";
		expect(job).toMatch(CLEANUP_ALWAYS);
		expect(job).toMatch(UPLOAD_ALWAYS);
		expect(job).toContain("--cleanup");
		expect(job).toContain("*.jsonl");
		expect(helper).toContain("STARTUP_SECONDS = 120");
		expect(helper).toContain("HIERARCHY_SECONDS = 120");
		expect(helper).toContain('"test-without-building"');
		expect(helper).not.toMatch(PROHIBITED_OPERATIONS);
		expect(helper).toContain('"hierarchy", "viewHierarchy"');
		expect(helper).toContain('"status", "status"');
	});
});
