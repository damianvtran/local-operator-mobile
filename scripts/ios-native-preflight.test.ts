import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const JOB_BOUNDARY = /\n {2}[a-z][\w-]*:\n/;
const COMMENT_LINE = /^\s*#.*$/gm;
const JOB_GUARD = /^ {4}if: (.*)$/m;
const FOLDED_GUARD = /^ {4}if: >-\n((?: {6}.+\n)+)/m;
const MANUAL_DISPATCH = /^ {2}workflow_dispatch:$/m;
const SECRET_OR_UPLOAD = /secrets\.|environment:|fastlane|gh release/;
const UPLOAD_GUARD = /^ {8}if: >-\n((?: {10}.+\n)+)/m;
const SHARED_ACTION = "uses: ./.github/actions/ios-signed-ipa";
const read = (path: string): string =>
	readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const workflow = (name: string): string =>
	read(`.github/workflows/${name}.yml`);

/** Source guards complement hosted execution. Comments must not masquerade as
 * executable steps, and guard mutations must fail without touching real secrets.
 */
function job(source: string, name: string): string {
	const body = source.split(`\n  ${name}:\n`)[1];
	if (!body) throw new Error(`missing job ${name}`);
	return (body.split(JOB_BOUNDARY)[0] ?? "").replace(COMMENT_LINE, "");
}
function guard(body: string): string {
	return (
		body.match(FOLDED_GUARD)?.[1]?.trim() ?? body.match(JOB_GUARD)?.[1] ?? ""
	);
}
function installsPodsBeforeResolution(body: string): boolean {
	const prebuild = body.indexOf(
		"run: pnpm exec expo prebuild --platform ios --clean --no-install",
	);
	const pods = body.indexOf("run: cd ios && pod install");
	const resolve = body.indexOf(
		"run: node scripts/ci/ios-project.ts --root ios",
	);
	return prebuild >= 0 && pods > prebuild && resolve > pods;
}
function authorized(
	expression: string,
	event: string,
	ref: string,
	exported = false,
	upload = false,
	variable = "",
): boolean {
	// This subset uses the same &&/||/== operands in JavaScript and Actions.
	// No API or real workflow dispatch is performed by this truth-table test.
	return (
		runInNewContext(
			expression,
			{
				github: { event_name: event, ref },
				inputs: { signed_export_only: exported, testflight_upload: upload },
				vars: { IOS_INTERNAL_UPLOAD: variable },
				needs: {
					changes: { outputs: { native: "true" } },
					credentials: { outputs: { all_present: "true" } },
				},
			},
			{ timeout: 100 },
		) === true
	);
}

describe("hosted iOS native preflight boundaries", () => {
	it("executes all Fastfile paths from the actual fastlane lane cwd", () => {
		const result = spawnSync("ruby", ["scripts/ci/fastlane-path-test.rb"], {
			encoding: "utf8",
			timeout: 15_000,
		});
		expect(result.stdout).toContain("PASS negative control");
		expect(result.stdout).toContain("PASS Fastfile lanes from fastlane/");
		expect(result.status, result.stderr).toBe(0);
	});
	it("exercises profile/entitlement, certificate and failed-cleanup controls without Apple access", () => {
		const result = spawnSync("python3", ["scripts/ci/ios-signing-test.py"], {
			encoding: "utf8",
			timeout: 15_000,
			env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
		});
		expect(result.stderr).toContain("OK");
		expect(result.status).toBe(0);
	});
	it.each([
		["release", "ios"],
		["ios", "ios"],
		["ios", "internal"],
	])("%s/%s installs pods before reading its workspace", (file, name) => {
		const body = job(workflow(file), name);
		expect(installsPodsBeforeResolution(body)).toBe(true);
		expect(
			installsPodsBeforeResolution(
				body.replace("run: cd ios && pod install", "run: echo omitted"),
			),
		).toBe(false);
	});
	it("both signed paths use one cleanup-protected manual-signing action", () => {
		for (const [file, name] of [
			["ios", "internal"],
			["release", "ios"],
		] as const) {
			const body = job(workflow(file), name);
			expect(body).toContain(SHARED_ACTION);
			expect(body).not.toContain("xcodebuild -exportArchive");
			expect(body).toContain("APPLE_DIST_CERT_P12_BASE64");
			expect(body).toContain("APPLE_DIST_CERT_PASSWORD");
		}
		const action = read(".github/actions/ios-signed-ipa/action.yml");
		expect(action).toContain("if: always()");
		expect(action).toContain("python3 scripts/ci/ios-signing.py cleanup");
		expect(action).not.toContain("-allowProvisioningUpdates");
		expect(action).not.toContain("CODE_SIGN_IDENTITY=");
		const fastlane = read("fastlane/Fastfile");
		expect(fastlane).toContain("targets: [target.name]");
		expect(fastlane).toContain('build_configurations: ["Release"]');
		expect(fastlane).toContain("readonly: true");
		expect(fastlane).toContain("use_automatic_signing: false");
		for (const file of ["ios", "release"]) {
			const body = job(workflow(file), "credentials");
			expect(body).toContain(
				"APPLE_DIST_CERT_P12_BASE64,APPLE_DIST_CERT_PASSWORD",
			);
		}
	});
	it("default dispatch and forks remain unsigned and isolated", () => {
		const source = workflow("ios");
		expect(source).toMatch(MANUAL_DISPATCH);
		expect(source).toContain("permissions:\n  contents: read");
		const simulator = job(source, "ios");
		expect(simulator).toContain("CODE_SIGNING_ALLOWED=NO");
		expect(simulator).toContain("xcrun simctl launch");
		expect(simulator).not.toMatch(SECRET_OR_UPLOAD);
		for (const name of ["credentials", "internal"]) {
			const expression = guard(job(source, name));
			expect(
				authorized(expression, "workflow_dispatch", "refs/heads/main"),
			).toBe(false);
			expect(authorized(expression, "push", "refs/heads/main")).toBe(false);
			expect(
				authorized(
					expression,
					"pull_request",
					"refs/pull/1/merge",
					true,
					true,
					"true",
				),
			).toBe(false);
			expect(
				authorized(
					expression,
					"workflow_dispatch",
					"refs/heads/feature",
					true,
					true,
				),
			).toBe(false);
			expect(
				authorized(expression, "workflow_dispatch", "refs/heads/main", true),
			).toBe(true);
			expect(
				authorized(
					expression,
					"workflow_dispatch",
					"refs/heads/main",
					false,
					true,
				),
			).toBe(true);
			expect(
				authorized(expression, "push", "refs/heads/main", false, false, "true"),
			).toBe(true);
			const unsafe = expression.replace(
				"github.ref == 'refs/heads/main' && ",
				"",
			);
			expect(
				authorized(unsafe, "workflow_dispatch", "refs/heads/feature", true),
			).toBe(true);
		}
	});
	it("export-only takes precedence; upload requires its own opt-in", () => {
		const internal = job(workflow("ios"), "internal");
		const expression = internal.match(UPLOAD_GUARD)?.[1]?.trim() ?? "";
		expect(expression).not.toBe("");
		expect(
			authorized(
				expression,
				"workflow_dispatch",
				"refs/heads/main",
				true,
				true,
			),
		).toBe(false);
		expect(
			authorized(
				expression,
				"workflow_dispatch",
				"refs/heads/main",
				false,
				true,
			),
		).toBe(true);
		expect(authorized(expression, "workflow_dispatch", "refs/heads/main")).toBe(
			false,
		);
		expect(authorized(expression, "push", "refs/heads/main")).toBe(false);
		expect(
			authorized(expression, "push", "refs/heads/main", false, false, "true"),
		).toBe(true);
		expect(
			authorized(
				expression.replace("inputs.signed_export_only != true && ", ""),
				"workflow_dispatch",
				"refs/heads/main",
				true,
				true,
			),
		).toBe(true);
	});
	it("release dry-run excludes native builds and publishing (not prose)", () => {
		for (const name of ["gate", "android", "ios", "publish"]) {
			expect(guard(job(workflow("release"), name))).toContain(
				"inputs.dry_run != true",
			);
		}
	});
	// fastlane 2.242.0 has no Linux uploader (Helper.itms_path is "" off macOS), so
	// v0.1.1's TestFlight step on ubuntu-latest died with ENOENT after the Release
	// existed (run 46097429989). These pin the shape of the fix so a tidy-up cannot
	// move the upload back to the Linux job.
	it("uploads to TestFlight from a macOS job that runs after the Release", () => {
		const release = workflow("release");
		const testflight = job(release, "testflight");
		expect(testflight).toContain("runs-on: macos-26");
		expect(testflight).toMatch(/needs: \[[^\]]*\bpublish\b[^\]]*\]/);
		expect(guard(testflight)).toContain("'ios'");
		expect(testflight).toContain("name: ios-ipa");
		expect(testflight).toContain("bundle exec fastlane ios testflight");
		expect(testflight).toContain(
			"LO_IOS_IPA_DIR: ${{ github.workspace }}/artifacts",
		);
		// The key is removed even when the lane fails.
		expect(testflight).toMatch(
			/if: always\(\)\n\s+run: rm -f "\$RUNNER_TEMP\/asc-api-key\.p8"/,
		);
	});
	it("keeps the Linux publish job free of the TestFlight upload and Apple key", () => {
		const publish = job(workflow("release"), "publish");
		expect(publish).toContain("runs-on: ubuntu-latest");
		expect(publish).toContain("gh release create");
		expect(publish).not.toContain("ios testflight");
		expect(publish).not.toContain("APPLE_ASC");
		expect(publish).not.toContain("asc-api-key");
	});
	it("reports the testflight job's own result in the release summary", () => {
		const summary = job(workflow("release"), "summary");
		expect(summary).toContain(
			"TESTFLIGHT_OUTCOME: ${{ needs.testflight.result }}",
		);
		expect(summary).toMatch(/needs: \[[^\]]*\btestflight\b[^\]]*\]/);
	});
	it("keeps the v0.1.1 recovery dispatch-only, verify-only by default and pinned", () => {
		const source = workflow("recover-v011-testflight");
		expect(source).toMatch(/^on:\n {2}workflow_dispatch:\n/m);
		expect(source).not.toMatch(
			/^ {2}(push|pull_request|schedule|workflow_run):/m,
		);
		expect(source).toMatch(/upload:\n(?: {8}.+\n)*? {8}default: false\n/);
		expect(source).toContain("tag=v0.1.1");
		expect(source).toContain("commit=baf13e4c690ebc2653f9fee4f4aa8c0542b83c52");
		expect(source).toContain(
			"digest=e4b578aa263be8389a9b4e07d5914c35ea091178915d9bb5e7cfaaea9a8b12b9",
		);
		expect(source).toContain("recovery_version:0.1.1 recovery_build:1700");
		// Nothing left over from the v0.1.0 pins it was copied from.
		expect(source).not.toMatch(/0\.1\.0|1517|43efeb6b/);
	});
	it("declares OS-only encryption after dependency audit", () => {
		expect(read("app.config.ts")).toContain(
			"ITSAppUsesNonExemptEncryption: false",
		);
	});
});
