/**
 * The decoder gate for the comparison arithmetic, runnable with plain `node`.
 *
 * WHY A SCRIPT AND NOT ONLY A VITEST FILE: the regression cases that matter live
 * at sizes where ImageMagick prints a `%[fx:...]` value in scientific notation —
 * 1,080,000 pixels and a real 1320x2868 frame at 3,785,760 — and the two places
 * that could run them disagree about tooling. The unit job (`Checks`) has no
 * ImageMagick (measured: `2469 passed | 5 skipped`, and no mention of it in that
 * job's log), so a decoder-dependent vitest test skips there; the design job has
 * ImageMagick 7.1.2-33 but deliberately installs no node dependencies, so it
 * cannot run vitest at all. This script needs neither: it shells out to the
 * decoder and imports the module the capture gate uses.
 *
 * It FAILS when there is no decoder — unlike the vitest file, which skips on a
 * machine without one. The design job installs ImageMagick before this runs, so
 * "no decoder here" is a broken job, not a fine day; a gate that quietly skips in
 * the one job that guarantees its dependency is the same shape as the bug this
 * guards (a path that only runs when everything else is already fine).
 *
 * Run: `node design/preview/frame-difference.probe.mjs` — exit 0 when every case
 * holds, 1 otherwise, printing one line per case.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	alphaTool,
	largestDifference,
	parseScalar,
	pixelDifference,
	STRAY_PIXELS,
} from "./frame-difference.mjs";

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok, detail });

const decoder = alphaTool();
if (!decoder) {
	console.error(
		"PROBLEM: no ImageMagick on this machine, so the frame difference could not be measured.\n" +
			"This gate is installed with `brew install imagemagick` and CI's design job does that\n" +
			"before running it; a run without it proves nothing and is a failure here.",
	);
	process.exit(1);
}

const scratch = mkdtempSync(join(tmpdir(), "frame-difference-probe-"));
try {
	const magick = (args) => execFileSync(decoder, args, { stdio: ["ignore", "pipe", "pipe"] });
	const solid = (name, size, colour) => {
		const path = join(scratch, name);
		magick(["-size", size, `xc:${colour}`, path]);
		return path;
	};

	/* The exact truncation this guards. A large `%[fx:...]` value is printed as
	 * `3.78576e+06` unless `-precision` is raised, and `parseInt` of that is 3. */
	check("parseScalar reads scientific notation whole", parseScalar("3.78576e+06") === 3_785_760);
	check("parseScalar refuses a signed count", parseScalar("-5") === undefined);
	check("parseScalar refuses a formatted report", parseScalar("111.119 (0.0001)") === undefined);

	const black = solid("black.png", "1200x900", "black");
	const white = solid("white.png", "1200x900", "white");
	const full = pixelDifference(black, white, 0);
	check(
		"a 1,080,000-pixel canvas change counts every pixel",
		full === 1_200 * 900,
		`measured ${full}`,
	);
	check("…and cannot pass as stragglers", Number(full) > STRAY_PIXELS * 1_000, `allowance ${STRAY_PIXELS}`);

	const frameBlack = solid("frame-black.png", "1320x2868", "black");
	const frameWhite = solid("frame-white.png", "1320x2868", "white");
	const frameCount = pixelDifference(frameBlack, frameWhite, 0);
	check(
		"a real 1320x2868 frame counts 3,785,760, not 3",
		frameCount === 1_320 * 2_868,
		`measured ${frameCount}`,
	);

	const base = solid("base.png", "600x600", "srgb(242,237,227)");
	const patched = join(scratch, "patched.png");
	magick([
		base,
		"(",
		"+clone",
		"-crop",
		"10x10+40+40",
		"+repage",
		"-evaluate",
		"add",
		"0.78%",
		")",
		"-geometry",
		"+40+40",
		"-composite",
		"-alpha",
		"off",
		`PNG24:${patched}`,
	]);
	check("a 10x10 patch at 0.78% counts 100 at zero tolerance", pixelDifference(base, patched, 0) === 100);
	check("…and is absorbed at 1%", pixelDifference(base, patched, 1) === 0);
	check("identical images count 0", pixelDifference(base, base, 0) === 0);

	/* A patch at 1.57% is four 8-bit levels, and that is what the largest-delta
	 * report has to say — the number a tolerance is chosen against. */
	const deeper = join(scratch, "deeper.png");
	magick([
		base,
		"(",
		"+clone",
		"-crop",
		"10x10+40+40",
		"+repage",
		"-evaluate",
		"add",
		"1.57%",
		")",
		"-geometry",
		"+40+40",
		"-composite",
		"-alpha",
		"off",
		`PNG24:${deeper}`,
	]);
	check("the largest channel difference is reported", largestDifference(base, deeper) === 4);
	check("an unreadable input is could-not-measure", pixelDifference(base, join(scratch, "absent.png"), 0) === undefined);
} finally {
	rmSync(scratch, { recursive: true, force: true });
}

for (const { name, ok, detail } of results) {
	console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail && !ok ? ` — ${detail}` : ""}`);
}
const failed = results.filter((r) => !r.ok).length;
if (failed > 0) {
	console.error(`\n${failed} of ${results.length} frame-difference cases failed`);
	process.exit(1);
}
console.log(`\n${results.length} frame-difference cases hold (decoder: ${decoder})`);
