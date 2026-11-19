/** Opt-in observation only: never participates in the capture verdict.
 * Keep every preceding navigation/shot so selecting evidence cannot manufacture
 * a different rasterizer warmup history. No baselines or tolerances are changed.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export const PAIR = [
	"appstore-ipad-13/01-session-transcript.png",
	"play-phone/01-session-transcript.png",
];
export const selected = (path) => PAIR.some((suffix) => path.endsWith(`/${suffix}`));

export function pixelBounds(fresh, baseline, width, fuzz) {
	if (fresh.length !== baseline.length || fresh.length % 3 || fresh.length % (width * 3)) {
		throw new Error("diagnostic RGB dimensions differ");
	}
	const rows = [];
	const bounds = { changed: null, beyondFuzz: null };
	const extend = (key, x, y) => {
		const b = bounds[key];
		bounds[key] = b
			? [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)]
			: [x, y, x, y];
	};
	let maxChannelDelta = 0;
	let beyondFuzz = 0;
	for (let i = 0; i < fresh.length; i += 3) {
		const rgb = [...fresh.subarray(i, i + 3)];
		const before = [...baseline.subarray(i, i + 3)];
		const delta = rgb.map((value, c) => value - before[c]);
		const max = Math.max(...delta.map(Math.abs));
		if (!max) continue;
		const x = (i / 3) % width;
		const y = Math.floor(i / 3 / width);
		extend("changed", x, y);
		if (max > (fuzz / 100) * 255) {
			beyondFuzz++;
			extend("beyondFuzz", x, y);
		}
		maxChannelDelta = Math.max(maxChannelDelta, max);
		rows.push(JSON.stringify({ x, y, baseline: before, fresh: rgb, delta }));
	}
	return { rows, summary: { width, height: fresh.length / 3 / width, changed: rows.length, beyondFuzz, maxChannelDelta, bounds, fuzz } };
}

export function retainRaw(dir, path, png) {
	const frameDir = join(dir, basename(dirname(path)), basename(path, ".png"));
	mkdirSync(frameDir, { recursive: true });
	writeFileSync(join(frameDir, "raw.png"), png);
	return frameDir;
}

export function retainComparison(dir, fresh, baseline, fuzz, bin) {
	copyFileSync(fresh, join(dir, "fresh.png"));
	copyFileSync(baseline, join(dir, "baseline.png"));
	// Decode the exact compared RGB8 files, not a metric's rounded text. The
	// original raw screenshot is retained separately before alpha stripping.
	const dimensions = (path) => {
		const png = readFileSync(path);
		return [png.readUInt32BE(16), png.readUInt32BE(20)];
	};
	const [width, height] = dimensions(fresh);
	const [baselineWidth, baselineHeight] = dimensions(baseline);
	if (width !== baselineWidth || height !== baselineHeight) throw new Error("diagnostic PNG dimensions differ");
	// RGB8 stdout has exactly three bytes per source pixel, so the buffer bound
	// derives from the actual IHDR rather than a guessed runner memory allowance.
	const decode = (path) => execFileSync(bin, [path, "-depth", "8", "RGB:-"], { maxBuffer: width * height * 3 });
	const result = pixelBounds(decode(fresh), decode(baseline), width, fuzz);
	writeFileSync(join(dir, "pixels.jsonl"), `${result.rows.join("\n")}\n`);
	writeFileSync(join(dir, "bounds.json"), `${JSON.stringify(result.summary, null, 2)}\n`);
	execFileSync(bin, [fresh, baseline, "-compose", "difference", "-composite", join(dir, "diff.png")]);
	return result.summary;
}
