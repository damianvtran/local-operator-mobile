import { readdirSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";

const read = (path: string) =>
	readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const ci = read(".github/workflows/ci.yml");
const qa =
	ci.split("  team-bridge-qa:\n")[1]?.split("  release-staging:\n")[0] ?? "";

it("opts in only the PR-only, isolated web export step", () => {
	expect(qa).toContain("if: github.event_name == 'pull_request'");
	expect(qa).toContain("if: steps.fixture.outputs.needed == 'true'");
	expect(qa).toContain(
		'env:\n          EXPO_PUBLIC_TEAM_BRIDGE_FIXTURES: "1"\n        run: pnpm export:web --output-dir team-bridge-qa-dist',
	);
	expect(ci.match(/EXPO_PUBLIC_TEAM_BRIDGE_FIXTURES/g)).toHaveLength(1);
	const production = ci.split("  team-bridge-qa:\n")[0];
	expect(production).toContain("run: pnpm export:web\n");
	expect(production).toContain("name: web-export\n          path: dist\n");
});

it("records the compiled merge checkout, PR head and every exported file hash", () => {
	for (const text of [
		"github.event.pull_request.head.sha",
		"git rev-parse HEAD > team-bridge-qa-dist/COMPILED_COMMIT_SHA",
		"team-bridge-qa-dist/PR_HEAD_SHA",
		"sha256sum > SHA256SUMS",
		"name: team-bridge-qa-web-export",
		"path: team-bridge-qa-dist",
		"if-no-files-found: error",
	])
		expect(qa).toContain(text);
});

it("preserves hidden Expo assets only within the generated QA export", () => {
	const upload = qa.split("      - uses: actions/upload-artifact@v7\n")[1];
	expect(upload).toBeDefined();
	// Exact single-directory scope keeps hidden source/home/credential files out;
	// Expo's generated .pnpm asset paths must survive the SHA256SUMS upload intact.
	expect(upload).toContain(
		"          name: team-bridge-qa-web-export\n          path: team-bridge-qa-dist\n          include-hidden-files: true\n",
	);
	expect(upload?.match(/^\s+path:/gm)).toHaveLength(1);
	expect(ci.replace(qa, "")).not.toContain("include-hidden-files:");
});

it("keeps fixtures out of every native/release workflow and artifact consumer", () => {
	for (const name of readdirSync(
		new URL("../../.github/workflows/", import.meta.url),
	)) {
		if (name === "ci.yml") continue;
		const workflow = read(`.github/workflows/${name}`);
		for (const marker of [
			"EXPO_PUBLIC_TEAM_BRIDGE_FIXTURES",
			"team-bridge-qa-web-export",
			"team-bridge-qa-dist",
		]) {
			expect(workflow, name).not.toContain(marker);
			expect(ci.replace(qa, "")).not.toContain(marker);
		}
	}
	expect(qa).not.toContain("download-artifact");
});

const FIXTURE_SELECTOR = /grep -Eq '([^']+)'/;

// Exercise the actual workflow selector rather than maintaining a parallel path
// allowlist: #106 attachment/source changes must produce the opted-in artifact.
it("selects attachment PR paths without selecting documentation-only changes", () => {
	const expression = qa.match(FIXTURE_SELECTOR)?.[1];
	if (!expression) throw new Error("fixture selector missing");
	const selected = new RegExp(expression);
	for (const path of [
		"src/features/team-bridge/attachment-source.ts",
		"src/features/team-bridge/attachment-draft.ts",
		"src/testing/team-bridge-attachment-source.ts",
		"src/team-bridge/attachments.ts",
		"src/i18n/catalogues/ur/mobile.team_bridge.json",
	])
		expect(selected.test(path), path).toBe(true);
	expect(selected.test("docs/ci.md")).toBe(false);
});
