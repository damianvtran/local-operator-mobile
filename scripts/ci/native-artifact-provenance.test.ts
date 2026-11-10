/**
 * Negative controls for the chrome proof's artifact provenance gate, run
 * through the REAL CLI on GitHub metadata captured from the actual runs
 * (`fixtures/native-artifact-provenance/`, fetched 2026-11-10 with
 * `gh api repos/damianvtran/local-operator-mobile/actions/runs/<id>[/artifacts]`
 * and trimmed to the fields the gate reads). No token, no network.
 *
 * The red case is the real incident: chrome-proof run 42789156345 meant to
 * prove PR #216 (head d5886f8f at capture time) and installed run
 * 41506698136's build of feat/i18n-project-create@91a3cbca instead.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const here = (path: string) => new URL(path, import.meta.url).pathname;
const CLI = here("./native-artifact-provenance.ts");
const FIX = here("./fixtures/native-artifact-provenance/");
const REPO = "damianvtran/local-operator-mobile";

/* The three real builds. */
const STALE = {
	run: "41506698136",
	sha256: "080c27c8554638317baafbea91a163b049ead1ecdf7c3f78194d31e037c1c1fe",
	source: "91a3cbca1a2770e78dc5f216c2335b4b8126fe4d",
	files: [
		"stale-project-create-run-41506698136.json",
		"stale-project-create-artifacts-41506698136.json",
	],
};
const PR216 = {
	run: "42812463730",
	sha256: "ef7d9ddaa64329142c15fa04c2ebb8e30f48d717c52d62e8707fce113dd96975",
	source: "d5886f8fc4448b10ac16f677d39d81077130ef0d",
	files: ["pr216-run-42812463730.json", "pr216-artifacts-42812463730.json"],
};
const MAIN = {
	run: "42811945754",
	sha256: "c324d12290e4c7b57116a29a7d8249ae3a6059c179f0e4f610b36367e4d6b567",
	source: "5fb51be02bbb22b39e42f24b50e70b6e51ded18b",
	files: ["main-run-42811945754.json", "main-artifacts-42811945754.json"],
};
type Build = typeof PR216;

const NEXT_JOB = /\n {2}[a-z0-9-]+:\n/;
const NATIVE_SOURCE_INPUT =
	/\n {6}native_source_sha:\n(?: {8}.*\n)*? {8}default: ""\n/;
const BASE_SOURCE_INPUT =
	/\n {6}base_source_sha:\n(?: {8}.*\n)*? {8}default: ""\n/;
/* The runner's env reads the gate's validated provenance output, verbatim. */
const PROVENANCE_ENV =
	/PROOF_PROVENANCE: \$\{\{ needs\.chrome-ios-provenance\.outputs\.provenance \}\}/;

const cli = (args: string[]) => {
	const result = spawnSync(process.execPath, [CLI, ...args], {
		encoding: "utf8",
		env: { NODE_ENV: "test", PATH: process.env.PATH ?? "" },
	});
	return { rc: result.status, out: result.stdout, err: result.stderr };
};
const side = (
	role: "after" | "before",
	build: Build,
	source = build.source,
	files = build.files.map((name) => join(FIX, name)),
) => [
	`--${role}-run-id`,
	build.run,
	`--${role}-sha256`,
	build.sha256,
	`--${role}-source-sha`,
	source,
	`--${role}-run`,
	files[0] as string,
	`--${role}-artifacts`,
	files[1] as string,
];
const verify = (...extra: string[]) =>
	cli(["verify", "--repo", REPO, "--after-name", "ios-simulator", ...extra]);

describe("chrome proof artifact provenance (run 42789156345 regression)", () => {
	it("rejects the stale project-create artifact when PR #216's head is the intended source", () => {
		const { rc, err } = verify(...side("after", STALE, PR216.source));
		expect(rc).toBe(1);
		expect(err).toContain("STALE OR UNRELATED BUILD");
		expect(err).toContain(`feat/i18n-project-create@${STALE.source}`);
		expect(err).toContain(`expected source ${PR216.source}`);
	});

	it("accepts the artifact built for the intended head and records intended vs actual", () => {
		const root = mkdtempSync(join(tmpdir(), "provenance-"));
		try {
			const out = join(root, "p.json");
			const { rc, out: stdout } = verify(...side("after", PR216), "--out", out);
			expect(rc).toBe(0);
			expect(stdout).toContain("fix/keyboard-composer-bound@d5886f8f");
			const [after] = JSON.parse(readFileSync(out, "utf8"));
			expect(after.intended).toEqual({
				runId: PR216.run,
				artifactName: "ios-simulator",
				sha256: PR216.sha256,
				sourceSha: PR216.source,
			});
			expect(after.actual).toMatchObject({
				artifactId: 13765198900,
				event: "pull_request",
				workflowPath: ".github/workflows/ios.yml",
				// A pull_request build compiled the merge ref, and the receipt says so.
				compiled: {
					kind: "pull_request-merge",
					headSha: PR216.source,
					ref: "refs/pull/216/merge",
				},
			});
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("refuses the old defaults-only dispatch (no source sha) before any metadata is read", () => {
		const { rc, err } = cli([
			"inputs",
			"--after-run-id",
			STALE.run,
			"--after-name",
			"ios-simulator",
			"--after-sha256",
			STALE.sha256,
		]);
		expect(rc).toBe(1);
		expect(err).toContain("native_source_sha must all be given explicitly");
		expect(err).toContain(
			"a digest alone authenticates bytes, not the revision",
		);
	});

	it("refuses metadata that carries no artifact source revision", () => {
		const root = mkdtempSync(join(tmpdir(), "provenance-"));
		try {
			const artifacts = JSON.parse(
				readFileSync(join(FIX, PR216.files[1] as string), "utf8"),
			);
			delete artifacts.artifacts[0].workflow_run.head_sha;
			const stripped = join(root, "artifacts.json");
			writeFileSync(stripped, JSON.stringify(artifacts));
			const { rc, err } = verify(
				...side("after", PR216, PR216.source, [
					join(FIX, PR216.files[0] as string),
					stripped,
				]),
			);
			expect(rc).toBe(1);
			expect(err).toContain("artifact records source <missing>");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("accepts a deliberate before/after pair (main push build before, PR build after)", () => {
		const { rc, out } = verify(
			...side("after", PR216),
			...side("before", MAIN),
		);
		expect(rc).toBe(0);
		expect(out).toContain(
			`before run ${MAIN.run} push main@${MAIN.source} artifact 13765833742 (head)`,
		);
	});

	it("refuses a half-specified or degenerate before build", () => {
		const half = verify(
			...side("after", PR216),
			"--before-run-id",
			MAIN.run,
			"--before-sha256",
			MAIN.sha256,
		);
		expect(half.rc).toBe(1);
		expect(half.err).toContain("base_source_sha must all be given explicitly");
		const same = verify(...side("after", PR216), ...side("before", PR216));
		expect(same.rc).toBe(1);
		expect(same.err).toContain("same run");
		// The stale build as a "before" of the wrong revision is caught the same way.
		const wrong = verify(
			...side("after", PR216),
			...side("before", STALE, MAIN.source),
		);
		expect(wrong.rc).toBe(1);
		expect(wrong.err).toContain(
			"before artifact (run 41506698136): STALE OR UNRELATED BUILD",
		);
	});
});

describe("e2e.yml wires the gate before the macOS job", () => {
	const workflow = readFileSync(
		here("../../.github/workflows/e2e.yml"),
		"utf8",
	);
	const job = (name: string) => {
		const start = workflow.indexOf(`\n  ${name}:\n`);
		expect(start).toBeGreaterThan(0);
		const next = workflow.slice(start + 1).search(NEXT_JOB);
		return workflow.slice(start, next === -1 ? undefined : start + 1 + next);
	};
	it("requires an explicit source sha with no default", () => {
		expect(workflow).toMatch(NATIVE_SOURCE_INPUT);
		expect(workflow).toMatch(BASE_SOURCE_INPUT);
	});
	it("validates on Ubuntu, and the macOS job installs only the validated artifact ids", () => {
		const gate = job("chrome-ios-provenance");
		expect(gate).toContain("runs-on: ubuntu-latest");
		expect(gate).toContain("native-artifact-provenance.ts inputs");
		expect(gate).toContain("native-artifact-provenance.ts verify");
		const proof = job("chrome-ios-proof");
		expect(proof).toContain("needs: [harness, chrome-ios-provenance]");
		expect(proof).toContain(
			"needs.chrome-ios-provenance.outputs.after_artifact_id",
		);
		expect(proof).toMatch(PROVENANCE_ENV);
		// No second, unvalidated artifact lookup by run id on the macOS runner.
		expect(proof).not.toContain("/actions/runs/");
	});
});
