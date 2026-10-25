/**
 * The image-comparison primitives `design/preview/capture.mjs --check` runs, in a
 * module of their own so the arithmetic can be exercised without launching Chrome.
 *
 * WHY THEY ARE NOT INLINE IN capture.mjs: the count they return is a claim in a
 * log ("N pixel(s) differ"), and the first version of it was wrong in a way only a
 * test would have caught — see `parseScalar` below. A gate whose number is wrong
 * is worse than one with no number, so the number is testable: `scripts/design/
 * frame-difference.test.ts` drives these against a real decoder.
 *
 * THE RULE for a difference, stated because the number goes in the log: a pixel
 * differs when the LARGEST of its channel differences exceeds `fuzz` percent of
 * the channel range. It is computed from the two images directly — difference,
 * per-channel max, threshold, count — never from a decoder's metric text, whose
 * formatting and semantics differed between the two ImageMagick builds this
 * project runs on (7.1.2-18 here, 7.1.2-33 on CI).
 */
import { execFileSync } from "node:child_process";

/** How many isolated pixels may sit beyond a surface's tolerance and still pass.
 *
 * Measured, not chosen for comfort. Cross-Chrome drift on the runner moves
 * 232-327 pixels by 1/255 on the Play set, 573-790 by 1-2/255 on the phone set,
 * and 9,026-47,479 by 2/255 on the iPad set — all absorbed by the per-surface
 * tolerance. One phone frame also carries a single pixel at 14/255, which fails a
 * zero-outlier rule while saying nothing about content. The smallest content
 * change this project has measured is a 10x10 recolour (100 pixels) and a
 * one-character headline edit is 439-770 pixels, so a handful of isolated pixels
 * cannot hide a real edit.
 *
 * WHAT IT ADMITS, as a stated limit: the allowance counts pixels, it does not
 * test their spatial isolation, so eight adjacent pixels pass exactly as eight
 * scattered ones do. That is deliberate — the alternative is a connected-component
 * count, which is one more parse of a decoder's printed output, the class of bug
 * this module exists to remove. Eight pixels is two thousandths of one percent of
 * the smallest frame; no caption, template, capture or theme change comes near it.
 *
 * Applies only where a surface has a tolerance; the preview sheet and feature
 * graphic keep zero outliers. */
export const STRAY_PIXELS = 8;

export const alphaTool = () =>
	["magick", "convert"].find((bin) => {
		try {
			execFileSync(bin, ["--version"], { stdio: "ignore" });
			return true;
		} catch {
			return false;
		}
	});

/**
 * Parse ONE scalar printed by ImageMagick's `%[fx:...]` formatter.
 *
 * WHY THIS EXISTS AT ALL: `Number.parseInt("3.78576e+06", 10)` is 3. ImageMagick
 * prints a large `%[fx:...]` value in scientific notation, so a full-canvas change
 * of a 1320x2868 frame (3,785,760 pixels) parsed as THREE pixels — under the
 * 8-pixel stray allowance, which would have waved it through as encoder noise.
 * The parse therefore takes the whole string as a number and rounds, and the
 * scan below also passes `-precision 20` so the formatter prints the integer in
 * full; either mechanism alone would do, and the two together mean neither the
 * formatter's default precision nor a future one-argument parse can lose the
 * magnitude.
 *
 * Returns `undefined` for anything that is not one complete number — a suffix, a
 * second value, a locale decimal comma. A caller that cannot read the number must
 * report "could not measure", never a small count.
 */
export const parseScalar = (printed) => {
	const text = String(printed).trim();
	/* Unsigned only. A count of pixels cannot be negative, and a leading sign is
	 * how a formatted report grows a `-0` or a `-5` that would otherwise pass for a
	 * measurement; the exponent keeps its sign, which is the one place it is real. */
	if (!/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) return undefined;
	const value = Number(text);
	return Number.isFinite(value) ? Math.round(value) : undefined;
};

/** Run the shared difference pipeline and parse its one printed scalar.
 *
 * Returns `null` when no decoder is installed (distinct from `undefined`, which
 * means the comparison itself failed): "no decoder" and "could not run" must
 * never read as a pass in a log. */
const differenceScan = (a, b, tail) => {
	const bin = alphaTool();
	if (!bin) return null;
	try {
		const out = execFileSync(
			bin,
			[
				a,
				"-alpha",
				"off",
				b,
				"-alpha",
				"off",
				"-compose",
				"difference",
				"-composite",
				/* Per-channel abs difference; `-separate` splits the channels and
				 * `-evaluate-sequence max` reduces them to the largest one. */
				"-separate",
				"-evaluate-sequence",
				"max",
				/* Print the whole number, not six significant digits of it. */
				"-precision",
				"20",
				...tail,
			],
			{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
		);
		return parseScalar(out);
	} catch {
		return undefined;
	}
};

/** How many pixels differ by more than `fuzz` percent. */
export const pixelDifference = (a, b, fuzz) =>
	differenceScan(a, b, ["-threshold", `${fuzz}%`, "-format", "%[fx:round(mean*w*h)]", "info:"]);

/** The largest per-channel difference anywhere between two images, in 8-bit
 * levels. It is what says how much slack a surface plausibly needs: a count alone
 * cannot distinguish hundreds of 1-level encoder shifts from hundreds of 30-level
 * ones, and a tolerance chosen without that is a guess. */
export const largestDifference = (a, b) =>
	differenceScan(a, b, ["-format", "%[fx:round(maxima*255)]", "info:"]);
