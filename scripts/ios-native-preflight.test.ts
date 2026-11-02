import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const JOB_BOUNDARY = /\n {2}[a-z][\w-]*:\n/;
const COMMENT_LINE = /^\s*#.*$/gm;
const JOB_GUARD = /^ {4}if: (.*)$/m;
const MANUAL_DISPATCH = /^ {2}workflow_dispatch:$/m;
const SECRET_OR_UPLOAD = /secrets\.|environment:|fastlane|gh release/;

const workflow = (name: string): string =>
	readFileSync(
		new URL(`../.github/workflows/${name}.yml`, import.meta.url),
		"utf8",
	);

/** These source-contract guards complement, not simulate, the hosted build.
 * Missing pods used to fail before signing on a fresh release runner. Matching
 * executable step lines (not comments) makes the negative control discriminating.
 */
function job(source: string, name: string): string {
	const body = source.split(`\n  ${name}:\n`)[1];
	if (!body) throw new Error(`missing job ${name}`);
	return (body.split(JOB_BOUNDARY)[0] ?? "").replace(COMMENT_LINE, "");
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

/** Secret-bearing jobs must remain unreachable for a manual dispatch on main
 * as well as a fork PR. Environment protection alone does not make it build-only.
 */
function isPushMainOnly(body: string): boolean {
	const guard = body.match(JOB_GUARD)?.[1] ?? "";
	return (
		guard.includes("github.event_name == 'push'") &&
		guard.includes("github.ref == 'refs/heads/main'") &&
		!guard.includes("||")
	);
}

describe("hosted iOS native preflight boundaries", () => {
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

	it("rejects installing pods before a clean prebuild would delete them", () => {
		expect(
			installsPodsBeforeResolution(
				"run: cd ios && pod install\n" +
					"run: pnpm exec expo prebuild --platform ios --clean --no-install\n" +
					"run: node scripts/ci/ios-project.ts --root ios",
			),
		).toBe(false);
	});

	it("manual dispatch reuses the unsigned simulator job without secret access", () => {
		const source = workflow("ios");
		expect(source).toMatch(MANUAL_DISPATCH);
		expect(source).toContain("permissions:\n  contents: read");
		const simulator = job(source, "ios");
		expect(simulator).toContain("CODE_SIGNING_ALLOWED=NO");
		expect(simulator).toContain("xcrun simctl launch");
		expect(simulator).not.toMatch(SECRET_OR_UPLOAD);
		for (const name of ["credentials", "internal"]) {
			const body = job(source, name);
			expect(isPushMainOnly(body)).toBe(true);
			expect(
				isPushMainOnly(body.replace("github.event_name == 'push' && ", "")),
			).toBe(false);
		}
	});

	it("release dry-run explicitly excludes native builds and publishing", () => {
		const source = workflow("release");
		for (const name of ["gate", "android", "ios", "publish"]) {
			expect(job(source, name).match(JOB_GUARD)?.[1]).toContain(
				"inputs.dry_run != true",
			);
		}
		expect(source).toContain(
			"Check version and credential presence only; no full gate, build or upload",
		);
	});
});
