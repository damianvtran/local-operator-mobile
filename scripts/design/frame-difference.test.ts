import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
	alphaTool,
	largestDifference,
	parseScalar,
	pixelDifference,
	STRAY_PIXELS,
} from "../../design/preview/frame-difference.mjs";

/**
 * The count `capture.mjs --check` prints ("N pixel(s) differ") is a claim in a
 * gate's log, and it was wrong once: `Number.parseInt` on an ImageMagick
 * `%[fx:...]` value truncated `3.78576e+06` to 3, so a full-canvas change of a
 * real frame read as three pixels — inside the 8-pixel stray allowance, i.e. a
 * wholesale replacement of the image would have passed as encoder noise (review
 * round 2, BLOCKER).
 *
 * These tests pin both halves of the fix: the parse takes a whole number, and the
 * expression is driven with an input that formats in scientific notation, not only
 * with small counts.
 *
 * WHERE THE ARITHMETIC CASES ACTUALLY RUN IN CI: `pnpm test` runs in `Checks` on
 * `ubuntu-latest`, which has no ImageMagick, so the decoder cases skip there and
 * say so. The same cases are a hard gate in the design job, which installs the
 * decoder and runs `design/preview/frame-difference.probe.mjs`; a skip in the one
 * job that guarantees its dependency would be a gate that only runs when it is
 * already fine.
 */

const decoder = alphaTool();

const scratch = mkdtempSync(join(tmpdir(), "frame-difference-"));

afterAll(() => {
	rmSync(scratch, { recursive: true, force: true });
});

const magick = (args: string[]): string =>
	execFileSync(decoder as string, args, {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});

const solid = (name: string, size: string, colour: string): string => {
	const path = join(scratch, name);
	magick(["-size", size, `xc:${colour}`, path]);
	return path;
};

/** A copy of `source` with a `size`-pixel patch raised by `percent`, which is how
 * the earlier rounds' controls were built; the count this returns is the patch's
 * pixel area as long as the patch is uniform. */
const withPatch = (
	source: string,
	size: string,
	offset: string,
	percent: string,
): string => {
	const path = join(scratch, `patched-${size}-${offset}-${percent}.png`);
	magick([
		source,
		"(",
		"+clone",
		"-crop",
		`${size}+${offset}`,
		"+repage",
		"-evaluate",
		"add",
		percent,
		")",
		"-geometry",
		`+${offset}`,
		"-composite",
		"-alpha",
		"off",
		`PNG24:${path}`,
	]);
	return path;
};

describe("parseScalar", () => {
	it("reads scientific notation as the whole number it spells", () => {
		// The exact string a 1320x2868 full-canvas difference printed on
		// ImageMagick 7.1.2-18 before `-precision 20` was added.
		expect(parseScalar("3.78576e+06")).toBe(3_785_760);
		expect(parseScalar("1e+06")).toBe(1_000_000);
		expect(parseScalar("3785760")).toBe(3_785_760);
	});

	it("rounds a formatted fraction rather than truncating it", () => {
		expect(parseScalar("111.9")).toBe(112);
		expect(parseScalar("2.5")).toBe(3);
	});

	it("refuses anything that is not one complete unsigned number", () => {
		/* A prefix parse is the bug this replaces: `111.119 (0.0001)` and a
		 * thousands-separated `1,234` must be "could not measure", never 111 or 1.
		 * A count of pixels cannot be negative either, so a leading sign is refused
		 * rather than turned into `-0` or `-5` and compared as a measurement (round
		 * 3, finding 2). The exponent keeps its sign: that one is real. */
		expect(parseScalar("111.119 (0.0001)")).toBeUndefined();
		expect(parseScalar("1,234")).toBeUndefined();
		expect(parseScalar("-5")).toBeUndefined();
		expect(parseScalar("+5")).toBeUndefined();
		expect(parseScalar("-0")).toBeUndefined();
		expect(parseScalar("")).toBeUndefined();
		expect(parseScalar("abc")).toBeUndefined();
	});
});

describe.skipIf(!decoder)("pixelDifference against a real decoder", () => {
	/* 30s, not vitest's 5s default: each of these shells out to a decoder, and the
	 * unit suite runs up to 161 of these files at once — a loaded machine is not a
	 * defect in the arithmetic. */
	const SLOW = 30_000;

	it(
		"counts a full-canvas change as every pixel, never as its leading digit",
		() => {
			const width = 1200;
			const height = 900;
			const black = solid("black.png", `${width}x${height}`, "black");
			const white = solid("white.png", `${width}x${height}`, "white");

			const count = pixelDifference(black, white, 0);

			/* 1,080,000 is past the 1e6 where the default formatter switches to
			 * scientific notation (measured: it prints `1.08e+06`), so this input
			 * fails a `parseInt` exactly the way a real 1320x2868 frame did. */
			expect(count).toBe(width * height);
			expect(count).toBeGreaterThan(STRAY_PIXELS * 1_000);
		},
		SLOW,
	);

	it(
		"keeps a small count exact, and a tolerance below it absorbs nothing",
		() => {
			const base = solid("base.png", "600x600", "srgb(242,237,227)");
			/* +2/255 is 0.78%: under the 1% tolerance it must vanish, and at zero it
			 * must still count every pixel of the 10x10 patch. */
			const patched = withPatch(base, "10x10", "40+40", "0.78%");

			expect(pixelDifference(base, patched, 0)).toBe(100);
			expect(pixelDifference(base, patched, 1)).toBe(0);
		},
		SLOW,
	);

	it(
		"reports identical images as zero",
		() => {
			const base = solid("same.png", "600x600", "srgb(20,20,20)");
			expect(pixelDifference(base, base, 0)).toBe(0);
		},
		SLOW,
	);

	it(
		"reports the largest channel difference, which is what justifies a tolerance",
		() => {
			const base = solid("spread.png", "600x600", "srgb(100,100,100)");
			const patched = withPatch(base, "10x10", "40+40", "1.57%");
			const black = solid("black-2.png", "600x600", "black");
			const white = solid("white-2.png", "600x600", "white");

			expect(largestDifference(base, patched)).toBe(4);
			expect(largestDifference(black, white)).toBe(255);
		},
		SLOW,
	);

	it(
		"reports a missing file as could-not-measure, never as a count",
		() => {
			const base = solid("present.png", "600x600", "black");
			expect(
				pixelDifference(base, join(scratch, "absent.png"), 0),
			).toBeUndefined();
		},
		SLOW,
	);
});

/** A guard on the import itself: `capture.mjs` and this test must be looking at
 * the same allowance, or the number in the log and the number in the test drift. */
describe("the stray allowance", () => {
	it("is the one the capture script imports", () => {
		expect(Number.isInteger(STRAY_PIXELS)).toBe(true);
		expect(STRAY_PIXELS).toBeGreaterThan(0);
	});
});
