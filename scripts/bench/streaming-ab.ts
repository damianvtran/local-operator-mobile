/**
 * Interleaved A/B runner for the streaming render benchmark.
 *
 *   node scripts/bench/streaming-ab.ts [--runs 6] [--base origin/main]
 *
 * WHY IT EXISTS. `src/features/session/components/streaming-bench.test.tsx`
 * prints one `[stream-bench]` JSON line per run. A single run of anything on a
 * shared machine is noise (the same code varies 2x run to run under load), so
 * the before/after claim is: BASELINE and VARIANT runs INTERLEAVED (so a load
 * spike lands on both), n >= 5, median and p95 across runs, and the load
 * average stated next to the table.
 *
 * HOW THE BASELINE RUNS WITHOUT A SECOND CHECKOUT. `git archive <base> src` is
 * extracted into a temp directory, its `node_modules` is a symlink to this
 * checkout's (no install, no copy), and a throwaway vitest config points the
 * `@` alias at the extracted `src`. The bench file itself stays this checkout's,
 * so both arms replay the identical workload through whichever tree `@`
 * names; it only calls exports both trees have.
 *
 * It spawns `vitest` with the repo's own binary and cleans up only the directory
 * it created.
 */
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { loadavg, tmpdir } from "node:os";
import { join, resolve } from "node:path";

const BENCH = "src/features/session/components/streaming-bench.test.tsx";
const repo = resolve(import.meta.dirname, "../..");

const arg = (name: string, fallback: string): string => {
	const at = process.argv.indexOf(`--${name}`);
	return at >= 0 ? (process.argv[at + 1] ?? fallback) : fallback;
};
const runs = Number(arg("runs", "6"));
const base = arg("base", "origin/main");

const work = mkdtempSync(join(tmpdir(), "stream-ab-"));
try {
	// The baseline tree: `src` only, dependencies by symlink.
	const archive = spawnSync(
		"sh",
		["-c", `git archive ${base} src | tar -x -C ${work}`],
		{ cwd: repo, stdio: "inherit" },
	);
	if (archive.status !== 0) throw new Error(`git archive ${base} failed`);
	// The baseline must be the tree BEFORE the paced reveal. If `--base` names a
	// ref that already has it (or this branch's own head), both arms would run
	// the same code and the table would report "no difference" as if measured.
	if (existsSync(join(work, "src/features/session/paced-reveal.ts")))
		throw new Error(
			`--base ${base} already contains paced-reveal.ts: it is not a baseline`,
		);
	symlinkSync(join(repo, "node_modules"), join(work, "node_modules"));
	const config = join(work, "vitest.base.config.ts");
	writeFileSync(
		config,
		`import { defineConfig } from "vitest/config";
export default defineConfig({
	root: ${JSON.stringify(repo)},
	test: {
		environment: "node",
		include: [${JSON.stringify(BENCH)}],
		server: { deps: { inline: [/react-native-web/] } },
		reporters: ["default"],
	},
	server: { fs: { allow: [${JSON.stringify(repo)}, ${JSON.stringify(work)}] } },
	resolve: {
		alias: [
			{ find: /^react-native$/, replacement: "react-native-web" },
			{ find: "@", replacement: ${JSON.stringify(join(work, "src"))} },
		],
	},
});
`,
	);
	mkdirSync(work, { recursive: true });

	type Stat = { median: number; p95: number };
	type Result = {
		cellsPerFrame: Stat;
		nonStreamingRowCommitsPerFrame: Stat;
		streamingLeafCommitsPerSecond: number;
		decodeMs: Stat;
		applyCommitMs: Stat;
		tickMs: Stat;
		frameTotalMs: Stat & { sum: number };
		markdownParseMs: Stat;
		reuseRowsMs: Stat;
	};
	const one = (arm: "baseline" | "variant"): Result => {
		const args =
			arm === "baseline" ? ["run", "--config", config] : ["run", BENCH];
		// The repo's own vitest binary (no `pnpm` on PATH is assumed).
		const out = spawnSync(join(repo, "node_modules/.bin/vitest"), args, {
			cwd: repo,
			encoding: "utf8",
			// A baseline tree fails the variant's gates by design.
			env: {
				...process.env,
				...(arm === "baseline" ? { STREAM_BENCH_REPORT_ONLY: "1" } : {}),
			},
		});
		// A failed run (a crash, a failed gate in the variant) must not be
		// summarised as if it had measured something.
		if (out.error || out.status !== 0)
			throw new Error(
				`${arm}: vitest exited ${out.status ?? out.error?.message}\n${out.stdout}\n${out.stderr}`,
			);
		// vitest colours its output when it believes it is on a terminal or under
		// CI, which puts escape codes in front of the marker; strip them first.
		// biome-ignore lint/suspicious/noControlCharactersInRegex: the ESC byte is the point
		const plain = `${out.stdout}${out.stderr}`.replace(/\u001b\[[0-9;]*m/g, "");
		const line = plain
			.split("\n")
			.map((text) => text.trim())
			.find((text) => text.startsWith("[stream-bench] "));
		if (!line)
			throw new Error(
				`${arm}: no [stream-bench] line\n${out.stdout}\n${out.stderr}`,
			);
		console.log(`${arm} ${line}`);
		return JSON.parse(line.slice("[stream-bench] ".length)) as Result;
	};

	console.log(`load average before: ${loadavg().map((n) => n.toFixed(1))}`);
	const results: Record<"baseline" | "variant", Result[]> = {
		baseline: [],
		variant: [],
	};
	for (let at = 0; at < runs; at += 1) {
		// Interleaved, and the order alternates, so neither arm always runs first.
		const order =
			at % 2 === 0
				? (["baseline", "variant"] as const)
				: (["variant", "baseline"] as const);
		for (const arm of order) results[arm].push(one(arm));
	}
	console.log(`load average after: ${loadavg().map((n) => n.toFixed(1))}`);

	const median = (values: number[]): number => {
		const sorted = [...values].sort((a, b) => a - b);
		return sorted[Math.floor(sorted.length / 2)] ?? 0;
	};
	const rows: [string, (r: Result) => number][] = [
		["renderItem cells re-run / frame (median)", (r) => r.cellsPerFrame.median],
		[
			"non-streaming row commits / frame (median)",
			(r) => r.nonStreamingRowCommitsPerFrame.median,
		],
		["streaming leaf commits / s", (r) => r.streamingLeafCommitsPerSecond],
		["decodeFrame ms (median)", (r) => r.decodeMs.median],
		["decodeFrame ms (p95)", (r) => r.decodeMs.p95],
		["store apply + React commit ms (median)", (r) => r.applyCommitMs.median],
		["store apply + React commit ms (p95)", (r) => r.applyCommitMs.p95],
		["pacing ticks ms / 100 ms frame (median)", (r) => r.tickMs.median],
		["total JS ms / 100 ms frame (median)", (r) => r.frameTotalMs.median],
		["total JS ms / 100 ms frame (p95)", (r) => r.frameTotalMs.p95],
		["total JS ms over 199 frames", (r) => r.frameTotalMs.sum],
		["markdown parse ms / frame (median)", (r) => r.markdownParseMs.median],
		["markdown parse ms / frame (p95)", (r) => r.markdownParseMs.p95],
		["reuseRows ms / frame (median)", (r) => r.reuseRowsMs.median],
	];
	console.log(`\nmedian across ${runs} interleaved runs`);
	console.log("metric | baseline | variant");
	for (const [label, pick] of rows) {
		const before = median(results.baseline.map(pick));
		const after = median(results.variant.map(pick));
		console.log(`${label} | ${before.toFixed(3)} | ${after.toFixed(3)}`);
	}
} finally {
	// Only the directory this run created.
	rmSync(work, { recursive: true, force: true });
}
