import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
	PAIR,
	pixelBounds,
	retainComparison,
	retainRaw,
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

it("keeps the observer out of navigation and verdict logic; hosted evidence survives red", () => {
	const source = readFileSync(
		new URL("../../design/preview/capture.mjs", import.meta.url),
		"utf8",
	);
	expect(source).toContain(
		'const target = explicitTarget ?? (check ? "all" : "preview")',
	);
	expect(source).toContain(
		'const diagnostic = diagnosticDir ? await import("./capture-diagnostic.mjs") : null',
	);
	expect(
		source.indexOf("if (diagnostic && !diagnostic.selected(outPath)) return"),
	).toBeGreaterThan(source.indexOf("const save ="));
	expect(source).toContain(
		"const differing = fuzz === 0 ? strict : pixelDifference(fresh, outPath, fuzz)",
	);
	const workflow = readFileSync(
		new URL("../../.github/workflows/capture-diagnostic.yml", import.meta.url),
		"utf8",
	);
	expect(workflow).toContain("for history in all frames; do");
	expect(workflow).toContain("status=" + "$" + "{PIPESTATUS[0]}");
	expect(workflow).toContain('exit "$verdict"');
	expect(workflow).toContain("if: always()");
	expect(workflow).not.toContain("continue-on-error");
});
