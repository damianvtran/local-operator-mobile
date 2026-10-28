/**
 * The frame gate's failing path, driven end to end — for the design job, where a
 * browser and an image decoder both exist.
 *
 * WHY THIS IS A SCRIPT AND NOT ONLY A VITEST TEST: `pnpm test` runs in the `Checks`
 * job on `ubuntu-latest`, which has neither Chrome nor ImageMagick, so a Chrome
 * driven test skips there — and a skipped test is no guard at all. The design job
 * on `macos-26` has both. This module is the one implementation: the CLI below runs
 * it in that job, and `scripts/design/capture-check.test.ts` imports the same
 * function so a developer still gets it from `pnpm test`.
 *
 * WHY THE PATH MATTERS: round 2 moved the comparison arithmetic out of
 * `design/preview/capture.mjs` and `const failures = []` went with it. Every
 * passing run never reaches `stale()`, so nothing failed until the FIRST stale
 * frame — which, on CI, was the preview sheet (its shipped faces live in a sibling
 * checkout). The throw was uncaught: the stale line printed, the summary never did,
 * the remaining captures went unchecked, and the browser tree leaked. This drives
 * exactly that: a one-surface, one-frame tree whose caption is not the one the
 * committed frame was rendered from, so the frame is genuinely stale.
 *
 * Run: `node design/preview/capture-stale.probe.mjs` — exit 0 when the gate fails
 * the way a gate should, 1 otherwise.
 */
import { spawnSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const design = fileURLToPath(new URL("..", import.meta.url));
const SURFACE = "appstore-iphone-6.9";
const SLUG = "01-session-transcript";

const copy = (from, to) => {
	mkdirSync(dirname(to), { recursive: true });
	cpSync(from, to);
};

/** A one-frame design tree: exactly what `--target frames` opens for one surface. */
const buildTree = (tree) => {
	copy(join(design, "preview", "capture.mjs"), join(tree, "preview", "capture.mjs"));
	copy(join(design, "preview", "frame-difference.mjs"), join(tree, "preview", "frame-difference.mjs"));
	copy(
		join(design, "store-screenshots", "iphone-6.9.html"),
		join(tree, "store-screenshots", "iphone-6.9.html"),
	);
	for (const face of ["figtree-variable-latin.woff2", "jetbrains-mono-variable.woff2"]) {
		copy(join(design, "fonts", face), join(tree, "fonts", face));
	}
	copy(
		join(design, "store-screenshots", "app-captures", "iphone-max", `${SLUG}.png`),
		join(tree, "store-screenshots", "app-captures", "iphone-max", `${SLUG}.png`),
	);
	copy(
		join(design, "store-screenshots", SURFACE, `${SLUG}.png`),
		join(tree, "store-screenshots", SURFACE, `${SLUG}.png`),
	);

	/* The real `frames.json`, cut to this one frame with its caption changed: the
	 * fresh render then differs from the committed frame, which is how `stale()` is
	 * reached without touching a committed PNG. */
	const set = JSON.parse(readFileSync(join(design, "store-screenshots", "frames.json"), "utf8"));
	const one = {
		...set,
		surfaces: [
			{
				...set.surfaces[0],
				frames: [
					{ ...set.surfaces[0].frames[0], headline: "Tampered caption, for the failing-path check." },
				],
			},
		],
	};
	mkdirSync(join(tree, "store-screenshots"), { recursive: true });
	writeFileSync(join(tree, "store-screenshots", "frames.json"), `${JSON.stringify(one, null, "\t")}\n`);
};

/** Kill every process whose command line carries `marker`, by exact pid.
 *
 * The failing path is the one that leaks: when `capture.mjs` throws before its
 * teardown, its headless browser survives, and a guard that reports that leak
 * without cleaning it up would be adding to the mess it exists to catch. The
 * marker is the profile path, which carries the child's pid, so it can only ever
 * match this check's own browser. */
const reap = (marker) => {
	const ps = spawnSync("ps", ["-axo", "pid,command"], { encoding: "utf8" }).stdout ?? "";
	for (const line of ps.split("\n")) {
		if (!line.includes(marker)) continue;
		const pid = Number.parseInt(line.trim().split(/\s+/)[0] ?? "", 10);
		if (!Number.isInteger(pid) || pid === process.pid) continue;
		try {
			process.kill(pid, "SIGKILL");
		} catch {
			/* already gone */
		}
	}
};

/**
 * Run the gate against a stale frame in a throwaway tree.
 *
 * Returns `{ skipped }` when this machine has no browser to run it with, else
 * `{ problems, output }` — `problems` empty means the gate failed the way it must.
 */
export const checkStaleFrame = () => {
	const work = mkdtempSync(join(tmpdir(), "capture-stale-"));
	const tree = join(work, "design");
	const scratchBase = join(work, "scratch");
	let runPid = null;
	try {
		buildTree(tree);
		/* The script resolves its own directory through the filesystem, so macOS
		 * reports the temp tree as /private/var/... while `tmpdir()` says /var/... */
		const treeReal = realpathSync(tree);
		const run = spawnSync(
			process.execPath,
			[join(tree, "preview", "capture.mjs"), "--target", "frames", "--check"],
			{
				encoding: "utf8",
				timeout: 180_000,
				/* A scratch base this check owns, so the per-pid tree the child creates is
				 * predictable and its removal is checked rather than trusted. */
				env: { ...process.env, LOCAL_OPERATOR_SCRATCHPAD: scratchBase },
			},
		);
		runPid = run.pid ?? null;
		const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
		if (output.includes("No Chrome or Chromium found")) return { skipped: "no Chrome" };

		const problems = [];
		const expect = (ok, message) => {
			if (!ok) problems.push(message);
		};
		expect(
			output.includes(`stale: ${join(treeReal, "store-screenshots", SURFACE, `${SLUG}.png`)}`),
			"the stale frame was not reported",
		);
		expect(
			output.includes("0 of 1 committed captures verified, 1 stale"),
			"the closing summary was not printed (an uncaught throw ends the run before it)",
		);
		expect(!output.includes("ReferenceError"), "the run threw instead of reporting");
		expect(
			output.includes("teardown: 0 processes left, profile removed"),
			"the browser teardown did not run",
		);
		expect(run.status !== 0, "the gate exited 0 on a stale frame");
		expect(
			!(existsSync(scratchBase) && readdirSync(scratchBase).length > 0),
			"the run left its scratch tree behind",
		);
		const ps = spawnSync("ps", ["-axo", "command"], { encoding: "utf8" }).stdout ?? "";
		expect(!ps.includes(`profile-${String(run.pid)}-`), "a browser process survived the run");
		return { problems, output };
	} finally {
		/* Detect first (above), then clean: a surviving browser is reported as a
		 * problem and then reaped, and the tree is removed with retries because a
		 * browser that is still writing into its profile races the delete. */
		if (runPid !== null) reap(`profile-${String(runPid)}-`);
		try {
			rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
		} catch {
			/* a temp tree the OS will clear; never mask the check's own verdict */
		}
	}
};

/* CLI: the design job runs this. A missing browser or decoder is a FAILURE here,
 * not a skip — both are installed by that job's own steps, so "not found" means the
 * job is broken, and a check that skips where its dependencies are guaranteed
 * cannot guard anything. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const result = checkStaleFrame();
	if (result.skipped) {
		console.error(
			`PROBLEM: ${result.skipped} — the design job installs a browser before this runs, so this is a broken job, not a skip.`,
		);
		process.exit(1);
	}
	for (const problem of result.problems) console.error(`FAIL ${problem}`);
	const stale = result.output.split("\n").filter((l) => /^(stale:|teardown:|\d+ of \d+ )/.test(l));
	for (const line of stale) console.log(`  ${line}`);
	if (result.problems.length > 0) {
		console.error(`\n${result.problems.length} of 7 stale-path conditions failed`);
		process.exit(1);
	}
	console.log("\nthe frame gate fails a stale frame with its summary, its teardown and a non-zero exit");
}
