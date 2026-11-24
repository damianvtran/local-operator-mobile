/**
 * The `release-staging` job's artefact-visibility wait, pinned.
 *
 * WHY. That job uploads probe artefacts and downloads them in the same job, and
 * the artefact backend's listing is eventually consistent right after an upload:
 * #348, #349 and #350 each went red with the artefact "not found" ~1 s after
 * finalize and passed on a rerun. The fix is a bounded wait between the uploads
 * and the downloads (see the step's own comment in ci.yml). A later tidy-up that
 * deletes it, moves it after a download, lets it run unbounded or soft-fails it
 * brings the flake back — or worse, hides a real round-trip failure — and no
 * test elsewhere would notice, because the race cannot be reproduced on demand.
 *
 * WHAT IT CHECKS, statically: the wait sits after every upload and before the
 * first download; it polls this run's artefact listing for every uploaded name;
 * it is bounded (step timeout and in-script deadline) and fails with `exit 1`;
 * nothing in the job uses `continue-on-error`; the job grants `actions: read`
 * and writes nothing; and the download steps keep release.yml's `name` + `path`
 * shape (the job exists to mirror release.yml). It also checks the wait is
 * scoped to THIS attempt's uploads (each expected entry is `name=<the upload
 * step's artifact-id output>`, because a rerun's listing still holds the earlier
 * attempt's same-named artefacts) and that every sleep is capped at the time
 * left. Each property has a negative control below proving the check can fail.
 *
 * BEHAVIOUR, not just text: the step's own `run:` script is executed under bash
 * with a fake `gh` on PATH that answers from per-poll JSON fixtures through the
 * script's real `--jq` filter (via `jq -r`, which gh's `--jq` mirrors), so the
 * attempt scoping and the deadline cap are exercised, each with a mutated
 * script as the negative control. Needs `bash` and `jq` (both present on
 * ubuntu-latest and macOS).
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CI = readFileSync(
	fileURLToPath(new URL("../../.github/workflows/ci.yml", import.meta.url)),
	"utf8",
);

const ACTION = readFileSync(
	fileURLToPath(
		new URL(
			"../../.github/actions/upload-android-release/action.yml",
			import.meta.url,
		),
	),
	"utf8",
);

const WAIT_NAME = "Wait until both probe artefacts are listed for this run";

/** The `release-staging:` job block, up to the next top-level job key. */
function jobBlock(text: string): string {
	const lines = text.split("\n");
	const start = lines.indexOf("  release-staging:");
	if (start < 0) throw new Error("release-staging job not found");
	let end = lines.length;
	for (let i = start + 1; i < lines.length; i++) {
		if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[i] ?? "")) {
			end = i;
			break;
		}
	}
	return lines.slice(start, end).join("\n");
}

/** Steps as text chunks, split on `      - ` (the job's step indentation). */
function steps(job: string): string[] {
	return job.split(/\n(?= {6}- )/).slice(1);
}

function problems(text: string, action: string = ACTION): string[] {
	const out: string[] = [];
	const job = jobBlock(text);
	const all = steps(job);
	// Anchored to the step's own `uses:` key (`- uses:` or an 8-space key under
	// `- name:`): the "Assert the release still uses…" step greps for the upload
	// action's text inside its script, which must not count as an upload.
	const isUpload = (s: string) =>
		/^(?: {6}- | {8})uses: (?:\.\/\.github\/actions\/upload-android-release|actions\/upload-artifact@)/m.test(
			s,
		);
	const isDownload = (s: string) =>
		/^(?: {6}- | {8})uses: actions\/download-artifact@/m.test(s);
	const waitIdx = all.findIndex((s) => s.includes(`name: ${WAIT_NAME}`));
	const lastUpload = all.map(isUpload).lastIndexOf(true);
	const firstDownload = all.findIndex(isDownload);
	if (waitIdx < 0) return ["visibility wait step missing"];
	if (lastUpload < 0 || firstDownload < 0)
		out.push("upload/download steps missing");
	if (!(waitIdx > lastUpload && waitIdx < firstDownload))
		out.push("wait is not between the last upload and the first download");

	// Never the `""`: `waitIdx >= 0` past the early return above.
	const wait = all[waitIdx] ?? "";
	if (!wait.includes("actions/runs/$RUN_ID/artifacts"))
		out.push("wait does not poll this run's artefact listing");
	const uploads = all.filter(isUpload).map((s) => ({
		name: /\n\s+name: (\S+)/.exec(s.slice(s.indexOf("with:")))?.[1],
		id: /\n {8}id: (\S+)/.exec(s)?.[1],
	}));
	// Entries are `name` or `name=<value>`, and the value may be a `${{ … }}`
	// expression with spaces inside, so this cannot be a whitespace split.
	const expected = new Map<string, string>();
	for (const m of (/EXPECTED: (.+)/.exec(wait)?.[1] ?? "").matchAll(
		/([\w-]+)(?:=(\$\{\{[^}]*\}\}|\S*))?/g,
	))
		expected.set(m[1] ?? "", m[2] ?? "");
	for (const { name, id } of uploads) {
		if (!name || !expected.has(name)) {
			out.push(`wait does not expect uploaded artefact ${name}`);
			continue;
		}
		// Attempt scoping: the entry must carry the ID that very upload step
		// output, or a rerun's stale same-named artefact satisfies it.
		if (!id || expected.get(name) !== `\${{ steps.${id}.outputs.artifact-id }}`)
			out.push(`wait does not scope ${name} to this attempt's artifact-id`);
	}
	if (!wait.includes('"\\(.name)=\\(.id)"'))
		out.push("wait listing does not pair each name with its artefact id");
	if (
		!/^ {2}artifact-id:\n(?: {4}.*\n)*? {4}value: \$\{\{ steps\.upload\.outputs\.artifact-id \}\}$/m.test(
			action,
		) ||
		!/^ {4}- id: upload\n {6}uses: actions\/upload-artifact@/m.test(action)
	)
		out.push("upload-android-release does not output its artifact-id");
	const stepTimeout = Number(/timeout-minutes: (\d+)/.exec(wait)?.[1]);
	if (!(stepTimeout > 0 && stepTimeout <= 5))
		out.push("wait step timeout missing or > 5 min");
	const limit = Number(/\blimit=(\d+)\n/.exec(wait)?.[1]);
	if (
		!(limit > 0 && limit <= 120) ||
		!wait.includes("deadline=$((start + limit))")
	)
		out.push("in-script deadline missing or > 120 s");
	if (!wait.includes('[ "$delay" -gt "$left" ] && delay=$left'))
		out.push("sleep is not capped at the time left");
	if (!/exit 1/.test(wait))
		out.push("wait does not fail when the deadline passes");
	if (/continue-on-error/.test(job)) out.push("job uses continue-on-error");

	const perms = /\n {4}permissions:\n((?: {6}.+\n)+)/.exec(job)?.[1] ?? "";
	if (!/actions: read/.test(perms)) out.push("job lacks actions: read");
	if (/write/.test(perms)) out.push("job grants a write permission");

	for (const d of all.filter(isDownload)) {
		const keys = [
			...d.slice(d.indexOf("with:")).matchAll(/\n {10}([a-z-]+):/g),
		].map((m) => m[1]);
		if (keys.join(",") !== "name,path")
			out.push(
				`download step drifted from release.yml's name+path shape: ${keys}`,
			);
	}
	return out;
}

describe("release-staging artefact visibility wait", () => {
	it("holds every property on the committed ci.yml", () => {
		expect(problems(CI)).toEqual([]);
	});

	const job = jobBlock(CI);
	const waitStep =
		steps(job).find((s) => s.includes(`name: ${WAIT_NAME}`)) ?? "";
	const mutate = (from: string, to: string) => {
		expect(CI.includes(from)).toBe(true);
		return problems(CI.replace(from, to));
	};

	it("fails when the wait is removed", () => {
		expect(mutate(`${waitStep}\n`, "")).toContain(
			"visibility wait step missing",
		);
	});

	it("fails when the wait moves after a download", () => {
		const dl =
			"      - uses: actions/download-artifact@v8\n        with:\n          name: ios-ipa-probe\n          path: artifacts\n";
		const moved = CI.replace(`${waitStep}\n`, "").replace(
			dl,
			`${dl}${waitStep}\n`,
		);
		expect(problems(moved)).toContain(
			"wait is not between the last upload and the first download",
		);
	});

	it("fails when an uploaded artefact is not awaited", () => {
		expect(
			mutate(
				" ios-ipa-probe=${{ steps.upload-ipa.outputs.artifact-id }}\n",
				"\n",
			),
		).toContain("wait does not expect uploaded artefact ios-ipa-probe");
	});

	it("fails when the wait matches names without this attempt's IDs", () => {
		const ipa = "ios-ipa-probe=${{ steps.upload-ipa.outputs.artifact-id }}";
		const unscoped =
			"wait does not scope ios-ipa-probe to this attempt's artifact-id";
		expect(mutate(ipa, "ios-ipa-probe")).toContain(unscoped);
		expect(
			mutate(
				ipa,
				"ios-ipa-probe=${{ steps.upload-android.outputs.artifact-id }}",
			),
		).toContain(unscoped);
		expect(mutate('"\\(.name)=\\(.id)"', ".name")).toContain(
			"wait listing does not pair each name with its artefact id",
		);
		// The composite action's pass-through is part of the chain.
		const from = "    - id: upload\n      uses: actions/upload-artifact@";
		expect(ACTION.includes(from)).toBe(true);
		expect(
			problems(
				CI,
				ACTION.replace(from, "    - uses: actions/upload-artifact@"),
			),
		).toContain("upload-android-release does not output its artifact-id");
	});

	it("fails when the sleep is not capped at the time left", () => {
		expect(
			mutate('            [ "$delay" -gt "$left" ] && delay=$left\n', ""),
		).toContain("sleep is not capped at the time left");
	});

	it("fails when the wait is unbounded or soft", () => {
		expect(mutate("          limit=60\n", "          limit=3600\n")).toContain(
			"in-script deadline missing or > 120 s",
		);
		expect(mutate("        timeout-minutes: 2\n", "")).toContain(
			"wait step timeout missing or > 5 min",
		);
		expect(
			mutate(
				`        timeout-minutes: 2\n`,
				"        timeout-minutes: 2\n        continue-on-error: true\n",
			),
		).toContain("job uses continue-on-error");
	});

	it("fails when permissions are dropped or widened", () => {
		expect(mutate("      actions: read\n", "")).toContain(
			"job lacks actions: read",
		);
		expect(
			mutate(
				"      contents: read\n      actions: read\n",
				"      contents: write\n      actions: read\n",
			),
		).toContain("job grants a write permission");
	});

	it("fails when a download diverges from release.yml's shape", () => {
		expect(
			mutate(
				"          name: ios-ipa-probe\n          path: artifacts\n",
				"          name: ios-ipa-probe\n          path: artifacts\n          run-id: 1\n",
			),
		).toContain(
			"download step drifted from release.yml's name+path shape: name,path,run-id",
		);
	});
});

/**
 * Run the wait step's real script. `polls[n]` is the artefact listing JSON the
 * fake `gh` returns on poll n (the last one repeats). `${{ steps.<id>.outputs.
 * artifact-id }}` in the step's EXPECTED is replaced from `ids`, exactly as the
 * runner would, so a script whose EXPECTED drops the IDs gets names only.
 */
function runWait(opts: {
	script: string;
	envExpected: string;
	ids: Record<string, string>;
	polls: { id: number; name: string }[][];
}): { status: number | null; out: string; calls: number; seconds: number } {
	const dir = mkdtempSync(join(tmpdir(), "staging-wait-"));
	try {
		opts.polls.forEach((p, i) => {
			const artifacts = p.map((a) => ({ ...a, expired: false }));
			writeFileSync(join(dir, `poll${i}.json`), JSON.stringify({ artifacts }));
		});
		// Answers through the script's own --jq filter, as gh does.
		writeFileSync(
			join(dir, "gh"),
			`#!/usr/bin/env bash
set -euo pipefail
n=$(cat "${dir}/calls" 2>/dev/null || echo 0)
echo $((n + 1)) > "${dir}/calls"
last=${opts.polls.length - 1}
f="${dir}/poll$(( n < last ? n : last )).json"
while [ $# -gt 0 ]; do [ "$1" = --jq ] && { jq -r "$2" "$f"; exit; }; shift; done
exit 2
`,
			{ mode: 0o755 },
		);
		writeFileSync(join(dir, "wait.sh"), opts.script);
		const expected = opts.envExpected.replace(
			/\$\{\{ steps\.([\w-]+)\.outputs\.artifact-id \}\}/g,
			(_, id: string) => opts.ids[id] ?? "",
		);
		const t0 = Date.now();
		const r = spawnSync("bash", [join(dir, "wait.sh")], {
			encoding: "utf8",
			env: {
				...process.env,
				PATH: `${dir}:${process.env.PATH ?? ""}`,
				GH_TOKEN: "synthetic",
				REPO: "example/repo",
				RUN_ID: "1",
				EXPECTED: expected,
			},
		});
		let calls = 0;
		try {
			calls = Number(readFileSync(join(dir, "calls"), "utf8").trim());
		} catch {}
		return {
			status: r.status,
			out: `${r.stdout}${r.stderr}`,
			calls,
			seconds: (Date.now() - t0) / 1000,
		};
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

describe("release-staging artefact visibility wait, executed", () => {
	const waitStep =
		steps(jobBlock(CI)).find((s) => s.includes(`name: ${WAIT_NAME}`)) ?? "";
	const run = waitStep.slice(waitStep.indexOf("run: |\n") + "run: |\n".length);
	const SCRIPT = `${run
		.split("\n")
		.map((l) => l.replace(/^ {10}/, ""))
		.join("\n")}\n`;
	const ENV_EXPECTED = /EXPECTED: (.+)/.exec(waitStep)?.[1]?.trim() ?? "";
	const ids = { "upload-android": "300", "upload-ipa": "400" };
	// A rerun: attempt 1's same-named artefacts are listed from the first poll;
	// this attempt's (300, 400) only appear on poll 2.
	const stale = [
		{ id: 100, name: "android-release-probe" },
		{ id: 200, name: "ios-ipa-probe" },
	];
	const fresh = [
		{ id: 300, name: "android-release-probe" },
		{ id: 400, name: "ios-ipa-probe" },
	];

	it("extracted the committed script", () => {
		expect(SCRIPT).toContain("limit=60\n");
		expect(ENV_EXPECTED).toContain(
			"=${{ steps.upload-ipa.outputs.artifact-id }}",
		);
	});

	it("ignores an earlier attempt's same-named artefacts", () => {
		const r = runWait({
			script: SCRIPT,
			envExpected: ENV_EXPECTED,
			ids,
			polls: [stale, [...stale, ...fresh]],
		});
		expect(r.status, r.out).toBe(0);
		expect(r.calls).toBe(2);
		expect(r.out).toContain(
			"not yet listed: android-release-probe=300 ios-ipa-probe=400",
		);
		expect(r.out).toContain("visible after");
	});

	it("negative control: name-only matching passes on the stale listing", () => {
		// The filter removed (names in EXPECTED and in the listing): the first
		// poll's stale artefacts satisfy it, which the test above rejects.
		const r = runWait({
			script: SCRIPT.replace('"\\(.name)=\\(.id)"', ".name"),
			envExpected: ENV_EXPECTED.replace(/=\$\{\{[^}]*\}\}/g, ""),
			ids,
			polls: [stale, [...stale, ...fresh]],
		});
		expect(r.status, r.out).toBe(0);
		expect(r.calls).toBe(1);
	});

	it("fails at once, with no poll, when an upload output no artifact-id", () => {
		const r = runWait({
			script: SCRIPT,
			envExpected: ENV_EXPECTED,
			ids: { "upload-android": "300" },
			polls: [fresh],
		});
		expect(r.status).toBe(1);
		expect(r.calls).toBe(0);
		expect(r.out).toContain(
			"upload step output no artifact-id for ios-ipa-probe",
		);
	});

	// limit=5 with backoff 1, 2, 4: polls at ~0, 1, 3 s, then at most 2 s are
	// left. Wall-clock time is a poor witness (bash's SECONDS is whole seconds
	// from the shell's start, so it reads up to 1 s ahead), so these sum the
	// sleeps the script announces: capped they never exceed the limit (1+2+≤2);
	// uncapped the third sleep is the full 4 s (1+2+4 = 7).
	const slept = (out: string) =>
		[...out.matchAll(/retrying in (\d+)s/g)].reduce(
			(n, m) => n + Number(m[1] ?? NaN),
			0,
		);

	it("never sleeps past the deadline, and fails loudly at it", () => {
		const r = runWait({
			script: SCRIPT.replace("limit=60\n", "limit=5\n"),
			envExpected: ENV_EXPECTED,
			ids,
			polls: [stale],
		});
		expect(r.status).toBe(1);
		expect(slept(r.out), r.out).toBeGreaterThan(0);
		expect(slept(r.out), r.out).toBeLessThanOrEqual(5);
		// Coarse: each poll costs bash + jq start-up, so wall time runs over the
		// sleeps; the sleep sum above is the discriminating check.
		expect(r.seconds).toBeLessThan(10);
		expect(r.out).toContain("not listed for run 1 within 5s");
		expect(r.out).toContain("--- last listing\nandroid-release-probe=100");
	}, 15_000);

	it("negative control: without the cap the wait sleeps past the deadline", () => {
		const r = runWait({
			script: SCRIPT.replace("limit=60\n", "limit=5\n").replace(
				'[ "$delay" -gt "$left" ] && delay=$left\n',
				"",
			),
			envExpected: ENV_EXPECTED,
			ids,
			polls: [stale],
		});
		expect(r.status).toBe(1);
		expect(slept(r.out), r.out).toBeGreaterThan(5);
	}, 15_000);
});
