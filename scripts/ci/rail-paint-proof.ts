/**
 * The checkpoint rail's PAINT, measured on a native screenshot.
 *
 * WHY THIS EXISTS. PR #196 closed the rail at the component level: the drawn
 * tree per state, 14 mutation-proved tests. What it could not prove is the only
 * thing the operator asked for — that the marks actually appear on the phone
 * while a reader flings, and that the `building` state is visibly different from
 * `deep`. Neither claim is reachable from the web harness, and the web harness is
 * this repository's only visual lane: `src/features/session/transcript-presence.ts`
 * records why (`react-native-web` 0.21 emits only `onScroll`, never a drag or
 * momentum event, so every offset reads as a scroll the app made and the rail is
 * never summoned). On web the rail is a component that cannot paint. On Android
 * it can, so Android is where the claim is settled.
 *
 * WHAT IT MEASURES. One region: the rail's own column. `checkpoint-rail.tsx`
 * places it at `end: RAIL_EDGE_PT` (7 pt) with `width: RAIL_COLUMN_PT` (8 pt),
 * so it occupies 7–15 pt of the right edge, inside the transcript's 16 pt side
 * padding — which is the property that makes this measurement honest: nothing
 * else in the app draws in that band, so a non-background pixel in it is a mark
 * (or the building state's liveness dash), not transcript content that moved.
 * The band is derived from the device's OWN `wm size` and `wm density`, passed
 * in by the capture script, never assumed from a device profile.
 *
 * WHAT IT DOES NOT MEASURE. Whether an 8 pt glyph is legible, and whether the
 * column clears iOS's scroll indicator. Those are a designer's reading of the
 * same frames; this file only counts ink.
 *
 * THE TWO CLAIMS, AND WHY ONLY ONE OF THEM IS A GATE YET. The capture's latency
 * (how long one `adb exec-out screencap` takes) and its per-state pixel counts
 * had no prior distribution in this repository before run 42546977251 — the
 * first run measured 240 frames over two scenario worlds, so the shape is now
 * known but still a single sample. Gating a number one run has seen is how a
 * nightly becomes a coin flip, so this file GATES the two structural claims (the
 * rail paints during a fast fling; `building` and `deep` paint different band
 * content) and only REPORTS latency and counts until two independent runs agree.
 *
 * Reading the report: `state.*.up` is the inkiest frame captured while the fling
 * flow was running, `state.*.down` the inkest captured with no gesture at all.
 * Counts are per threshold (max per-channel delta from the band's modal colour),
 * because a fixed threshold on a 0.55-opacity mark over an unknown background is
 * an assumption; the sweep shows the claim does not depend on which one is read.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

/** The rail's column geometry, mirrored from `checkpoint-rail.tsx`. Two
 *  constants, and the mirror is checked: the bands asserted in
 *  `rail-paint-proof.test.ts` are the same numbers a 320×640 mdpi AVD yields. */
export const RAIL_EDGE_PT = 7;
export const RAIL_COLUMN_PT = 8;

/** The fraction of the frame's height dropped at each end. The transcript's edge
 *  fades are 24 pt gradients pinned to the top and bottom of the list
 *  (`transcript-presence.ts`'s `TRANSCRIPT_FADE_PT`), they span the full width,
 *  and they would put faded transcript content inside the band. 10 % of a 640 pt
 *  frame is 64 pt — more than twice the fade and its ramp — and leaves 80 % of
 *  the track, which is where the marks are. */
export const BAND_ROW_INSET = 0.1;

/** The thresholds the sweep reports, as max per-channel deltas from the band's
 *  modal colour. */
export const COUNT_THRESHOLDS = [1, 4, 8, 16, 32] as const;

/** The threshold the GATED claims read. A `screencap` frame is unfiltered
 *  framebuffer bytes, so the background is byte-identical across a static band
 *  and even 1 would separate ink from it; 8 leaves room for a dithered or
 *  gradient background nobody has looked at yet while sitting far below the
 *  contrast of a 0.55-opacity mark (`RAIL_PEAK_OPACITY`). */
export const GATE_THRESHOLD = 8;

/** The smallest thing the rail can paint: the compact dash is 3 pt × 1 pt
 *  (`DASH_SIZE`), which at the smallest density scale Android ships (1.0) is
 *  3 px. So a rail-up frame that does not beat its rail-down frame by 3 px has
 *  not painted one whole mark. */
export const MIN_INK_PX = 3;

const PNG_SIGNATURE = Uint8Array.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

export type DecodedPng = {
	width: number;
	height: number;
	/** 1 (grey), 3 (RGB) or 4 (RGBA). `adb exec-out screencap -p` emits RGBA. */
	channels: 1 | 3 | 4;
	/** Unfiltered scanlines, top to bottom, `width * channels` bytes each. */
	pixels: Uint8Array;
};

const CHANNELS_BY_COLOUR_TYPE: Record<number, 1 | 3 | 4> = {
	0: 1,
	2: 3,
	4: 4,
	6: 4,
};

/**
 * A PNG decoder for exactly what this lane produces, and nothing else.
 *
 * WHY HAND-ROLLED. The repository declares no image library and this lane must
 * not add one: the decoder needs 8-bit non-interlaced truecolour, which is what
 * `screencap` and `screenrecord`-derived frames emit. Writing it here keeps the
 * measurement testable in vitest on a machine with no emulator, which is the
 * whole reason the arithmetic lives in this file rather than in the shell
 * script.
 *
 * WHAT IT REFUSES. 16-bit depth, palette (3) and grey+alpha (4) images, and
 * interlaced images — each with a message naming the field, because a decoder
 * that silently mis-reads a frame would report a pixel count that means nothing.
 *
 * CRC-32 is NOT verified: a corrupt chunk cannot survive `inflateSync` plus the
 * length/IEND bounds below, and a CRC check would only re-detect the same bytes.
 */
export function decodePng(bytes: Uint8Array, label = "png"): DecodedPng {
	if (bytes.length < 8) throw new Error(`${label}: too short to be a PNG`);
	for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
		if (bytes[i] !== PNG_SIGNATURE[i]) {
			throw new Error(`${label}: bad PNG signature`);
		}
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let offset = 8;
	let width = 0;
	let height = 0;
	let channels: 1 | 3 | 4 = 4;
	let sawHeader = false;
	let sawEnd = false;
	const idat: Uint8Array[] = [];

	while (offset + 8 <= bytes.length) {
		const length = view.getUint32(offset);
		const type = String.fromCharCode(
			bytes[offset + 4] ?? 0,
			bytes[offset + 5] ?? 0,
			bytes[offset + 6] ?? 0,
			bytes[offset + 7] ?? 0,
		);
		const dataStart = offset + 8;
		const dataEnd = dataStart + length;
		if (dataEnd + 4 > bytes.length) {
			throw new Error(`${label}: chunk ${type} runs past the end of the file`);
		}
		if (type === "IHDR") {
			if (length < 13) throw new Error(`${label}: short IHDR`);
			width = view.getUint32(dataStart);
			height = view.getUint32(dataStart + 4);
			const depth = bytes[dataStart + 8];
			const colourType = bytes[dataStart + 9] ?? -1;
			const interlace = bytes[dataStart + 12];
			if (depth !== 8) {
				throw new Error(`${label}: bit depth ${String(depth)} is not 8`);
			}
			if (interlace !== 0) {
				throw new Error(`${label}: interlaced PNGs are not supported`);
			}
			const mapped = CHANNELS_BY_COLOUR_TYPE[colourType];
			if (mapped === undefined) {
				throw new Error(
					`${label}: colour type ${String(colourType)} is not supported`,
				);
			}
			// Grey+alpha carries an alpha the ink count would have to composite
			// against, and no producer in this lane emits it.
			if (colourType === 4) {
				throw new Error(`${label}: grey+alpha pixels are not supported`);
			}
			channels = mapped;
			sawHeader = true;
		} else if (type === "IDAT") {
			idat.push(bytes.subarray(dataStart, dataEnd));
		} else if (type === "IEND") {
			sawEnd = true;
			break;
		}
		offset = dataEnd + 4;
	}

	if (!sawHeader) throw new Error(`${label}: no IHDR`);
	if (!sawEnd) throw new Error(`${label}: truncated (no IEND)`);
	if (width <= 0 || height <= 0) {
		throw new Error(`${label}: ${width}x${height} is not a usable frame`);
	}
	if (idat.length === 0) throw new Error(`${label}: no IDAT`);

	const stride = width * channels;
	const expected = height * (stride + 1);
	const filtered = inflateSync(Buffer.concat(idat));
	if (filtered.length !== expected) {
		throw new Error(
			`${label}: inflated ${filtered.length} bytes, expected ${expected}`,
		);
	}
	return {
		width,
		height,
		channels,
		pixels: unfilter(filtered, height, stride, channels),
	};
}

const PAETH = (a: number, b: number, c: number): number => {
	const p = a + b - c;
	const pa = Math.abs(p - a);
	const pb = Math.abs(p - b);
	const pc = Math.abs(p - c);
	if (pa <= pb && pa <= pc) return a;
	return pb <= pc ? b : c;
};

/** The five PNG scanline filters, into one contiguous pixel buffer.
 *
 *  `bpp` is the byte distance between the same channel in adjacent pixels — the
 *  image's channel count — and is what filter 1 (Sub) and filter 4 (Paeth)
 *  reach back by. Filters 3 and 4 average and predict from the already-
 *  RECONSTRUCTED left and up bytes, not the filtered ones, so `out` is read as it
 *  is written rather than buffered a row at a time. */
function unfilter(
	filtered: Uint8Array,
	height: number,
	stride: number,
	bpp: number,
): Uint8Array {
	const out = new Uint8Array(height * stride);
	let pos = 0;
	for (let y = 0; y < height; y += 1) {
		const filter = filtered[pos] ?? 0;
		pos += 1;
		const row = y * stride;
		const previousRow = row - stride;
		for (let i = 0; i < stride; i += 1) {
			const raw = filtered[pos] ?? 0;
			pos += 1;
			const left = i >= bpp ? (out[row + i - bpp] ?? 0) : 0;
			const up = y > 0 ? (out[previousRow + i] ?? 0) : 0;
			const upLeft = y > 0 && i >= bpp ? (out[previousRow + i - bpp] ?? 0) : 0;
			let value: number;
			switch (filter) {
				case 0:
					value = raw;
					break;
				case 1:
					value = raw + left;
					break;
				case 2:
					value = raw + up;
					break;
				case 3:
					value = raw + ((left + up) >> 1);
					break;
				case 4:
					value = raw + PAETH(left, up, upLeft);
					break;
				default:
					throw new Error(`scanline ${y}: unknown filter ${filter}`);
			}
			out[row + i] = value & 0xff;
		}
	}
	return out;
}

export type RailBand = { x0: number; x1: number; y0: number; y1: number };

/**
 * The band, in device pixels, from the device's own geometry.
 *
 * `densityScale` is `wm density / 160`, which is the `pt → px` factor Android
 * reports for the running emulator. The edges round OUTWARD (floor the outer
 * edge, ceil the inner one) so a mark whose rounded layout lands on a fractional
 * pixel boundary still counts; at an integral scale — the AVD this runs on — the
 * band is exactly the rail's own 8 pt and no wider.
 *
 * AND NO WIDER, deliberately. The transcript's 16 pt (`px-4`) side padding puts
 * its rightmost pixel column at `width - 16·scale`; a band padded by even one
 * pixel past that would count message text as rail ink and turn the whole
 * measurement into a claim about scrolling rather than painting.
 */
export function railBand(
	width: number,
	height: number,
	densityScale: number,
): RailBand {
	const outer = Math.floor((RAIL_EDGE_PT + RAIL_COLUMN_PT) * densityScale);
	const inner = Math.ceil(RAIL_EDGE_PT * densityScale);
	const y0 = Math.round(height * BAND_ROW_INSET);
	return {
		x0: Math.max(0, width - outer),
		x1: Math.min(width, width - inner),
		y0,
		y1: height - y0,
	};
}

export type BandInk = {
	/** The band's most common colour — the background a mark has to differ
	 *  from. Exact bytes, so `counts` is a statement about paint, not noise. */
	modal: [number, number, number];
	/** Pixels whose max per-channel delta from `modal` exceeds each threshold,
	 *  keyed by the threshold. */
	counts: Record<string, number>;
	/** Pixels examined; a band that is not the expected size is a bug upstream. */
	total: number;
};

/** Count ink in one band: `counts[t]` is how many pixels differ from the band's
 *  modal colour by more than `t` on some channel. */
export function countBandInk(
	png: DecodedPng,
	band: RailBand,
	thresholds: readonly number[] = COUNT_THRESHOLDS,
): BandInk {
	const { channels, pixels } = png;
	const histogram = new Map<number, number>();
	const region: Array<[number, number, number]> = [];
	for (let y = band.y0; y < band.y1; y += 1) {
		let index = (y * png.width + band.x0) * channels;
		for (let x = band.x0; x < band.x1; x += 1) {
			let r: number;
			let g: number;
			let b: number;
			if (channels === 1) {
				r = pixels[index] ?? 0;
				g = r;
				b = r;
			} else {
				r = pixels[index] ?? 0;
				g = pixels[index + 1] ?? 0;
				b = pixels[index + 2] ?? 0;
			}
			region.push([r, g, b]);
			const key = (r << 16) | (g << 8) | b;
			histogram.set(key, (histogram.get(key) ?? 0) + 1);
			index += channels;
		}
	}
	let modalKey = 0;
	let modalCount = -1;
	for (const [key, count] of histogram) {
		if (count > modalCount) {
			modalKey = key;
			modalCount = count;
		}
	}
	const modal: [number, number, number] = [
		(modalKey >> 16) & 0xff,
		(modalKey >> 8) & 0xff,
		modalKey & 0xff,
	];
	const counts: Record<string, number> = {};
	for (const threshold of thresholds) counts[String(threshold)] = 0;
	for (const [r, g, b] of region) {
		const delta = Math.max(
			Math.abs(r - modal[0]),
			Math.abs(g - modal[1]),
			Math.abs(b - modal[2]),
		);
		for (const threshold of thresholds) {
			// `noUncheckedIndexedAccess`: a Record lookup is possibly-undefined even
			// after the seeding loop above, so every write defends.
			if (delta > threshold) {
				const key = String(threshold);
				counts[key] = (counts[key] ?? 0) + 1;
			}
		}
	}
	return { modal, counts, total: region.length };
}

/** One line of the capture script's JSONL: the device geometry, once. */
export type ScreenRecord = {
	type: "screen";
	widthPx: number;
	heightPx: number;
	densityDpi: number;
};

/** A phase is the capture script's own claim about what the device was doing:
 *  `pre` is a settled list no gesture has touched, `fling` is while the fast
 *  swipe flow ran, `post` is after it finished. */
export type FramePhase = "pre" | "fling" | "post";

export type FrameRecord = {
	type: "frame";
	/** The mock relay scenario the app was talking to (`checkpoints-deep`…). */
	state: string;
	phase: FramePhase;
	path: string;
	/** Capture start, ms since the epoch — the only cross-phase clock. */
	atMs: number;
	/** Wall time of the `adb exec-out screencap` itself, ms. */
	captureMs: number;
};

export type CapturedFrame = FrameRecord & BandInk;

export type StateReport = {
	/** The inkest frame captured DURING the fling. */
	up: CapturedFrame | null;
	/** The inkest frame captured with no gesture — the rail-down control. */
	down: CapturedFrame | null;
	frames: number;
	/** Gated: the rail painted while flinging. */
	railPaints: boolean;
	/** Reported: the up frame's count minus the down frame's, at the gate
	 *  threshold. */
	inkDelta: number;
};

export type RailPaintReport = {
	schema: "rail-paint-proof/1";
	band: RailBand | null;
	geometry: ScreenRecord | null;
	/** Reported, never gated until two runs agree (see the header). */
	latency: { n: number; minMs: number; medianMs: number; maxMs: number } | null;
	states: Record<string, StateReport>;
	claims: {
		/** Gated: every state paints the rail during a fast fling. */
		railPaints: boolean;
		/** Gated: `building` and `deep` do not paint identical band content. */
		buildingDiffersFromDeep: boolean;
		/** Reported: `building`'s up count minus `deep`'s. Positive is what the
		 *  component's own shape predicts — building draws the same marks plus a
		 *  liveness dash — but the two states are separate captures, so a larger
		 *  magnitude means the fixture tick sets differ, not that the mark grew. */
		buildingMinusDeep: number | null;
	};
	verdict: "pass" | "fail";
};

const inkAt = (frame: CapturedFrame | null): number =>
	frame === null ? 0 : (frame.counts[String(GATE_THRESHOLD)] ?? 0);

/** `building` is the state this comparison is about; `deep` is its control. */
export const DEEP_STATE = "checkpoints-deep";
export const BUILDING_STATE = "checkpoints-building";

const median = (values: readonly number[]): number => {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
	return Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2);
};

/** Group the JSONL's records, decode every frame, and decide the two claims. */
export function analyseFrames(
	records: readonly (ScreenRecord | FrameRecord)[],
	readFrame: (path: string) => Uint8Array = (path) =>
		new Uint8Array(readFileSync(path)),
): RailPaintReport {
	const geometry =
		records.find(
			(record): record is ScreenRecord => record.type === "screen",
		) ?? null;
	const frames = records.filter(
		(record): record is FrameRecord => record.type === "frame",
	);
	if (geometry === null || frames.length === 0) {
		throw new Error("the capture wrote no geometry or no frames");
	}
	const densityScale = geometry.densityDpi / 160;
	const band = railBand(geometry.widthPx, geometry.heightPx, densityScale);

	const captured: CapturedFrame[] = frames.map((frame) => {
		const png = decodePng(readFrame(frame.path), frame.path);
		if (png.width !== geometry.widthPx || png.height !== geometry.heightPx) {
			throw new Error(
				`${frame.path}: ${png.width}x${png.height} does not match the reported ${geometry.widthPx}x${geometry.heightPx}`,
			);
		}
		return { ...frame, ...countBandInk(png, band) };
	});

	const states: Record<string, StateReport> = {};
	for (const state of [...new Set(captured.map((frame) => frame.state))]) {
		const own = captured.filter((frame) => frame.state === state);
		const inkest = (phase: FramePhase): CapturedFrame | null => {
			let best: CapturedFrame | null = null;
			for (const frame of own) {
				if (frame.phase !== phase) continue;
				if (best === null || inkAt(frame) > inkAt(best)) best = frame;
			}
			return best;
		};
		const up = inkest("fling");
		const down = inkest("pre");
		states[state] = {
			up,
			down,
			frames: own.length,
			railPaints: inkAt(up) >= inkAt(down) + MIN_INK_PX,
			inkDelta: inkAt(up) - inkAt(down),
		};
	}

	const deep = states[DEEP_STATE];
	const building = states[BUILDING_STATE];
	if (deep === undefined || building === undefined) {
		throw new Error(
			`the capture must cover both ${DEEP_STATE} and ${BUILDING_STATE}; saw ${Object.keys(states).join(", ") || "none"}`,
		);
	}
	const railPaints = Object.values(states).every((state) => state.railPaints);
	const buildingMinusDeep = inkAt(building.up) - inkAt(deep.up);
	const buildingDiffersFromDeep = buildingMinusDeep !== 0;

	const latencies = frames.map((frame) => frame.captureMs);
	/* A NEGATIVE DURATION IS A BROKEN CLOCK, NOT A FAST CAPTURE, and averaging it
	 * into the distribution is how a 175 ms median silently becomes nonsense. The
	 * capture script times with `/proc/uptime` precisely because the runner's wall
	 * clock steps (26 backward steps in 240 frames of run 42546977251); this is the
	 * check that proves the shortcut held. */
	const stepped = latencies.filter((ms) => ms < 0);
	if (stepped.length > 0) {
		throw new Error(
			`${stepped.length} frame(s) report a negative capture time (${stepped.slice(0, 5).join(", ")}) — the capture clock stepped; it must be monotonic`,
		);
	}
	return {
		schema: "rail-paint-proof/1",
		band,
		geometry,
		latency:
			latencies.length === 0
				? null
				: {
						n: latencies.length,
						minMs: Math.min(...latencies),
						medianMs: median(latencies),
						maxMs: Math.max(...latencies),
					},
		states,
		claims: { railPaints, buildingDiffersFromDeep, buildingMinusDeep },
		verdict: railPaints && buildingDiffersFromDeep ? "pass" : "fail",
	};
}

/** The human-facing lines. Numbers first, verdict last: the numbers are the
 *  evidence and the verdict is only a summary of it. */
export function formatReport(report: RailPaintReport): string {
	const lines: string[] = [];
	const geometry = report.geometry;
	const band = report.band;
	if (geometry !== null && band !== null) {
		lines.push(
			`geometry: ${geometry.widthPx}x${geometry.heightPx} @ ${geometry.densityDpi} dpi (scale ${geometry.densityDpi / 160})`,
		);
		lines.push(
			`band: x ${band.x0}..${band.x1 - 1}, y ${band.y0}..${band.y1 - 1} (${band.x1 - band.x0} px wide)`,
		);
	}
	const latency = report.latency;
	if (latency !== null) {
		lines.push(
			`screencap latency: n=${latency.n} min=${latency.minMs}ms median=${latency.medianMs}ms max=${latency.maxMs}ms`,
		);
	}
	for (const [state, report_] of Object.entries(report.states)) {
		lines.push(`${state}: ${report_.frames} frames`);
		for (const phase of ["down", "up"] as const) {
			const frame = report_[phase];
			if (frame === null) {
				lines.push(`  ${phase}: no frame`);
				continue;
			}
			const counts = COUNT_THRESHOLDS.map(
				(threshold) => `${threshold}:${frame.counts[String(threshold)] ?? 0}`,
			).join(" ");
			lines.push(
				`  ${phase} [t8 ${frame.counts[String(GATE_THRESHOLD)] ?? 0}] ${counts} ${frame.path}`,
			);
		}
		lines.push(`  ink delta (up - down): ${report_.inkDelta}`);
	}
	lines.push(`claim rail-paints-during-fling: ${report.claims.railPaints}`);
	lines.push(
		`claim building-differs-from-deep: ${report.claims.buildingDiffersFromDeep} (building - deep = ${report.claims.buildingMinusDeep})`,
	);
	lines.push(`verdict: ${report.verdict}`);
	return lines.join("\n");
}

/** `node scripts/ci/rail-paint-proof.ts --frames <jsonl> --out <json>` */
function main(argv: readonly string[]): void {
	const readFlag = (name: string): string => {
		const index = argv.indexOf(name);
		const value = index === -1 ? undefined : argv[index + 1];
		if (value === undefined || value.startsWith("--")) {
			throw new Error(`missing ${name} <path>`);
		}
		return value;
	};
	const framesPath = readFlag("--frames");
	const records = readFileSync(framesPath, "utf8")
		.split("\n")
		.filter((line) => line.trim() !== "")
		.map((line) => JSON.parse(line) as ScreenRecord | FrameRecord);
	const report = analyseFrames(records);
	console.log(formatReport(report));
	const outIndex = argv.indexOf("--out");
	const out = outIndex === -1 ? undefined : argv[outIndex + 1];
	if (out !== undefined) {
		writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
		console.log(`report: ${out}`);
	}
	if (report.verdict !== "pass") {
		console.error(
			"::error title=Checkpoint rail did not paint::a gated claim failed — see the numbers above",
		);
		process.exitCode = 1;
	}
}

if (process.argv[1]?.endsWith("rail-paint-proof.ts") === true) {
	main(process.argv.slice(2));
}
