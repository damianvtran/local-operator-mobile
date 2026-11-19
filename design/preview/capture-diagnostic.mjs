/** Opt-in observation only: never participates in the capture verdict.
 * Keep every preceding navigation/shot so selecting evidence cannot manufacture
 * a different rasterizer warmup history. No baselines or tolerances are changed.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

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
	if (resolve(fresh) !== resolve(dir, "fresh.png")) copyFileSync(fresh, join(dir, "fresh.png"));
	if (resolve(baseline) !== resolve(dir, "baseline.png")) copyFileSync(baseline, join(dir, "baseline.png"));
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

/** Copy-only observer hook. Failure reporting itself must not throw into save().
 * Missing evidence is an observer failure, never a substitute subject verdict.
 * File I/O is still a timing perturbation; this cannot prove a rasterizer cause.
 */
export function retainSafely(dir, path, raw, fresh, fuzz, retain = retainRaw) {
	if (!selected(path)) return;
	try {
		const frame = retain(dir, path, raw);
		copyFileSync(fresh, join(frame, "fresh.png"));
		copyFileSync(path, join(frame, "baseline.png"));
		writeFileSync(join(frame, "fuzz.json"), JSON.stringify(fuzz));
	} catch (error) {
		const message = `observer retention failed: ${path}: ${error.stack ?? error}\n`;
		console.error(message);
		try { appendFileSync(join(dir, "observer-errors.log"), message); }
		catch (reportError) { console.error(`observer error recording failed: ${reportError}`); }
	}
}

/** Called by CI only AFTER both original invocations, probes, and teardown.
 * Continue over missing/bad files so one decoder error cannot hide the other
 * history. Any missing representative or failed analysis makes this step red.
 */
export function analyzeHistories(root, bin = "magick", analyze = retainComparison) {
	let failed = false;
	for (const history of ["all", "frames"]) {
		const dir = join(root, history);
		if (existsSync(join(dir, "observer-errors.log"))) failed = true;
		for (const path of PAIR) {
			const frame = join(dir, dirname(path), basename(path, ".png"));
			try {
				analyze(frame, join(frame, "fresh.png"), join(frame, "baseline.png"),
					JSON.parse(readFileSync(join(frame, "fuzz.json"), "utf8")), bin);
			} catch (error) {
				failed = true;
				mkdirSync(dir, { recursive: true });
				appendFileSync(join(dir, "analysis-errors.log"), `${path}: ${error.stack ?? error}\n`);
			}
		}
	}
	return failed ? 1 : 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	process.exitCode = analyzeHistories(process.argv[2]);
}
