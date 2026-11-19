import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
	analyzeHistories,
	PAIR,
	pixelBounds,
	retainComparison,
	retainRaw,
	retainSafely,
	selected,
} from "../../design/preview/capture-diagnostic.mjs";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0))
		rmSync(dir, { recursive: true, force: true });
});

it("rejects invalid diagnostic mode before browser discovery", () => {
	const result = spawnSync(
		process.execPath,
		[
			"design/preview/capture.mjs",
			"--target",
			"preview",
			"--check",
			"--diagnostic-dir",
			"/unused",
		],
		{ encoding: "utf8" },
	);
	expect(result.status).not.toBe(0);
	expect(result.stderr).toContain(
		"--diagnostic-dir requires --check and target all or frames",
	);
	expect(result.stdout).not.toContain("preview fonts:");
});

it("retains compared PNGs, absolute diff and coordinate evidence using the real decoder", (ctx) => {
	if (spawnSync("magick", ["--version"]).status !== 0) {
		ctx.skip();
		return;
	}
	const dir = mkdtempSync(join(tmpdir(), "capture-retention-"));
	dirs.push(dir);
	// Fixed 1x1 PNG bytes; this test decodes data, never launches a browser or
	// renders an app. Large hosted listing images follow the same retention path.
	const png = Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
		"base64",
	);
	const input = join(dir, "input.png");
	writeFileSync(input, png);
	const summary = retainComparison(dir, input, input, 1, "magick");
	expect(summary.changed).toBe(0);
	for (const name of ["fresh.png", "baseline.png"])
		expect(readFileSync(join(dir, name))).toEqual(png);
	expect(readFileSync(join(dir, "diff.png")).subarray(1, 4).toString()).toBe(
		"PNG",
	);
	expect(JSON.parse(readFileSync(join(dir, "bounds.json"), "utf8"))).toEqual(
		summary,
	);
});

it("observes exactly the representative pair, without accepting same-named iPhone frames", () => {
	expect(PAIR).toHaveLength(2);
	for (const path of PAIR) expect(selected(`/tree/${path}`)).toBe(true);
	expect(selected("/tree/appstore-iphone-6.9/01-session-transcript.png")).toBe(
		false,
	);
	expect(selected("/tree/play-phone/02-session-diff.png")).toBe(false);
});

it("retains raw bytes separately for same-named frames on different surfaces", () => {
	const dir = mkdtempSync(join(tmpdir(), "capture-observer-"));
	dirs.push(dir);
	for (const [i, path] of PAIR.entries()) {
		const raw = Buffer.from([i, 42, 255]);
		const out = retainRaw(dir, `/tree/${path}`, raw);
		expect(readFileSync(join(out, "raw.png"))).toEqual(raw);
	}
});

it("records signed RGB deltas, inclusive coordinate bounds, and the unchanged 1% threshold", () => {
	const baseline = Buffer.alloc(12, 100);
	const fresh = Buffer.from([
		100, 100, 100, 102, 100, 100, 100, 81, 100, 100, 100, 100,
	]);
	const result = pixelBounds(fresh, baseline, 2, 1);
	expect(result.summary).toEqual({
		width: 2,
		height: 2,
		changed: 2,
		beyondFuzz: 1,
		maxChannelDelta: 19,
		bounds: { changed: [0, 0, 1, 1], beyondFuzz: [0, 1, 0, 1] },
		fuzz: 1,
	});
	expect(result.rows.map(JSON.parse)).toEqual([
		{
			x: 1,
			y: 0,
			baseline: [100, 100, 100],
			fresh: [102, 100, 100],
			delta: [2, 0, 0],
		},
		{
			x: 0,
			y: 1,
			baseline: [100, 100, 100],
			fresh: [100, 81, 100],
			delta: [0, -19, 0],
		},
	]);
	expect(pixelBounds(baseline, baseline, 2, 0).summary.bounds).toEqual({
		changed: null,
		beyondFuzz: null,
	});
	expect(() => pixelBounds(fresh, Buffer.alloc(3), 2, 1)).toThrow(
		"dimensions differ",
	);
});

const observerHook =
	/\t\/\/ Publication is selective;[\s\S]*?\tif \(diagnostic\) diagnostic.retainSafely[^\n]*\n/;
const source = readFileSync(
	new URL("../../design/preview/capture.mjs", import.meta.url),
	"utf8",
);
const workflow = readFileSync(
	new URL("../../.github/workflows/ci.yml", import.meta.url),
	"utf8",
);
const step = (name: string) => {
	const result = workflow
		.split(`      - name: ${name}\n`)[1]
		?.split("\n      - name:")[0];
	if (!result) throw new Error(`missing step ${name}`);
	return result;
};
const stepRun = (name: string) =>
	step(name)
		.split("        run: |\n")[1]
		.split("\n")
		.filter((line) => line.startsWith("          "))
		.map((line) => line.slice(10))
		.join("\n");

it("preserves every original reencode, comparison and verdict in exactly the original order", () => {
	// Fingerprint derived from the complete save-through-scratch-setup block at
	// frozen 175e67064cfba95f127fc89cc46a032a1894b630, not a reconstructed model.
	// A hash keeps this comparison available in Actions' shallow checkout too.
	const save = (text: string) =>
		text.slice(
			text.indexOf("const save ="),
			text.indexOf("const scratchVerify ="),
		);
	const withoutObserver = save(source).replace(observerHook, "");
	expect(createHash("sha256").update(withoutObserver).digest("hex")).toBe(
		"a4e49dc2d3fdca32f9f33240b4da1af686172ea3fab62be1082c3ab4d14005b7",
	);
	expect(source).not.toContain("diagnostic.retainComparison");
	expect(source).not.toContain("diagnostic.selected");
});

it("contains retention throws without skipping subsequent collection", () => {
	const dir = mkdtempSync(join(tmpdir(), "observer-throw-"));
	dirs.push(dir);
	const raw = Buffer.from([1]);
	expect(() =>
		retainSafely(dir, `/tree/${PAIR[0]}`, raw, "/missing", 1, () => {
			throw new Error("injected retention failure");
		}),
	).not.toThrow();
	const input = join(dir, "input.png");
	writeFileSync(input, raw);
	retainSafely(dir, input.replace("input.png", PAIR[1]), raw, input, 1);
	// The next representative is collected before a missing baseline is reported.
	expect(
		readFileSync(join(dir, "play-phone/01-session-transcript/raw.png")),
	).toEqual(raw);
	expect(readFileSync(join(dir, "observer-errors.log"), "utf8")).toContain(
		"injected retention failure",
	);
});

it("continues post-history analysis across observer errors and reports them separately", () => {
	const dir = mkdtempSync(join(tmpdir(), "analysis-throw-"));
	dirs.push(dir);
	for (const history of ["all", "frames"]) {
		for (const path of PAIR) {
			const frame = retainRaw(
				join(dir, history),
				`/tree/${path}`,
				Buffer.from([1]),
			);
			writeFileSync(join(frame, "fuzz.json"), "1");
		}
	}
	let calls = 0;
	expect(
		analyzeHistories(dir, "unused", () => {
			calls++;
			throw new Error("injected decoder failure");
		}),
	).toBe(1);
	expect(calls).toBe(4);
	for (const history of ["all", "frames"])
		expect(
			readFileSync(join(dir, history, "analysis-errors.log"), "utf8"),
		).toContain("injected decoder failure");
});

it("retains raw, fresh and baseline in independent history paths without decoding", () => {
	const dir = mkdtempSync(join(tmpdir(), "retention-history-"));
	dirs.push(dir);
	const baseline = join(dir, PAIR[0]);
	const frame = retainRaw(dir, `/tree/${PAIR[0]}`, Buffer.from([0]));
	// retainRaw creates the surface directory; the baseline need not be a PNG:
	// copy-only observation must never try to decode this negative control.
	writeFileSync(baseline, Buffer.from([11]));
	const fresh = join(frame, "input");
	writeFileSync(fresh, Buffer.from([12]));
	for (const [i, history] of ["all", "frames"].entries()) {
		retainSafely(join(dir, history), baseline, Buffer.from([i]), fresh, 1);
		const out = join(dir, history, "appstore-ipad-13/01-session-transcript");
		expect(readFileSync(join(out, "raw.png"))).toEqual(Buffer.from([i]));
		expect(readFileSync(join(out, "fresh.png"))).toEqual(Buffer.from([12]));
		expect(readFileSync(join(out, "baseline.png"))).toEqual(Buffer.from([11]));
	}
});

it("runs the second history after the first fails and preserves the original red verdict", () => {
	const dir = mkdtempSync(join(tmpdir(), "workflow-history-"));
	dirs.push(dir);
	const first = stepRun(
		"Preview sheet and feature graphic re-render identically",
	);
	const second = stepRun("The committed listing frames re-render identically");
	// Execute the actual workflow shell, substituting only the subject command.
	// No browser is launched. Actions executes each step in a separate shell.
	const prelude = `node() { echo "subject:$*"; case "$*" in *--target*) return 0;; *) return 7;; esac; }; export -f node;`;
	expect(
		spawnSync("mkdir", ["-p", join(dir, "all"), join(dir, "frames")]).status,
	).toBe(0);
	const env = {
		...process.env,
		CAPTURE_DIAGNOSTIC_DIR: dir,
		HOME: dir,
		GITHUB_STEP_SUMMARY: join(dir, "summary"),
	};
	const all = spawnSync("bash", ["-c", `${prelude}\n${first}`], {
		env,
		encoding: "utf8",
	});
	expect(all.status, all.stderr).toBe(0); // original missing-font warning policy
	expect(readFileSync(join(dir, "all/exit-code.txt"), "utf8").trim()).toBe("7");
	const frames = spawnSync(
		"bash",
		["-c", `set -euo pipefail; ${prelude}\n${second}`],
		{ env, encoding: "utf8" },
	);
	expect(frames.status, frames.stderr).toBe(0);
	expect(readFileSync(join(dir, "frames/exit-code.txt"), "utf8").trim()).toBe(
		"0",
	);
	const final = spawnSync(
		"bash",
		[
			"-c",
			stepRun(
				"Retain both original capture verdicts independently of observation",
			),
		],
		{ env, encoding: "utf8" },
	);
	expect(final.status).toBe(1);
	const names = [
		"Preview sheet and feature graphic re-render identically",
		"The frame-difference arithmetic, on this runner's ImageMagick",
		"The frame gate fails a stale frame with its summary, not an uncaught throw",
		"The committed listing frames re-render identically",
		"Render the preview sheet for the review rounds",
		"Analyze retained history pixels after browser teardown",
		"Publish representative evidence even on subject or observer failure",
	];
	for (let i = 1; i < names.length; i++)
		expect(workflow.indexOf(`name: ${names[i]}`)).toBeGreaterThan(
			workflow.indexOf(`name: ${names[i - 1]}`),
		);
	for (const name of names.slice(1, 5))
		expect(step(name)).toContain(
			"success() || (github.event_name == 'workflow_dispatch' && inputs.capture_diagnostic)",
		);
	for (const name of names.slice(5))
		expect(step(name)).toContain(
			"if: always() && github.event_name == 'workflow_dispatch' && inputs.capture_diagnostic",
		);
	expect(workflow).toContain("default: false");
	expect(workflow).not.toContain("continue-on-error");
	expect(source.indexOf("ws.close()")).toBeLessThan(
		source.indexOf("/* ---- report"),
	);
	const analysis = stepRun(
		"Analyze retained history pixels after browser teardown",
	);
	const guard = analysis.indexOf("teardown: 0 processes left, profile removed");
	expect(guard).toBeGreaterThan(-1);
	expect(guard).toBeLessThan(
		analysis.indexOf("node design/preview/capture-diagnostic.mjs"),
	);
	expect(source).not.toContain("analyzeHistories");
});
