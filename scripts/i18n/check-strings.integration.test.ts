import { execFileSync, spawnSync } from "node:child_process";
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// A real Git base ensures neither the worktree scanner nor its catalogue can
// silently substitute for the historical inputs used to classify debt.
const root = process.cwd();
const fingerprintsPattern =
	/scanner sha256: base=[0-9a-f]{64} head=[0-9a-f]{64}/;
const nextJob = /\n {2}[a-z][\w-]*:/;
const fullCheckout =
	/actions\/checkout@v7\s+with:\s+(?:#[^\n]*\n\s*)*fetch-depth:\s*0/;
const isolated = (cwd: string) => ({
	HOME: cwd,
	NODE_ENV: "test" as const,
	PATH: process.env.PATH,
	LOCAL_OPERATOR_SCRATCHPAD: process.env.LOCAL_OPERATOR_SCRATCHPAD,
	GIT_CONFIG_SYSTEM: "/dev/null",
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_TERMINAL_PROMPT: "0",
});
const git = (cwd: string, ...args: string[]) =>
	execFileSync("git", args, { cwd, stdio: "pipe", env: isolated(cwd) });
function fixture(): string {
	const dir = mkdtempSync(
		join(process.env.LOCAL_OPERATOR_SCRATCHPAD ?? tmpdir(), "i18n-test-"),
	);
	mkdirSync(join(dir, "scripts/i18n"), { recursive: true });
	mkdirSync(join(dir, "src/i18n/catalogues/en"), { recursive: true });
	writeFileSync(join(dir, "src/i18n/catalogues/en/messages.json"), "{}\n");
	writeFileSync(
		join(dir, "src/example.tsx"),
		"<Text>Old visible copy</Text>\n" +
			Array.from(
				{ length: 27 },
				(_, i) => `<Card headline="Historical headline ${i}" />`,
			).join("\n"),
	);
	writeFileSync(
		join(dir, "scripts/i18n/strings-baseline.json"),
		JSON.stringify({
			findings: [
				{
					file: "src/example.tsx",
					text: "Old visible copy",
					owner: "test",
					payoff: "key",
				},
			],
		}),
	);
	for (const name of ["check-strings.ts", "scan-strings.ts", "ratchet.ts"])
		cpSync(join(root, "scripts/i18n", name), join(dir, "scripts/i18n", name));
	const scanner = join(dir, "scripts/i18n/scan-strings.ts");
	const current = readFileSync(scanner, "utf8");
	writeFileSync(
		scanner,
		current.replace(
			"|headline|next|subtitle|caption|body|message|hint|description|detail",
			"",
		),
	);
	git(dir, "init", "-q");
	git(dir, "add", ".");
	git(
		dir,
		"-c",
		"user.name=Test",
		"-c",
		"user.email=test@example.invalid",
		"commit",
		"-qm",
		"base",
	);
	writeFileSync(scanner, current);
	return dir;
}
function run(dir: string, ...args: string[]) {
	return spawnSync(
		process.execPath,
		["scripts/i18n/check-strings.ts", ...args],
		{ cwd: dir, encoding: "utf8", env: isolated(dir) },
	);
}
const update = (dir: string) =>
	run(
		dir,
		"--base",
		"HEAD",
		"--update",
		"--owner",
		"test",
		"--payoff",
		"key it",
	);
const baseline = (dir: string) =>
	JSON.parse(
		readFileSync(join(dir, "scripts/i18n/strings-baseline.json"), "utf8"),
	);

describe("historical scanner migration in Git", () => {
	it("supplies full history to the release gate and checks a shallow tag checkout", () => {
		const workflow = readFileSync(
			join(root, ".github/workflows/ci.yml"),
			"utf8",
		);
		const checks = workflow.split("\n  checks:")[1]?.split(nextJob)[0] ?? "";
		expect(checks).toMatch(fullCheckout);
		const dir = fixture();
		git(dir, "branch", "-M", "main");
		expect(update(dir).status).toBe(0);
		git(dir, "add", ".");
		git(
			dir,
			"-c",
			"user.name=Test",
			"-c",
			"user.email=test@example.invalid",
			"commit",
			"-qm",
			"release",
		);
		git(dir, "tag", "v1.0.0");
		const dest = join(
			process.env.LOCAL_OPERATOR_SCRATCHPAD ?? tmpdir(),
			`i18n-tag-${Date.now()}-${process.pid}`,
		);
		git(
			dir,
			"clone",
			"--depth=1",
			"--single-branch",
			"--branch",
			"v1.0.0",
			`file://${dir}`,
			dest,
		);
		const before = run(dest);
		expect(before.status).not.toBe(0);
		expect(before.stderr).toContain("Cannot resolve base");
		// checkout@v7 with fetch-depth: 0 fetches branch refs and complete history.
		git(
			dest,
			"fetch",
			"--unshallow",
			"origin",
			"+refs/heads/*:refs/remotes/origin/*",
		);
		const after = run(dest);
		expect(after.status, after.stderr).toBe(0);
		expect(after.stdout).toContain("0 new");
		const eventPath = join(dest, "event.json");
		const baseSha = git(dest, "rev-parse", "HEAD^").toString().trim();
		const prRun = () =>
			spawnSync(process.execPath, ["scripts/i18n/check-strings.ts"], {
				cwd: dest,
				encoding: "utf8",
				env: {
					...isolated(dest),
					GITHUB_EVENT_NAME: "pull_request",
					GITHUB_EVENT_PATH: eventPath,
				},
			});
		writeFileSync(
			eventPath,
			JSON.stringify({ pull_request: { base: { sha: baseSha } } }),
		);
		const pr = prRun();
		expect(pr.status, pr.stderr).toBe(0);
		writeFileSync(eventPath, JSON.stringify({ pull_request: {} }));
		const invalid = prRun();
		expect(invalid.status).not.toBe(0);
		expect(invalid.stderr).toContain("pull_request event has no base SHA");
	}, 30_000);
	it("seeds 27 existing identities, rejects a fresh hand-baselined headline, and shrinks on deletion", () => {
		const dir = fixture();
		const count = baseline(dir).findings.length;
		const seeded = update(dir);
		expect(seeded.status, seeded.stderr).toBe(0);
		const data = baseline(dir);
		expect(data.findings.length - count).toBe(27);
		expect(
			data.findings.filter(
				(entry: { ruleVersion?: string }) =>
					entry.ruleVersion === "copy-props-v1",
			),
		).toHaveLength(27);
		const first = run(dir, "--base", "HEAD");
		const second = run(dir, "--base", "HEAD");
		expect(first.status).toBe(0);
		const fingerprints = first.stdout.match(fingerprintsPattern)?.[0];
		expect(fingerprints).toBeDefined();
		expect(second.stdout).toContain(fingerprints);
		const file = join(dir, "src", "fresh.tsx");
		writeFileSync(file, '<Card headline="A fresh headline" />\n');
		data.findings.push({
			file: "src/fresh.tsx",
			text: "A fresh headline",
			owner: "test",
			payoff: "key",
			ruleVersion: "copy-props-v1",
		});
		writeFileSync(
			join(dir, "scripts/i18n/strings-baseline.json"),
			JSON.stringify(data),
		);
		expect(run(dir, "--base", "HEAD").status).not.toBe(0);
		writeFileSync(file, "");
		data.findings.pop();
		const removed = data.findings.find(
			(entry: { ruleVersion?: string }) =>
				entry.ruleVersion === "copy-props-v1",
		);
		const target = join(dir, removed.file);
		writeFileSync(
			target,
			readFileSync(target, "utf8").replace(removed.text, ""),
		);
		writeFileSync(
			join(dir, "scripts/i18n/strings-baseline.json"),
			JSON.stringify(data),
		);
		expect(update(dir).status).toBe(0);
		expect(baseline(dir).findings.length).toBe(count + 26);
	}, 30_000);
	it("fails closed on a missing ref and a broken snapshot scanner", () => {
		const dir = fixture();
		expect(run(dir, "--base", "missing-ref").status).not.toBe(0);
		writeFileSync(
			join(dir, "scripts/i18n/scan-strings.ts"),
			"throw new Error('scan failed');\n",
		);
		git(dir, "add", "scripts/i18n/scan-strings.ts");
		git(
			dir,
			"-c",
			"user.name=Test",
			"-c",
			"user.email=test@example.invalid",
			"commit",
			"-qm",
			"broken scanner",
		);
		cpSync(
			join(root, "scripts/i18n/scan-strings.ts"),
			join(dir, "scripts/i18n/scan-strings.ts"),
		);
		expect(run(dir, "--base", "HEAD").status).not.toBe(0);
	});
	it("rejects rebaselining an old-rule finding", () => {
		const dir = fixture();
		const data = baseline(dir);
		const old = data.findings.pop();
		writeFileSync(
			join(dir, "scripts/i18n/strings-baseline.json"),
			JSON.stringify(data),
		);
		git(dir, "add", "scripts/i18n/strings-baseline.json");
		git(
			dir,
			"-c",
			"user.name=Test",
			"-c",
			"user.email=test@example.invalid",
			"commit",
			"-qm",
			"remove old exemption",
		);
		data.findings.push({ ...old, ruleVersion: "copy-props-v1" });
		writeFileSync(
			join(dir, "scripts/i18n/strings-baseline.json"),
			JSON.stringify(data),
		);
		expect(run(dir, "--base", "HEAD").status).not.toBe(0);
	});
});
